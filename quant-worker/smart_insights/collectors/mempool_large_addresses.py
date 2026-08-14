from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import json
from typing import Any
from urllib.parse import quote

from smart_insights.contracts import ObservationInput, RawSnapshot
from smart_insights.exchange_labels import ExchangeLabel, exchange_labels_by_address
from smart_insights.http import HttpResponse, SourceFetchError, UrllibTransport
from smart_insights.sources import source_for_code

from . import CollectionBatch


_SATOSHIS = Decimal("100000000")


@dataclass(frozen=True, slots=True)
class AddressWatch:
    address: str
    rank: int
    discovery_balance_btc: Decimal
    label_status: str
    cohort_version: str

    def __post_init__(self) -> None:
        if self.rank < 1 or self.rank > 100:
            raise ValueError("Address rank is outside the tracked universe.")
        if self.discovery_balance_btc < Decimal("1000"):
            raise ValueError("Tracked address balance is below the universe floor.")
        if not self.address or not self.cohort_version:
            raise ValueError("Tracked address metadata is required.")


def _btc_from_sats(value: object) -> Decimal:
    try:
        sats = Decimal(str(value))
    except (InvalidOperation, TypeError) as error:
        raise ValueError("INVALID_VALUE") from error
    if not sats.is_finite() or sats < 0 or sats != sats.to_integral_value():
        raise ValueError("INVALID_VALUE")
    return sats / _SATOSHIS


def _ratio(numerator: int | Decimal, denominator: int | Decimal) -> Decimal:
    if Decimal(denominator) <= 0:
        return Decimal("1.000000")
    return (Decimal(numerator) / Decimal(denominator)).quantize(Decimal("0.000001"))


