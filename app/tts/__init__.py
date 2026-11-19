from app.config import settings
from app.tts.base import Model, TTSError, TTSProvider, Voice


def get_provider() -> TTSProvider:
    if settings.tts_provider == "mock":
        from app.tts.mock import MockProvider

        return MockProvider()
    from app.tts.elevenlabs import ElevenLabsProvider

    return ElevenLabsProvider(settings)


__all__ = ["Model", "TTSError", "TTSProvider", "Voice", "get_provider"]
