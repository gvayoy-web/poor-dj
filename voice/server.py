#!/usr/bin/env python3
"""Local neural TTS HTTP server for POOR DJ (Piper + optional Kokoro)."""

from __future__ import annotations

import argparse
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
import urllib.parse
import wave

import numpy as np
from piper import PiperVoice, SynthesisConfig

try:
    from kokoro_onnx import Kokoro
except Exception:
    Kokoro = None


BASE_DIR = Path(__file__).resolve().parent
VOICES_DIR = BASE_DIR / "voices"
SAMPLES_DIR = BASE_DIR / "samples"
LOG_PATH = BASE_DIR / "server.log"
MAX_LOG_BYTES = 1_048_576
CACHE_LIMIT = 64
SELFTEST_TEXT = (
    "¡Qué tal! Soy DJ POOR. Esta va directo a tus favoritas: "
    "Tití Me Preguntó, de Bad Bunny."
)

KNOWN_PIPER_LABELS = {
    "es_MX-claude-high": ("Claude · México", "es-MX"),
    "es_MX-ald-medium": ("Ald · México", "es-MX"),
    "es_AR-daniela-high": ("Daniela · Argentina", "es-AR"),
    "es_ES-davefx-medium": ("Davefx · España", "es-ES"),
    "es_ES-sharvard-medium": ("Sharvard · España", "es-ES"),
    "es_ES-carlfm-x_low": ("Carlfm · España", "es-ES"),
    "es_ES-mls_9972-low": ("MLS 9972 · España", "es-ES"),
    "es_ES-mls_10246-low": ("MLS 10246 · España", "es-ES"),
}

COUNTRY_NAMES = {
    "MX": "México",
    "AR": "Argentina",
    "ES": "España",
    "US": "EE. UU.",
    "419": "Latinoamérica",
}

KOKORO_VOICES = [
    ("em_alex", "Alex · Español (Kokoro)", "es"),
    ("em_santa", "Santa · Español (Kokoro)", "es"),
    ("ef_dora", "Dora · Español (Kokoro)", "es"),
]

