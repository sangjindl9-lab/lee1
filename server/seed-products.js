'use strict';
/* 기본 제품 목록: 일반적인 카메라 유형별 예시 사양입니다. 실제 판매 제품의 모델·사양·가격으로 수정해서 사용하세요. */
const C = (name, data) => ({ kind: 'camera', name, data: { ...data, note: '예시 사양 – 실제 제품 사양서 값으로 수정하세요' } });
const I = (name, model, unit) => ({ kind: 'item', name, model, data: { unit, note: '' } });
const LIST = [
  C('실내 돔 카메라 200만', { type: '돔형', place: '실내', resolution: '200만 화소(FHD)', lens: '2.8mm 고정', hfov: 103, range_m: 10, ir_m: 20, features: '적외선 야간 촬영, 천장 설치' }),
  C('실내 돔 카메라 400만', { type: '돔형', place: '실내', resolution: '400만 화소(QHD)', lens: '2.8mm 고정', hfov: 98, range_m: 12, ir_m: 30, features: '적외선 야간 촬영, 역광 보정(WDR)' }),
  C('실외 불릿 카메라 400만', { type: '불릿형', place: '실외', resolution: '400만 화소(QHD)', lens: '3.6mm 고정', hfov: 87, range_m: 25, ir_m: 40, features: '방수·방진(IP67), 적외선 야간 촬영' }),
  C('실외 줌 카메라 500만', { type: '불릿형', place: '실외', resolution: '500만 화소', lens: '2.7~13.5mm 전동 줌', hfov: 85, range_m: 40, ir_m: 50, features: '원격 줌·초점 조정, 방수(IP67)' }),
  C('실외 PTZ 카메라 400만', { type: 'PTZ', place: '실외', resolution: '400만 화소', lens: '광학 25배 줌', hfov: 60, range_m: 80, ir_m: 100, features: '회전·확대 원격 조작, 자동 추적' }),
  C('어안 360° 카메라', { type: '어안', place: '실내', resolution: '1200만 화소', lens: '1.4mm 어안', hfov: 360, range_m: 8, ir_m: 10, features: '한 대로 실내 전체 감시' }),
  C('가정용 Wi-Fi 카메라', { type: '큐브형', place: '실내', resolution: '200만 화소', lens: '2.8mm', hfov: 110, range_m: 8, ir_m: 10, features: '스마트폰 앱 확인, 양방향 대화' }),
  I('녹화기(NVR) 4채널', 'NVR-4CH', '대'), I('녹화기(NVR) 8채널', 'NVR-8CH', '대'), I('녹화기(NVR) 16채널', 'NVR-16CH', '대'),
  I('하드디스크 2TB', '감시용 HDD', '개'), I('하드디스크 4TB', '감시용 HDD', '개'), I('모니터 22인치', 'FHD', '대'),
  I('설치비', '카메라 1대당', '대'), I('배선·배관 공사', 'UTP·전선관', '식'), I('CCTV 안내판', '아크릴', '개')
];
function seed(db, uid) { const ins = db.prepare('INSERT INTO products(id,kind,name,model,maker,data,sort) VALUES(?,?,?,?,?,?,?)'); db.transaction(() => LIST.forEach((p, i) => ins.run(uid(), p.kind, p.name, p.model || '', '', JSON.stringify(p.data), i)))(); }
module.exports = { seed, LIST };
