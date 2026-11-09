# SB-MB01 Rev 0.1 스마트박스 메인보드 펌웨어

ESP32-WROOM-32E 기반 CCTV 스마트박스 메인보드 펌웨어입니다.
장치↔서버 계약은 `../docs/protocol.md`(프로토콜 v1)이며, 이 펌웨어는 그 문서를 기준으로 구현했습니다.

- 프레임워크: PlatformIO, `platform = espressif32@6.9.0`, `framework = arduino`(Arduino-ESP32 2.0.17 / ESP-IDF 4.4.7), `board = esp32dev`
- 라이브러리: ArduinoJson 7.2.1 (MQTT는 ESP-IDF 내장 `esp-mqtt` 사용, 아래 "설계 메모" 참고)

## 디렉터리 구조

| 경로 | 내용 |
|---|---|
| `src/main.cpp` | 부팅 순서, 메인 루프(MQTT 재접속·LED·SNTP) |
| `src/board.h` | 핀맵·I2C 주소 등 회로도 고정값 |
| `src/i2c_bus.*` | Wire + 뮤텍스, 버스 복구 |
| `src/io_expander.*` | MCP23017 (릴레이 코일·사이렌·경광등 출력, DI1~8 입력) |
| `src/sensors.*` | INA226 ×2, SHT31, LIS3DH, PCF85063A RTC |
| `src/pzem.*` | PZEM-004T v3 Modbus-RTU(직접 구현), RS-485(MAX3485) 헬퍼 |
| `src/power.*` | 채널 NO/NC 부하 의미, 채널 잠금, 경보 출력 타이머 |
| `src/mqtt_link.*` | MQTT over TLS(mTLS), LWT, QoS1, 오프라인 이벤트 버퍼(64), 재접속 백오프 |
| `src/commands.*` | 명령 수신·검증·중복 처리·단일 실행 큐 |
| `src/local_control.*` | 입력 감시, 충격/기울기, 팬/히터 히스테리시스, 환경 경보, telemetry |
| `src/recovery.*` | 로컬 자동복구(ping → SUNAPI 재시작 → 전원 재투입, 시간당 제한) |
| `src/storage.*` | NVS(설정·부팅 카운터·복구 이력·명령 워터마크), LittleFS `/prov.json` |
| `src/timebase.*` | SNTP / RTC 시각 |
| `src/watchdog.*` | TPS3823 WDI 급전 태스크 + ESP 태스크 워치독 |
| `src/core/*` | 아두이노 비의존 순수 로직(정규화 JSON, HMAC-SHA256, MD5, 명령 검증, ack 캐시, 히스테리시스, 제한기, PZEM/SHT31/RTC 코덱, 다이제스트 인증, 설정 검증) |
| `host_test/` | `src/core` 호스트(PC) 단위 테스트 |
| `tools/make_prov.py` | 서버 프로비저닝 응답 → `data/prov.json` 생성 |
| `tools/sign_cmd.py` | 벤치 테스트용 서명 명령 생성 |

## 빌드

```bash
pip install platformio      # 또는 VS Code PlatformIO 확장
cd firmware
pio run                     # 펌웨어 빌드
./host_test/run.sh          # (선택) 순수 로직 단위 테스트, g++ 필요
```

## 플래시(업로드)

> **주의: JP1(워치독 점퍼)을 반드시 제거한 상태에서 플래시하세요.**
> TPS3823 외부 워치독은 펌웨어가 GPIO5를 토글하지 않으면 약 1.6초 후 EN을 리셋합니다.
> 다운로드 모드(부트로더)에서는 토글이 없으므로 JP1이 꽂혀 있으면 업로드 도중 리셋되어 실패합니다.
> 업로드와 첫 부팅 확인이 끝나면 JP1을 다시 꽂아야 워치독이 동작합니다.

1. 전원 OFF → **JP1 제거** → USB-UART 연결
2. `pio run -t upload` (자동 리셋 회로가 없으면 BOOT(IO0)을 누른 채 EN 리셋)
   - GPIO0은 이더넷 50 MHz 클럭 입력이지만, 발진기 EN(GPIO16)이 10k 풀다운이라 부팅 시 발진기는 꺼져 있어 스트래핑에 영향이 없습니다.
