"""macOS app launcher for Holy Flow.

Build target: PyInstaller (--windowed --name HolyFlow)
Output: HolyFlow.app bundle
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

import tkinter as tk
from tkinter import messagebox


DEFAULT_PORT = 4173
PORT_SCAN_RANGE = 50


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


def run_ui(url: str, server: ThreadingHTTPServer, initial_open: bool) -> None:
    root = tk.Tk()
    root.title("Holy Flow")
    root.geometry("440x200")
    root.resizable(False, False)

    frame = tk.Frame(root, padx=18, pady=18)
    frame.pack(fill="both", expand=True)

    tk.Label(frame, text="Holy Flow is running.", font=("Helvetica Neue", 13, "bold")).pack(anchor="w")
    tk.Label(frame, text=f"Address: {url}", font=("Helvetica Neue", 11)).pack(anchor="w", pady=(8, 2))
    tk.Label(
        frame,
        text="Keep this window open while using the app.",
        font=("Helvetica Neue", 10),
        fg="#555555",
    ).pack(anchor="w", pady=(0, 12))

    buttons = tk.Frame(frame)
    buttons.pack(anchor="w")

    tk.Button(buttons, text="Open Browser", width=14, command=lambda: webbrowser.open(url)).pack(side="left")

    def shutdown():
        try:
            server.shutdown()
            server.server_close()
        finally:
            root.destroy()

    tk.Button(buttons, text="Quit", width=12, command=shutdown).pack(side="left", padx=(8, 0))
    root.protocol("WM_DELETE_WINDOW", shutdown)

    if initial_open:
        root.after(250, lambda: webbrowser.open(url))

    root.mainloop()


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
    url = f"http://127.0.0.1:{port}/"
    server = ThreadingHTTPServer(("127.0.0.1", port), build_handler(site_root))
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    run_ui(url=url, server=server, initial_open=(not args.no_open))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        tk.Tk().withdraw()
        messagebox.showerror("Holy Flow", f"Launcher failed:\n{exc}")
        raise
