import asyncio
import zlib

from app.audio import run_ffmpeg
from app.tts.base import TTSProvider, Voice


class MockProvider(TTSProvider):
    """Тестовый движок без API: тон, длина которого зависит от длины текста."""

    name = "mock"

    async def synthesize(self, text, voice_id, **_):
        duration = max(0.3, len(text) * 0.06)
        freq = 200 + zlib.crc32(voice_id.encode()) % 400
        return await asyncio.to_thread(
            run_ffmpeg,
            ["-f", "lavfi", "-i", f"sine=frequency={freq}:duration={duration:.2f}",
             "-f", "mp3", "pipe:1"],
        )

    async def list_voices(self):
        return [Voice("mock-low", "Тест (низкий)", "mock"),
                Voice("mock-high", "Тест (высокий)", "mock")]

    async def clone_voice(self, name, files, description=""):
        return Voice(f"mock-{zlib.crc32(name.encode())}", name, "cloned")

    async def usage(self):
        return {"tier": "mock", "characters_used": 0, "characters_limit": None,
                "can_clone_voice": True}