_log_lock = threading.Lock()


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
    with _log_lock:
        try:
            if LOG_PATH.exists() and LOG_PATH.stat().st_size > MAX_LOG_BYTES:
                tail = LOG_PATH.read_bytes()[-(MAX_LOG_BYTES // 2):]
                idx = tail.find(b"\n")
                if idx >= 0:
                    tail = tail[idx + 1 :]
                LOG_PATH.write_bytes(tail)
            with LOG_PATH.open("a", encoding="utf-8") as fh:
                fh.write(line)
        except Exception:
            pass


def clean_text(raw: str) -> str:
    text = re.sub(r"[\r\n\t]+", " ", raw or "")
    text = "".join(ch for ch in text if ord(ch) >= 32 and ord(ch) != 127)
    return re.sub(r"\s+", " ", text).strip()


def clamp_speed(raw: str | float | None) -> float:
    try:
        val = float(raw) if raw is not None else 1.0
    except (TypeError, ValueError):
        val = 1.0
    if not np.isfinite(val):
        val = 1.0
    return round(max(0.7, min(1.4, val)), 2)


def infer_piper_meta(stem: str) -> tuple[str, str]:
    if stem in KNOWN_PIPER_LABELS:
        return KNOWN_PIPER_LABELS[stem]
    m = re.match(r"^([a-z]{2})_([A-Za-z0-9]+)-([^-]+)-(.+)$", stem)
    if m:
        lang_code, region, name, _quality = m.groups()
        lang = f"{lang_code}-{region}"
        place = COUNTRY_NAMES.get(region.upper(), region)
        return (f"{name.capitalize()} · {place}", lang)
    return (stem, "es")


def format_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    arr = np.asarray(samples, dtype=np.float32).reshape(-1)
    if arr.size == 0:
        arr = np.zeros(int(sample_rate * 0.2), dtype=np.float32)

    peak = float(np.max(np.abs(arr)))
    target_peak = 10.0 ** (-1.0 / 20.0)  # approx -1 dBFS
    if peak > 1e-6:
        arr = arr * (target_peak / peak)
    arr = np.clip(arr, -1.0, 1.0)

    lead = np.zeros(int(round(sample_rate * 0.1)), dtype=np.float32)
    tail = np.zeros(int(round(sample_rate * 0.2)), dtype=np.float32)
    padded = np.concatenate([lead, arr, tail])
    pcm = np.round(padded * 32767.0).astype("<i2")

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


class VoiceRegistry:
    def __init__(self, voices_dir: Path = VOICES_DIR) -> None:
        self.voices_dir = voices_dir
        self.voices: dict[str, dict] = {}
        self.order: list[str] = []
        self.default_id: str = ""
        self._piper_models: dict[str, PiperVoice] = {}
        self._piper_lock = threading.Lock()
        self._kokoro = None
        self._kokoro_lock = threading.Lock()
        self._cache: OrderedDict[tuple[str, float, str], bytes] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._discover()

    def _discover(self) -> None:
        preferred_order = [
            "es_MX-claude-high",
            "es_MX-ald-medium",
            "es_AR-daniela-high",
            "es_ES-davefx-medium",
        ]
        found_onnx: dict[str, Path] = {}
        if self.voices_dir.exists():
            for onnx_path in sorted(self.voices_dir.glob("*.onnx")):
                json_path = Path(str(onnx_path) + ".json")
                if json_path.exists():
                    found_onnx[onnx_path.stem] = onnx_path

        stems = [s for s in preferred_order if s in found_onnx] + [
            s for s in sorted(found_onnx) if s not in preferred_order
        ]
        for stem in stems:
            vid = f"piper:{stem}"
            label, lang = infer_piper_meta(stem)
            self.voices[vid] = {
                "id": vid,
                "label": label,
                "lang": lang,
                "engine": "piper",
                "path": found_onnx[stem],
            }
            self.order.append(vid)

        kokoro_dir = self.voices_dir / "kokoro"
        k_model = kokoro_dir / "kokoro-v1.0.int8.onnx"
        k_voices = kokoro_dir / "voices-v1.0.bin"
        if Kokoro is not None and k_model.exists() and k_voices.exists():
            try:
                self._kokoro = Kokoro(str(k_model), str(k_voices))
                for k_name, label, lang in KOKORO_VOICES:
                    vid = f"kokoro:{k_name}"
                    self.voices[vid] = {
                        "id": vid,
                        "label": label,
                        "lang": lang,
                        "engine": "kokoro",
                        "kokoro_name": k_name,
                    }
                    self.order.append(vid)
                log("Kokoro ONNX loaded successfully.")
            except Exception as exc:
                self._kokoro = None
                log(f"Kokoro ONNX disabled (failed to load): {exc}")

        if "piper:es_MX-claude-high" in self.voices:
            self.default_id = "piper:es_MX-claude-high"
        elif self.order:
            self.default_id = self.order[0]

        if self.default_id and self.voices[self.default_id]["engine"] == "piper":
            try:
                self._get_piper(self.default_id)
                log(f"Preloaded default voice: {self.default_id}")
            except Exception as exc:
                log(f"Failed to preload default voice {self.default_id}: {exc}")

    def _get_piper(self, vid: str) -> PiperVoice:
        if vid in self._piper_models:
            return self._piper_models[vid]
        model_path = str(self.voices[vid]["path"])
        voice = PiperVoice.load(model_path)
        self._piper_models[vid] = voice
        return voice

    def health_payload(self) -> dict:
        return {
            "ok": len(self.order) > 0,
            "version": "1.0",
            "default": self.default_id,
            "voices": [
                {
                    "id": self.voices[vid]["id"],
                    "label": self.voices[vid]["label"],
                    "lang": self.voices[vid]["lang"],
                    "engine": self.voices[vid]["engine"],
                }
                for vid in self.order
            ],
        }

    def resolve_voice(self, requested: str | None) -> str:
        if requested and requested in self.voices:
            return requested
        return self.default_id

    def synthesize(self, text: str, voice_id: str | None = None, speed: float = 1.0) -> tuple[bytes, str, bool]:
        if not self.order:
            raise RuntimeError("No voice models are available in voice/voices/")

        vid = self.resolve_voice(voice_id)
        spd = clamp_speed(speed)
        cache_key = (vid, spd, text)

        with self._cache_lock:
            cached = self._cache.get(cache_key)
            if cached is not None:
                self._cache.move_to_end(cache_key)
                return cached, vid, True

        meta = self.voices[vid]
        if meta["engine"] == "piper":
            wav_bytes = self._synth_piper(vid, text, spd)
        elif meta["engine"] == "kokoro":
            wav_bytes = self._synth_kokoro(meta["kokoro_name"], text, spd)
        else:
            raise RuntimeError(f"Unsupported engine: {meta['engine']}")

        with self._cache_lock:
            self._cache[cache_key] = wav_bytes
            self._cache.move_to_end(cache_key)
            while len(self._cache) > CACHE_LIMIT:
                self._cache.popitem(last=False)

        return wav_bytes, vid, False

    def _synth_piper(self, vid: str, text: str, speed: float) -> bytes:
        with self._piper_lock:
            voice = self._get_piper(vid)
            syn_cfg = SynthesisConfig(length_scale=round(1.0 / speed, 4))
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wf:
                voice.synthesize_wav(text, wf, syn_config=syn_cfg)
            buf.seek(0)
            with wave.open(buf, "rb") as rf:
                sample_rate = rf.getframerate()
                raw_pcm = rf.readframes(rf.getnframes())
        samples = np.frombuffer(raw_pcm, dtype="<i2").astype(np.float32) / 32768.0
        return format_wav(samples, sample_rate)

    def _synth_kokoro(self, k_name: str, text: str, speed: float) -> bytes:
        if self._kokoro is None:
            raise RuntimeError("Kokoro engine is not loaded")
        with self._kokoro_lock:
            samples, sample_rate = self._kokoro.create(
                text=text, voice=k_name, speed=float(speed), lang="es"
            )
        return format_wav(samples, int(sample_rate))


def make_handler(registry: VoiceRegistry):
    class TTSHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args) -> None:
            log(f"{self.client_address[0]} - {format % args}")

        def _send_cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.close_connection = True

        def _send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._send_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/health":
                self._send_json(200, registry.health_payload())
                return

            if parsed.path == "/tts":
                params = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
                raw_text = params.get("text", [""])[0]
                text = clean_text(raw_text)
                if not text:
                    self._send_json(400, {"ok": False, "error": "El parámetro text es obligatorio (1-600 caracteres)."})
                    return
                if len(text) > 600:
                    self._send_json(400, {"ok": False, "error": "El texto supera los 600 caracteres."})
                    return

                voice_req = params.get("voice", [""])[0]
                speed_req = params.get("speed", ["1.0"])[0]
                try:
                    t0 = time.perf_counter()
                    wav_bytes, used_voice, hit = registry.synthesize(text, voice_req, clamp_speed(speed_req))
                    dt_ms = (time.perf_counter() - t0) * 1000.0
                    log(f"TTS voice={used_voice} cache={hit} len={len(text)} bytes={len(wav_bytes)} time={dt_ms:.1f}ms")
                    self.send_response(200)
                    self._send_cors_headers()
                    self.send_header("Content-Type", "audio/wav")
                    self.send_header("Content-Length", str(len(wav_bytes)))
                    self.send_header("X-Voice-Id", used_voice)
                    self.end_headers()
                    self.wfile.write(wav_bytes)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    pass
                except Exception as exc:
                    log(f"TTS error: {exc}")
                    try:
                        self._send_json(500, {"ok": False, "error": str(exc)})
                    except OSError:
                        pass
                return

            self._send_json(404, {"ok": False, "error": "Ruta no encontrada."})

    return TTSHandler


def run_selftest(registry: VoiceRegistry) -> int:
    if not registry.order:
        print("ERROR: No se encontraron voces en voice/voices/", file=sys.stderr)
        return 1

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    failures = 0
    for vid in registry.order:
        t0 = time.perf_counter()
        try:
            wav_bytes, _, _ = registry.synthesize(SELFTEST_TEXT, vid, 1.0)
            elapsed = time.perf_counter() - t0
            safe_name = vid.replace(":", "_") + ".wav"
            out_path = SAMPLES_DIR / safe_name
            out_path.write_bytes(wav_bytes)
            print(f"[OK] {vid} -> {out_path.name} ({len(wav_bytes)} bytes, {elapsed*1000:.1f} ms)")
        except Exception as exc:
            elapsed = time.perf_counter() - t0
            print(f"[FAIL] {vid} ({elapsed*1000:.1f} ms): {exc}", file=sys.stderr)
            failures += 1

    return 1 if failures == len(registry.order) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="POOR DJ local neural TTS server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=47811)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    registry = VoiceRegistry(VOICES_DIR)
    if args.selftest:
        return run_selftest(registry)

    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.daemon_threads = True
    server = ThreadingHTTPServer((args.host, args.port), make_handler(registry))
    log(f"Listening on http://{args.host}:{args.port} with {len(registry.order)} voices")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        log("Server stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
