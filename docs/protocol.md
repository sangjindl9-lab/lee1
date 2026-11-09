# EUM 스마트박스 장치 통신 프로토콜 v1

대상 장치: SB-MB01 Rev 0.1 (ESP32-WROOM-32E, 릴레이 6CH, 접점입력 8CH, 경보출력 2CH)
전송: MQTT 3.1.1 over TLS 1.2 (포트 8883), 장치별 클라이언트 인증서(mTLS)

## 1. 식별자와 인증

- `device_id`: 서버가 발급하는 장치 ID. 형식 `SB-` + 12자리 소문자 hex (예: `SB-a1b2c3d4e5f6`).
- MQTT `client_id` = `device_id`.
- 장치 클라이언트 인증서의 CN = `device_id`. 브로커는 CN을 사용자명으로 사용하고, 장치는 자기 토픽만 쓰고 읽을 수 있다(ACL).
- `cmd_secret`: 장치별 32바이트 비밀값(hex 64자). 서버 명령의 HMAC 서명 검증에 사용한다. 프로비저닝 시 1회만 표시·전달된다.

## 2. 토픽

접두어 `P = eum/v1/{device_id}`

| 방향 | 토픽 | QoS | retain | 내용 |
|---|---|---|---|---|
| 장치→서버 | `P/status` | 1 | yes | 온라인 상태. LWT로 `{"online":false}` 등록 |
| 장치→서버 | `P/hello` | 1 | no | 접속 직후 장치 정보 |
| 장치→서버 | `P/telemetry` | 0 | no | 주기 계측값 (기본 10초) |
| 장치→서버 | `P/event` | 1 | no | 상태 변화·장애 이벤트 |
| 장치→서버 | `P/ack` | 1 | no | 명령 수신·결과 |
| 서버→장치 | `P/cmd` | 1 | no | 제어 명령 |

장치는 `P/cmd`만 구독한다. 모든 페이로드는 UTF-8 JSON이다. 시각 `ts`는 UTC epoch 밀리초(정수). 장치 시계가 동기화되지 않았으면 `ts`에 `0`을 넣고 `uptime_ms`를 함께 보낸다.

## 3. 장치 → 서버

### 3.1 status (retain)
```json
{"online": true, "ts": 1762700000000}
```
LWT: `{"online": false}` (retain, QoS1). 정상 종료 시에도 `{"online":false,"ts":...}`를 보낸다.

### 3.2 hello
```json
{
  "ts": 1762700000000, "uptime_ms": 5321,
  "hw": "SB-MB01", "hw_rev": "0.1", "fw": "1.0.0",
  "mac": "24:0a:c4:00:00:01", "ip": "10.1.2.30",
  "boot_reason": "power_on|watchdog|sw_reset|brownout|ota|other",
  "config_version": 3,
  "channels": [{"ch":1,"contact":"NC","role":"poe_switch"}, ...]
}
```

### 3.3 telemetry
```json
{
  "ts": 1762700000000, "uptime_ms": 123456, "seq": 812,
  "ac":  {"v": 221.4, "a": 0.82, "w": 160.2, "kwh": 1234.5, "hz": 60.0, "pf": 0.88},
  "dc":  {"in_v": 13.62, "in_a": 1.21, "batt_v": 13.35},
  "env": {"t": 31.2, "rh": 64.1},
  "relays": [false,false,true,false,false,false],
  "loads":  [true,true,true,false,false,false],
  "alarm_out": {"siren": false, "strobe": false},
  "inputs": {"door": false, "tamper": false, "ups_ac_fail": false, "ups_batt_low": false,
             "elb_trip": false, "spd_fault": false, "di7": false, "di8": false},
  "accel": {"shock": false, "tilt_deg": 0.4},
  "net": {"eth_link": true, "mqtt_reconnects": 2, "offline_buffered": 0},
  "auto": {"fan": true, "heater": true}
}
```
- `relays[i]`: CH(i+1) 코일 통전 여부(true=코일 ON).
- `loads[i]`: CH(i+1)에 물린 부하에 전원이 공급되는지(NC 채널은 코일 OFF일 때 true).
- 측정 불가 센서는 해당 객체를 `null`로 보낸다(예: PZEM 미연결 시 `"ac": null`). 0으로 채우지 않는다.
- `inputs` 값은 true = 이상/동작 상태(문 열림, 정전, 트립 등). 장치 설정의 접점 극성(NO/NC)을 반영한 논리값이다.

### 3.4 event
```json
{"id": "e-00000331", "ts": 1762700000000, "type": "input_change", "severity": "warning",
 "data": {"input": "door", "value": true}}
```
`id`는 장치가 만드는 고유값(부팅 카운터+일련번호). 서버는 `id` 중복을 무시한다.

| type | data | 기본 severity |
|---|---|---|
| `input_change` | `{input, value}` | 입력별(아래) |
| `shock` | `{peak_g}` | warning |
| `tilt` | `{tilt_deg}` | warning |
| `env_alarm` | `{kind: "overtemp"|"undertemp"|"humidity", value, threshold}` | warning |
| `local_action` | `{action, ch?, reason}` 장치가 독립 판단으로 수행한 조치(팬/히터/자동복구 등) | info |
| `recovery` | `{target_ip, ch?, step: "soft_restart"|"power_cycle"|"gave_up", result, attempts_in_hour}` | warning |
| `boot` | `{boot_reason, fw}` | info |
| `sensor_fault` | `{sensor: "sht31"|"ina226_in"|"ina226_batt"|"lis3dh"|"pzem"|"rtc"|"mcp23017"}` | warning |

