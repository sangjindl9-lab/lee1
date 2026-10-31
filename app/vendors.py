"""제조사 프로필 (기본 제공).

여기 값은 각 제조사에서 흔히 쓰는 기본값이다. 현장 장비의 펌웨어·설정에 따라 다를 수 있으니
반드시 제조사 매뉴얼이나 납품업체 자료로 확인하고, 다르면 화면에서 고쳐 '내 프로필'로 저장해 쓴다.
"""

def _p(key, maker, name, values, note):
    v = {"protocol": "modbus", "transport": "tcp", "port": 502, "word_order": "high", "addr_offset": 0, "timeout": 2, "block": 100}
    v.update(values)
    return {"key": key, "maker": maker, "name": name, "values": v, "note": note}


FIELDBUS = "CC-Link·PROFINET·EtherCAT 같은 필드망은 PLC와 현장 I/O 사이 통신입니다. 이 프로그램은 PLC를 거쳐 그 장치들을 봅니다."

PLC = [
    _p("ls_xgt", "LS ELECTRIC", "XGT·XGB · FEnet XGT 전용 프로토콜", {"protocol": "xgt", "port": 2004, "word_order": "low"},
       "FEnet 모듈(또는 내장 이더넷)을 XGT 전용 서버로 설정합니다. 기본 포트 2004. PLC 주소는 %MX100(비트) %MW100(워드) %DW200(D영역 워드) 표기. XGK는 장치 표기가 다를 수 있으니 XG5000 변수 표기로 확인하세요."),
    _p("ls_mbtcp", "LS ELECTRIC", "XGT·XGB · FEnet Modbus TCP", {"word_order": "low"},
       "XG5000에서 FEnet 드라이버를 Modbus TCP 서버로 지정하고 비트·워드 영역 매핑을 일람표 Modbus 주소와 맞추세요."),
    _p("ls_cnet", "LS ELECTRIC", "XGT·XGB · Cnet Modbus RTU (RS-485 직렬)", {"transport": "rtu_serial", "word_order": "low", "baud": 9600, "parity": "N", "stopbits": 1, "bytesize": 8, "timeout": 3},
       "Cnet 포트를 Modbus RTU 서버(슬레이브)로 설정. 국번 = Unit ID. 서버 PC의 직렬 포트(COM3, /dev/ttyUSB0) 또는 통신변환장치를 씁니다. Cnet XGT 전용 직렬 프로토콜은 아직 지원하지 않습니다."),
    _p("mitsubishi_mc", "미쓰비시", "MELSEC Q·L·iQ-R · MC 프로토콜 / SLMP (3E 바이너리)", {"protocol": "mc", "port": 5007, "word_order": "low", "mc_net": 0, "mc_pc": 255},
       "GX Works에서 이더넷 포트를 'SLMP(MC 프로토콜) 바이너리 · TCP'로 열고 포트 번호를 맞추세요. 쓰기 허용(RUN 중 쓰기) 설정 필요. PLC 주소는 M100 X1F Y20 D100 W1A 표기. " + FIELDBUS),
    _p("mitsubishi_mb", "미쓰비시", "MELSEC · Modbus TCP 모듈", {"word_order": "low"}, "Modbus TCP 지원 모듈(또는 iQ-R 내장 기능)의 디바이스 할당을 일람표 Modbus 주소와 맞추세요."),
    _p("siemens_s7", "지멘스", "S7-1200·1500 · S7 통신 (PUT/GET)", {"protocol": "s7", "port": 102, "s7_rack": 0, "s7_slot": 1},
       "TIA Portal에서 'PUT/GET 통신 허용'을 켜고, 읽을 DB는 '최적화된 블록 액세스'를 끄세요. S7-1200·1500은 랙 0·슬롯 1, S7-300은 랙 0·슬롯 2. PLC 주소는 DB10.DBX0.3 DB10.DBW2 DB10.DBD4 I0.0 Q0.1 M10.0 표기."),
    _p("siemens_ua", "지멘스", "S7-1500 (S7-1200 펌웨어 4.4+) · OPC UA", {"protocol": "opcua", "port": 4840, "ua_ns": 3, "ua_security": "none", "timeout": 3},
       "CPU의 OPC UA 서버를 켜고 변수를 'OPC UA에서 접근 가능'으로 둡니다. NodeId 예: ns=3;s=\"DB_Tunnel\".\"JF01_FWD\". 보안 없음으로 시작하고, 보안을 켜면 프로그램 인증서를 CPU에서 신뢰 처리해야 합니다. CPU·펌웨어·라이선스 조건을 확인하세요."),
    _p("siemens_mb", "지멘스", "S7-1200·1500 · Modbus TCP (MB_SERVER)", {}, "MB_SERVER 블록의 홀딩 레지스터 DB와 프로세스 이미지 매핑을 일람표 Modbus 주소와 맞추세요. " + FIELDBUS),
    _p("omron_fins_tcp", "오므론", "NJ·NX·CJ·CP · FINS/TCP", {"protocol": "fins", "port": 9600, "word_order": "low", "fins_mode": "tcp"},
       "FINS/TCP 서버를 켜세요. NJ·NX는 FINS로 읽을 변수를 CIO·D 영역 메모리에 할당(AT 지정)해야 합니다. NX 일부 모델은 FINS를 지원하지 않으니 모델별로 확인하세요. PLC 주소는 D100 W100.05 H10.01 CIO0.00 표기."),
    _p("omron_fins_udp", "오므론", "NJ·NX·CJ·CP · FINS/UDP", {"protocol": "fins", "port": 9600, "word_order": "low", "fins_mode": "udp", "fins_pc_node": 0, "fins_plc_node": 0},
       "PLC 노드 번호(비우면 IP 끝자리)와 이 PC의 노드 번호(보통 PC IP 끝자리)를 넣으세요. PLC의 IP-노드 변환 설정과 맞아야 합니다."),
    _p("omron_ua", "오므론", "NJ·NX · OPC UA", {"protocol": "opcua", "port": 4840, "ua_ns": 4, "ua_security": "none", "timeout": 3},
       "OPC UA 서버를 지원하는 CPU에서 변수를 공개(Network Publish)하세요. 네임스페이스 번호는 UaExpert 같은 도구로 확인하세요. EtherNet/IP 태그 통신은 이 프로그램에서 오므론용으로 지원하지 않으니 FINS나 OPC UA를 쓰세요. EtherCAT은 필드망입니다."),
    _p("schneider_mb", "슈나이더", "Modicon M241 · Modbus TCP", {"word_order": "low"}, "%M·%MW 주소가 Modbus 주소와 1:1로 대응합니다. EtherNet/IP·OPC UA·CANopen은 세부 모델별로 확인하세요."),
    _p("schneider_ua", "슈나이더", "Modicon (OPC UA 지원 모델) · OPC UA", {"protocol": "opcua", "port": 4840, "ua_ns": 2, "ua_security": "none", "timeout": 3},
       "OPC UA 서버를 지원하는 모델·펌웨어인지 확인하고 심볼 공개 설정을 하세요."),
    _p("rockwell_logix", "로크웰 / Allen-Bradley", "Micro800 · CompactLogix · ControlLogix · EtherNet/IP", {"protocol": "eip", "port": 44818, "eip_mode": "logix", "eip_slot": ""},
       "PLC 주소는 컨트롤러 태그 이름(JF01_FWD, Tunnel.JF[1].Run). ControlLogix는 CPU 슬롯 번호를 넣으세요. Micro800은 전역 변수만 읽을 수 있습니다."),
    _p("rockwell_slc", "로크웰 / Allen-Bradley", "MicroLogix 1400 · SLC 500 · EtherNet/IP (PCCC)", {"protocol": "eip", "port": 44818, "eip_mode": "slc"},
       "PLC 주소는 데이터 파일 표기(B3:0/1, N7:10, L9:0). MicroLogix 1400의 DF1·DH-485·DNP3는 직렬·전력 계통 프로토콜이라 이 프로그램은 이더넷(EtherNet/IP 또는 Modbus TCP)으로 연결합니다."),
    _p("rockwell_mb", "로크웰 / Allen-Bradley", "Micro800 · MicroLogix 1400 · Modbus TCP", {}, "Modbus 매핑 표(Micro800은 CCW의 Modbus Mapping)를 일람표 Modbus 주소와 맞추세요."),
    _p("delta_mbtcp", "델타", "DVP (이더넷 모델·모듈) · Modbus TCP", {"word_order": "low"},
       "DVP Modbus 주소: X0=입력 1024(0x0400), Y0=코일 1280(0x0500), M0=코일 2048(0x0800), D0=홀딩 4096(0x1000). 일람표 Modbus 주소에 이 오프셋을 더해 넣으세요. EtherNet/IP는 지원 모델만 해당됩니다."),
    _p("delta_ascii", "델타", "DVP · Modbus ASCII (RS-485 직렬, 기본 9600 7E1)", {"transport": "ascii_serial", "word_order": "low", "baud": 9600, "parity": "E", "stopbits": 1, "bytesize": 7, "timeout": 3},
       "DVP 통신 포트 기본값은 Modbus ASCII 9600bps 7E1, 국번 1입니다. RTU로 바꿨다면 연결 방식을 RTU로 고르세요. 주소 오프셋은 Modbus TCP와 같습니다."),
    _p("generic", "공통", "일반 Modbus TCP", {}, "Modbus TCP 서버(슬레이브) 기능이 있는 PLC 공통값"),
    _p("gateway", "공통", "통신변환장치 · Modbus RTU over TCP (투명 모드)", {"transport": "rtu_tcp", "port": 4001, "timeout": 3, "block": 60},
       "RS-485 장비를 이더넷 변환장치(시리얼 서버)의 TCP 투명 모드로 연결할 때. 포트는 변환장치 설정값. Unit ID = 직렬 장비 국번."),
    _p("gateway_mb", "공통", "통신변환장치 · Modbus TCP 변환 (게이트웨이 모드)", {"timeout": 3, "block": 60},
       "변환장치가 Modbus TCP ↔ RTU 변환을 하는 경우. Unit ID = 직렬 장비 국번."),
]