class MempoolLargeAddressCollector:
    def __init__(
        self,
        *,
        transport: Any | None = None,
        labels: Mapping[str, ExchangeLabel] | None = None,
    ) -> None:
        self.source = source_for_code("mempool-btc-large-addresses")
        self._transport = transport or UrllibTransport()
        self._labels = dict(labels or exchange_labels_by_address())

    def collect(
        self,
        as_of: datetime,
        *,
        watchlist: Sequence[AddressWatch],
        previous_cutoff: datetime | None,
        balance_history: Mapping[date, Mapping[str, Decimal]],
        last_outgoing: Mapping[str, datetime],
    ) -> CollectionBatch:
        del balance_history, last_outgoing
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise ValueError("as_of must be timezone-aware.")
        effective_at = as_of.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        payloads: dict[str, object] = {}
        if not watchlist:
            snapshot = self._snapshot(payloads, as_of, effective_at)
            return CollectionBatch(self.source, snapshot, (), "MISSING_WATCHLIST")

        try:
            tip_response = self._fetch(self.source.urls[1])
            tip_height = int(tip_response.body.decode("ascii"))
        except (SourceFetchError, UnicodeDecodeError, ValueError):
            snapshot = self._snapshot(payloads, as_of, effective_at)
            return CollectionBatch(self.source, snapshot, (), "INVALID_RESPONSE")
        payloads["tip_height"] = tip_height

        observations: list[ObservationInput] = []
        successful_balances = 0
        successful_transactions = 0
        reviewed_value = Decimal("0")
        external_value = Decimal("0")
        to_exchange = Decimal("0")
        from_exchange = Decimal("0")
        balances: list[tuple[AddressWatch, Decimal]] = []
        seen_txids: set[str] = set()

        for watch in watchlist:
            address_url = f"{self.source.urls[0]}{quote(watch.address, safe='')}"
            try:
                summary_response = self._fetch(address_url)
                summary = json.loads(summary_response.body)
                if not isinstance(summary, dict):
                    raise ValueError("SCHEMA_DRIFT")
                chain_stats = summary.get("chain_stats")
                if not isinstance(chain_stats, dict):
                    raise ValueError("SCHEMA_DRIFT")
                funded = _btc_from_sats(chain_stats["funded_txo_sum"])
                spent = _btc_from_sats(chain_stats["spent_txo_sum"])
                balance = funded - spent
                if balance < 0:
                    raise ValueError("INVALID_VALUE")
                successful_balances += 1
                balances.append((watch, balance))
                payloads[f"address:{watch.address}"] = summary
                observations.append(
                    self._row(
                        "crypto.large_address.confirmed_balance_btc",
                        balance,
                        effective_at,
                        {
                            "address": watch.address,
                            "rank": str(watch.rank),
                            "cohort_version": watch.cohort_version,
                            "label_status": watch.label_status,
                        },
                    )
                )
            except (SourceFetchError, UnicodeDecodeError, json.JSONDecodeError, KeyError, ValueError):
                continue

            try:
                transactions = self._transaction_history(
                    address_url, previous_cutoff=previous_cutoff
                )
                payloads[f"transactions:{watch.address}"] = transactions
                successful_transactions += 1
            except (SourceFetchError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
                continue

            for transaction in transactions:
                parsed = self._transaction(
                    transaction,
                    watch=watch,
                    tip_height=tip_height,
                    previous_cutoff=previous_cutoff,
                )
                if parsed is None or parsed[0] in seen_txids:
                    continue
                txid, row, reviewed, external, to_value, from_value = parsed
                seen_txids.add(txid)
                observations.append(row)
                reviewed_value += reviewed
                external_value += external
                to_exchange += to_value
                from_exchange += from_value

        address_coverage = _ratio(successful_balances, len(watchlist))
        transaction_coverage = _ratio(successful_transactions, len(watchlist))
        flow_label_coverage = _ratio(reviewed_value, external_value)
        common_dimensions = {
            "cohort_version": watchlist[0].cohort_version,
            "confirmation_policy": "6",
        }
        observations.extend(
            (
                self._row("crypto.large_address.to_exchange_btc", to_exchange, effective_at, common_dimensions),
                self._row("crypto.large_address.from_exchange_btc", from_exchange, effective_at, common_dimensions),
                self._row("crypto.large_address.exchange_flow_pressure_btc", to_exchange - from_exchange, effective_at, common_dimensions),
                self._row("crypto.large_address.address_coverage", address_coverage, effective_at, common_dimensions),
                self._row("crypto.large_address.transaction_coverage", transaction_coverage, effective_at, common_dimensions),
                self._row("crypto.large_address.flow_label_coverage", flow_label_coverage, effective_at, common_dimensions),
            )
        )
        if balances:
            ordered = sorted((balance for _, balance in balances), reverse=True)
            total = sum(ordered, Decimal("0"))
            concentration = (
                sum(ordered[:10], Decimal("0")) / total if total else Decimal("0")
            )
            observations.append(
                self._row(
                    "crypto.large_address.top10_concentration",
                    concentration.quantize(Decimal("0.000001")),
                    effective_at,
                    common_dimensions,
                )
            )
        if min(address_coverage, transaction_coverage) < Decimal("0.900000"):
            observations = [
                replace(
                    row,
                    quality_flags=tuple(
                        dict.fromkeys(
                            (*row.quality_flags, "PARTIAL_ADDRESS_COVERAGE")
                        )
                    ),
                )
                for row in observations
            ]
        snapshot = self._snapshot(payloads, as_of, effective_at)
        return CollectionBatch(self.source, snapshot, tuple(observations))

    def _transaction_history(
        self, address_url: str, *, previous_cutoff: datetime | None
    ) -> list[object]:
        url = f"{address_url}/txs"
        transactions: list[object] = []
        cursors: set[str] = set()
        for _ in range(20):
            response = self._fetch(url)
            page = json.loads(response.body)
            if not isinstance(page, list):
                raise ValueError("SCHEMA_DRIFT")
            transactions.extend(page)
            if len(page) < 25:
                break
            last = page[-1]
            if not isinstance(last, dict):
                raise ValueError("SCHEMA_DRIFT")
            txid = last.get("txid")
            status = last.get("status")
            if not isinstance(txid, str) or len(txid) != 64 or txid in cursors:
                raise ValueError("PAGINATION_ORDER")
            if previous_cutoff is not None and isinstance(status, dict):
                try:
                    block_time = datetime.fromtimestamp(
                        int(status["block_time"]), timezone.utc
                    )
                except (KeyError, TypeError, ValueError, OverflowError, OSError):
                    block_time = None
                if block_time is not None and block_time < previous_cutoff:
                    break
            cursors.add(txid)
            url = f"{address_url}/txs/chain/{quote(txid, safe='')}"
        return transactions

    def _transaction(
        self,
        payload: object,
        *,
        watch: AddressWatch,
        tip_height: int,
        previous_cutoff: datetime | None,
    ) -> tuple[str, ObservationInput, Decimal, Decimal, Decimal, Decimal] | None:
        if not isinstance(payload, dict):
            return None
        txid = payload.get("txid")
        status = payload.get("status")
        vin = payload.get("vin")
        vout = payload.get("vout")
        if not isinstance(txid, str) or len(txid) != 64:
            return None
        if not isinstance(status, dict) or not isinstance(vin, list) or not isinstance(vout, list):
            return None
        if status.get("confirmed") is not True:
            return None
        try:
            block_height = int(status["block_height"])
            block_time = datetime.fromtimestamp(int(status["block_time"]), timezone.utc)
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            return None
        confirmations = tip_height - block_height + 1
        if confirmations < 6 or (previous_cutoff is not None and block_time < previous_cutoff):
            return None

        tracked_inputs = self._input_value(vin, watch.address)
        tracked_outputs = self._output_value(vout, watch.address)
        net = tracked_outputs - tracked_inputs
        to_value = Decimal("0")
        from_value = Decimal("0")
        reviewed = Decimal("0")
        external = Decimal("0")
        counterparties: set[str] = set()

        if net < 0:
            external_outputs = self._external_outputs(vout, watch.address)
            external = min(-net, sum(external_outputs.values(), Decimal("0")))
            reviewed_outputs = {
                address: value
                for address, value in external_outputs.items()
                if self._reviewed_label(address) is not None
            }
            reviewed = min(external, sum(reviewed_outputs.values(), Decimal("0")))
            to_value = reviewed
            counterparties.update(reviewed_outputs)
            code = "crypto.large_address.confirmed_outgoing_btc"
            value = -net
            direction = "outgoing"
        elif net > 0:
            external_inputs = self._external_inputs(vin, watch.address)
            external = min(net, sum(external_inputs.values(), Decimal("0")))
            reviewed_inputs = {
                address: value
                for address, value in external_inputs.items()
                if self._reviewed_label(address) is not None
            }
            reviewed = min(external, sum(reviewed_inputs.values(), Decimal("0")))
            from_value = reviewed
            counterparties.update(reviewed_inputs)
            code = "crypto.large_address.confirmed_incoming_btc"
            value = net
            direction = "incoming"
        else:
            return None

        names = sorted(
            {
                label.entity_name
                for address in counterparties
                if (label := self._reviewed_label(address)) is not None
            }
        )
        row = self._row(
            code,
            value,
            block_time,
            {
                "address": watch.address,
                "block_time": block_time.isoformat(),
                "confirmation_count": str(confirmations),
                "counterparty": ", ".join(names) if names else "unknown",
                "direction": direction,
                "txid": txid,
            },
        )
        return txid, row, reviewed, external, to_value, from_value

    def _reviewed_label(self, address: str) -> ExchangeLabel | None:
        label = self._labels.get(address)
        if label is None or label.confidence not in {"verified", "reviewed"}:
            return None
        return label

    @staticmethod
    def _input_value(rows: Sequence[object], address: str) -> Decimal:
        return sum(
            (
                _btc_from_sats(prevout.get("value"))
                for row in rows
                if isinstance(row, dict)
                and isinstance((prevout := row.get("prevout")), dict)
                and prevout.get("scriptpubkey_address") == address
            ),
            Decimal("0"),
        )

    @staticmethod
    def _output_value(rows: Sequence[object], address: str) -> Decimal:
        return sum(
            (
                _btc_from_sats(row.get("value"))
                for row in rows
                if isinstance(row, dict) and row.get("scriptpubkey_address") == address
            ),
            Decimal("0"),
        )

    @staticmethod
    def _external_inputs(rows: Sequence[object], tracked: str) -> dict[str, Decimal]:
        result: dict[str, Decimal] = {}
        for row in rows:
            prevout = row.get("prevout") if isinstance(row, dict) else None
            if not isinstance(prevout, dict):
                continue
            address = prevout.get("scriptpubkey_address")
            if not isinstance(address, str) or address == tracked:
                continue
            result[address] = result.get(address, Decimal("0")) + _btc_from_sats(prevout.get("value"))
        return result

    @staticmethod
    def _external_outputs(rows: Sequence[object], tracked: str) -> dict[str, Decimal]:
        result: dict[str, Decimal] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            address = row.get("scriptpubkey_address")
            if not isinstance(address, str) or address == tracked:
                continue
            result[address] = result.get(address, Decimal("0")) + _btc_from_sats(row.get("value"))
        return result

    def _fetch(self, url: str) -> HttpResponse:
        response = self._transport.fetch(url, timeout_seconds=30, max_bytes=10_000_000)
        if response.status != 200 or response.url != url:
            raise SourceFetchError("INVALID_RESPONSE")
        return response

    def _snapshot(
        self, payloads: Mapping[str, object], observed_at: datetime, effective_at: datetime
    ) -> RawSnapshot:
        return RawSnapshot(
            content=json.dumps(payloads, sort_keys=True, separators=(",", ":")).encode("utf-8"),
            content_type="application/json",
            source_url=self.source.urls[0],
            effective_at=effective_at,
            published_at=None,
            observed_at=observed_at,
            metadata={
                "parser_version": self.source.parser_version,
                "confirmation_policy": 6,
            },
        )

    @staticmethod
    def _row(
        code: str,
        value: Decimal,
        effective_at: datetime,
        dimensions: Mapping[str, str],
    ) -> ObservationInput:
        return ObservationInput(
            metric_code=code,
            value=value,
            effective_at=effective_at,
            asset_symbol="BTC",
            dimensions=dimensions,
            quality_status="warning",
            quality_flags=("LARGE_ADDRESS_PROXY",),
        )
