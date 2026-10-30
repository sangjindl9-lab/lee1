"""운영 명령.

  python -m nvr.cli create-admin --username admin [--password-file FILE]
      초기 최고관리자 생성. 비밀번호는 대화식 입력 또는 파일로 받으며 명령줄 인자로 받지 않는다.
      생성된 계정은 첫 로그인 시 비밀번호 변경이 강제된다.
  python -m nvr.cli reset-password --username admin
  python -m nvr.cli gen-master-key      (base64 32바이트 키 출력)
"""
from __future__ import annotations

import argparse
import base64
import getpass
import os
import sys

from sqlalchemy import select


def _read_password(path: str | None) -> str:
    if path:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    pw = getpass.getpass("새 비밀번호: ")
    if pw != getpass.getpass("비밀번호 확인: "):
        print("비밀번호가 일치하지 않습니다.", file=sys.stderr)
        sys.exit(2)
    return pw


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="nvr.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-admin")
    c.add_argument("--username", default="admin")
    c.add_argument("--display-name", default="최고관리자")
    c.add_argument("--password-file")
    r = sub.add_parser("reset-password")
    r.add_argument("--username", required=True)
    r.add_argument("--password-file")
    sub.add_parser("gen-master-key")
    args = ap.parse_args(argv)

    if args.cmd == "gen-master-key":
        print(base64.b64encode(os.urandom(32)).decode())
        return 0

    from .db import session_scope
    from .models import AuthSession, User, utcnow
    from .security.passwords import hash_password, validate_password_policy

    username = args.username.strip().lower()
    pw = _read_password(args.password_file)
    reason = validate_password_policy(pw, username)
    if reason:
        print(reason, file=sys.stderr)
        return 2
    with session_scope() as db:
        u = db.scalar(select(User).where(User.username == username))
        if args.cmd == "create-admin":
            if u:
                print(f"이미 존재하는 사용자입니다: {username}", file=sys.stderr)
                return 1
            db.add(User(username=username, display_name=args.display_name, role="superadmin",
                        password_hash=hash_password(pw), must_change_password=True))
            print(f"최고관리자 '{username}' 생성 완료. 첫 로그인 후 비밀번호를 변경해야 합니다.")
        else:
            if not u:
                print(f"사용자가 없습니다: {username}", file=sys.stderr)
                return 1
            u.password_hash = hash_password(pw)
            u.must_change_password = True
            u.is_active = True
            for s in db.scalars(select(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None))):
                s.revoked_at = utcnow()
            print(f"'{username}' 비밀번호를 재설정했습니다(모든 세션 종료).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
