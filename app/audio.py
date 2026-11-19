"""Работа со звуком через ffmpeg: декодирование, ускорение, сборка дорожки."""
import subprocess
from array import array

from app.config import settings

BYTES_PER_SAMPLE = 2  # s16le, моно


class AudioError(RuntimeError):
    pass


def run_ffmpeg(args: list[str], input_bytes: bytes | None = None) -> bytes:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        input=input_bytes, capture_output=True,
    )
    if proc.returncode != 0:
        raise AudioError(proc.stderr.decode(errors="replace").strip()[-800:])
    return proc.stdout


def _atempo_chain(tempo: float) -> str:
    # один фильтр atempo принимает 0.5..2.0, поэтому при необходимости делаем цепочку
    parts = []
    while tempo > 2.0:
        parts.append("atempo=2.0")
        tempo /= 2.0
    parts.append(f"atempo={tempo:.4f}")
    return ",".join(parts)


def decode_pcm(mp3: bytes, tempo: float = 1.0) -> bytes:
    """MP3 -> сырой PCM s16le моно с частотой settings.sample_rate."""
    args = ["-i", "pipe:0"]
    if abs(tempo - 1.0) > 1e-3:
        args += ["-af", _atempo_chain(tempo)]
    args += ["-f", "s16le", "-ac", "1", "-ar", str(settings.sample_rate), "pipe:1"]
    return run_ffmpeg(args, mp3)


def pcm_duration(pcm: bytes) -> float:
    return len(pcm) / BYTES_PER_SAMPLE / settings.sample_rate


def build_timeline(segments: list[tuple[float, bytes]], total: float) -> bytes:
    """Раскладывает куски PCM по времени на тишине длиной total секунд."""
    sr = settings.sample_rate
    track = array("h", bytes(int(total * sr) * BYTES_PER_SAMPLE))
    for start, pcm in segments:
        seg = array("h", pcm)
        pos = int(start * sr)
        end = min(pos + len(seg), len(track))
        if end > pos:
            track[pos:end] = seg[: end - pos]
    return track.tobytes()


def encode(pcm: bytes, fmt: str = "mp3") -> bytes:
    codec = {"mp3": ["-f", "mp3", "-b:a", "192k"], "wav": ["-f", "wav"]}[fmt]
    return run_ffmpeg(
        ["-f", "s16le", "-ac", "1", "-ar", str(settings.sample_rate), "-i", "pipe:0",
         *codec, "pipe:1"],
        pcm,
    )


def probe(path: str) -> dict:
    """Длительность медиафайла и наличие звуковой дорожки."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
         "-of", "default=nw=1", path],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise AudioError("Не удалось прочитать файл: " + out.stderr.strip()[-300:])
    duration, has_audio, has_video = 0.0, False, False
    for line in out.stdout.splitlines():
        key, _, val = line.partition("=")
        if key == "duration" and val not in ("", "N/A"):
            duration = float(val)
        elif key == "codec_type":
            has_audio |= val == "audio"
            has_video |= val == "video"
    return {"duration": duration, "has_audio": has_audio, "has_video": has_video}
