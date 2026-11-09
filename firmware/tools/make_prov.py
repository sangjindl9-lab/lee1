#!/usr/bin/env python3
"""Create data/prov.json from the server's POST /smartboxes response.

Usage:
  python3 tools/make_prov.py response.json [--ntp pool.ntp.org ...]

The response JSON contains {"provisioning": {device_id, cmd_secret, client_cert_pem,
client_key_pem, ca_cert_pem, mqtt_host, mqtt_port}} (docs/api.md). The bundle is
shown only once by the server, so keep the file safe and never commit it.
"""
import argparse
import json
import os
import re
import sys

REQUIRED = ["device_id", "cmd_secret", "mqtt_host", "mqtt_port",
            "ca_cert_pem", "client_cert_pem", "client_key_pem"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("response")
    ap.add_argument("--ntp", nargs="*", default=[])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "prov.json"))
    a = ap.parse_args()

    with open(a.response, encoding="utf-8") as f:
        doc = json.load(f)
    prov = doc.get("provisioning", doc)
    missing = [k for k in REQUIRED if k not in prov]
    if missing:
        print("missing fields: " + ", ".join(missing), file=sys.stderr)
        return 1
    if not re.fullmatch(r"SB-[0-9a-f]{12}", prov["device_id"]):
        print("device_id format invalid", file=sys.stderr)
        return 1
    if not re.fullmatch(r"[0-9a-fA-F]{64}", prov["cmd_secret"]):
        print("cmd_secret must be 64 hex chars", file=sys.stderr)
        return 1
    out = {k: prov[k] for k in REQUIRED}
    if a.ntp:
        out["ntp_servers"] = a.ntp[:3]
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {a.out} for {out['device_id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
