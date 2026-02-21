"""Single-file Windows launcher for Holy Flow.

Build with PyInstaller (--onefile --windowed). The binary serves bundled
static files on localhost and opens the default browser automatically.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import unquote, urlsplit

import threading


DEFAULT_PORT = 4173
PORT_SCAN_RANGE = 50
AI_TIMEOUT_SECONDS = 45
OPENAI_MODEL = "gpt-4.1-mini"
CLAUDE_MODEL = "claude-3-5-haiku-latest"
GEMINI_MODEL = "gemini-2.0-flash"
GROK_MODEL = "grok-2-latest"
PERPLEXITY_MODEL = "sonar"
BASIC_REQUEST_DAILY_LIMIT = 10

try:
    import certifi
except Exception:  # pragma: no cover - optional dependency fallback
    certifi = None


def build_ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    if certifi is not None:
        try:
            context.load_verify_locations(cafile=certifi.where())
        except Exception:
            pass
    return context


SSL_CONTEXT = build_ssl_context()


def get_basic_usage_file() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else (Path.home() / ".holyflow")
    return base / "HolyFlow" / "basic_ai_usage.json"


def consume_basic_request_quota() -> tuple[int, int]:
    usage_file = get_basic_usage_file()
    today = datetime.now().strftime("%Y-%m-%d")
    usage = {"date": today, "count": 0}

    try:
        if usage_file.exists():
            loaded = json.loads(usage_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                usage["date"] = str(loaded.get("date", today))
                usage["count"] = int(loaded.get("count", 0))
    except Exception:
        usage = {"date": today, "count": 0}

    if usage["date"] != today:
        usage = {"date": today, "count": 0}

    if usage["count"] >= BASIC_REQUEST_DAILY_LIMIT:
        raise RuntimeError("기본 요청이 만료되었습니다. 설정에서 API 키를 입력해주세요.")

    usage["count"] += 1

    try:
        usage_file.parent.mkdir(parents=True, exist_ok=True)
        usage_file.write_text(json.dumps(usage, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass

    return usage["count"], BASIC_REQUEST_DAILY_LIMIT


def build_basic_fallback_result(provider: str, passage: str, bible_version: str) -> dict[str, str]:
    used, total = consume_basic_request_quota()
    provider_name_map = {
        "openai": "ChatGPT",
        "claude": "Claude",
        "gemini": "Gemini",
        "grok": "Grok",
        "perplexity": "Perplexity",
    }
    provider_name = provider_name_map.get(provider, "AI")

    return {
        "passageText": f"[기본 요청 모드] {bible_version} · {passage}",
        "summary": (
            f"요청 본문은 '{passage}' 입니다. 오늘 적용할 한 가지 결단을 짧게 정리해 보세요. "
            f"(기본 요청 사용 {used}/{total})"
        ),
        "explanation": (
            f"{provider_name} 사이트 로그인과 별개로 앱 자동 연동에는 공식 API 키가 필요합니다.\n"
            "기본 요청 모드는 간단 응답만 제공합니다. 더 정확한 본문/요약/설명은 설정에서 API 키를 입력해주세요."
        ),
    }


def build_ai_prompt(passage: str, bible_version: str) -> str:
    return (
        f"사용자 요청 본문: {passage}\n"
        f"요청 번역: {bible_version}\n\n"
        "반드시 JSON 객체 하나로만 응답하세요. 코드블록/마크다운 금지.\n"
        '키는 "passageText", "summary", "explanation" 3개만 사용하세요.\n'
        "passageText는 요청 번역 기준으로 본문 내용을 자연스럽게 제공하세요.\n"
        "summary는 3문장 이내 간략 요약,\n"
        "explanation은 핵심 의미를 쉽고 짧게 설명하세요."
    )


def parse_ai_json(raw_text: str) -> dict[str, str]:
    cleaned = raw_text.strip()
    parsed: dict[str, object] | None = None

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            parsed = json.loads(cleaned[start : end + 1])

    if not isinstance(parsed, dict):
        raise RuntimeError("AI 응답을 해석하지 못했습니다.")

    def _value(name: str) -> str:
        value = parsed.get(name, "")
        return str(value).strip()

    return {
        "passageText": _value("passageText"),
        "summary": _value("summary"),
        "explanation": _value("explanation"),
    }


def http_json_post(url: str, headers: dict[str, str], payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urlrequest.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )

    try:
        with urlrequest.urlopen(request, timeout=AI_TIMEOUT_SECONDS, context=SSL_CONTEXT) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urlerror.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"AI API 오류({exc.code}): {error_body[:240] or exc.reason}") from exc
    except urlerror.URLError as exc:
        reason_text = str(exc.reason)
        if "CERTIFICATE_VERIFY_FAILED" in reason_text or "unable to get local issuer certificate" in reason_text:
            raise RuntimeError(
                "AI API SSL 인증서 검증에 실패했습니다. 최신 EXE로 재빌드/재설치하고, 백신 또는 사내 HTTPS 검사 설정을 확인해주세요."
            ) from exc
        raise RuntimeError(f"AI API 연결 오류: {exc.reason}") from exc


def extract_openai_text(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message", {})
    content = message.get("content", "")
    if isinstance(content, list):
        fragments = [part.get("text", "") for part in content if isinstance(part, dict)]
        return "".join(fragments)
    return str(content)


def extract_claude_text(payload: dict) -> str:
    content = payload.get("content") or []
    if not content:
        return ""
    fragments = [part.get("text", "") for part in content if isinstance(part, dict)]
    return "".join(fragments)


def extract_gemini_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    fragments = [part.get("text", "") for part in parts if isinstance(part, dict)]
    return "".join(fragments)


def request_ai_analysis(provider: str, api_key: str, passage: str, bible_version: str) -> dict[str, str]:
    prompt = build_ai_prompt(passage, bible_version)

    if not api_key:
        return build_basic_fallback_result(provider, passage, bible_version)

    if provider == "openai":
        payload = http_json_post(
            "https://api.openai.com/v1/chat/completions",
            {"Authorization": f"Bearer {api_key}"},
            {
                "model": OPENAI_MODEL,
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": "You are a Korean Bible assistant."},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        return parse_ai_json(extract_openai_text(payload))

    if provider == "claude":
        payload = http_json_post(
            "https://api.anthropic.com/v1/messages",
            {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            {
                "model": CLAUDE_MODEL,
                "max_tokens": 1400,
                "temperature": 0.2,
                "system": "You are a Korean Bible assistant. Return JSON only.",
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        return parse_ai_json(extract_claude_text(payload))

    if provider == "gemini":
        payload = http_json_post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}",
            {},
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                },
            },
        )
        return parse_ai_json(extract_gemini_text(payload))

    if provider == "grok":
        payload = http_json_post(
            "https://api.x.ai/v1/chat/completions",
            {"Authorization": f"Bearer {api_key}"},
            {
                "model": GROK_MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": "You are a Korean Bible assistant. Return JSON only."},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        return parse_ai_json(extract_openai_text(payload))

    if provider == "perplexity":
        payload = http_json_post(
            "https://api.perplexity.ai/chat/completions",
            {"Authorization": f"Bearer {api_key}"},
            {
                "model": PERPLEXITY_MODEL,
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": "You are a Korean Bible assistant. Return JSON only."},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        return parse_ai_json(extract_openai_text(payload))

    raise ValueError("지원하지 않는 AI 제공자입니다.")


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
        # Suppress request logs in portable mode.
        return

    def _send_json(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _safe_target(self, request_path: str) -> Path | None:
        clean = unquote(urlsplit(request_path).path).lstrip("/")
        base = self.site_root
        target = (base / clean).resolve() if clean else (base / "index.html")
        if base not in target.parents and target != base:
            return None
        return target

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/__holyflow_ai":
            self.send_error(404, "Not Found")
            return

        try:
            raw_length = self.headers.get("Content-Length", "0")
            content_length = int(raw_length)
            if content_length <= 0 or content_length > 100000:
                raise ValueError("요청 본문 크기가 올바르지 않습니다.")

            body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(body)
            provider = str(payload.get("provider", "")).strip().lower()
            api_key = str(payload.get("apiKey", "")).strip()
            passage = str(payload.get("passage", "")).strip()
            bible_version = str(payload.get("bibleVersion", "개역개정")).strip()

            if provider not in {"openai", "claude", "gemini", "grok", "perplexity"}:
                raise ValueError("AI 제공자를 선택해주세요.")
            if not passage:
                raise ValueError("본문을 입력해주세요.")
            if bible_version not in {"개역개정", "우리말성경"}:
                bible_version = "개역개정"

            result = request_ai_analysis(provider, api_key, passage, bible_version)
            self._send_json(200, {"result": result})
        except ValueError as exc:
            self._send_json(400, {"error": str(exc)})
        except RuntimeError as exc:
            self._send_json(502, {"error": str(exc)})
        except Exception:
            self._send_json(500, {"error": "AI 처리 중 알 수 없는 오류가 발생했습니다."})

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


def open_in_app_mode(url: str) -> bool:
    pf = Path(os.environ.get("ProgramFiles", ""))
    pfx86 = Path(os.environ.get("ProgramFiles(x86)", ""))
    local = Path(os.environ.get("LOCALAPPDATA", ""))

    browser_commands = (
        (
            "msedge",
            [
                pfx86 / "Microsoft/Edge/Application/msedge.exe",
                pf / "Microsoft/Edge/Application/msedge.exe",
            ],
        ),
        (
            "chrome",
            [
                pf / "Google/Chrome/Application/chrome.exe",
                pfx86 / "Google/Chrome/Application/chrome.exe",
                local / "Google/Chrome/Application/chrome.exe",
            ],
        ),
        (
            "brave",
            [
                pf / "BraveSoftware/Brave-Browser/Application/brave.exe",
                pfx86 / "BraveSoftware/Brave-Browser/Application/brave.exe",
                local / "BraveSoftware/Brave-Browser/Application/brave.exe",
            ],
        ),
        (
            "vivaldi",
            [
                pf / "Vivaldi/Application/vivaldi.exe",
                pfx86 / "Vivaldi/Application/vivaldi.exe",
                local / "Vivaldi/Application/vivaldi.exe",
            ],
        ),
    )

    for executable, candidates in browser_commands:
        resolved = shutil.which(executable)
        binaries: list[str] = []
        if resolved:
            binaries.append(resolved)
        binaries.extend([str(path) for path in candidates if path.exists()])

        for binary in binaries:
            try:
                subprocess.Popen(
                    [binary, f"--app={url}"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return True
            except OSError:
                continue

    create_no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    for executable, _ in browser_commands:
        try:
            subprocess.Popen(
                ["cmd", "/c", "start", "", executable, f"--app={url}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=create_no_window,
            )
            return True
        except OSError:
            continue
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Holy Flow Windows portable launcher")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred localhost port")
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Do not auto-open browser on startup",
    )
    args = parser.parse_args()

    site_root = resolve_app_root()
    required = ["index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest", "assets/icon.svg"]
    missing = [name for name in required if not (site_root / name).exists()]
    if missing:
        raise RuntimeError(f"Required app files are missing: {', '.join(missing)}")

    port = pick_port(args.port)
    url = f"http://127.0.0.1:{port}/?desktop=1&app=1&v=20260221-7"
    server = ThreadingHTTPServer(("127.0.0.1", port), build_handler(site_root))
    server.daemon_threads = True

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
    except Exception as exc:  # pragma: no cover - launcher fallback path
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
