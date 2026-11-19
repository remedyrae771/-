"""Озвучка по субтитрам: каждая реплика встаёт ровно в свой тайминг."""
import asyncio
from dataclasses import dataclass, field

from app import audio
from app.cache import cached_synthesize
from app.config import settings
from app.srt import Cue
from app.tts import TTSProvider

# одновременно отправляем в API не больше стольких запросов
CONCURRENCY = 3


@dataclass
class DubResult:
    pcm: bytes
    duration: float
    cues: int
    warnings: list[str] = field(default_factory=list)


async def dub_cues(provider: TTSProvider, cues: list[Cue], voice_id: str,
                   total: float | None = None, **opts) -> DubResult:
    sem = asyncio.Semaphore(CONCURRENCY)

    async def synth(cue: Cue) -> bytes:
        async with sem:
            return await cached_synthesize(provider, cue.text, voice_id, **opts)

    mp3s = await asyncio.gather(*(synth(c) for c in cues))

    segments, warnings = [], []
    for i, (cue, mp3) in enumerate(zip(cues, mp3s)):
        # реплике разрешено звучать до начала следующей (или до конца субтитра для последней)
        next_start = cues[i + 1].start if i + 1 < len(cues) else None
        slot = (next_start if next_start is not None else cue.end) - cue.start
        pcm = await asyncio.to_thread(audio.decode_pcm, mp3)
        length = audio.pcm_duration(pcm)

        if length > slot > 0:
            tempo = min(length / slot, settings.max_speedup)
            pcm = await asyncio.to_thread(audio.decode_pcm, mp3, tempo)
            length = audio.pcm_duration(pcm)
            if length > slot + 0.05:
                if next_start is not None:
                    warnings.append(
                        f"#{cue.index} ({cue.start:.1f}s): реплика длиннее тайминга на "
                        f"{length - slot:.1f}s даже с ускорением x{tempo:.2f} — "
                        f"хвост обрезан. Сократите текст."
                    )
                    pcm = pcm[: int(slot * settings.sample_rate) * audio.BYTES_PER_SAMPLE]
                    length = slot
        segments.append((cue.start, pcm))

    end = max(start + audio.pcm_duration(p) for start, p in segments)
    total = max(total or 0.0, end)
    pcm = await asyncio.to_thread(audio.build_timeline, segments, total)
    return DubResult(pcm=pcm, duration=total, cues=len(cues), warnings=warnings)
