"""지능형 영상 분석(서버 측). 카메라가 보내는 이벤트(source=camera)와 구분해 source=analytics 로 기록한다."""

LABELS = {
    "fire": "불꽃(화재)",
    "smoke": "연기(시험 기능)",
    "no_helmet": "안전모 미착용",
    "water_level": "수위 상승·범람",
    "intrusion": "침입",
    "loitering": "배회",
    "crowd": "군집",
    "fall": "쓰러짐",
    "running": "급이동(뛰기)",
    "stationary": "장시간 움직임 없음",
}

# 사람 검출(YOLOX)이 필요한 규칙
PERSON_RULES = {"no_helmet", "intrusion", "loitering", "crowd", "fall", "running", "stationary"}

DEFAULT_SEVERITY = {
    "fire": "critical", "smoke": "warning", "water_level": "critical", "fall": "critical",
    "no_helmet": "warning", "intrusion": "warning", "loitering": "warning", "crowd": "info",
    "running": "info", "stationary": "warning",
}

# 규칙별 기본 설정값(화면에서 조정)
DEFAULT_PARAMS = {
    "fire": {"min_area": 0.002, "persist_seconds": 3, "flicker": 0.15, "sensitivity": 0.5},
    "smoke": {"min_area": 0.02, "persist_seconds": 8, "sensitivity": 0.5},
    "no_helmet": {"min_person_px": 60, "persist_seconds": 3, "sensitivity": 0.5},
    "water_level": {"changed_ratio": 0.45, "persist_seconds": 20, "danger_percent": 70},
    "intrusion": {"min_seconds": 1},
    "loitering": {"dwell_seconds": 60},
    "crowd": {"min_count": 5, "persist_seconds": 5},
    "fall": {"persist_seconds": 3},
    "running": {"speed": 1.5},
    "stationary": {"seconds": 120},
}
