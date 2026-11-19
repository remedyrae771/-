import pytest

from app.srt import SRTError, parse_srt

SAMPLE = """﻿1
00:00:01,000 --> 00:00:03,500
Привет, <i>мир</i>!

2
00:00:04.200 --> 00:00:06,000
Вторая строка
продолжается тут
"""


def test_parse():
    cues = parse_srt(SAMPLE.replace("\n", "\r\n"))
    assert len(cues) == 2
    assert cues[0].start == 1.0 and cues[0].end == 3.5
    assert cues[0].text == "Привет, мир!"
    assert cues[1].start == pytest.approx(4.2)
    assert cues[1].text == "Вторая строка продолжается тут"


def test_empty():
    with pytest.raises(SRTError):
        parse_srt("просто текст")
