"""로그·오류 메시지에서 인증정보를 가린다."""
from __future__ import annotations

import re
from collections.abc import Iterable
from urllib.parse import quote

_USERINFO = re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s@'\"]*@")
_AUTH_HDR = re.compile(r"(?i)(authorization:\s*)(\S+\s+)?\S+")


def redact(text: str, secrets_: Iterable[str] = ()) -> str:
    if not text:
        return text
    out = _USERINFO.sub(r"\1***@", text)
    out = _AUTH_HDR.sub(r"\1***", out)
    for s in secrets_:
        if s and len(s) >= 3:
            out = out.replace(s, "***")
            enc = quote(s, safe="")
            if enc != s:
                out = out.replace(enc, "***")
    return out
