// 설비 종류·필드 정의 (서버·화면 공통, /api/meta 로 제공)
const STATUSES = ['설계', '시공 중', '시공 완료', '시험 완료', '사용 중', '철거'];

const CATEGORIES = {
  power_cable: { label: '전력케이블', group: 'cable', medium: 'power', prefix: 'PC' },
  fiber_cable: { label: '광케이블', group: 'cable', medium: 'comm', prefix: 'FO' },
  lan_cable:   { label: 'LAN케이블', group: 'cable', medium: 'comm', prefix: 'LN' },
  cctv:        { label: 'CCTV', group: 'equipment', ports: 'device', prefix: 'CAM' },
  panel:       { label: '분전반·배전반', group: 'equipment', ports: 'circuit', hub: true, prefix: 'LP' },
  load:        { label: '부하설비', group: 'equipment', ports: 'terminal', prefix: 'LD' },
  odf:         { label: 'ODF', group: 'equipment', ports: 'passthrough', prefix: 'ODF' },
  closure:     { label: '광접속함', group: 'equipment', prefix: 'JC' },
  splitter:    { label: '광분배기', group: 'equipment', ports: 'splitter', prefix: 'SP' },
  rack:        { label: '랙', group: 'equipment', hub: true, prefix: 'RK' },
  patch_panel: { label: '패치패널', group: 'equipment', ports: 'passthrough', prefix: 'PP' },
  switch:      { label: '스위치', group: 'equipment', ports: 'terminal', hub: true, prefix: 'SW' },
  nvr:         { label: 'NVR', group: 'equipment', ports: 'channel', hub: true, prefix: 'NVR' },
  outlet:      { label: '정보콘센트', group: 'equipment', ports: 'passthrough', prefix: 'TO' },
  pathway:     { label: '관로·트레이·접속함', group: 'equipment', prefix: 'TR' },
  other:       { label: '기타 장비', group: 'equipment', prefix: 'EQ' },
};

// 종류별 상세 필드
const DETAIL_FIELDS = {
  power_cable: [
    ['panel_name', '분전반·배전반'], ['circuit_no', '회로번호'],
    ['cable_type', '케이블 종류'], ['size', '규격'], ['cores', '심수'], ['parallel', '병렬 포설 수'],
    ['voltage', '전압'], ['phase', '상'], ['wiring', '선식'],
    ['breaker_rating', '차단기 정격'], ['load_desc', '연결 부하'],
    ['from_desc', '시작점'], ['from_terminal', '시작점 단자'], ['to_desc', '종점'], ['to_terminal', '종점 단자'],
    ['via', '경유 접속함·관로·트레이'],
    ['design_length', '설계길이(m)', 'number'], ['actual_length', '실제 포설길이(m)', 'number'],
    ['slack', '여장(m)', 'number'], ['length_basis', '길이 산정 근거'],
    ['laid_date', '포설일', 'date'], ['terminated_date', '단말 처리일', 'date'], ['worker', '작업자'],
  ],
  fiber_cable: [
    ['section_name', '구간명'], ['cable_type', '케이블 종류'], ['spec', '규격'], ['core_count', '코어 수', 'number'],
    ['from_desc', '시작점'], ['to_desc', '종점'], ['via', '경유 접속함·ODF'],
    ['design_length', '설계길이(m)', 'number'], ['actual_length', '실제 포설길이(m)', 'number'],
    ['laid_date', '포설일', 'date'], ['worker', '작업자'],
  ],
  lan_cable: [
    ['cable_type', '케이블 종류'], ['lan_category', '카테고리'], ['shielded', '차폐 여부', 'select', ['', 'UTP(비차폐)', 'FTP/STP(차폐)']],
    ['rack', '랙'], ['outlet_no', '정보콘센트 번호'], ['outlet_location', '정보콘센트 위치'],
    ['design_length', '설계길이(m)', 'number'], ['actual_length', '실제 포설길이(m)', 'number'],
    ['poe', 'PoE 사용', 'select', ['', '사용', '미사용']],
    ['laid_date', '시공일', 'date'], ['worker', '작업자'],
  ],
  cctv: [
    ['install_height', '설치 높이(m)', 'number'], ['direction', '촬영 방향'],
    ['ip', 'IP 주소'], ['mac', 'MAC 주소'], ['nvr_channel', 'NVR 채널(메모)'],
    ['power_method', '전원 공급 방식', 'select', ['', 'PoE', 'AC 220V', 'DC 어댑터', '기타']],
    ['warranty_start', '보증 시작일', 'date'], ['warranty_end', '보증 종료일', 'date'],
    ['supplier_contact', '공급업체 연락처'],
  ],
  panel: [['rated', '정격'], ['source', '공급 전원'], ['phase_wiring', '상·선식']],
  switch: [['ip', 'IP 주소'], ['poe_budget', 'PoE 용량']],
  nvr: [['ip', 'IP 주소'], ['storage', '저장 용량']],
  splitter: [['ratio', '분배비']],
  rack: [['units', '랙 유닛(U)']],
  odf: [], closure: [], patch_panel: [], outlet: [], load: [['rated', '정격 용량']], pathway: [['spec', '규격']], other: [],
};

const PORT_STATUSES = ['사용', '예비', '불량', '사용 중지'];
const CORE_STATUSES = ['사용 중', '예비', '불량', '사용 중지'];
const CORE_COLORS = ['청', '황', '녹', '갈', '회', '백', '적', '흑', '황색', '자', '분홍', '하늘'];

const TEST_TYPES = {
  insulation: { label: '절연저항', cats: ['power_cable'] },
  otdr: { label: 'OTDR', cats: ['fiber_cable'] },
  optical_loss: { label: '광손실', cats: ['fiber_cable'] },
  lan_cert: { label: 'LAN 성능시험', cats: ['lan_cable'] },
  other: { label: '기타 시험', cats: ['*'] },
};

const WORK_TYPES = ['신규 설치', '포설', '접속', '단말 처리', '측정', '점검', '장애', '보수', '교체', '철거', '도면 수정'];

const CONN_KINDS = { power: '전원', fixed: '고정 배선·단말', patch: '패치코드', splice: '광접속', comm: '통신' };

const FILE_CATEGORIES = {
  photo: '사진', photo_before: '작업 전 사진', photo_after: '작업 후 사진', report: '시험성적서',
  approval: '승인서', manual: '매뉴얼', config: '설정 자료', other: '기타',
};

module.exports = { STATUSES, CATEGORIES, DETAIL_FIELDS, PORT_STATUSES, CORE_STATUSES, CORE_COLORS, TEST_TYPES, WORK_TYPES, CONN_KINDS, FILE_CATEGORIES };
