"""알림 전송(이메일·웹훅): 새 이벤트, 해소, 미확인 이벤트 반복 알림. 같은 이벤트 키는 억제 시간 안에 다시 보내지 않는다."""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import func, select

from ..db import session_scope
from ..events import EVENT_TEXT, SEVERITY_ORDER
from ..models import Camera, Event, NotifyChannel, NotifyLog, SystemSetting, utcnow
from ..security.crypto import decrypt_secret
from ..security.netguard import TargetDenied, check_host

log = logging.getLogger("nvr.worker.notify")
ANY_NET = ["0.0.0.0/0", "::/0"]  # 외부 주소 허용, 루프백·메타데이터·내부 Docker 망은 netguard 가 항상 차단


def channel_config(ch: NotifyChannel) -> dict[str, Any]:
    return json.loads(decrypt_secret(ch.config_enc) or "{}")


def payload(ev: Event, cam: Camera | None, kind: str) -> dict[str, Any]:
    return {
        "kind": kind,  # new / repeat / resolved / test
        "event_id": ev.id, "type": ev.type, "type_label": EVENT_TEXT.get(ev.type, ev.type), "severity": ev.severity,
        "source": ev.source, "message": ev.message, "camera_id": ev.camera_id, "camera_name": cam.name if cam else None,
        "started_at": ev.started_at.isoformat() if ev.started_at else None,
        "ended_at": ev.ended_at.isoformat() if ev.ended_at else None,
    }


def send(ch: NotifyChannel, data: dict[str, Any]) -> None:
    cfg = channel_config(ch)
    label = {"new": "발생", "repeat": "미확인 반복", "resolved": "해소", "test": "시험"}.get(data["kind"], data["kind"])
    subject = f"[웹 NVR] {data['type_label']} {label} — {data.get('camera_name') or '시스템'}"
    if ch.type == "webhook":
        url = cfg.get("url", "")
        p = urlsplit(url)
        if p.scheme not in ("http", "https") or not p.hostname or p.username:
            raise ValueError("웹훅 주소가 올바르지 않습니다.")
        check_host(p.hostname, ANY_NET)
        body = json.dumps(data, ensure_ascii=False).encode()
        headers = {"Content-Type": "application/json", "User-Agent": "web-nvr/0.2", "X-NVR-Event": data["type"]}
        if cfg.get("secret"):
            headers["X-NVR-Signature"] = "sha256=" + hmac.new(cfg["secret"].encode(), body, hashlib.sha256).hexdigest()
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as c:
            r = c.post(url, content=body, headers=headers)
        if r.status_code >= 300:
            raise RuntimeError(f"웹훅 응답 HTTP {r.status_code}")
        return
    if ch.type == "email":
        host = cfg.get("host", "")
        check_host(host, ANY_NET)
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = cfg.get("from") or cfg.get("username")
        msg["To"] = ", ".join(cfg.get("to", []))
        lines = [f"종류: {data['type_label']} ({label})", f"중요도: {data['severity']}",
                 f"카메라: {data.get('camera_name') or '-'}", f"발생: {data['started_at']}",
                 f"종료: {data['ended_at'] or '진행 중'}", "", data["message"]]
        msg.set_content("\n".join(lines))
        port = int(cfg.get("port") or 587)
        sec = cfg.get("security", "starttls")
        ctx = ssl.create_default_context()
        if sec == "ssl":
            server = smtplib.SMTP_SSL(host, port, timeout=15, context=ctx)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
        try:
            if sec == "starttls":
                server.starttls(context=ctx)
            if cfg.get("username"):
                server.login(cfg["username"], cfg.get("password", ""))
            server.send_message(msg)
        finally:
            try:
                server.quit()
            except Exception:  # noqa: BLE001
                pass
        return
    raise ValueError("알 수 없는 채널 종류")


def _matches(ch: NotifyChannel, ev: Event) -> bool:
    if SEVERITY_ORDER.get(ev.severity, 0) < SEVERITY_ORDER.get(ch.min_severity, 1):
        return False
    return not ch.event_types or ev.type in ch.event_types


def _log(db, ch: NotifyChannel, ev: Event | None, key: str, kind: str, ok: bool, err: str = "") -> None:
    db.add(NotifyLog(channel_id=ch.id, event_id=ev.id if ev else None, dedup_key=key, kind=kind, ok=ok, error=err[:500]))


