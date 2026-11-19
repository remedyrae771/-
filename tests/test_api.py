import subprocess

from fastapi.testclient import TestClient

from app.audio import probe
from app.main import app

client = TestClient(app)

SRT = """1
00:00:00,500 --> 00:00:01,500
Коротко

2
00:00:02,000 --> 00:00:02,600
Очень длинная реплика, которая точно не влезет в отведённое ей время

3
00:00:03,000 --> 00:00:04,000
Финал
"""


def test_health_and_voices():
    assert client.get("/api/health").json()["provider"] == "mock"
    assert len(client.get("/api/voices").json()) == 2


def test_tts():
    r = client.post("/api/tts", json={"text": "Привет", "voice_id": "mock-low"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert len(r.content) > 1000


def test_tts_validation():
    assert client.post("/api/tts", json={"text": ""}).status_code == 422


def test_dub_srt():
    r = client.post("/api/dub/srt", files={"subtitles": ("a.srt", SRT.encode())},
                    data={"voice_id": "mock-high", "format": "wav"})
    j = r.json()
    assert r.status_code == 200, j
    assert j["cues"] == 3
    assert len(j["warnings"]) == 1 and j["warnings"][0].startswith("#2")
    f = client.get(j["url"])
    assert f.status_code == 200 and f.content[:4] == b"RIFF"


def test_bad_srt():
    r = client.post("/api/dub/srt", files={"subtitles": ("a.srt", b"nothing")})
    assert r.status_code == 422


def test_dub_video(tmp_path):
    src = tmp_path / "in.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i",
                    "color=c=blue:s=160x120:d=5", "-f", "lavfi", "-i", "anoisesrc=d=5",
                    "-shortest", "-c:v", "libx264", "-c:a", "aac", str(src)], check=True)
    for mode in ("replace", "mix"):
        r = client.post("/api/dub/video",
                        files={"video": ("in.mp4", src.read_bytes()),
                               "subtitles": ("a.srt", SRT.encode())},
                        data={"mode": mode})
        j = r.json()
        assert r.status_code == 200, j
        out = tmp_path / f"out-{mode}.mp4"
        out.write_bytes(client.get(j["url"]).content)
        info = probe(str(out))
        assert info["has_video"] and info["has_audio"]
        assert abs(info["duration"] - 5) < 0.3


def test_file_path_traversal():
    assert client.get("/api/files/..%2F..%2Fetc%2Fpasswd").status_code == 404
