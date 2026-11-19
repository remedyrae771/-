"""Наложение озвучки на видео."""
from app.audio import run_ffmpeg


def mux(video_path: str, dub_wav: str, out_path: str, *, mode: str = "replace",
        original_volume: float = 0.15, has_audio: bool = True) -> None:
    """mode=replace — заменить звук; mode=mix — оставить оригинал тише (фон/музыка)."""
    args = ["-i", video_path, "-i", dub_wav]
    if mode == "mix" and has_audio:
        args += [
            "-filter_complex",
            f"[0:a]volume={original_volume}[bg];"
            "[bg][1:a]amix=inputs=2:duration=first:normalize=0[a]",
            "-map", "0:v", "-map", "[a]",
        ]
    else:
        args += ["-map", "0:v", "-map", "1:a", "-af", "apad", "-shortest"]
    args += ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
             out_path]
    run_ffmpeg(args)
