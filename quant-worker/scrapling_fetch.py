from __future__ import annotations

import base64
import json
import re
import sys
from urllib.parse import parse_qsl, urlparse


_FARSIDE_PATHS = frozenset({"/btc/", "/eth/", "/sol/"})
_COINSHARES_PREFIXES = (
    "/insights/research-data/fund-flows-",
    "/us/insights/research-data/fund-flows-",
)
_COINSHARES_INDEX = "/insights/research-data/"
_STORYBLOK_IMAGE = re.compile(
    r"^/f/176807/[^?#]+\.(?:png|jpe?g|webp)/m/$", re.IGNORECASE
)
_CRYPTOCRAFT_EVENT = re.compile(
    r"^/calendar/[1-9]\d*-[a-z0-9]+(?:-[a-z0-9]+)*$", re.IGNORECASE
)


def is_runner_url_allowed(url: str) -> bool:
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.fragment
    ):
        return False
    host = (parsed.hostname or "").casefold()
    if host == "farside.co.uk":
        return parsed.path in _FARSIDE_PATHS and not parsed.query
    if host == "coinshares.com":
        index = parsed.path == _COINSHARES_INDEX and parsed.query in {
            "",
            *(f"page={page}" for page in range(1, 6)),
        }
        article = any(
            parsed.path.startswith(prefix) for prefix in _COINSHARES_PREFIXES
        ) and not parsed.query
        return index or article
    if host == "a.storyblok.com":
        return _STORYBLOK_IMAGE.fullmatch(parsed.path) is not None
    if host == "www.cryptocraft.com":
        week = parsed.path == "/calendar" and parse_qsl(
            parsed.query, keep_blank_values=True
        ) in ([('week', 'this')], [('week', 'next')])
        event = (
            _CRYPTOCRAFT_EVENT.fullmatch(parsed.path) is not None
            and not parsed.query
        )
        return week or event
    return False


def main() -> int:
    try:
        request = json.load(sys.stdin)
        url = request["url"]
        if not isinstance(url, str) or not is_runner_url_allowed(url):
            return 2

        from scrapling.fetchers import Fetcher

        response = Fetcher.get(
            url,
            impersonate="chrome",
            stealthy_headers=True,
            timeout=30,
        )
        body = response.body
        if not isinstance(body, bytes):
            return 3
        payload = {
            "bodyBase64": base64.b64encode(body).decode("ascii"),
            "headers": {
                str(name): str(value)
                for name, value in dict(response.headers).items()
            },
            "status": int(response.status),
            "url": str(response.url),
        }
        json.dump(payload, sys.stdout, separators=(",", ":"))
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
