from __future__ import annotations

import argparse
from collections.abc import Callable, Sequence
from io import TextIOBase
from pathlib import Path
import sys
from typing import Any
from uuid import uuid4

from datavest_env import read_env_file


_REQUIRED_SETTINGS = (
    "DATAVEST_S3_ENDPOINT_URL",
    "DATAVEST_S3_BUCKET",
    "DATAVEST_S3_ACCESS_KEY_ID",
    "DATAVEST_S3_SECRET_ACCESS_KEY",
)


def _error_code(error: Exception) -> str:
    return str(getattr(error, "response", {}).get("Error", {}).get("Code", ""))


def anonymous_read_is_denied(client: Any, bucket: str, key: str) -> bool:
    try:
        client.get_object(Bucket=bucket, Key=key)
    except Exception as error:
        if _error_code(error) in {"403", "AccessDenied", "Forbidden"}:
            return True
        raise
    return False


def verify_access(
    client: Any,
    bucket: str,
    key: str,
    payload: bytes,
    *,
    anonymous_client: Any | None = None,
) -> dict[str, str]:
    if bucket != "datavest":
        raise ValueError("The smoke test is restricted to the datavest bucket.")
    if not key.startswith("_deployment-smoke/") or not key.endswith(".txt"):
        raise ValueError("The smoke object key is outside the allowed prefix.")

    result: dict[str, str] = {}
    created = False
    client.head_bucket(Bucket=bucket)
    result["head_bucket"] = "ok"
    client.list_objects_v2(Bucket=bucket, MaxKeys=1)
    result["list_objects"] = "ok"
    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=payload,
            ContentType="text/plain",
        )
        created = True
        result["put_object"] = "ok"
        head = client.head_object(Bucket=bucket, Key=key)
        if head.get("ContentLength") != len(payload):
            raise RuntimeError("Smoke object length verification failed.")
        result["head_object"] = "ok"
        response = client.get_object(Bucket=bucket, Key=key)
        if response["Body"].read(len(payload) + 1) != payload:
            raise RuntimeError("Smoke object content verification failed.")
        result["get_object"] = "ok"
        if anonymous_client is not None:
            if not anonymous_read_is_denied(anonymous_client, bucket, key):
                raise RuntimeError("Smoke object is anonymously readable.")
            result["anonymous_read"] = "denied"
        client.delete_object(Bucket=bucket, Key=key)
        created = False
        result["delete_object"] = "ok"
        remaining = client.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
        if remaining.get("KeyCount") != 0:
            raise RuntimeError("Deleted smoke object is still visible.")
        result["deleted_object_absent"] = "ok"
        return result
    finally:
        if created:
            client.delete_object(Bucket=bucket, Key=key)


def _default_client_factory(settings: dict[str, str]) -> tuple[Any, Any]:
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    authenticated = boto3.client(
        "s3",
        endpoint_url=settings["DATAVEST_S3_ENDPOINT_URL"],
        aws_access_key_id=settings["DATAVEST_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=settings["DATAVEST_S3_SECRET_ACCESS_KEY"],
        region_name="us-east-1",
    )
    anonymous = boto3.client(
        "s3",
        endpoint_url=settings["DATAVEST_S3_ENDPOINT_URL"],
        region_name="us-east-1",
        config=Config(signature_version=UNSIGNED),
    )
    return authenticated, anonymous


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify private DataVest S3 access.")
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--bucket", required=True)
    return parser


def run(
    argv: Sequence[str] | None = None,
    *,
    client_factory: Callable[[dict[str, str]], tuple[Any, Any]] = _default_client_factory,
    output: TextIOBase = sys.stdout,
) -> int:
    try:
        args = _argument_parser().parse_args(argv)
        settings = read_env_file(Path(args.env_file))
        for name in _REQUIRED_SETTINGS:
            if not settings.get(name, "").strip():
                raise ValueError(f"{name} is required.")
        if args.bucket != settings["DATAVEST_S3_BUCKET"] or args.bucket != "datavest":
            raise ValueError("Configured bucket does not match datavest.")
        authenticated, anonymous = client_factory(settings)
        key = f"_deployment-smoke/access-check-{uuid4().hex}.txt"
        result = verify_access(
            authenticated,
            args.bucket,
            key,
            b"datavest s3 access verification\n",
            anonymous_client=anonymous,
        )
        for name, status in result.items():
            output.write(f"{name}={status}\n")
        return 0
    except Exception:
        output.write("s3_access=failed\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(run())
