import asyncio

import httpx

from app.config import Settings
from app.tts.base import Model, TTSError, TTSProvider, Voice


def voice_settings(model_id: str, stability: float, similarity: float, style: float) -> dict:
    """Каждое семейство моделей принимает свой набор настроек."""
    if model_id.startswith("eleven_v3"):
        # v3 понимает только три режима: 0 — творческий, 0.5 — естественный, 1 — стабильный
        return {"stability": min((0.0, 0.5, 1.0), key=lambda x: abs(x - stability))}
    if model_id.startswith("eleven_v4"):
        return {"stability": stability, "similarity_boost": similarity}
    return {"stability": stability, "similarity_boost": similarity, "style": style}


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
        code = ""
        try:
            detail = r.json().get("detail", r.text)
            if isinstance(detail, dict):
                code = detail.get("code", "")
                detail = detail.get("message", str(detail))
        except ValueError:
            detail = r.text
        if code == "paid_plan_required":
            detail = ("на бесплатном тарифе голоса из библиотеки (Mark Rubins, Nikolay и др.) "
                      "через API недоступны — нужна подписка Starter или выше. "
                      "Пока можно выбрать голос из группы «Стандартные».")
        elif code == "quota_exceeded":
            detail = "закончились символы на тарифе ElevenLabs."
        raise TTSError(f"ElevenLabs {r.status_code}: {detail}",
                       400 if r.status_code in (400, 401, 402, 422) else 502)

    async def synthesize(self, text, voice_id, *, model_id=None, stability=0.5,
                         similarity=0.75, style=0.0):
        model_id = model_id or self.s.elevenlabs_model
        async with self._client() as c:
            r = await c.post(
                f"/v1/text-to-speech/{voice_id}",
                params={"output_format": "mp3_44100_128"},
                json={
                    "text": text,
                    "model_id": model_id,
                    "voice_settings": voice_settings(model_id, stability, similarity, style),
                },
            )
        self._raise(r)
        return r.content

    async def list_voices(self):
        async with self._client(30) as c:
            favs, own = await asyncio.gather(
                asyncio.gather(*(c.get(f"/v1/voices/{v}") for v in self.s.favorite_voice_ids)),
                c.get("/v1/voices"),
            )
        self._raise(own)
        result, seen = [], set()
        for r in favs:
            if r.is_success:  # удалённый из библиотеки голос просто пропускаем
                v = r.json()
                result.append(Voice(v["voice_id"], v["name"], "favorite", v.get("preview_url")))
                seen.add(v["voice_id"])
        for v in own.json().get("voices", []):
            if v["voice_id"] not in seen:
                result.append(Voice(v["voice_id"], v["name"], v.get("category", ""),
                                    v.get("preview_url")))
        return result

    async def list_models(self):
        async with self._client(30) as c:
            r = await c.get("/v1/models")
        self._raise(r)
        return [
            Model(m["model_id"], m.get("name", m["model_id"]),
                  m.get("max_characters_request_subscribed_user"))
            for m in r.json()
            if m.get("can_do_text_to_speech")
            and any(lang.get("language_id") == "ru" for lang in m.get("languages", []))
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
