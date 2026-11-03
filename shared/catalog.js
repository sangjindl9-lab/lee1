/* 공통 카탈로그: 장비 유형, 포트 생성 규칙, 기본 레이어, 케이블 종류
 * 브라우저(window.CCTVCatalog)와 Node(require) 양쪽에서 사용합니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CCTVCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 기본 레이어 (key, 표시명, 색, 선종류[dash], 선굵기 mm)
  const LAYERS = [
    { key: 'BG', name: '원본 도면', color: '#888888', dash: '', lw: 0.18, locked: true },
    { key: 'CCTV', name: 'CCTV', color: '#d62728', dash: '', lw: 0.35 },
    { key: 'NET', name: '네트워크 장비', color: '#1f77b4', dash: '', lw: 0.35 },
    { key: 'REC', name: '녹화장비', color: '#9467bd', dash: '', lw: 0.35 },
    { key: 'BOX', name: '함체·폴', color: '#8c564b', dash: '', lw: 0.35 },
    { key: 'UTP', name: 'UTP', color: '#1f77b4', dash: '', lw: 0.35 },
    { key: 'FIBER', name: '광케이블', color: '#ff7f0e', dash: '8 3', lw: 0.5 },
    { key: 'COAX', name: '동축케이블', color: '#2ca02c', dash: '2 2', lw: 0.4 },
    { key: 'POWER', name: '전원케이블', color: '#e377c2', dash: '10 3 2 3', lw: 0.35 },
    { key: 'GROUND', name: '접지선', color: '#17becf', dash: '4 2 1 2 1 2', lw: 0.25 },
    { key: 'RACEWAY', name: '배관·트레이', color: '#7f7f7f', dash: '14 4', lw: 0.7 },
    { key: 'FOV', name: '화각', color: '#ffbf00', dash: '', lw: 0.13 },
    { key: 'TEXT', name: '문자·치수', color: '#000000', dash: '', lw: 0.18 },
    { key: 'DEMO', name: '철거', color: '#555555', dash: '3 3', lw: 0.25 },
    { key: 'NEW', name: '신설', color: '#000000', dash: '', lw: 0.25 }
  ];

  // 케이블 종류: 흑백 출력 시 선종류와 라벨 접두어로 구분
  const CABLE_KINDS = {
    utp: { name: 'UTP', layer: 'UTP', prefix: 'U', dash: '', carries: ['data'] },
    stp: { name: '차폐 데이터', layer: 'UTP', prefix: 'S', dash: '6 2', carries: ['data'] },
    fiber: { name: '광케이블', layer: 'FIBER', prefix: 'F', dash: '8 3', carries: ['fiber'] },
    coax: { name: '동축케이블', layer: 'COAX', prefix: 'C', dash: '2 2', carries: ['video'] },
    composite: { name: '영상·전원 복합', layer: 'COAX', prefix: 'CP', dash: '2 2 8 2', carries: ['video', 'power'] },
    power: { name: '전원케이블', layer: 'POWER', prefix: 'P', dash: '10 3 2 3', carries: ['power'] },
    ground: { name: '접지선', layer: 'GROUND', prefix: 'E', dash: '4 2 1 2 1 2', carries: ['ground'] }
  };

  const SIGNALS = ['CVBS', 'AHD', 'HD-TVI', 'HD-CVI', '사용자 정의'];

  // 장비 유형. role: 계통도 열 배치, layer: 기본 레이어
  // pass: 회선 추적 시 통과(경유) 가능한 매체 목록
  const DEVICE_TYPES = {
    camera: { name: 'CCTV', layer: 'CCTV', role: 0, sym: 'cam', prefix: 'CAM' },
    nvr: { name: 'NVR', layer: 'REC', role: 5, sym: 'rec', prefix: 'NVR' },
    dvr: { name: 'DVR', layer: 'REC', role: 5, sym: 'rec', prefix: 'DVR' },
    hvr: { name: '하이브리드 녹화기', layer: 'REC', role: 5, sym: 'rec', prefix: 'HVR' },
    server: { name: '서버', layer: 'REC', role: 5, sym: 'box', prefix: 'SVR' },
    monitor: { name: '모니터', layer: 'REC', role: 6, sym: 'mon', prefix: 'MON' },
    switch: { name: '스위치', layer: 'NET', role: 3, sym: 'sw', prefix: 'SW' },
    poe_switch: { name: 'PoE 스위치', layer: 'NET', role: 2, sym: 'sw', prefix: 'PSW' },
    fiber_switch: { name: '광스위치', layer: 'NET', role: 4, sym: 'sw', prefix: 'FSW' },
    media_converter: { name: '광컨버터', layer: 'NET', role: 2, sym: 'mc', prefix: 'MC', pass: ['data', 'fiber'] },
    sfp: { name: 'SFP 모듈', layer: 'NET', role: 3, sym: 'small', prefix: 'SFP', pass: ['data', 'fiber'] },
    fdf: { name: '광분배함', layer: 'NET', role: 3, sym: 'box', prefix: 'FDF', pass: ['fiber'] },
    patch_panel: { name: '패치패널', layer: 'NET', role: 3, sym: 'box', prefix: 'PP', pass: ['data'] },
    encoder: { name: '영상 인코더', layer: 'NET', role: 2, sym: 'conv', prefix: 'ENC' },
    video_converter: { name: '영상 변환기', layer: 'NET', role: 1, sym: 'conv', prefix: 'VC', pass: ['video'] },
    coax_repeater: { name: '동축 중계기·송수신기', layer: 'COAX', role: 1, sym: 'rep', prefix: 'REP', pass: ['video', 'power'] },
    balun: { name: '영상 발룬', layer: 'COAX', role: 1, sym: 'small', prefix: 'BL', pass: ['video', 'data'] },
    coax_spd: { name: '동축 영상 서지보호기', layer: 'COAX', role: 1, sym: 'spd', prefix: 'VSPD', pass: ['video', 'power'] },
    coax_joint: { name: '동축 중간 접속점', layer: 'COAX', role: 1, sym: 'joint', prefix: 'JT', pass: ['video', 'power'] },
    cabinet: { name: '통신함체', layer: 'BOX', role: 2, sym: 'box', prefix: 'BOX', pass: ['video', 'power', 'data', 'fiber'], container: true },
    rack: { name: '랙', layer: 'BOX', role: 4, sym: 'box', prefix: 'RACK', container: true },
    pole: { name: 'CCTV 폴', layer: 'BOX', role: 0, sym: 'pole', prefix: 'POLE' },
    bracket: { name: '브래킷', layer: 'BOX', role: 0, sym: 'small', prefix: 'BRK' },
    psu: { name: '전원공급장치', layer: 'POWER', role: 2, sym: 'psu', prefix: 'PSU' },
    panel: { name: '분전함', layer: 'POWER', role: 4, sym: 'box', prefix: 'PNL' },
    ups: { name: 'UPS', layer: 'POWER', role: 4, sym: 'box', prefix: 'UPS', pass: ['power'] },
    power_spd: { name: '전원 서지보호기', layer: 'POWER', role: 1, sym: 'spd', prefix: 'PSPD', pass: ['power'] },
    junction_box: { name: '접속함', layer: 'BOX', role: 1, sym: 'box', prefix: 'JB', pass: ['video', 'power', 'data', 'fiber'] },
    pull_box: { name: '풀박스', layer: 'RACEWAY', role: 1, sym: 'box', prefix: 'PB', raceNode: true },
    manhole: { name: '맨홀', layer: 'RACEWAY', role: 1, sym: 'mh', prefix: 'MH', raceNode: true },
    handhole: { name: '핸드홀', layer: 'RACEWAY', role: 1, sym: 'mh', prefix: 'HH', raceNode: true },
    offpage: { name: '도면 간 연결 참조', layer: 'TEXT', role: 1, sym: 'ref', prefix: 'REF', pass: ['video', 'power', 'data', 'fiber', 'ground'] },
    custom: { name: '사용자 정의', layer: 'NEW', role: 3, sym: 'box', prefix: 'EQ' }
  };

  // 라이브러리 프리셋 (왼쪽 패널)
  const LIBRARY = [
    { group: 'CCTV (IP)', items: [
      { label: 'IP 고정형', type: 'camera', props: { system: 'IP', form: '고정형', hfov: 90, range: 20, poe: true } },
      { label: 'IP 돔형', type: 'camera', props: { system: 'IP', form: '돔형', hfov: 100, range: 15, poe: true } },
      { label: 'IP 불릿형', type: 'camera', props: { system: 'IP', form: '불릿형', hfov: 85, range: 30, poe: true } },
      { label: 'IP PTZ', type: 'camera', props: { system: 'IP', form: 'PTZ', hfov: 60, range: 80, poe: true } },
      { label: 'IP 어안', type: 'camera', props: { system: 'IP', form: '어안', hfov: 360, range: 10, poe: true } }
    ] },
    { group: 'CCTV (동축)', items: [
      { label: '동축 고정형', type: 'camera', props: { system: '동축', form: '고정형', hfov: 90, range: 20, signal: 'AHD', power_mode: '별도전원' } },
      { label: '동축 돔형', type: 'camera', props: { system: '동축', form: '돔형', hfov: 100, range: 15, signal: 'AHD', power_mode: '별도전원' } },
      { label: '동축 불릿형', type: 'camera', props: { system: '동축', form: '불릿형', hfov: 85, range: 30, signal: 'HD-TVI', power_mode: '별도전원' } },
      { label: '동축 PTZ', type: 'camera', props: { system: '동축', form: 'PTZ', hfov: 60, range: 60, signal: 'HD-TVI', power_mode: '별도전원' } }
    ] },
    { group: '녹화·표시', items: [
      { label: 'NVR', type: 'nvr', props: { channels: 16, lan_ports: 1 } },
      { label: 'DVR', type: 'dvr', props: { channels: 8 } },
      { label: '하이브리드 녹화기', type: 'hvr', props: { channels: 16 } },
      { label: '서버', type: 'server', props: {} },
      { label: '모니터', type: 'monitor', props: {} }
    ] },
    { group: '네트워크', items: [
      { label: '일반 스위치', type: 'switch', props: { ports: 8, sfp_ports: 2 } },
      { label: 'PoE 스위치', type: 'poe_switch', props: { ports: 8, sfp_ports: 2 } },
      { label: '광스위치', type: 'fiber_switch', props: { ports: 0, sfp_ports: 8 } },
      { label: '광컨버터', type: 'media_converter', props: {} },
      { label: 'SFP 모듈', type: 'sfp', props: {} },
      { label: '광분배함', type: 'fdf', props: { ports: 12 } },
      { label: '패치패널', type: 'patch_panel', props: { ports: 24 } },
      { label: '영상 인코더', type: 'encoder', props: { channels: 4 } },
      { label: '영상 변환기', type: 'video_converter', props: {} }
    ] },
    { group: '동축 부대장비', items: [
      { label: '동축 중계기·송수신기', type: 'coax_repeater', props: {} },
      { label: '영상 발룬', type: 'balun', props: {} },
      { label: '동축 영상 서지보호기', type: 'coax_spd', props: {} },
      { label: '동축 중간 접속점', type: 'coax_joint', props: {} }
    ] },
    { group: '함체·전원', items: [
      { label: '통신함체', type: 'cabinet', props: {} },
      { label: '랙', type: 'rack', props: {} },
      { label: 'CCTV 폴', type: 'pole', props: {} },
      { label: '브래킷', type: 'bracket', props: {} },
      { label: '전원공급장치', type: 'psu', props: { outputs: 4, voltage: 12, current_type: 'DC' } },
      { label: '분전함', type: 'panel', props: {} },
      { label: 'UPS', type: 'ups', props: {} },
      { label: '전원 서지보호기', type: 'power_spd', props: {} }
    ] },
    { group: '관로 노드·기타', items: [
      { label: '접속함', type: 'junction_box', props: {} },
      { label: '풀박스', type: 'pull_box', props: {} },
      { label: '맨홀', type: 'manhole', props: {} },
      { label: '핸드홀', type: 'handhole', props: {} },
      { label: '도면 간 연결 참조', type: 'offpage', props: { link_ref: '' } },
      { label: '사용자 정의', type: 'custom', props: {} }
    ] }
  ];

  function range(n, f) { const a = []; for (let i = 1; i <= n; i++) a.push(f(i)); return a; }

  // 장비의 포트 목록 생성. kind: data|video|power|fiber|ground|any
  function portsFor(dev) {
    const p = dev.props || {};
    const t = dev.type;
    let ports = [];
    switch (t) {
      case 'camera':
        if (p.system === 'IP') ports = [{ id: 'LAN', kind: 'data' }];
        else if (p.system === '동축') ports = [{ id: 'VIDEO', kind: 'video' }];
        else ports = [{ id: 'LAN', kind: 'data' }, { id: 'VIDEO', kind: 'video' }];
        if (!(p.system === 'IP' && p.poe)) ports.push({ id: 'DC', kind: 'power' });
        break;
      case 'nvr': case 'server':
        ports = range(+p.lan_ports || 1, i => ({ id: 'LAN' + i, kind: 'data' }));
        if (+p.poe_ports) ports = ports.concat(range(+p.poe_ports, i => ({ id: 'PoE' + i, kind: 'data' })));
        ports.push({ id: 'AC', kind: 'power' }, { id: 'HDMI', kind: 'video' });
        break;
      case 'dvr':
        ports = range(+p.channels || 4, i => ({ id: 'CH' + i, kind: 'video' }));
        ports.push({ id: 'LAN1', kind: 'data' }, { id: 'AC', kind: 'power' }, { id: 'HDMI', kind: 'video' });
        break;
      case 'hvr':
        ports = range(+p.channels || 8, i => ({ id: 'CH' + i, kind: 'video' }));
        ports.push({ id: 'LAN1', kind: 'data' }, { id: 'AC', kind: 'power' }, { id: 'HDMI', kind: 'video' });
        break;
      case 'monitor': ports = [{ id: 'HDMI', kind: 'video' }, { id: 'AC', kind: 'power' }]; break;
      case 'switch': case 'poe_switch': case 'fiber_switch':
        ports = range(+p.ports || 0, i => ({ id: 'P' + i, kind: 'data' }))
          .concat(range(+p.sfp_ports || 0, i => ({ id: 'SFP' + i, kind: 'fiber' })));
        ports.push({ id: 'AC', kind: 'power' });
        break;
      case 'media_converter': ports = [{ id: 'LAN', kind: 'data' }, { id: 'FIBER', kind: 'fiber' }, { id: 'DC', kind: 'power' }]; break;
      case 'sfp': ports = [{ id: 'HOST', kind: 'data' }, { id: 'FIBER', kind: 'fiber' }]; break;
      case 'fdf': ports = range(+p.ports || 12, i => ({ id: 'P' + i, kind: 'fiber' })).concat([{ id: 'TRUNK', kind: 'fiber' }]); break;
      case 'patch_panel': ports = range(+p.ports || 24, i => ({ id: 'P' + i, kind: 'data' })).concat([{ id: 'REAR', kind: 'data' }]); break;
      case 'encoder': ports = range(+p.channels || 4, i => ({ id: 'CH' + i, kind: 'video' })).concat([{ id: 'LAN', kind: 'data' }, { id: 'DC', kind: 'power' }]); break;
      case 'video_converter': ports = [{ id: 'IN', kind: 'video' }, { id: 'OUT', kind: 'video' }, { id: 'DC', kind: 'power' }]; break;
      case 'coax_repeater': ports = [{ id: 'IN', kind: 'video' }, { id: 'OUT', kind: 'video' }, { id: 'DC', kind: 'power' }]; break;
      case 'balun': ports = [{ id: 'COAX', kind: 'video' }, { id: 'UTP', kind: 'data' }]; break;
      case 'coax_spd': case 'coax_joint': ports = [{ id: 'IN', kind: 'video' }, { id: 'OUT', kind: 'video' }, { id: 'GND', kind: 'ground' }]; if (t === 'coax_joint') ports.pop(); break;
      case 'psu': ports = range(+p.outputs || 4, i => ({ id: 'OUT' + i, kind: 'power' })).concat([{ id: 'AC', kind: 'power' }]); break;
      case 'panel': ports = range(+p.circuits || 6, i => ({ id: 'CB' + i, kind: 'power' })).concat([{ id: 'MAIN', kind: 'power' }, { id: 'E', kind: 'ground' }]); break;
      case 'ups': ports = [{ id: 'IN', kind: 'power' }].concat(range(+p.outputs || 4, i => ({ id: 'OUT' + i, kind: 'power' }))); break;
      case 'power_spd': ports = [{ id: 'IN', kind: 'power' }, { id: 'OUT', kind: 'power' }, { id: 'GND', kind: 'ground' }]; break;
      case 'offpage': ports = [{ id: 'A', kind: 'any' }]; break;
      default: ports = [{ id: 'A', kind: 'any' }, { id: 'B', kind: 'any' }];
    }
    // 사용자 추가 포트
    (p.extra_ports || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => ports.push({ id, kind: 'any' }));
    return ports;
  }

  // 케이블 종류가 연결 가능한 포트 kind
  function cableFitsPort(cableKind, portKind) {
    if (portKind === 'any') return true;
    const map = { utp: ['data'], stp: ['data'], fiber: ['fiber'], coax: ['video'], composite: ['video', 'power'], power: ['power'], ground: ['ground'] };
    return (map[cableKind] || []).includes(portKind);
  }

  const STATUS = ['신설', '기존', '철거', '재사용', '교체'];
  const FIELD_STATUS = ['미확인', '위치 확정', '변경 필요', '설치 완료'];
  const INSTALL_METHODS = ['배관', '트레이', '매설', '노출', '가공', '기존관', '랙 내부', '기타'];
  const RACEWAY_METHODS = ['매설', '노출', '가공', '기존관 사용'];

  return { LAYERS, CABLE_KINDS, SIGNALS, DEVICE_TYPES, LIBRARY, portsFor, cableFitsPort, STATUS, FIELD_STATUS, INSTALL_METHODS, RACEWAY_METHODS };
});