3. `pio device monitor` (115200 bps)로 부팅 로그 확인
4. 전원 OFF → **JP1 다시 장착**

## 프로비저닝 파일 업로드 (LittleFS)

서버 `POST /smartboxes` 응답의 `provisioning`(1회만 표시)을 그대로 사용합니다.

```bash
python3 tools/make_prov.py response.json            # data/prov.json 생성 (권한 600)
pio run -t uploadfs                                  # data/ 폴더를 LittleFS로 업로드 (JP1 제거 상태)
```

`data/prov.json` 형식은 `provisioning/prov.example.json` 참고:
`device_id, cmd_secret, mqtt_host, mqtt_port, ca_cert_pem, client_cert_pem, client_key_pem` (+선택 `ntp_servers`).
`data/prov.json`은 비밀키가 들어 있으므로 `.gitignore`에 포함되어 있습니다. 절대 커밋하지 마세요.

프로비저닝 파일이 없거나 잘못되면 장치는 **로컬 전용 모드**로 동작합니다(MQTT 미접속, 온도제어·경보·입력감시·자동복구는 계속 동작, 이벤트는 RAM에 최대 64건 보관).

## 동작 요약

### 부팅 순서
1. I2C 시작 직후 MCP23017 OLATA=0 → IODIRA=출력 (모든 코일 OFF = NC 부하 전원 공급, 사이렌/경광등 OFF). 시간 걸리는 작업보다 먼저 수행
2. TPS3823 급전 태스크 시작(최고 우선순위, 100 ms 토글). 부팅 완료 전에는 최대 60초 무조건 토글, 이후에는 모든 헬스 채널(main, io, control, cmd_rx, cmd_exec, recovery)이 정상일 때만 토글 → 앱이 멈추면 하드웨어 리셋
3. ESP 태스크 워치독(15초, panic) 적용
4. NVS 설정 로드, RTC로 시스템 시각 설정, 센서/UART 초기화, `boot` 이벤트
5. 이더넷(GPIO16 HIGH로 발진기 enable 후 `ETH.begin`), MQTT, 작업 태스크 시작

### 서버 통신 (protocol.md 2~4)
- 토픽 `eum/v1/{device_id}/{status|hello|telemetry|event|ack|cmd}`, status는 retain + LWT `{"online":false}`
- 접속 시: `cmd` 구독 → `status` online(retain) → `hello` → 미전달 ack 재전송 → 버퍼 이벤트 순서대로 전송
- 이벤트는 QoS1 PUBACK을 받아야 버퍼에서 삭제(중복 가능, 서버가 `id`로 중복 제거), telemetry는 버퍼링하지 않음
- 재접속: 1초부터 2배씩 최대 60초(±20% 지터)
- 명령: 서명 검증(HMAC-SHA256, 정렬 키·공백 없는 params) → 만료 검사 → 타입·파라미터 검사 → `received` → 단일 실행 큐 → `done`/`failed`
- 같은 `cmd_id` 재수신 시 재실행하지 않고 마지막 ack 재전송(최근 32개). 서명 실패 명령은 캐시하지 않음(위조 메시지가 정상 명령을 가로막지 못하게)
- 시계 미동기 시에도 재생 공격 차단: 마지막으로 수락한 명령의 `ts`를 NVS에 저장하고, `exp`가 그보다 이전이면 `expired`
- `power_cycle`은 실행 태스크에서 대기하므로 MQTT(별도 태스크)를 막지 않음
- `config_set`은 부분 설정 병합 + 검증 후 NVS 저장, 결과 `{"config_version":n}`

