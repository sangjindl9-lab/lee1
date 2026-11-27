"""자막: 단어 타임스탬프 → 큐 묶기 → SRT · VTT · ASS(단어 강조, 쇼츠 안전 영역)."""
import re

CJK = {"ko", "ja", "zh"}
DEFAULT_STYLE = {
    "font": "Noto Sans CJK KR", "size": 92, "primary": "#FFFFFF", "highlight": "#FFE500",
    "emphasis": "#3DE0FF", "outline": "#000000", "outline_width": 9, "shadow": 3,
    # 쇼츠 화면의 하단 제목·설명 영역과 우측 버튼 열을 피한다(1080x1920 기준 픽셀).
    "margin_v": 560, "margin_l": 90, "margin_r": 190, "kinetic": False,
    # 상단 타이틀(핵심 문구 카드)
    "title_size": 110, "title_text": "#111111", "title_box": "#FFE500", "title_margin_v": 300,
}
_END = re.compile(r"[.!?。！？…]$")


_BREAK = re.compile(r"[,.!?。！？…:;]$")


def build_cues(scenes: list[dict], language: str = "ko") -> list[dict]:
    """scenes: [{start, words:[{w,s,e}], position, emphasis:[...]}] → 화면 단위 큐.
    말하는 구절(쉼표·문장 끝·숨 쉬는 곳) 단위로 한 줄씩 보여 준다. 글자 수로 기계적으로 자르면 어색하다."""
    max_chars = 15 if language in CJK else 32
    cues = []
    for sc in scenes:
        words = [{"w": wd["w"], "s": round(sc["start"] + wd["s"], 3), "e": round(sc["start"] + wd["e"], 3)}
                 for wd in sc.get("words") or [] if wd.get("w")]
        groups, cur = [], []
        for i, word in enumerate(words):
            if cur:
                length = sum(len(x["w"]) for x in cur) + len(cur) + len(word["w"])
                pause = word["s"] - cur[-1]["e"]
                if length > max_chars or pause > 0.35:
                    groups.append(cur)
                    cur = []
            cur.append(word)
            if _BREAK.search(word["w"]):
                groups.append(cur)
                cur = []
        if cur:
            groups.append(cur)
        # 한 낱말만 남은 꼬리는 앞 구절에 붙인다(너무 길어지지 않을 때)
        merged = []
        for g in groups:
            if merged and len(g) == 1 and not _BREAK.search(merged[-1][-1]["w"]) and \
                    sum(len(x["w"]) for x in merged[-1] + g) + len(merged[-1]) <= max_chars + 4:
                merged[-1] = merged[-1] + g
            else:
                merged.append(g)
        cues += [_cue(g, sc) for g in merged]
    # 표시 시간 보정: 최소 0.6초, 다음 큐와 겹치지 않게
    for i, c in enumerate(cues):
        nxt = cues[i + 1]["s"] if i + 1 < len(cues) else None
        end = max(c["e"] + 0.15, c["s"] + 0.6)
        c["e"] = round(min(end, nxt) if nxt is not None else end, 3)
        if c["e"] <= c["s"]:
            c["e"] = round(c["s"] + 0.2, 3)
    return cues


def _display(text: str) -> str:
    """화면 자막에서는 문장 끝 마침표·쉼표를 뺀다(물음표·느낌표는 둔다)."""
    return re.sub(r"[.,。]+$", "", text.strip())


def _cue(words: list[dict], sc: dict) -> dict:
    words = [{**w, "w": _display(w["w"]) if i == len(words) - 1 else w["w"]} for i, w in enumerate(words)]
    return {"s": words[0]["s"], "e": words[-1]["e"], "text": " ".join(w["w"] for w in words), "words": list(words),
            "position": sc.get("position", "lower"), "emphasis": sc.get("emphasis") or []}


def _ts(t: float, sep: str) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{sep}{ms % 1000:03d}"


def to_srt(cues: list[dict]) -> str:
    return "\n".join(f"{i}\n{_ts(c['s'], ',')} --> {_ts(c['e'], ',')}\n{c['text']}\n" for i, c in enumerate(cues, 1))


def to_vtt(cues: list[dict]) -> str:
    return "WEBVTT\n\n" + "\n".join(f"{_ts(c['s'], '.')} --> {_ts(c['e'], '.')}\n{c['text']}\n" for c in cues)


def _ass_color(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}&".upper()


