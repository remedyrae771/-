"""Кэш синтеза: одинаковый текст + голос + настройки не оплачиваются дважды."""
import hashlib
import json

from app.config import settings
from app.tts import TTSProvider


async def cached_synthesize(provider: TTSProvider, text: str, voice_id: str, **opts) -> bytes:
    key_src = json.dumps(
        [provider.name, settings.elevenlabs_model, voice_id, text, opts], sort_keys=True,
        ensure_ascii=False,
    )
    key = hashlib.sha256(key_src.encode()).hexdigest()
    path = settings.cache_dir / f"{key}.mp3"
    if path.exists():
        return path.read_bytes()
    audio = await provider.synthesize(text, voice_id, **opts)
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    return audio
