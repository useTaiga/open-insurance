import argparse
import json
import sys
import time
from contextlib import ExitStack
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import nfc
import nfc.clf.pn53x
from serial.tools.list_ports import comports


def request(path, data=None):
    incoming = Request(
        "http://127.0.0.1:4320" + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(incoming, timeout=10) as response:
            return json.load(response)
    except HTTPError as error:
        message = json.load(error).get("error", "The demo rejected this card.")
        raise ValueError(message) from error


def device_path(explicit):
    if explicit:
        return explicit
    ports = [
        port for port in comports() if (port.vid, port.pid) == (0x0403, 0x6001)
    ]
    if len(ports) != 1:
        raise ValueError(
            "Connect the FT232R USB adapter, or select the PN532 "
            "using --device <nfcpy path>."
        )
    name = Path(ports[0].device).name
    if name.startswith("cu.usbserial-"):
        return f"tty:{name.removeprefix('cu.')}:pn532"
    if name.startswith("tty"):
        return f"tty:{name.removeprefix('tty')}:pn532"
    if name.startswith("COM"):
        return f"com:{name.removeprefix('COM')}:pn532"
    raise ValueError("Use --device to select this adapter's nfcpy path.")


def run_wallet_demo(args, config):
    from vas import run_vas

    demo = config.get("publicDemo")
    if (
        not isinstance(demo, dict)
        or demo.get("kind") != "public-demo-badge"
        or demo.get("ready") is not True
        or not isinstance(demo.get("passTypeIdentifier"), str)
        or not demo["passTypeIdentifier"].startswith("pass.")
    ):
        raise ValueError("Configure the public NFC badge demo before reading it.")
    request("/api/reader/demo-status", {"status": "waiting"})
    try:
        path = device_path(args.device)
        print(f"Opening {path}", flush=True)
        with nfc.ContactlessFrontend(path) as reader:
            print(f"Reader responding: {reader.device}", flush=True)
            print("Tap the linked NFC Test Pass. This local demo sends no eligibility inquiry.", flush=True)
            envelope = run_vas(
                reader, demo["passTypeIdentifier"], args.timeout,
                use_ecp=not args.no_ecp,
            )
        result = request("/api/reader/demo-badge", envelope)
        print(json.dumps({
            "mode": result.get("mode"),
            "checkedAt": result.get("checkedAt"),
            "benefitCount": len(result.get("eligibility", {}).get("benefits", [])),
            "sent": result.get("sent"),
        }, indent=2))
        print("Physical Wallet badge resolved. Result displayed locally; no eligibility inquiry sent.")
    except (Exception, KeyboardInterrupt) as error:
        try:
            request("/api/reader/demo-status", {
                "status": "failed", "error": str(error) or "Reader stopped.",
            })
        except (OSError, ValueError):
            pass
        raise


def main():
    parser = argparse.ArgumentParser(
        description="PN532 synthetic insurance demo. Links NFC-A chip IDs "
        "locally and provides an experimental Apple VAS reader; "
        "no tag writes or live eligibility."
    )
    parser.add_argument(
        "command",
        choices=["doctor", "inspect", "enroll", "read", "vas", "vas-probe", "vas-capture", "wallet-demo", "test"],
    )
    parser.add_argument(
        "--device", help="nfcpy path, e.g. tty:usbserial-BG03MDLU:pn532"
    )
    parser.add_argument(
        "--timeout", type=float, help="Seconds to wait for one tag (VAS: 30, other reads: 60)"
    )
    parser.add_argument(
        "--no-ecp", action="store_true",
        help="Disable experimental ECP; manually select and authenticate the NFC pass instead",
    )
    parser.add_argument("--pass-type-identifier", help="Exact identifier for a diagnostic NFC pass")
    parser.add_argument("--out", help="New owner-only diagnostic capture JSON file")
    args = parser.parse_args()
    if args.command == "vas-capture":
        if not args.pass_type_identifier or not args.out:
            parser.error("vas-capture requires --pass-type-identifier and --out.")
        from vas import get_data_payload

        get_data_payload(args.pass_type_identifier)
    elif args.pass_type_identifier or args.out:
        parser.error("--pass-type-identifier and --out are only available with vas-capture.")
    if args.command == "test":
        import unittest

        suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent), "test_*.py")
        if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
            raise ValueError("Reader protocol tests failed.")
        return
    if args.timeout is None:
        args.timeout = 30 if args.command.startswith("vas") else 60
    if not 0 < args.timeout <= 300:
        parser.error("--timeout must be between 0 and 300 seconds.")
    config = None
    if args.command in {"enroll", "read", "vas", "wallet-demo"}:
        config = request("/api/reader/config")
        if (
            (config.get("syntheticOnly") is not True
             and not (args.command == "wallet-demo"
                      and isinstance(config.get("publicDemo"), dict)
                      and config["publicDemo"].get("dataMode") == "personal-cache"))
            or config.get("eligibilityReady") is not False
        ):
            raise ValueError(
                "Expected the synthetic preparation-only demo. No tag was linked."
            )
        if args.command == "enroll":
            state = request("/api/state")
            if state.get("revoked") or not state.get("currentCard"):
                raise ValueError(
                    "Issue a synthetic card at http://127.0.0.1:4320 "
                    "before linking a tag."
                )
        if args.command == "vas":
            if config.get("nfcPassReady") is not True:
                raise ValueError(
                    "Apple NFC pass permission has not been verified. "
                    "The ordinary Wallet test card cannot transmit an NFC payload. "
                    "Use vas-probe only to diagnose the reader protocol."
                )
            if config.get("vasReady") is not True:
                raise ValueError("The issuer's VAS decryption service is not configured.")

    if args.command == "wallet-demo":
        run_wallet_demo(args, config)
        return

    with ExitStack() as stack:
        output = None
        if args.command == "vas-capture":
            from vas import open_capture

            output = stack.enter_context(open_capture(args.out))
        path = device_path(args.device)
        print(f"Opening {path}", flush=True)
        reader = stack.enter_context(nfc.ContactlessFrontend(path))
        print(f"Reader responding: {reader.device}", flush=True)
        if args.command == "doctor":
            print(
                "PN532 connection verified. No card read "
                "and no eligibility inquiry sent."
            )
            return
        if args.command in {"vas", "vas-probe", "vas-capture"}:
            from vas import run_vas, write_capture

            probe = args.command == "vas-probe"
            transcript = {}
            result = None
            error = None
            pass_type_identifier = args.pass_type_identifier if output else config.get("passTypeIdentifier") if config else None
            try:
                result = run_vas(
                    reader, pass_type_identifier, args.timeout,
                    probe=probe, use_ecp=not args.no_ecp,
                    transcript=transcript if output else None,
                )
            except Exception as failure:
                error = str(failure)
                raise
            finally:
                if output:
                    write_capture(output, pass_type_identifier, transcript, result, error)
            if output:
                print(f"Encrypted diagnostic capture saved to {args.out}. No backend request or eligibility inquiry sent.")
            elif probe:
                print(json.dumps(result, indent=2))
                print("Diagnostic SELECT only. No pass data read or eligibility inquiry sent.")
            else:
                print(json.dumps(request("/api/reader/vas", result), indent=2))
                print("Encrypted Wallet data delivered to the synthetic issuer resolver. No paid inquiry sent.")
            return
        print(
            f"Hold the card or key fob over the antenna. "
            f"Waiting {args.timeout:g} seconds.", flush=True
        )
        deadline = time.monotonic() + args.timeout
        waiting_for_removal = args.command == "read"
        removal_prompted = False
        while time.monotonic() < deadline:
            target = reader.sense(nfc.clf.RemoteTarget("106A"), iterations=1)
            if target is None:
                waiting_for_removal = False
                time.sleep(0.1)
                continue
            if waiting_for_removal:
                if not removal_prompted:
                    print(
                        "Remove the tag from the antenna, then tap again.",
                        flush=True,
                    )
                    removal_prompted = True
                time.sleep(0.1)
                continue
            identifier = bytes(target.sdd_res).hex()
            print("Physical NFC-A tag detected.", flush=True)
            if args.command == "inspect":
                print(json.dumps(
                    {
                        "technology": target.brty,
                        "identifier": identifier,
                        "identifierBytes": len(bytes(target.sdd_res)),
                        "selectResponse": bytes(target.sel_res).hex(),
                    }, indent=2
                ))
            else:
                result = request(
                    f"/api/reader/tag/{args.command}", {"identifier": identifier}
                )
                print(json.dumps(result, indent=2))
                print(
                    "Tag linked locally. Remove it, then run reader read."
                    if args.command == "enroll" else
                    "Physical tap resolved. Request prepared, not sent. "
                    "See http://127.0.0.1:4320."
                )
            return
        raise TimeoutError(
            "No NFC-A tag detected. Keep the card flat "
            "against the PN532 antenna and try again."
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Reader stopped.", file=sys.stderr)
        sys.exit(130)
    except (
        OSError, ValueError, nfc.clf.CommunicationError,
        nfc.tag.TagCommandError, nfc.clf.pn53x.Chipset.Error,
    ) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
