import base64
import json
import stat
import tempfile
import unittest
from pathlib import Path

from ber_tlv.tlv import Tlv

from vas import get_data_payload, open_capture, read_vas, select_vas, write_capture, VASStatusError


SELECT_RESPONSE = bytes.fromhex(
    "6f1d50084170706c655061799f210201009f2404c05d48d09f23040000001e9000"
)
GET_RESPONSE = bytes.fromhex(
    "70549f2a009f274ebeef7375094afa4824addb8abf0a59f4c5b88f7b33cd803666"
    "cdf358dc8aa2ecea863673b7e92b8f39bc744233dda87e53f2ae346eb43415e7b2"
    "0a50aa41e02de9f3d533f506e29b4ed31eaa9cfa9000"
)


class CardTranscript:
    def __init__(self, *responses):
        self.responses = iter(responses)

    def send_apdu(self, *args, **kwargs):
        return next(self.responses)


class VASProtocolTests(unittest.TestCase):
    def test_diagnostic_capture_preserves_raw_responses_in_a_private_non_overwriting_file(self):
        transcript = {}
        identifier = "pass.com.passkit.pksamples.nfcdemo"
        result = read_vas(CardTranscript(SELECT_RESPONSE, GET_RESPONSE), identifier, transcript)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.json"
            with open_capture(path) as output:
                write_capture(output, identifier, transcript, result)
            record = json.loads(path.read_text())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(base64.b64decode(record["responses"]["selectResponseBase64"]), SELECT_RESPONSE)
            self.assertEqual(base64.b64decode(record["responses"]["getDataResponseBase64"]), GET_RESPONSE)
            self.assertEqual(record["envelope"], result)
            self.assertTrue(record["diagnosticOnly"])
            self.assertFalse(record["eligibilitySent"])
            with self.assertRaises(FileExistsError):
                open_capture(path)
            self.assertEqual(json.loads(path.read_text()), record)

    def test_rejected_get_data_remains_available_for_diagnosis_without_a_valid_envelope(self):
        transcript = {}
        with self.assertRaises(VASStatusError):
            read_vas(CardTranscript(SELECT_RESPONSE, bytes.fromhex("6a83")), "pass.example", transcript)
        self.assertEqual(base64.b64decode(transcript["getDataResponseBase64"]), bytes.fromhex("6a83"))

    def test_research_transcript_returns_encrypted_payload_without_interpreting_it_as_a_member_id(self):
        result = read_vas(
            CardTranscript(SELECT_RESPONSE, GET_RESPONSE),
            "pass.com.passkit.pksamples.nfcdemo",
        )
        self.assertEqual(result["passTypeIdentifier"], "pass.com.passkit.pksamples.nfcdemo")
        self.assertEqual(result["mobileTokenBase64"], "")
        cryptogram = base64.b64decode(result["vasDataBase64"], validate=True)
        self.assertEqual(len(cryptogram), 78)
        self.assertEqual(cryptogram[:4].hex(), "beef7375")
        self.assertNotIn("memberId", result)

    def test_get_data_preserves_the_exact_pass_identifier_hash_and_uses_vas_only(self):
        fields = dict(Tlv.parse(get_data_payload(
            "pass.com.passkit.pksamples.nfcdemo", nonce=b"\x01\x00\x00\x00"
        )))
        self.assertEqual(fields[0x9F25].hex(), "03b57cdb3eca0984ba9abdc2fb45d86626d87b39d33c5c6dbbc313a6347a3146")
        self.assertEqual(fields[0x9F26], bytes.fromhex("00800002"))
        self.assertEqual(fields[0x9F28], b"\x01\x00\x00\x00")

    def test_locked_missing_and_malformed_responses_never_produce_a_payload(self):
        for status in (0x6287, 0x6A83, 0x6984, 0x6A82):
            with self.subTest(status=f"{status:04x}"):
                with self.assertRaises(VASStatusError):
                    read_vas(CardTranscript(SELECT_RESPONSE, status.to_bytes(2, "big")), "pass.example")
        malformed = [
            b"", b"\x90", bytes.fromhex("70059f274e9000"),
            Tlv.build([(0x70, [(0x9F27, b"short")])]) + b"\x90\x00",
            Tlv.build([(0x70, [(0x9F27, b"a" * 80), (0x9F27, b"b" * 80)])]) + b"\x90\x00",
            Tlv.build([(0x6F, [(0x9F27, b"a" * 80)])]) + b"\x90\x00",
        ]
        for response in malformed:
            with self.subTest(response=response.hex()):
                with self.assertRaises(ValueError):
                    read_vas(CardTranscript(SELECT_RESPONSE, response), "pass.example")

    def test_a_different_wallet_or_protocol_cannot_be_read_as_apple_vas(self):
        for label, version in [(b"Android", b"\x01\x00"), (b"ApplePay", b"\x02\x00")]:
            response = Tlv.build([(0x6F, [(0x50, label), (0x9F21, version), (0x9F23, bytes.fromhex("0000001e"))])]) + b"\x90\x00"
            with self.subTest(label=label, version=version):
                with self.assertRaises(ValueError):
                    select_vas(CardTranscript(response))


if __name__ == "__main__":
    unittest.main()