CCTV = [
    {"key": "generic", "name": "일반 (주소 직접 입력)", "values": {"port": 80, "auth": "auto", "snap_tpl": "", "mjpeg_tpl": "", "rtsp_tpl": ""},
     "note": "카메라 매뉴얼의 JPEG 스냅샷(정지영상) 주소를 그대로 넣으세요. {ip} {port} {ch} 를 쓰면 자동으로 바뀝니다."},
    {"key": "hanwha", "name": "한화비전 Wisenet (SUNAPI)", "values": {"port": 80, "auth": "digest",
        "snap_tpl": "http://{ip}:{port}/stw-cgi/video.cgi?msubmenu=snapshot&action=view&Channel={ch0}",
        "mjpeg_tpl": "", "rtsp_tpl": "rtsp://{ip}:554/profile2/media.smp"},
     "note": "NVR 채널은 0부터 시작합니다({ch0}). 펌웨어에 따라 경로가 다를 수 있습니다."},
    {"key": "hikvision", "name": "Hikvision (ISAPI)", "values": {"port": 80, "auth": "digest",
        "snap_tpl": "http://{ip}:{port}/ISAPI/Streaming/channels/{ch}01/picture",
        "mjpeg_tpl": "", "rtsp_tpl": "rtsp://{ip}:554/Streaming/Channels/{ch}01"},
     "note": "채널 1의 메인 스트림 = 101."},
    {"key": "dahua", "name": "Dahua (CGI)", "values": {"port": 80, "auth": "digest",
        "snap_tpl": "http://{ip}:{port}/cgi-bin/snapshot.cgi?channel={ch}",
        "mjpeg_tpl": "http://{ip}:{port}/cgi-bin/mjpg/video.cgi?channel={ch}&subtype=1",
        "rtsp_tpl": "rtsp://{ip}:554/cam/realmonitor?channel={ch}&subtype=0"},
     "note": "MJPEG는 보조 스트림 코덱을 MJPEG로 설정해야 나옵니다."},
    {"key": "axis", "name": "Axis (VAPIX)", "values": {"port": 80, "auth": "digest",
        "snap_tpl": "http://{ip}:{port}/axis-cgi/jpg/image.cgi?camera={ch}",
        "mjpeg_tpl": "http://{ip}:{port}/axis-cgi/mjpg/video.cgi?camera={ch}",
        "rtsp_tpl": "rtsp://{ip}/axis-media/media.amp?camera={ch}"}, "note": ""},
    {"key": "idis", "name": "아이디스 IDIS", "values": {"port": 80, "auth": "digest", "snap_tpl": "", "mjpeg_tpl": "", "rtsp_tpl": ""},
     "note": "모델별 CGI 주소가 달라 기본값을 넣지 않았습니다. 제조사 CGI·API 매뉴얼의 스냅샷 주소를 입력하세요."},
    {"key": "go2rtc", "name": "go2rtc 영상 중계서버 (RTSP 변환)", "values": {"port": 1984, "auth": "none",
        "snap_tpl": "http://{ip}:{port}/api/frame.jpeg?src={ch}",
        "mjpeg_tpl": "http://{ip}:{port}/api/stream.mjpeg?src={ch}", "rtsp_tpl": ""},
     "note": "채널 칸에 go2rtc.yaml 의 스트림 이름을 넣으세요. 어떤 제조사 RTSP 카메라든 이 방식으로 붙일 수 있습니다."},
]