def deliver(ch: NotifyChannel, ev: Event, cam: Camera | None, kind: str) -> tuple[bool, str]:
    try:
        send(ch, payload(ev, cam, kind))
        return True, ""
    except (OSError, ValueError, RuntimeError, TargetDenied, httpx.HTTPError, smtplib.SMTPException) as exc:
        return False, getattr(exc, "message", str(exc))


def run_once() -> dict[str, int]:
    """새 이벤트·해소·반복 알림 처리. 반환: 전송 수."""
    sent = failed = 0
    now = utcnow()
    with session_scope() as db:
        chans = db.scalars(select(NotifyChannel).where(NotifyChannel.enabled.is_(True))).all()
        cur_row = db.get(SystemSetting, "notify_cursor")
        cursor = int(cur_row.value) if cur_row else (db.scalar(select(func.max(Event.id))) or 0)
        if not cur_row:
            db.add(SystemSetting(key="notify_cursor", value=cursor))
            return {"sent": 0, "failed": 0}
        if not chans:
            cur_row.value = db.scalar(select(func.max(Event.id))) or cursor
            return {"sent": 0, "failed": 0}
        cams = {c.id: c for c in db.scalars(select(Camera))}
        new_events = db.scalars(select(Event).where(Event.id > cursor).order_by(Event.id).limit(200)).all()
        for ev in new_events:
            key = ev.dedup_key or f"{ev.type}:{ev.camera_id}"
            for ch in chans:
                if not _matches(ch, ev):
                    continue
                recent = db.scalar(select(NotifyLog.id).where(
                    NotifyLog.channel_id == ch.id, NotifyLog.dedup_key == key, NotifyLog.ok.is_(True),
                    NotifyLog.kind == "new", NotifyLog.sent_at > now - dt.timedelta(minutes=ch.suppress_minutes)).limit(1))
                if recent:
                    continue  # 중복 알림 억제
                ok, err = deliver(ch, ev, cams.get(ev.camera_id), "new")
                _log(db, ch, ev, key, "new", ok, err)
                sent, failed = sent + ok, failed + (not ok)
        if new_events:
            cur_row.value = new_events[-1].id
        # 해소 알림: 'new' 를 보낸 이벤트가 끝났으면 1회
        since = now - dt.timedelta(hours=24)
        for ch in chans:
            rows = db.execute(select(NotifyLog.event_id).where(
                NotifyLog.channel_id == ch.id, NotifyLog.kind == "new", NotifyLog.ok.is_(True),
                NotifyLog.sent_at > since, NotifyLog.event_id.is_not(None)).distinct()).scalars().all()
            for eid in rows:
                ev = db.get(Event, eid)
                if not ev or not ev.ended_at or ev.ended_at > now or ev.ended_at == ev.started_at:
                    continue
                done = db.scalar(select(NotifyLog.id).where(NotifyLog.channel_id == ch.id, NotifyLog.event_id == eid,
                                                            NotifyLog.kind == "resolved").limit(1))
                if done:
                    continue
                ok, err = deliver(ch, ev, cams.get(ev.camera_id), "resolved")
                _log(db, ch, ev, ev.dedup_key, "resolved", ok, err)
                sent, failed = sent + ok, failed + (not ok)
            # 반복 알림: 끝나지 않고 확인되지 않은 이벤트
            if ch.repeat_minutes > 0:
                opens = db.scalars(select(Event).where(Event.ended_at.is_(None), Event.acknowledged_at.is_(None),
                                                       Event.started_at > now - dt.timedelta(days=7))).all()
                for ev in opens:
                    if not _matches(ch, ev):
                        continue
                    last = db.scalar(select(func.max(NotifyLog.sent_at)).where(
                        NotifyLog.channel_id == ch.id, NotifyLog.event_id == ev.id, NotifyLog.ok.is_(True)))
                    if not last or now - last < dt.timedelta(minutes=ch.repeat_minutes):
                        continue
                    ok, err = deliver(ch, ev, cams.get(ev.camera_id), "repeat")
                    _log(db, ch, ev, ev.dedup_key, "repeat", ok, err)
                    sent, failed = sent + ok, failed + (not ok)
    if sent or failed:
        log.info("알림 전송 %d, 실패 %d", sent, failed)
    return {"sent": sent, "failed": failed}
