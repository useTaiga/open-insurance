import json
import stat
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from issuer import issuer_request, save_result


class Resolver(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/redirect":
            self.send_response(307)
            self.send_header("Location", "/clinic/vas")
            self.end_headers()
            return
        if self.headers.get("Authorization") != "Bearer fictional-clinic-token":
            self.send_response(403)
            self.end_headers()
            return
        envelope = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        result = {
            "sent": False,
            "insurance": {"subscriber": {"memberId": "0000123"}},
            "benefits": {"data": {"nested": ["0001", {"planEnd": "20261231"}]}},
            "passTypeIdentifier": envelope["passTypeIdentifier"],
        }
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def log_message(self, *args):
        pass


class IssuerTests(unittest.TestCase):
    def test_authenticated_handoff_retains_data_in_private_non_overwriting_output_and_rejects_redirects(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Resolver)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        envelope = {"passTypeIdentifier": "pass.example", "vasDataBase64": "ciphertext", "mobileTokenBase64": ""}
        try:
            result = issuer_request(base, "/clinic/vas", envelope, "fictional-clinic-token")
            self.assertEqual(result["insurance"]["subscriber"]["memberId"], "0000123")
            self.assertEqual(result["benefits"]["data"]["nested"], ["0001", {"planEnd": "20261231"}])
            with tempfile.TemporaryDirectory() as directory:
                filename = Path(directory) / "intake.json"
                save_result(filename, result)
                self.assertEqual(json.loads(filename.read_text()), result)
                self.assertEqual(stat.S_IMODE(filename.stat().st_mode), 0o600)
                with self.assertRaises(FileExistsError):
                    save_result(filename, result)
            for path, token in [("/clinic/vas", "wrong"), ("/redirect", "fictional-clinic-token")]:
                with self.subTest(path=path), self.assertRaises(ValueError):
                    issuer_request(base, path, envelope, token)
            with self.assertRaises(ValueError):
                issuer_request("http://untrusted.example", "/clinic/vas", envelope, "fictional-clinic-token")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
