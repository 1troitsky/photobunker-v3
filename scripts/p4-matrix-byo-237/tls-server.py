#!/usr/bin/env python3
"""Single-request disposable Matrix-style HTTPS origin (CI only).

The certificate/key are generated in a throwaway directory. This server
serves no real Matrix account, device, token, messages or private content.
It must be bound ONLY to the locally routed synthetic address 1.1.1.1.
"""
import argparse
import http.server
import ssl
from pathlib import Path


class OneShotHTTPServer(http.server.HTTPServer):
    allow_reuse_address = True


class MatrixVersionsHandler(http.server.BaseHTTPRequestHandler):
    mode = "success"

    def do_GET(self):
        if self.path != "/_matrix/client/versions":
            self.send_error(404)
            return
        if self.mode == "redirect":
            self.send_response(302)
            self.send_header("Location", "https://169.254.169.254/latest/meta-data/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.mode == "oversize":
            content = b"X" * 70000
        elif self.mode == "malformed":
            content = b'{"versions":["v1.0"]}'
        else:
            content = b'{"versions":["v1.3","v1.11"]}'

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            # Expected when the client aborts oversized bodies.
            pass

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--mode", choices=["success", "redirect", "oversize", "malformed"], required=True)
    parser.add_argument("--ready", required=True)
    args = parser.parse_args()

    handler_type = type("CurrentMatrixVersions", (MatrixVersionsHandler,), {"mode": args.mode})
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(certfile=args.cert, keyfile=args.key)

    with OneShotHTTPServer(("1.1.1.1", 443), handler_type) as server:
        server.socket = context.wrap_socket(server.socket, server_side=True)
        Path(args.ready).write_text("ready\n", encoding="utf-8")
        server.handle_request()


if __name__ == "__main__":
    main()
