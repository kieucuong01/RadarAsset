from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import json
import socket
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class SourceFetchError(RuntimeError):
    def __init__(self, code: str, *, status_code: int | None = None) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    url: str


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, *_args: object, **_kwargs: object) -> None:
        return None


def _validate_transport_url(url: str, *, allow_loopback_http: bool) -> None:
    parsed = urlsplit(url)
    valid_scheme = parsed.scheme == "https" or (
        allow_loopback_http
        and parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    )
    if not valid_scheme or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Transport URL is not allowed.")


class UrllibTransport:
    def __init__(
        self,
        *,
        opener: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._opener = opener or build_opener(_NoRedirectHandler())
        self._sleep = sleep

    def fetch(
        self,
        url: str,
        *,
        timeout_seconds: float,
        max_bytes: int,
    ) -> HttpResponse:
        _validate_transport_url(url, allow_loopback_http=False)
        return self._request(
            Request(url, headers={"User-Agent": "DataVest/1.0"}, method="GET"),
            expected_url=url,
            timeout_seconds=timeout_seconds,
            max_bytes=max_bytes,
        )

    def post_json(
        self,
        url: str,
        payload: Mapping[str, object],
        *,
        headers: Mapping[str, str],
        timeout_seconds: float,
        max_bytes: int,
    ) -> dict[str, object]:
        _validate_transport_url(url, allow_loopback_http=True)
        request_headers = {"Content-Type": "application/json", **headers}
        request = Request(
            url,
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers=request_headers,
            method="POST",
        )
        response = self._request(
            request,
            expected_url=url,
            timeout_seconds=timeout_seconds,
            max_bytes=max_bytes,
        )
        try:
            decoded = json.loads(response.body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise SourceFetchError("INVALID_RESPONSE") from error
        if not isinstance(decoded, dict):
            raise SourceFetchError("INVALID_RESPONSE")
        return decoded

    def _request(
        self,
        request: Request,
        *,
        expected_url: str,
        timeout_seconds: float,
        max_bytes: int,
    ) -> HttpResponse:
        if timeout_seconds <= 0 or max_bytes <= 0:
            raise ValueError("Timeout and response limit must be positive.")
        for attempt in range(3):
            try:
                with self._opener.open(request, timeout=timeout_seconds) as response:
                    final_url = response.geturl()
                    if final_url != expected_url:
                        raise SourceFetchError("REDIRECT_REJECTED")
                    body = self._read_bounded(response, max_bytes)
                    return HttpResponse(
                        status=int(getattr(response, "status", 200)),
                        headers=dict(response.headers),
                        body=body,
                        url=final_url,
                    )
            except HTTPError as error:
                if 300 <= error.code < 400:
                    raise SourceFetchError("REDIRECT_REJECTED") from error
                retryable = error.code == 429 or 500 <= error.code < 600
                if retryable and attempt < 2:
                    self._sleep(self._retry_delay(error, attempt))
                    continue
                if error.code == 429:
                    raise SourceFetchError(
                        "RATE_LIMITED", status_code=error.code
                    ) from error
                if 500 <= error.code < 600:
                    raise SourceFetchError(
                        "UPSTREAM_SERVER_ERROR", status_code=error.code
                    ) from error
                raise SourceFetchError(
                    "HTTP_ERROR", status_code=error.code
                ) from error
            except (TimeoutError, socket.timeout) as error:
                raise SourceFetchError("TIMEOUT") from error
            except URLError as error:
                if isinstance(error.reason, (TimeoutError, socket.timeout)):
                    raise SourceFetchError("TIMEOUT") from error
                raise SourceFetchError("NETWORK_ERROR") from error
        raise SourceFetchError("UPSTREAM_SERVER_ERROR")

    @staticmethod
    def _retry_delay(error: HTTPError, attempt: int) -> float:
        retry_after = error.headers.get("Retry-After") if error.headers else None
        if retry_after is not None:
            try:
                return min(max(float(retry_after), 0.0), 60.0)
            except ValueError:
                pass
        return float(min(2**attempt, 60))

    @staticmethod
    def _read_bounded(response: Any, max_bytes: int) -> bytes:
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            try:
                if int(content_length) > max_bytes:
                    raise SourceFetchError("RESPONSE_TOO_LARGE")
            except ValueError:
                pass
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = response.read(min(65_536, max_bytes - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise SourceFetchError("RESPONSE_TOO_LARGE")
            chunks.append(chunk)
        return b"".join(chunks)