### 전원 유지 원칙 (protocol.md 5)
- 컨트롤러 재부팅/멈춤/통신 두절 시 부하 상태를 바꾸지 않음(코일 OFF가 기본, `reboot_device`도 부하 무관)
- 부팅 시 모든 코일 OFF로 시작(`power_off` 상태는 재부팅 후 유지되지 않음)
- `poe_switch`/`optic_converter` 채널은 로컬 자동복구로 전원 재투입하지 않음(`local_recovery.allow_shared:true` 또는 대상별 `allow_shared:true`일 때만)
- 자동 전원 재투입은 시간당 `max_per_hour`(기본 3)회, 1시간 슬라이딩 윈도를 NVS에 기록. 시계가 없으면 보수적으로 "방금 발생"으로 간주

### 통신 두절 시 독립 동작
- 팬/히터: SHT31 기준 히스테리시스(`fan.on_c/off_c`, `heater.on_c/off_c/rh_on/rh_off`). 팬 동작 중 히터 금지. SHT31 없음 → 팬 ON, 히터 OFF + `sensor_fault`
- 서버가 팬/히터 채널을 직접 제어하면 `manual_override_s`(기본 1800초) 동안 자동제어 중지, `power_off` 상태면 계속 손대지 않음
- 입력 DI1~8(디바운스 60 ms, NO/NC 극성), 충격(LIS3DH INT1, 임계값 `accel.shock_g`), 기울기(`accel.tilt_deg`), 환경 경보(`env_alarm`)
- 자동복구: `interval_s`마다 ping, `fail_threshold`회 연속 실패 시 SUNAPI 재시작(HTTP digest) → `boot_wait_s` 대기(감시 중지) → 여전히 실패하면 채널 전원 재투입(`off_sec`) → `boot_wait_s` 대기 → 실패 시 `gave_up`(1시간 후 재시도). 이더넷 링크가 없거나 서버가 끈 채널은 실패로 세지 않음

### 프로토콜 v1에 없는 확장 설정(선택, `config_set`에서 사용 가능)
`manual_override_s`, `local_recovery.allow_shared`, `targets[].allow_shared`,
`accel {shock_g, tilt_deg}`, `env_alarm {t_high, t_low, rh_high}`,
`local_alarm {on_door, on_tamper, on_shock, siren, strobe, duration_s}`(기본 모두 비활성).
서버 문서(protocol.md)에 반영이 필요합니다.

### LED (GPIO2)
빠른 깜빡임 = 이더넷 IP 없음, 느린 깜빡임 = 이더넷 OK·MQTT 미접속, 2초마다 짧게 점등 = 온라인

## 설계 메모

- **PubSubClient 대신 esp-mqtt 사용**: 프로토콜은 status/hello/event/ack를 QoS1로 요구하지만 PubSubClient는 QoS0 발행만 지원합니다. esp-mqtt(ESP-IDF 내장)는 QoS1+PUBACK 통지, LWT, mTLS, 독립 태스크를 제공하며 이더넷에서도 그대로 동작합니다. 자동 재접속은 끄고 이 펌웨어가 백오프를 직접 제어합니다.
- **HMAC 키 형식**: protocol.md는 `cmd_secret`을 "32바이트(hex 64자)"라고만 적고 있어, 키를 hex 디코딩한 32바이트로 보는지 hex 문자열 자체로 보는지 모호합니다. 펌웨어는 32바이트 원시 키를 우선 검증하고, 실패하면 hex 문자열 키(Node `createHmac('sha256', hexString)`)도 허용합니다. 둘 다 같은 비밀에서 나오므로 보안이 약해지지는 않지만, 서버 구현 확정 후 protocol.md에 명시하고 한쪽만 남기는 것이 좋습니다(`src/core/command_core.h` TODO).
- **params_json 문자열 이스케이프**: 서명 문자열의 params는 수신한 문자열 토큰 그대로(키만 정렬) 먼저 검증하고, 실패 시 `JSON.stringify` 방식으로 재이스케이프한 형태로 한 번 더 검증합니다(숫자는 항상 원문 유지). 이 역시 protocol.md에 명시 필요.
- **`pass_enc`**: 현재 평문으로 취급합니다. 장치 키로 암호화/복호화하도록 바꿔야 합니다(`TODO(security)`).
- **boot_reason**: TPS3823 리셋은 EN 핀 리셋이라 ESP32가 `power_on`으로 보고합니다. 워치독 리셋과 실제 전원 투입을 구분할 수 없습니다.
- Arduino-ESP32 3.x(IDF 5)용 분기(`ETH.begin` 인자 순서, esp-mqtt 설정 구조체, TWDT 설정)를 넣어 두었지만 **3.x로는 컴파일해 보지 않았습니다.** 기본은 2.0.17입니다.

