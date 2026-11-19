import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def mock_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tts_provider", "mock")
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "default_voice_id", "mock-low")
