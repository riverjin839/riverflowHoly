"""macOS app launcher for Holy Flow.

Build target: PyInstaller (--windowed --name HolyFlow)
Output: HolyFlow.app bundle
"""

from __future__ import annotations

import argparse
import socket
import subprocess
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import threading


DEFAULT_PORT = 4173
PORT_SCAN_RANGE = 50
SECURITY_HINT_MARKER = Path.home() / "Library/Application Support/HolyFlow/security_settings_hint_v2"
SECURITY_SETTINGS_URLS = [
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
    "x-apple.systempreferences:com.apple.preference.security?General",
]


def resolve_app_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[2]


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.15)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def pick_port(preferred_port: int) -> int:
    for port in range(preferred_port, preferred_port + PORT_SCAN_RANGE):
        if port_available(port):
            return port
    raise RuntimeError("No available port found.")


class HolyFlowHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, **kwargs):
        self.site_root = Path(directory).resolve()
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format: str, *args) -> None:
        return

    def _safe_target(self, request_path: str) -> Path | None:
        clean = unquote(urlsplit(request_path).path).lstrip("/")
        base = self.site_root
        target = (base / clean).resolve() if clean else (base / "index.html")
        if base not in target.parents and target != base:
            return None
        return target

    def do_GET(self) -> None:
        if urlsplit(self.path).path == "/__holyflow_shutdown":
            payload = b"Shutting down Holy Flow."
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        target = self._safe_target(self.path)
        if target is None:
            self.send_error(403, "Forbidden")
            return

        if target.is_dir():
            target = target / "index.html"

        if target.is_file():
            return super().do_GET()

        request_name = Path(unquote(urlsplit(self.path).path)).name
        if "." not in request_name:
            self.path = "/index.html"
            return super().do_GET()

        self.send_error(404, "Not Found")


def build_handler(site_root: Path):
    def _handler(*args, **kwargs):
        return HolyFlowHandler(*args, directory=str(site_root), **kwargs)

    return _handler


def open_security_settings_once() -> None:
    if not getattr(sys, "frozen", False):
        return

    if SECURITY_HINT_MARKER.exists():
        return

    try:
        SECURITY_HINT_MARKER.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        return

    opened = False
    for url in SECURITY_SETTINGS_URLS:
        try:
            subprocess.Popen(
                ["open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            opened = True
            break
        except Exception:
            continue

    if opened:
        try:
            SECURITY_HINT_MARKER.write_text("opened", encoding="utf-8")
        except OSError:
            pass


def open_in_app_mode(url: str) -> bool:
    browser_apps = (
        "Google Chrome",
        "Microsoft Edge",
        "Brave Browser",
        "Vivaldi",
    )

    for app_name in browser_apps:
        try:
            subprocess.Popen(
                ["open", "-na", app_name, "--args", f"--app={url}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except OSError:
            continue
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Holy Flow macOS app launcher")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred localhost port")
    parser.add_argument("--no-open", action="store_true", help="Do not auto-open browser on startup")
    args = parser.parse_args()

    site_root = resolve_app_root()
    required = ["index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest", "assets/icon.svg"]
    missing = [name for name in required if not (site_root / name).exists()]
    if missing:
        raise RuntimeError(f"Required app files are missing: {', '.join(missing)}")

    port = pick_port(args.port)
    url = f"http://127.0.0.1:{port}/?desktop=1&app=1&v=20260221-3"
    server = ThreadingHTTPServer(("127.0.0.1", port), build_handler(site_root))
    server.daemon_threads = True

    open_security_settings_once()

    if not args.no_open:
        if not open_in_app_mode(url):
            webbrowser.open(url)

    try:
        server.serve_forever()
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        try:
            import tkinter as tk
            from tkinter import messagebox

            root = tk.Tk()
            root.withdraw()
            messagebox.showerror("Holy Flow", f"Launcher failed:\n{exc}")
            root.destroy()
        except Exception:
            pass
        raise