def _ass_ts(t: float) -> str:
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _esc(s: str) -> str:
    return s.replace("{", "(").replace("}", ")").replace("\\", "/").replace("\n", " ")


def to_ass(cues: list[dict], width: int = 1080, height: int = 1920, style: dict | None = None,
           titles: list[dict] | None = None) -> str:
    st = {**DEFAULT_STYLE, **(style or {})}
    k = height / 1920
    size, mv = int(st["size"] * k), int(st["margin_v"] * k)
    ml, mr = int(st["margin_l"] * k), int(st["margin_r"] * k)
    hi, em = _ass_color(st["highlight"]), _ass_color(st["emphasis"])
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lower,{st['font']},{size},{_ass_color(st['primary'])},&H000000FF&,{_ass_color(st['outline'])},&H7F000000&,-1,0,0,0,100,100,0,0,1,{st['outline_width']},{st['shadow']},2,{ml},{mr},{mv},1
Style: Center,{st['font']},{size},{_ass_color(st['primary'])},&H000000FF&,{_ass_color(st['outline'])},&H7F000000&,-1,0,0,0,100,100,0,0,1,{st['outline_width']},{st['shadow']},5,{ml},{mr},0,1
Style: Title,{st['font']},{int(st['title_size'] * k)},{_ass_color(st['title_text'])},&H000000FF&,{_ass_color(st['title_box'])},&H00000000&,-1,0,0,0,100,100,0,0,3,{int(22 * k)},0,8,{ml},{mr},{int(st['title_margin_v'] * k)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for c in cues:
        name = "Center" if c.get("position") == "center" else "Lower"
        emph = {e.strip(".,!?") for e in c.get("emphasis") or []}
        words = c["words"]
        if not st.get("kinetic"):
            parts = [f"{{\\c{em}}}{_esc(x['w'])}{{\\r}}" if x["w"].strip(".,!?") in emph else _esc(x["w"]) for x in words]
            lines.append(f"Dialogue: 0,{_ass_ts(c['s'])},{_ass_ts(c['e'])},{name},,0,0,0,,{{\\fad(60,60)}}{' '.join(parts)}")
            continue
        for i, w in enumerate(words):
            start = c["s"] if i == 0 else w["s"]
            end = words[i + 1]["s"] if i + 1 < len(words) else c["e"]
            if end <= start:
                continue
            parts = []
            for j, x in enumerate(words):
                t = _esc(x["w"])
                if j == i:
                    pop = "\\fscx112\\fscy112\\t(0,140,\\fscx100\\fscy100)" if st.get("kinetic") else ""
                    parts.append(f"{{\\c{hi}{pop}}}{t}{{\\r}}")
                elif x["w"].strip(".,!?") in emph:
                    parts.append(f"{{\\c{em}}}{t}{{\\r}}")
                else:
                    parts.append(t)
            lines.append(f"Dialogue: 0,{_ass_ts(start)},{_ass_ts(end)},{name},,0,0,0,,{' '.join(parts)}")
    for t in titles or []:
        if not t.get("text") or t["e"] <= t["s"]:
            continue
        # 튀어나오듯 커졌다가 자리 잡는 카드(편집 툴의 '팝' 타이틀)
        anim = "{\\fad(60,140)\\fscx135\\fscy135\\t(0,160,\\fscx100\\fscy100)}"
        lines.append(f"Dialogue: 1,{_ass_ts(t['s'])},{_ass_ts(t['e'])},Title,,0,0,0,,{anim}{_esc(t['text'])}")
    return head + "\n".join(lines) + "\n"


def check(cues: list[dict], total: float, language: str = "ko") -> list[str]:
    """자막 자체 점검: 겹침, 범위 초과, 읽기 속도."""
    issues = []
    limit = 12 if language in CJK else 22  # 초당 글자 수 상한
    fast = 0
    for i, c in enumerate(cues):
        if c["e"] > total + 0.3:
            issues.append(f"자막 {i + 1}번이 영상 길이를 넘음")
        if i and c["s"] < cues[i - 1]["e"] - 0.01:
            issues.append(f"자막 {i}·{i + 1}번 겹침")
        d = max(c["e"] - c["s"], 0.01)
        if len(c["text"].replace(" ", "")) / d > limit:
            fast += 1
    if cues and fast / len(cues) > 0.25:
        issues.append(f"읽기 속도가 빠른 자막 {fast}개")
    return issues
