from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    tts_provider: str = "elevenlabs"
    elevenlabs_api_key: str = ""
    elevenlabs_model: str = "eleven_v4"
    elevenlabs_base_url: str = "https://api.elevenlabs.io"
    default_voice_id: str = ""
    # избранные голоса через запятую — показываются первыми в списке
    # (Mark Rubins, Nikolay, Daniel, Brian — из прошлых видео)
    favorite_voices: str = (
        "LmV7j80HF5QYSKe3sDtR,3EuKHIEZbSzrHGNmdYsx,onwK4e9ZLuTAKqWW03F9,nPczCjzI2devNBz1zQrb"
    )

    sample_rate: int = 44100
    max_speedup: float = 1.35
    max_text_chars: int = 5000
    data_dir: Path = Path("data")

    @property
    def favorite_voice_ids(self) -> list[str]:
        return [v.strip() for v in self.favorite_voices.split(",") if v.strip()]

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def output_dir(self) -> Path:
        return self.data_dir / "output"


settings = Settings()
