import base64
import hashlib
import json
import os
import time
from datetime import datetime, timezone

from ber_tlv.tlv import BadLength, BadParameter, BadTag, Tlv, UnexpectedEnd
import nfc
import nfc.clf.pn532
import nfc.tag.tt4


VAS_AID = b"OSE.VAS.01"
VAS_ONLY_ECP = bytes.fromhex("6a01000002")


class VASStatusError(ValueError):
    def __init__(self, status):
        self.status = status
        explanation = {
            0x6287: "Unlock the presenting iPhone and authenticate the matching pass.",
            0x6982: "The presenting device rejected the requested security state.",
            0x6984: "Select and authenticate the matching pass on the iPhone.",
            0x6A82: "The device does not expose the Apple VAS applet.",
            0x6A83: "No matching NFC-enabled pass is available for this pass identifier.",
        }.get(status, "The VAS command was rejected.")
        super().__init__(f"VAS status {status:04X}: {explanation}")


def response_fields(response, template):
    response = bytes(response)
    if len(response) < 2:
        raise ValueError("The VAS response has no complete status word.")
    status = int.from_bytes(response[-2:], "big")
    if status != 0x9000:
        raise VASStatusError(status)
    if len(response) > 1024:
        raise ValueError("The VAS response exceeds the supported size.")
    try:
        parsed = Tlv.parse(response[:-2])
    except (BadLength, BadParameter, BadTag, UnexpectedEnd) as error:
        raise ValueError("Malformed BER-TLV in the VAS response.") from error
    if len(parsed) != 1 or parsed[0][0] != template or not isinstance(parsed[0][1], list):
        raise ValueError("The VAS response has an unexpected template.")
    fields = {}
    for tag, value in parsed[0][1]:
        if tag in fields:
            raise ValueError("Duplicate tag in the VAS response.")
        fields[tag] = value
    return fields


def select_vas(tag, transcript=None):
    response = tag.send_apdu(0x00, 0xA4, 0x04, 0x00, VAS_AID, mrl=256, check_status=False)
    if transcript is not None:
        transcript["selectResponseBase64"] = base64.b64encode(response).decode("ascii")
    fields = response_fields(response, 0x6F)
    if fields.get(0x50) != b"ApplePay" or fields.get(0x9F21) != b"\x01\x00":
        raise ValueError("Expected ApplePay VAS protocol version 1.0.")
    capabilities = fields.get(0x9F23)
    if not isinstance(capabilities, bytes) or len(capabilities) != 4 or not capabilities[3] & 0x08:
        raise ValueError("The device does not advertise VAS support.")
    return {"wallet": "ApplePay", "protocolVersion": "1.0"}


def get_data_payload(pass_type_identifier, nonce=None):
    if not isinstance(pass_type_identifier, str) or not pass_type_identifier.startswith("pass."):
        raise ValueError("Expected the configured Apple pass type identifier.")
    nonce = os.urandom(4) if nonce is None else nonce
    if len(nonce) != 4:
        raise ValueError("A VAS terminal nonce must contain four bytes.")
    return Tlv.build([
        (0x9F22, b"\x01\x00"),
        (0x9F28, nonce),
        (0x9F26, b"\x00\x80\x00\x02"),
        (0x9F25, hashlib.sha256(pass_type_identifier.encode("utf-8")).digest()),
    ])


def read_vas(tag, pass_type_identifier, transcript=None):
    select_vas(tag, transcript)
    response = tag.send_apdu(
        0x80, 0xCA, 0x01, 0x01, get_data_payload(pass_type_identifier),
        mrl=256, check_status=False,
    )
    if transcript is not None:
        transcript["getDataResponseBase64"] = base64.b64encode(response).decode("ascii")
    fields = response_fields(response, 0x70)
    cryptogram = fields.get(0x9F27)
    token = fields.get(0x9F2A, b"")
    if not isinstance(cryptogram, bytes) or not 56 <= len(cryptogram) <= 120:
        raise ValueError("The VAS response has no valid encrypted cryptogram.")
    if not isinstance(token, bytes) or len(token) > 32:
        raise ValueError("The VAS response has an invalid mobile token.")
    return {
        "passTypeIdentifier": pass_type_identifier,
        "vasDataBase64": base64.b64encode(cryptogram).decode("ascii"),
        "mobileTokenBase64": base64.b64encode(token).decode("ascii"),
    }


def open_capture(path):
    return open(path, "x", opener=lambda name, flags: os.open(name, flags, 0o600))


def write_capture(output, pass_type_identifier, transcript, result=None, error=None):
    record = {
        "formatVersion": 1,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "diagnosticOnly": True,
        "eligibilitySent": False,
        "passTypeIdentifier": pass_type_identifier,
        "responses": transcript,
        "envelope": result,
        "error": error,
    }
    json.dump(record, output, indent=2)
    output.write("\n")
    output.flush()


def emit_ecp(reader):
    if not isinstance(reader.device, nfc.clf.pn532.Device):
        raise ValueError("Experimental ECP polling currently supports the PN532 only.")
    chip = reader.device.chipset
    registers = ("CIU_TxMode", "CIU_RxMode", "CIU_BitFraming")
    saved = chip.read_register(*registers)
    chip.rf_configuration(0x05, bytearray([0xFF, 0x01, 0x00]))
    chip.rf_configuration(0x01, bytearray([0x01]))
    try:
        chip.write_register(
            (registers[0], saved[0] & 0x7F),
            (registers[1], saved[1] & 0x7F),
            (registers[2], 0x00),
        )
        frame = reader.device.add_crc_a(bytearray(VAS_ONLY_ECP))
        try:
            chip.in_communicate_thru(frame, timeout=0.1)
        except nfc.clf.pn53x.Chipset.Error as error:
            if error.errno != 0x01:
                raise
    finally:
        chip.write_register(*zip(registers, saved))


def poll_vas(reader, use_ecp):
    target = reader.sense(nfc.clf.RemoteTarget("106A"), iterations=1)
    if target is None and use_ecp:
        with reader.lock:
            emit_ecp(reader)
            target = reader.device.sense_tta(nfc.clf.RemoteTarget("106A"))
            reader.target = target
    return target


def run_vas(reader, pass_type_identifier, timeout, probe=False, use_ecp=True, transcript=None):
    deadline = time.monotonic() + timeout
    attempts = 0
    print("Experimental Apple VAS polling. No payment commands are sent.", flush=True)
    while time.monotonic() < deadline:
        target = poll_vas(reader, use_ecp)
        attempts += 1
        if target is None:
            time.sleep(0.1)
            continue
        if not target.sel_res or not target.sel_res[0] & 0x20:
            raise ValueError("The detected card is not an ISO-DEP Wallet device.")
        tag = nfc.tag.activate(reader, target)
        if not isinstance(tag, nfc.tag.tt4.Type4Tag):
            raise ValueError("The NFC device could not establish ISO-DEP communication.")
        try:
            if probe:
                return {**select_vas(tag), "diagnosticOnly": True, "passDataRead": False}
            return read_vas(tag, pass_type_identifier, transcript)
        finally:
            try:
                reader.exchange(bytearray([0xC2]), 0.1)
            except nfc.clf.CommunicationError:
                pass
            reader.device.mute()
    raise TimeoutError(
        f"No ISO-DEP Wallet device found in {attempts} polling cycles. "
        "An ECP polling attempt is not proof of a Wallet pass transfer."
    )