VMS = [
    {"key": "plc", "name": "PLC 경유 (문안 번호)", "values": {"driver": "plc"},
     "note": "PLC가 VMS 제어기에 문안 번호를 넘깁니다. 관제점 VMS*.MSG / VMS*.FB 사용."},
    {"key": "modbus", "name": "Modbus TCP 직접 (예시값)", "values": {"driver": "modbus", "port": 502, "unit": 1,
        "msg_fc": 3, "msg_reg": 0, "fb_fc": 3, "fb_reg": 1, "text_reg": "", "text_len": 20, "encoding": "euc-kr"},
     "note": "VMS 제어기가 Modbus 서버일 때. 레지스터 번호는 제조사 통신 사양서 값으로 바꾸세요. 자유 문안을 쓰면 문안 시작 레지스터를 넣습니다."},
    {"key": "tcp", "name": "TCP 문자열 명령 (예시: STX·ETX·XOR)", "values": {"driver": "tcp", "port": 5000,
        "tpl": "<STX>M{no:03d}<ETX>{CS}", "checksum": "xor", "cs_from": "after_stx", "cs_fmt": "byte",
        "ack": "<ACK>", "encoding": "euc-kr", "timeout": 2},
     "note": "제조사 통신 사양서의 프레임 형식대로 명령 틀을 고치세요. {no}=문안 번호, {l1}{l2}=문안 글자, {CS}=체크섬 자리."},
]

