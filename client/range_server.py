"""Minimal static file server with HTTP Range (byte-serving) support, for
testing the PMTiles static client locally -- Python's stdlib http.server
doesn't support Range requests, but pmtiles.js requires them. GitHub
Pages' actual CDN supports Range natively, so this is only needed for
local testing, not for the real deployment."""
import http.server
import os
import re
import socketserver

PORT = 8092


class RangeHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().do_GET()

        file_size = os.path.getsize(path)
        range_header = self.headers.get("Range")
        if not range_header:
            self.send_response(200)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Type", self.guess_type(path))
            self.end_headers()
            with open(path, "rb") as f:
                self.wfile.write(f.read())
            return

        m = re.match(r"bytes=(\d+)-(\d*)", range_header)
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else file_size - 1
        end = min(end, file_size - 1)
        length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", self.guess_type(path))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            self.wfile.write(f.read(length))


with socketserver.TCPServer(("", PORT), RangeHTTPRequestHandler) as httpd:
    print(f"Serving with Range support on :{PORT}")
    httpd.serve_forever()
