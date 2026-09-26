"""Bible Concordance -- Kokoro voice sidecar (read-aloud).

Adapted from the Ghost Claw Kokoro sidecar (same idea: a tiny local HTTP server around
kokoro-onnx that the Rust backend starts as a child process), with these changes for
this app:

* Standard-library HTTP server instead of FastAPI/uvicorn (fewer things to bundle).
* Binds 127.0.0.1 on a free port chosen by the OS and prints "ready <port>" on stdout,
  so the app never has to guess or retry ports.
* Warms up (one short synthesis) before announcing "ready", so the reader's first verse
  isn't slow.
* Loads the espeak-ng DLL once, in place. phonemizer normally copies the DLL into a new
  temp folder for every wrapper instance and loads each copy; on Windows every freshly
  copied DLL is scanned by the antivirus (~4 s each, 16 s in total before the first
  word). A single-threaded server only needs one instance -- see _load_espeak_in_place.
* Exits by itself when the app that started it goes away (--parent-pid), so a crashed
  or killed app never leaves it running (or holding files an installer wants to replace).

Usage: voice-sidecar --model <kokoro .onnx> --voices <voices .bin> [--parent-pid <pid>]
Endpoints: GET /health, GET /voices, POST /speak {"text", "voice", "speed"} -> audio/wav
"""
import argparse
import ctypes
import io
import json
import os
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _load_espeak_in_place():
    import phonemizer.backend.espeak.api as espeak_api

    def __init__(self, library, data_path):
        self._library = None
        if data_path is not None:
            data_path = str(data_path).encode("utf-8")
        self._library = ctypes.cdll.LoadLibrary(str(library))
        if self._library.espeak_Initialize(0x02, 0, data_path, 0) <= 0:  # 0x02 = synchronous
            raise RuntimeError("failed to initialize espeak shared library")
        self._library_path = self._shared_library_path(self._library)
        self._tempdir = None

    espeak_api.EspeakAPI.__init__ = __init__


_load_espeak_in_place()

import numpy as np  # noqa: E402
from kokoro_onnx import Kokoro  # noqa: E402

kokoro: Kokoro | None = None
voice_names: list[str] = []
synth_lock = threading.Lock()  # kokoro/espeak are not thread-safe; /health stays responsive


def synthesize(text: str, voice: str, speed: float) -> bytes:
    with synth_lock:
        samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": kokoro is not None, "voices": len(voice_names)})
        elif self.path == "/voices":
            self._json(200, {"voices": voice_names})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/speak":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(length) or b"{}")
            text = str(req.get("text", "")).strip()
            voice = str(req.get("voice") or "am_michael")
            speed = min(2.0, max(0.5, float(req.get("speed") or 1.0)))
        except Exception as e:  # noqa: BLE001
            return self._json(400, {"error": f"bad request: {e}"})
        if not text:
            return self._json(400, {"error": "empty text"})
        if voice not in voice_names:
            return self._json(400, {"error": f"unknown voice {voice}"})
        try:
            self._send(200, synthesize(text, voice, speed), "audio/wav")
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": f"synthesis failed: {e}"})

    def log_message(self, *args):  # keep stderr quiet; the app logs failures itself
        pass


def exit_with_parent(pid: int):
    """Block until process `pid` ends, then exit (Windows: wait on its handle)."""
    if sys.platform != "win32":
        return
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not handle:
        os._exit(0)  # the parent is already gone
    kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
    os._exit(0)


def main():
    global kokoro, voice_names
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--voices", required=True)
    p.add_argument("--parent-pid", type=int, default=0)
    args = p.parse_args()

    if args.parent_pid:
        threading.Thread(target=exit_with_parent, args=(args.parent_pid,), daemon=True).start()

    kokoro = Kokoro(args.model, args.voices)
    voice_names = sorted(kokoro.get_voices())
    synthesize("In the beginning.", voice_names[0], 1.0)  # warm-up

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    print(f"ready {server.server_address[1]}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
