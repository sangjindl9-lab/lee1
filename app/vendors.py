"""제조사 프로필 (기본 제공).

여기 값은 각 제조사에서 흔히 쓰는 기본값이다. 현장 장비의 펌웨어·설정에 따라 다를 수 있으니
반드시 제조사 매뉴얼이나 납품업체 자료로 확인하고, 다르면 화면에서 고쳐 '내 프로필'로 저장해 쓴다.
"""

PLC = [
    {"key": "generic", "name": "일반 Modbus TCP", "values": {"port": 502, "word_order": "high", "addr_offset": 0, "timeout": 2, "block": 100},
     "note": "Modbus TCP 서버(슬레이브) 기능이 있는 PLC 공통값"},
    {"key": "ls_xgt", "name": "LS ELECTRIC XGT (FEnet Modbus TCP)", "values": {"port": 502, "word_order": "low", "addr_offset": 0, "timeout": 2, "block": 100},
     "note": "XG5000 이더넷 설정에서 FEnet 드라이버를 Modbus TCP 서버로 지정하고, 비트·워드 영역 매핑(P/M/D 등)을 일람표 주소와 맞추세요. 32비트는 하위 워드가 앞 주소에 오는 경우가 많습니다."},
    {"key": "siemens_s7", "name": "Siemens S7-1200/1500 (MB_SERVER)", "values": {"port": 502, "word_order": "high", "addr_offset": 0, "timeout": 2, "block": 100},
     "note": "MB_SERVER 블록의 홀딩 레지스터 DB와 프로세스 이미지(I/Q) 매핑을 확인하세요."},
    {"key": "mitsubishi", "name": "미쓰비시 iQ-R / Q (Modbus TCP)", "values": {"port": 502, "word_order": "low", "addr_offset": 0, "timeout": 2, "block": 100},
     "note": "Modbus TCP 모듈(또는 내장 포트) 디바이스 할당 설정을 확인하세요."},
    {"key": "schneider", "name": "Schneider Modicon M221/M241", "values": {"port": 502, "word_order": "low", "addr_offset": 0, "timeout": 2, "block": 100},
     "note": "%M·%MW 주소가 Modbus 주소와 1:1로 대응합니다."},
    {"key": "gateway", "name": "통신변환장치 (RS-485 Modbus RTU → TCP)", "values": {"port": 502, "word_order": "high", "addr_offset": 0, "timeout": 3, "block": 60},
     "note": "Unit ID = RS-485 쪽 장비 국번. 직렬 구간이 느리므로 응답 대기를 넉넉히 두세요."},
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
