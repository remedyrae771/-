import asyncio
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import audio, video
from app.audio import AudioError
from app.cache import cached_synthesize
from app.config import settings
from app.dubbing import dub_cues
from app.srt import SRTError, parse_srt
from app.tts import TTSError, get_provider

STATIC = Path(__file__).parent / "static"
MEDIA_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav", "mp4": "video/mp4"}

app = FastAPI(title="Озвучка для видео", version="0.1.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.exception_handler(TTSError)
async def _tts_error(_, exc: TTSError):
    return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)


@app.exception_handler(AudioError)
async def _audio_error(_, exc: AudioError):
    return JSONResponse({"detail": f"Ошибка обработки медиа: {exc}"}, status_code=422)


@app.exception_handler(SRTError)
async def _srt_error(_, exc: SRTError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


def _voice(voice_id: str | None) -> str:
    v = voice_id or settings.default_voice_id
    if not v:
        raise HTTPException(400, "Не выбран голос (voice_id)")
    return v


def _save_output(data: bytes, ext: str) -> str:
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    (settings.output_dir / name).write_bytes(data)
    return name


async def _read_srt(upload: UploadFile):
    raw = await upload.read()
    for enc in ("utf-8-sig", "cp1251"):
        try:
            return parse_srt(raw.decode(enc))
        except UnicodeDecodeError:
            continue
    raise HTTPException(422, "Не удалось определить кодировку субтитров")


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
async def health():
    return {"status": "ok", "provider": settings.tts_provider,
            "ffmpeg": shutil.which("ffmpeg") is not None}


@app.get("/api/voices")
async def voices():
    return [v.__dict__ for v in await get_provider().list_voices()]


@app.get("/api/usage")
async def usage():
    return await get_provider().usage()


class VoiceSettings(BaseModel):
    stability: float = Field(0.5, ge=0, le=1)
    similarity: float = Field(0.75, ge=0, le=1)
    style: float = Field(0.0, ge=0, le=1)


class TTSRequest(VoiceSettings):
    text: str = Field(min_length=1)
    voice_id: str | None = None
    format: Literal["mp3", "wav"] = "mp3"


@app.post("/api/tts")
async def tts(req: TTSRequest):
    """Озвучить один текст и сразу вернуть аудио."""
    if len(req.text) > settings.max_text_chars:
        raise HTTPException(413, f"Текст длиннее {settings.max_text_chars} символов")
    opts = req.model_dump(include={"stability", "similarity", "style"})
    mp3 = await cached_synthesize(get_provider(), req.text.strip(), _voice(req.voice_id), **opts)
    if req.format == "wav":
        data = await asyncio.to_thread(audio.encode, await asyncio.to_thread(audio.decode_pcm, mp3), "wav")
    else:
        data = mp3
    return Response(data, media_type=MEDIA_TYPES[req.format])


@app.post("/api/dub/srt")
async def dub_srt(
    subtitles: UploadFile = File(..., description="Файл .srt"),
    voice_id: str | None = Form(None),
    format: Literal["mp3", "wav"] = Form("mp3"),
    stability: float = Form(0.5), similarity: float = Form(0.75), style: float = Form(0.0),
):
    """Собрать звуковую дорожку по субтитрам — каждая фраза в свой тайминг."""
    cues = await _read_srt(subtitles)
    res = await dub_cues(get_provider(), cues, _voice(voice_id),
                         stability=stability, similarity=similarity, style=style)
    data = await asyncio.to_thread(audio.encode, res.pcm, format)
    name = _save_output(data, format)
    return {"file": name, "url": f"/api/files/{name}", "duration": round(res.duration, 2),
            "cues": res.cues, "characters": sum(len(c.text) for c in cues),
            "warnings": res.warnings}


@app.post("/api/dub/video")
async def dub_video(
    video_file: UploadFile = File(..., alias="video"),
    subtitles: UploadFile = File(...),
    voice_id: str | None = Form(None),
    mode: Literal["replace", "mix"] = Form("replace"),
    original_volume: float = Form(0.15, ge=0, le=1),
    stability: float = Form(0.5), similarity: float = Form(0.75), style: float = Form(0.0),
):
    """Озвучить видео по субтитрам и вернуть готовый mp4."""
    cues = await _read_srt(subtitles)
    voice = _voice(voice_id)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / ("input" + Path(video_file.filename or "v.mp4").suffix)
        with src.open("wb") as f:
            shutil.copyfileobj(video_file.file, f)
        info = await asyncio.to_thread(audio.probe, str(src))
        if not info["has_video"]:
            raise HTTPException(422, "В загруженном файле нет видеодорожки")

        res = await dub_cues(get_provider(), cues, voice, total=info["duration"],
                             stability=stability, similarity=similarity, style=style)
        wav = Path(tmp) / "dub.wav"
        wav.write_bytes(await asyncio.to_thread(audio.encode, res.pcm, "wav"))

        settings.output_dir.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}.mp4"
        await asyncio.to_thread(
            video.mux, str(src), str(wav), str(settings.output_dir / name),
            mode=mode, original_volume=original_volume, has_audio=info["has_audio"],
        )
    return {"file": name, "url": f"/api/files/{name}", "duration": round(info["duration"], 2),
            "cues": res.cues, "characters": sum(len(c.text) for c in cues),
            "warnings": res.warnings}


@app.post("/api/voices/clone")
async def clone_voice(
    name: str = Form(...),
    description: str = Form(""),
    samples: list[UploadFile] = File(..., description="1–25 аудиофайлов с голосом"),
):
    """Клонировать голос по образцам (у ElevenLabs нужна платная подписка)."""
    files = [(s.filename or f"sample{i}.mp3", await s.read()) for i, s in enumerate(samples)]
    v = await get_provider().clone_voice(name, files, description)
    return v.__dict__


@app.get("/api/files/{name}")
async def get_file(name: str):
    path = (settings.output_dir / name).resolve()
    if path.parent != settings.output_dir.resolve() or not path.is_file():
        raise HTTPException(404, "Файл не найден")
    return FileResponse(path, media_type=MEDIA_TYPES.get(path.suffix[1:]), filename=name)
