"""Разбор субтитров SRT."""
import re
from dataclasses import dataclass

_TIME = r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})"
_LINE = re.compile(rf"{_TIME}\s*-->\s*{_TIME}")
_TAGS = re.compile(r"<[^>]+>|\{\\[^}]*\}")


@dataclass
class Cue:
    index: int
    start: float  # секунды
    end: float
    text: str


class SRTError(ValueError):
    pass


def _seconds(h, m, s, ms) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000


def parse_srt(content: str) -> list[Cue]:
    content = content.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        for i, line in enumerate(lines):
            m = _LINE.search(line)
            if not m:
                continue
            start, end = _seconds(*m.groups()[:4]), _seconds(*m.groups()[4:])
            text = " ".join(_TAGS.sub("", t) for t in lines[i + 1:]).strip()
            if text and end > start:
                cues.append(Cue(len(cues) + 1, start, end, text))
            break
    if not cues:
        raise SRTError("В файле не найдено ни одного субтитра в формате SRT")
    cues.sort(key=lambda c: c.start)
    for n, c in enumerate(cues, 1):
        c.index = n
    return cues