입력별 기본 severity: `ups_ac_fail` critical, `elb_trip` critical, `door` warning, `tamper` warning, `ups_batt_low` major, `spd_fault` major, `di7`/`di8` info. 값이 정상으로 돌아오면 같은 type으로 `value:false`를 보내며 severity는 `info`.

오프라인 중 발생한 event는 장치 RAM(최대 64건)에 보관했다가 재접속 후 순서대로 전송한다. telemetry는 버퍼링하지 않는다.

### 3.5 ack
```json
{"cmd_id": "c-01HZX...", "stage": "received", "ts": 1762700000000}
{"cmd_id": "c-01HZX...", "stage": "done", "ts": 1762700012000, "result": {"ch": 1, "load": true}}
{"cmd_id": "c-01HZX...", "stage": "rejected", "ts": ..., "error": "bad_signature|expired|unknown_type|invalid_params|locked|busy"}
{"cmd_id": "c-01HZX...", "stage": "failed", "ts": ..., "error": "relay_feedback|timeout|hw_error", "result": {...}}
```
- `received`: 서명·만료 검증을 통과해 실행 큐에 넣었을 때.
- `done`/`failed`: 실행 완료. `power_cycle`은 전원이 다시 들어간 뒤 `done`.
- 같은 `cmd_id`가 다시 오면 다시 실행하지 않고 마지막 ack를 재전송한다(최근 32개 기억).

## 4. 서버 → 장치: cmd

```json
{
  "cmd_id": "c-018f2a5e7d3b4c1a9e0f",
  "ts": 1762700000000,
  "exp": 1762700060000,
  "type": "power_cycle",
  "params": {"ch": 1, "off_sec": 10},
  "sig": "hex(hmac_sha256(cmd_secret, canonical))"
}
```
`canonical` = `cmd_id + "\n" + ts + "\n" + exp + "\n" + type + "\n" + params_json`
- `params_json`은 키를 사전순 정렬하고 공백 없이 직렬화한 JSON(`{"ch":1,"off_sec":10}`). 문자열은 UTF-8 그대로(한글을 `\uXXXX`로 바꾸지 않음), 정수는 소수점 없이 쓴다.
- HMAC 키는 `cmd_secret` hex 문자열을 디코딩한 **32바이트 원시값**이다(hex 문자열 자체를 키로 쓰지 않는다). 서명은 소문자 hex 64자.
- 장치는 서명 불일치·`exp` 경과(시계 동기 시)·알 수 없는 type을 `rejected`로 응답한다.

| type | params | 동작 |
|---|---|---|
| `power_off` | `{ch}` | 부하 전원 차단 (NC 채널: 코일 ON) |
| `power_on` | `{ch}` | 부하 전원 공급 |
| `power_cycle` | `{ch, off_sec}` (1~120) | 차단 → off_sec 대기 → 공급 |
| `alarm_out` | `{output: "siren"|"strobe", on, duration_s}` | 경보 출력. on=true이고 duration_s>0이면 시간 후 자동 OFF |
| `telemetry_now` | `{}` | 즉시 telemetry 1회 송신 |
| `config_set` | 아래 | 설정 저장(NVS) 후 `done` |
| `reboot_device` | `{}` | 스마트박스 컨트롤러 재시작(부하 전원에는 영향 없음) |

`config_set` params:
```json
{
  "config_version": 4,
  "telemetry_interval_s": 10,
  "fan": {"on_c": 40, "off_c": 35},
  "heater": {"on_c": 0, "off_c": 5, "rh_on": 85, "rh_off": 75},
  "channels": [{"ch":1,"contact":"NC","role":"poe_switch"}, ...],
  "inputs_polarity": {"door":"NO", ...},
  "local_recovery": {
    "enabled": true,
    "interval_s": 30, "fail_threshold": 5, "off_sec": 10, "boot_wait_s": 180, "max_per_hour": 3,
    "targets": [{"ip":"10.1.2.31","kind":"hanwha_sunapi","ch":null,"user":"...","pass_enc":"..."}]
  }
}
```

`config_set`에 펌웨어가 추가로 이해하는 선택 항목: `accel`(충격 임계값), `env_alarm`(환경 경보 기준), `local_alarm`(문 열림 시 현장 경보 여부), `manual_override_s`(원격으로 팬·히터를 조작했을 때 자동제어를 멈추는 시간), `local_recovery.targets[].allow_shared`(공유 장비 자동 재투입 허용, 기본 false). 세부 형식은 firmware/README.md.

## 5. 전원 유지 원칙 (장치·서버 공통)

1. 컨트롤러 재부팅·펌웨어 멈춤·통신 두절이 부하 전원 상태를 바꾸지 않는다. NC 채널은 코일 OFF가 기본이라 전원이 유지된다.
2. `power_off`로 끈 채널은 장치 재부팅 후에도 꺼진 상태를 유지하지 않는다. 장치는 부팅 시 모든 코일을 OFF(=NC 부하 ON)로 시작한다. 장기 차단이 필요한 경우는 현장 차단기로 한다.
3. 장치의 독립 자동복구는 `role`이 `poe_switch`/`optic_converter`인 공유 장비 채널에 대해 기본 비활성이다. 서버 정책이 명시적으로 허용한 경우에만 수행한다.
4. 시간당 자동 전원 재투입 횟수 제한(기본 3회)은 장치가 NVS에 기록해 재부팅 후에도 유지한다.

## 6. 타이밍 (서버)

- `received` 대기 10초 → 같은 `cmd_id`로 최대 3회 재전송 → 실패 시 명령 상태 `timeout`.
- `done` 대기: `power_cycle`은 `off_sec + 30초`, 그 외 30초.
- 장치 오프라인 판정: `status.online=false` 수신 또는 telemetry 3주기 + 10초 동안 미수신.
