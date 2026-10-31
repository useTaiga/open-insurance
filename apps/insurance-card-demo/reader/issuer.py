import json
import os
from http.client import HTTPConnection, HTTPSConnection
from urllib.parse import urlsplit

from vas import open_capture, run_vas


def issuer_request(base, path, data=None, token=None):
    url = urlsplit(base)
    if (
        not url.hostname or url.username or url.password or url.query or url.fragment
        or (url.scheme != "https" and not (
            url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost", "::1"}
        ))
    ):
        raise ValueError("Use an HTTPS issuer URL, or HTTP on loopback for a local test.")
    connection_type = HTTPSConnection if url.scheme == "https" else HTTPConnection
    connection = connection_type(url.hostname, url.port, timeout=10)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        connection.request(
            "GET" if data is None else "POST",
            url.path.rstrip("/") + path,
            body=None if data is None else json.dumps(data),
            headers=headers,
        )
        response = connection.getresponse()
        if not 200 <= response.status < 300:
            raise ValueError(f"Issuer request rejected (HTTP {response.status}). No redirects are followed.")
        return json.load(response)
    finally:
        connection.close()


def prepare_issuer(args):
    token = os.environ.get(args.token_env)
    if not token:
        raise ValueError(f"Set {args.token_env} to a clinic token with the issuer's intake audience.")
    config = issuer_request(args.issuer, "/reader/config")
    if config.get("nfcReady") is not True or config.get("sendsEligibility") is not False:
        raise ValueError("Issuer NFC setup is blocked. Run its setup checker before a physical read.")
    identifier = config.get("passTypeIdentifier")
    if not isinstance(identifier, str) or not identifier.startswith("pass."):
        raise ValueError("Issuer returned an invalid pass identifier.")
    return identifier, token


def read_issuer(args, reader, identifier, token):
    envelope = run_vas(reader, identifier, args.timeout, use_ecp=not args.no_ecp)
    result = issuer_request(args.issuer, "/clinic/vas", data=envelope, token=token)
    if result.get("sent") is not False:
        raise ValueError("Issuer did not confirm preparation-only handling.")
    return result


def save_result(filename, result):
    with open_capture(filename) as output:
        json.dump(result, output, indent=2)
        output.write("\n")
