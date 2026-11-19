import httpx

from app.config import Settings
from app.tts.base import TTSError, TTSProvider, Voice


class ElevenLabsProvider(TTSProvider):
    name = "elevenlabs"

    def __init__(self, settings: Settings):
        self.s = settings

    def _client(self, timeout: float = 120) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.s.elevenlabs_base_url,
            headers={"xi-api-key": self.s.elevenlabs_api_key or "unset"},
            timeout=timeout,
        )

    @staticmethod
    def _raise(r: httpx.Response) -> None:
        if r.is_success:
            return
        try:
            detail = r.json().get("detail", r.text)
            if isinstance(detail, dict):
                detail = detail.get("message", str(detail))
        except ValueError:
            detail = r.text
        raise TTSError(f"ElevenLabs {r.status_code}: {detail}",
                       400 if r.status_code in (400, 401, 402, 422) else 502)

    async def synthesize(self, text, voice_id, *, stability=0.5, similarity=0.75, style=0.0):
        async with self._client() as c:
            r = await c.post(
                f"/v1/text-to-speech/{voice_id}",
                params={"output_format": "mp3_44100_128"},
                json={
                    "text": text,
                    "model_id": self.s.elevenlabs_model,
                    "voice_settings": {
                        "stability": stability,
                        "similarity_boost": similarity,
                        "style": style,
                    },
                },
            )
        self._raise(r)
        return r.content

    async def list_voices(self):
        async with self._client(30) as c:
            r = await c.get("/v1/voices")
        self._raise(r)
        return [
            Voice(v["voice_id"], v["name"], v.get("category", ""), v.get("preview_url"))
            for v in r.json().get("voices", [])
        ]

    async def clone_voice(self, name, files, description=""):
        """Instant Voice Cloning — требует платную подписку (Starter и выше)."""
        async with self._client(300) as c:
            r = await c.post(
                "/v1/voices/add",
                data={"name": name, "description": description},
                files=[("files", (fn, data)) for fn, data in files],
            )
        self._raise(r)
        return Voice(r.json()["voice_id"], name, "cloned")

    async def usage(self):
        async with self._client(30) as c:
            r = await c.get("/v1/user/subscription")
        self._raise(r)
        d = r.json()
        return {
            "tier": d.get("tier"),
            "characters_used": d.get("character_count"),
            "characters_limit": d.get("character_limit"),
            "can_clone_voice": d.get("can_use_instant_voice_cloning"),
        }
