#!/usr/bin/env bash
# Host-side unit tests for src/core (pure logic). Needs g++ and ArduinoJson.
# ArduinoJson: uses $ARDUINOJSON_DIR, else the PlatformIO libdeps copy, else clones v7.2.1.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FW="$(cd "$HERE/.." && pwd)"
OUT="${TMPDIR:-/tmp}/sb-mb01-host-test"
mkdir -p "$OUT"

AJ="${ARDUINOJSON_DIR:-}"
if [ -z "$AJ" ]; then
  for d in "$FW"/.pio/libdeps/*/ArduinoJson; do
    [ -f "$d/src/ArduinoJson.h" ] && AJ="$d" && break
  done
fi
if [ -z "$AJ" ]; then
  AJ="$OUT/ArduinoJson"
  [ -d "$AJ" ] || git clone -q --depth 1 --branch v7.2.1 https://github.com/bblanchon/ArduinoJson.git "$AJ"
fi

g++ -std=c++17 -O1 -g -Wall -Wextra -Werror -Wno-maybe-uninitialized -fsanitize=address,undefined \
  -I"$FW/src/core" -isystem "$AJ/src" \
  "$FW"/src/core/*.cpp "$HERE/test_core.cpp" -o "$OUT/test_core"
"$OUT/test_core"

# Cross-implementation check: commands signed by tools/sign_cmd.py (Python hmac,
# json.dumps(sort_keys)) must verify in the C++ code; tampered ones must not.
SECRET=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
fails=0
while IFS= read -r spec; do
  type="${spec%% *}"; params="${spec#* }"
  for mode in "" "--hex-key"; do
    out=$(python3 "$FW/tools/sign_cmd.py" --secret $SECRET $mode "$type" "$params" | "$OUT/test_core" --verify $SECRET) || true
    case "$out" in OK*) ;; *) echo "cross-check FAILED: $type $params $mode -> $out"; fails=$((fails+1));; esac
  done
  # tamper: change the signature's first hex digit
  out=$(python3 "$FW/tools/sign_cmd.py" --secret $SECRET "$type" "$params" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin);d["sig"]=("0" if d["sig"][0]!="0" else "1")+d["sig"][1:];print(json.dumps(d))' \
        | "$OUT/test_core" --verify $SECRET) || true
  case "$out" in BAD*) ;; *) echo "tamper check FAILED: $type -> $out"; fails=$((fails+1));; esac
done <<'SPECS'
power_cycle {"off_sec":10,"ch":1}
power_off {"ch":6}
alarm_out {"output":"siren","on":true,"duration_s":30}
telemetry_now {}
config_set {"config_version":7,"fan":{"on_c":40.5,"off_c":35},"inputs_polarity":{"door":"NC"},"local_recovery":{"enabled":true,"targets":[{"ip":"10.1.2.31","kind":"hanwha_sunapi","ch":null,"user":"admin","pass_enc":"비밀\"번호/é"}]}}
SPECS
echo "cross-check failures: $fails"
[ "$fails" -eq 0 ]