## 검증 현황

### 이 저장소에서 실제로 검증한 것
- **펌웨어 전체 컴파일·링크 성공**: Arduino-ESP32 2.0.17 / xtensa-esp32-elf GCC 8.4.0 (esp-2021r2-patch5), `-Wall -Wextra`에서 우리 소스 경고 0건, `firmware.bin` 생성(플래시 약 88%, RAM 약 15%).
  - 작업 환경에서 PlatformIO 레지스트리 접속이 차단되어 있어, 동일 버전의 플랫폼·툴체인·프레임워크·ArduinoJson을 GitHub 릴리스에서 받아 로컬 패키지로 설치한 뒤 `pio run`을 실행했습니다. 일반 PC에서는 `pio run`만으로 레지스트리에서 같은 버전을 받습니다.
- **호스트 단위 테스트** (`host_test/run.sh`, g++13 + AddressSanitizer/UBSan): 197개 검사 통과
  - SHA-256/HMAC(RFC 4231), MD5, HTTP digest(RFC 2617 MD5, RFC 7616 SHA-256 예제)
  - 정규화 JSON(키 정렬·중첩·유니코드·이스케이프·중복 키/잘못된 JSON 거부), 명령 서명 검증(Python으로 만든 벡터, 변조·cmd_id 바꿔치기 거부), 만료/워터마크
  - ack 캐시 32개(갱신·축출·미전달 재전송), 이벤트 큐 64개(초과 시 오래된 것 삭제, PUBACK·재전송)
  - 팬/히터 히스테리시스·인터록·센서 없음 안전상태, 환경 경보, 시간당 제한기(재부팅·시계 없음 포함), 입력 극성·디바운스
  - PZEM 요청 프레임(`01 04 00 00 00 0A 70 0D`)·응답 파싱·CRC, SHT31 CRC(데이터시트 예제), INA226 환산, RTC BCD/epoch 변환, 설정 병합·검증·NVS 직렬화 왕복
- **교차 검증**: `tools/sign_cmd.py`(Python hmac)로 서명한 5종 명령(한글·특수문자 포함 config_set 포함)을 C++ 코드가 검증 통과, 서명 변조 시 거부

### 실제 보드에서 확인해야 할 것
- LAN8720A 링크/IP 획득(GPIO16 발진기 enable 타이밍, PHY 리셋이 EN에 묶여 클럭보다 먼저 풀리는 점)
- MQTT TLS(mTLS) 실제 브로커 접속, LWT, QoS1 PUBACK, 재접속 백오프, 대용량 `config_set` 수신
- TPS3823: 정상 시 리셋 없음, 태스크 정지 시 리셋 발생(예: 디버그 빌드로 루프 정지), JP1 제거 상태 플래시
- MCP23017 출력/입력 극성, 릴레이 실제 동작(NC/NO), 부팅 시 코일 OFF 유지 확인(전원 투입 중 릴레이 튐 여부)
- INA226 전류 부호/스케일(10 mΩ), 배터리 전압, SHT31 탈착 시 동작, LIS3DH 충격 임계값·기울기 기준값, RTC 백업 유지
- PZEM-004T 실제 응답(주소 0xF8 범용 주소 사용), 미연결 시 `ac:null` + `sensor_fault` 1회
- 한화 카메라 SUNAPI 재시작(다이제스트 인증 realm/qop), ping 실패 → 전원 재투입 → 시간당 제한·`gave_up` 흐름
- `pio run -t uploadfs`(mklittlefs 도구는 작업 환경 제약으로 실행해 보지 못함)
- 장시간 안정성(힙 단편화, 스택 여유) — `uxTaskGetStackHighWaterMark` 로그로 확인 권장
