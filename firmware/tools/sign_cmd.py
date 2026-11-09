#!/usr/bin/env python3
"""Build a signed command for bench tests (protocol.md section 4).

  python3 tools/sign_cmd.py --secret <64hex> power_cycle '{"ch":5,"off_sec":10}' \
      | mosquitto_pub ... -t eum/v1/SB-xxxxxxxxxxxx/cmd -q 1 -s

HMAC key = the 32 raw bytes of cmd_secret (use --hex-key to sign with the ASCII
hex text instead; the firmware accepts both, see src/core/command_core.h).
"""
import argparse
import hashlib
import hmac
import json
import os
import time


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--secret", required=True)
    ap.add_argument("--hex-key", action="store_true")
    ap.add_argument("--ttl", type=int, default=60)
    ap.add_argument("type")
    ap.add_argument("params", nargs="?", default="{}")
    a = ap.parse_args()

    params = json.loads(a.params)
    ts = int(time.time() * 1000)
    exp = ts + a.ttl * 1000
    cmd_id = "c-" + os.urandom(10).hex()
    params_json = json.dumps(params, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    canonical = f"{cmd_id}\n{ts}\n{exp}\n{a.type}\n{params_json}"
    key = a.secret.encode() if a.hex_key else bytes.fromhex(a.secret)
    sig = hmac.new(key, canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    print(json.dumps({"cmd_id": cmd_id, "ts": ts, "exp": exp, "type": a.type,
                      "params": params, "sig": sig}, ensure_ascii=False))


if __name__ == "__main__":
    main()
