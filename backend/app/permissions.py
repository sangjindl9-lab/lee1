"""권한 목록과 기본 역할. 역할별 권한은 관리자 화면에서 변경 가능."""

PERMISSIONS: dict[str, str] = {
    # 공사
    "project.view_all": "전체 현장 조회 (미지정 시 배정 현장만)",
    "project.create": "공사 등록",
    "project.edit": "공사 수정·참여자 배정",
    "project.delete": "공사 삭제(휴지통)",
    "boq.edit": "설계내역·공정계획 등록·수정",
    # 일보
    "report.write": "작업일보 작성",
    "report.approve": "작업일보 승인·반려",
    "report.unapprove": "작업일보 승인취소",
    "worklog.write": "업무일지 작성",
    "worklog.review": "업무일지 승인·반려",
    # 자재
    "material.request": "자재 요청 작성",
    "material.master": "자재마스터·거래처 관리",
    "quote.manage": "견적 비교·업체 선정",
    "po.manage": "발주서 작성·취소",
    "po.receive": "입고·반품 처리",
    # 결재
    "approval.draft": "일반 품의서 기안",
    # 파일
    "file.upload": "파일·사진 업로드",
    "file.download": "파일 다운로드",
    "file.delete": "파일 삭제(휴지통)",
    # 민감정보
    "amount.contract": "[민감] 계약금액·설계금액·단가 조회",
    "amount.purchase": "[민감] 발주 단가·금액 조회",
    # 기타
    "notice.write": "공지 작성",
    "export.data": "PDF·엑셀 출력",
    # 관리자
    "admin.users": "[관리] 사용자 관리",
    "admin.settings": "[관리] 회사·결재선·코드 설정",
    "admin.trash": "[관리] 휴지통 복구",
    "audit.view": "[관리] 변경이력 조회",
}

ALL = list(PERMISSIONS)

_COMMON = ["file.upload", "file.download", "export.data", "worklog.write"]

DEFAULT_ROLES: list[tuple[str, str, list[str]]] = [
    ("admin", "시스템 관리자", ALL),
    ("executive", "대표·임원", ["project.view_all", "report.approve", "report.unapprove", "worklog.review",
                             "approval.draft", "amount.contract", "amount.purchase", "notice.write", "audit.view", *_COMMON]),
    ("office", "공무 담당", ["project.view_all", "project.create", "project.edit", "boq.edit", "report.approve",
                          "report.unapprove", "material.request", "approval.draft", "amount.contract", "notice.write", *_COMMON]),
    ("purchase", "구매 담당", ["project.view_all", "material.master", "quote.manage", "po.manage", "po.receive",
                            "material.request", "approval.draft", "amount.purchase", *_COMMON]),
    ("accounting", "경리 담당", ["project.view_all", "approval.draft", "amount.contract", "amount.purchase", *_COMMON]),
    ("site_manager", "현장소장", ["report.write", "report.approve", "material.request", "po.receive", "boq.edit",
                               "approval.draft", "file.delete", *_COMMON]),
    ("site_staff", "현장 직원", ["report.write", "material.request", "po.receive", *_COMMON]),
]

DOC_TYPES = {
    "material_request": "자재구매 요청서",
    "purchase_order": "발주 품의서",
    "general": "일반 업무 품의서",
}

DEFAULT_DOC_FORMATS = {
    "MR": "MR-{YYYY}{MM}-{SEQ:4}",
    "PO": "PO-{YYYY}{MM}-{SEQ:4}",
    "RC": "RC-{YYYY}{MM}-{SEQ:4}",
    "DR": "DR-{PROJECT}-{YYYY}{MM}{DD}",
    "AP": "AP-{YYYY}-{SEQ:5}",
}

DEFAULT_COMPANY_SETTINGS = {
    "doc_formats": DEFAULT_DOC_FORMATS,
    "amount_rounding": "floor",   # 원 미만 절사
    "vat_rate": "0.1",
    "trades": ["전기공", "내선전공", "외선전공", "통신내선공", "통신설비공", "광케이블설치사", "보통인부", "기타"],
    "weather_options": ["맑음", "구름많음", "흐림", "비", "눈", "강풍"],
    "photo_phases": ["작업전", "작업중", "작업후"],
}

SAMPLE_WORK_TYPES = ["배관", "배선", "케이블 포설", "트레이", "접지", "분전반", "조명",
                     "광케이블 접속", "통신장비 설치", "CCTV", "방송", "시험·시운전"]
