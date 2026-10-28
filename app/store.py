"""이력 DB(SQLite)와 사용자 계정.

현장 서버 한 대에 설치하는 폐쇄망 운영을 기준으로 SQLite를 쓴다.
관제점이 많아지거나 여러 현장을 묶을 때는 PostgreSQL(TimescaleDB)로 바꾸면 된다.
"""
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from collections import deque

ROLES = {"감시": 1, "운영": 2, "관리자": 3}


class Store:
    def __init__(self, base):
        os.makedirs(os.path.join(base, "data"), exist_ok=True)
        self.path = os.path.join(base, "data", "scada.db")
        self.users_path = os.path.join(base, "data", "users.json")
        self.lock = threading.Lock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts REAL, site TEXT, tunnel TEXT, kind TEXT, msg TEXT, user TEXT);
        CREATE TABLE IF NOT EXISTS alarms(id INTEGER PRIMARY KEY, akey TEXT, tunnel TEXT, lvl TEXT, msg TEXT,
            start_site TEXT, end_site TEXT, ack_user TEXT, ack_site TEXT);
        CREATE TABLE IF NOT EXISTS history(ts REAL, site TEXT, tunnel TEXT, kw REAL, co REAL, vi REAL, lum REAL, data TEXT);
        CREATE INDEX IF NOT EXISTS ix_hist ON history(tunnel, ts);
        CREATE INDEX IF NOT EXISTS ix_ev ON events(ts);
        CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
        """)
        self.db.commit()
        self.mem = deque(reversed(self._load_events(200)), maxlen=200)
        self._init_users()

    def _load_events(self, n):
        rows = self.db.execute("SELECT site,tunnel,kind,msg,user FROM events ORDER BY id DESC LIMIT ?", (n,)).fetchall()
        return [{"t": r[0], "tn": r[1], "kind": r[2], "msg": r[3], "user": r[4]} for r in rows]

    # ----- settings -----
    def get(self, k, default=None):
        with self.lock:
            r = self.db.execute("SELECT v FROM settings WHERE k=?", (k,)).fetchone()
        return json.loads(r[0]) if r else default

    def put(self, k, v):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)", (k, json.dumps(v, ensure_ascii=False)))
            self.db.commit()

    # ----- events / alarms -----
    def event(self, site, tunnel, kind, msg, user=""):
        with self.lock:
            self.db.execute("INSERT INTO events(ts,site,tunnel,kind,msg,user) VALUES(?,?,?,?,?,?)",
                            (time.time(), site, tunnel, kind, msg, user))
            self.db.commit()
        self.mem.append({"t": site, "tn": tunnel, "kind": kind, "msg": msg, "user": user})

    def recent_events(self, n=150):
        return list(self.mem)[-n:][::-1]

    def events_day(self, tunnel, day):
        with self.lock:
            rows = self.db.execute("SELECT site,kind,msg,user FROM events WHERE tunnel=? AND site LIKE ? ORDER BY id",
                                   (tunnel, day + "%")).fetchall()
        return [{"t": r[0], "kind": r[1], "msg": r[2], "user": r[3]} for r in rows]

    def alarm_open(self, akey, tunnel, lvl, msg, site):
        with self.lock:
            cur = self.db.execute("INSERT INTO alarms(akey,tunnel,lvl,msg,start_site) VALUES(?,?,?,?,?)", (akey, tunnel, lvl, msg, site))
            self.db.commit()
            return cur.lastrowid

    def alarm_close(self, aid, site):
        with self.lock:
            self.db.execute("UPDATE alarms SET end_site=? WHERE id=?", (site, aid))
            self.db.commit()

    def alarm_ack(self, aid, user, site):
        with self.lock:
            self.db.execute("UPDATE alarms SET ack_user=?, ack_site=? WHERE id=?", (user, site, aid))
            self.db.commit()

    # ----- history -----
    def history_add(self, site, tunnel, kw, co, vi, lum, data):
        with self.lock:
            self.db.execute("INSERT INTO history VALUES(?,?,?,?,?,?,?,?)",
                            (time.time(), site, tunnel, kw, co, vi, lum, json.dumps(data)))
            self.db.commit()

    def trend(self, tunnel, n=180):
        with self.lock:
            rows = self.db.execute("SELECT site,kw,co,vi FROM history WHERE tunnel=? ORDER BY ts DESC LIMIT ?", (tunnel, n)).fetchall()
        return [{"t": r[0], "kw": r[1], "co": r[2], "vi": r[3]} for r in reversed(rows)]

    def prune(self, days=400):
        with self.lock:
            self.db.execute("DELETE FROM history WHERE ts < ?", (time.time() - days * 86400,))
            self.db.commit()

    # ----- users -----
    @staticmethod
    def _hash(pw, salt):
        return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 120000).hex()

    def _init_users(self):
        if os.path.exists(self.users_path):
            return
        users = {}
        for uid, name, role, pw in [("admin", "관리자", "관리자", "admin1234"),
                                    ("operator", "운영자", "운영", "oper1234"),
                                    ("viewer", "감시자", "감시", "view1234")]:
            salt = secrets.token_hex(16)
            users[uid] = {"name": name, "role": role, "salt": salt, "hash": self._hash(pw, salt), "must_change": True}
        with open(self.users_path, "w", encoding="utf-8") as f:
            json.dump(users, f, ensure_ascii=False, indent=1)

    def users(self):
        with open(self.users_path, encoding="utf-8") as f:
            return json.load(f)

    def check_user(self, uid, pw):
        u = self.users().get(uid)
        if u and secrets.compare_digest(u["hash"], self._hash(pw, u["salt"])):
            return {"id": uid, "name": u["name"], "role": u["role"], "must_change": u.get("must_change", False)}
        return None

    def set_password(self, uid, pw):
        us = self.users()
        salt = secrets.token_hex(16)
        us[uid].update({"salt": salt, "hash": self._hash(pw, salt), "must_change": False})
        with open(self.users_path, "w", encoding="utf-8") as f:
            json.dump(us, f, ensure_ascii=False, indent=1)
