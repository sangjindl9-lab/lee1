# EUM SMART VMS PRO — 관제 서버 API v1 (1단계)

기본 경로 `/api`. JSON. 인증은 `Authorization: Bearer <access_token>`.
오류 응답: `{"statusCode": 4xx, "message": "...", "code": "MACHINE_CODE"}`

## 인증

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| POST | /auth/login | `{username, password}` | MFA 필요 시 `{mfa_required:true, mfa_token}` / 아니면 `{access_token, expires_in, user}` |
| POST | /auth/mfa/verify | `{mfa_token, code}` | `{access_token, expires_in, user}` |
| POST | /auth/mfa/setup | – | `{secret, otpauth_url}` (본인) |
| POST | /auth/mfa/enable | `{code}` | `{enabled:true}` |
| POST | /auth/reauth | `{password, code?}` (MFA 사용자는 code 필수) | `{step_up_token, expires_in:300}` |
| POST | /auth/logout | – | `{ok:true}` |
| GET | /me | – | `user` |

`user` = `{id, username, display_name, org_id, org_name, role, permissions: string[], mfa_enabled}`

관리자 역할(central_admin, org_admin, center_admin)은 MFA를 켜지 않으면 로그인 후 `/auth/mfa/setup` 외 API가 `403 MFA_SETUP_REQUIRED`를 반환한다.

권한 문자열: `site.read site.write device.read device.write device.control.power device.control.alarm command.approve alarm.read alarm.ack alarm.manage audit.read user.manage org.manage`

## 기관·사용자

| GET | /organizations | central_admin만 전체, 그 외 자기 기관 |
| POST | /organizations | `{name, code}` (org.manage, central_admin) |
| GET | /users | 자기 기관 사용자 (user.manage) |
| POST | /users | `{username, display_name, password, role}` |
| PATCH | /users/:id | `{display_name?, role?, active?}` |
| GET | /users/assignable | 장애 담당자로 지정 가능한 같은 기관 활성 사용자 (alarm.manage) |
| GET | /roles | `[{code, name, permissions[]}]` |

## 현장·함체·스마트박스

`site` = `{id, org_id, name, code, address, lat, lng, created_at}`
`cabinet` = `{id, site_id, code, name, address, lat, lng, install_date, note}`
`smartbox` = `{id, cabinet_id, device_id, serial_no, model, fw_version, online, last_seen_at, config_version, channels: channel[], inputs: input[], latest: telemetry|null, open_alarm_count}`
`channel` = `{ch, contact:"NC"|"NO", role, name, shared:boolean, load_on:boolean|null, coil_on:boolean|null}`
`input` = `{key, name, polarity, active:boolean|null, severity}`
`telemetry` = 장치 telemetry JSON 그대로 + `{received_at}` (docs/protocol.md 3.3)

| GET | /sites | | `site[]` |
| POST | /sites | `{name, code, address?, lat?, lng?}` | `site` |
| PATCH | /sites/:id | | `site` |
| GET | /cabinets?site_id= | | `cabinet[]` |
| POST | /cabinets | `{site_id, code, name, address?, lat?, lng?}` | `cabinet` |
| PATCH | /cabinets/:id | | `cabinet` |
| GET | /smartboxes | | `smartbox[]` (cabinet, site 이름 포함: `cabinet_code, cabinet_name, site_name`) |
| GET | /smartboxes/:id | | `smartbox` |
| POST | /smartboxes | `{cabinet_id, serial_no?, model?}` | `smartbox` + `{provisioning:{device_id, cmd_secret, client_cert_pem, client_key_pem, ca_cert_pem, mqtt_host, mqtt_port}}` (1회만) |
| PATCH | /smartboxes/:id/channels/:ch | `{name?, role?, contact?}` | `channel` |
| GET | /smartboxes/:id/telemetry?from=&to=&limit= | ISO 시각 | `[{ts, received_at, data}]` 최신순 |
| GET | /smartboxes/:id/events?limit= | | `[{id, device_event_id, ts, type, severity, data}]` |

## 명령

`command` = `{id(cmd_id), smartbox_id, type, params, status, requested_by, requested_by_name, approved_by, approved_by_name, requires_approval, reason, created_at, sent_at, acked_at, finished_at, attempts, error, result}`
`status`: `pending_approval` → `queued` → `sent` → `received` → `done` | `failed` | `rejected` | `timeout` | `cancelled` | `expired`

| POST | /smartboxes/:id/commands | `{type, params, reason}` + 헤더 `X-Step-Up-Token` (전원 명령 필수) | `command` |
| GET | /commands?smartbox_id=&status= | | `command[]` |
| POST | /commands/:id/approve | 헤더 `X-Step-Up-Token` | `command` (요청자와 다른 사용자, command.approve 필요) |
| POST | /commands/:id/reject | `{reason}` | `command` |

규칙
- `power_off`, `power_cycle`, `power_on`: `device.control.power` 권한 + step-up 토큰.
- `shared:true` 채널(역할 `poe_switch`, `optic_converter`)의 `power_off`/`power_cycle`은 이중 승인(`pending_approval`) 대상. 승인 유효시간 10분.
- 일괄(여러 장치 동시) 전원 명령 API는 제공하지 않는다.
- `alarm_out`: `device.control.alarm`. `telemetry_now`: `device.read`.

## 알람

`alarm` = `{id, org_id, smartbox_id, site_name, cabinet_code, type, severity:"critical"|"major"|"warning"|"info", title, detail, state:"open"|"acknowledged"|"assigned"|"resolved"|"closed", source:"device"|"system", first_at, last_at, count, ack_by_name, assignee_name, resolved_at}`

| GET | /alarms?state=&severity=&smartbox_id= | `alarm[]` 최신순. `state=active`는 open·acknowledged·assigned 전체 |
| POST | /alarms/:id/ack | `{note?}` (alarm.ack) |
| POST | /alarms/:id/assign | `{user_id}` (alarm.manage) |
| POST | /alarms/:id/resolve | `{note}` (alarm.manage) |

화면의 등급 표기: critical=긴급, major=심각, warning=주의, info=정보.

## 감사로그

`audit` = `{id, ts, org_id, user_id, username, action, target_type, target_id, detail, ip, prev_hash, hash}`

| GET | /audit-logs?limit=&before_id=&action= | `audit[]` (audit.read) |
| GET | /audit-logs/verify | `{ok, checked, broken_at_id|null}` |

## 실시간 (Socket.IO)

경로 `/socket.io`, 연결 시 `auth: {token: access_token}`. 서버는 사용자 기관 방에 자동 참여시킨다.

| 이벤트 | 페이로드 |
|---|---|
| `telemetry` | `{smartbox_id, data}` |
| `device_status` | `{smartbox_id, online, ts}` |
| `device_event` | `{smartbox_id, event}` |
| `alarm` | `alarm` (생성·변경 시) |
| `command` | `command` (상태 변경 시) |

## 상태

| GET | /health | `{ok, db, mqtt, version}` (인증 불필요) |
