from __future__ import annotations

import base64
import json
import re
import sys
from urllib.parse import urlparse


_FARSIDE_PATHS = frozenset({"/btc/", "/eth/", "/sol/"})
_COINSHARES_PREFIXES = (
    "/insights/research-data/fund-flows-",
    "/us/insights/research-data/fund-flows-",
)
_STORYBLOK_IMAGE = re.compile(
    r"^/f/176807/[^?#]+\.(?:png|jpe?g|webp)/m/$", re.IGNORECASE
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
        return any(parsed.path.startswith(prefix) for prefix in _COINSHARES_PREFIXES)
    if host == "a.storyblok.com":
        return _STORYBLOK_IMAGE.fullmatch(parsed.path) is not None
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
