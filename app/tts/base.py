from abc import ABC, abstractmethod
from dataclasses import dataclass


class TTSError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class Voice:
    voice_id: str
    name: str
    category: str = ""
    preview_url: str | None = None


class TTSProvider(ABC):
    """Общий интерфейс движка синтеза речи. Возвращает MP3-байты."""

    name: str = "base"

    @abstractmethod
    async def synthesize(self, text: str, voice_id: str, *, stability: float = 0.5,
                         similarity: float = 0.75, style: float = 0.0) -> bytes: ...

    @abstractmethod
    async def list_voices(self) -> list[Voice]: ...

    async def clone_voice(self, name: str, files: list[tuple[str, bytes]],
                          description: str = "") -> Voice:
        raise TTSError("Клонирование голоса не поддерживается этим провайдером", 501)

    async def usage(self) -> dict:
        return {}