GATE = [
    {"key": "plc", "name": "PLC 경유", "values": {"driver": "plc"},
     "note": "관제점 GATE*.DOWN_CMD / UP_CMD / UP / DOWN / FLT 사용."},
    {"key": "modbus", "name": "Modbus TCP 직접 (예시값)", "values": {"driver": "modbus", "port": 502, "unit": 1,
        "down_coil": 0, "up_coil": 1, "lamp_coil": 2, "pulse_ms": 500, "up_di": 0, "down_di": 1, "flt_di": 2},
     "note": "차단기 제어반이 Modbus 서버일 때. 펄스 0이면 유지형(켜 둔 채)으로 보냅니다."},
    {"key": "tcp", "name": "TCP 문자열 명령 (예시)", "values": {"driver": "tcp", "port": 5000,
        "down_tpl": "<STX>DN<ETX>", "up_tpl": "<STX>UP<ETX>", "status_tpl": "<STX>ST<ETX>",
        "resp_down": "DOWN", "resp_up": "UP", "ack": "<ACK>", "checksum": "none", "cs_from": "after_stx",
        "cs_fmt": "byte", "encoding": "ascii", "timeout": 2},
     "note": "제조사 사양서대로 하강·상승·상태조회 명령과 응답 문자열을 넣으세요. 상태조회를 비우면 마지막 명령으로 상태를 표시합니다."},
]

BUILTIN = {"plc": PLC, "cctv": CCTV, "vms": VMS, "gate": GATE}
