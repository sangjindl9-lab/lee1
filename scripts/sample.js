'use strict';
/* 샘플 제안서 (단독주택 6대). 금액은 예시이며 실제 견적이 아닙니다. */
const fs = require('fs');
const path = require('path');
async function seed({ db, uid, storeFile }) {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'house_plan.png'));
  const f = await storeFile(null, { buffer: buf, originalname: Buffer.from('예시_주택평면.png').toString('latin1') }, true);
  const P = db.prepare('SELECT id, name FROM products').all(); const pid = n => (P.find(p => p.name === n) || {}).id;
  const S = 80; const m = (x, y) => [x * S, y * S];
  const plan = { id: uid(), name: '1층 · 마당', file_id: f.id, page: 1, width: 2400, height: 1600, upm: S, scale_note: '도면 5m 막대 기준' };
  const out = pid('실외 불릿 카메라 400만'), dome = pid('실내 돔 카메라 400만'), dome2 = pid('실내 돔 카메라 200만');
  const cam = (seq, xy, dir, product_id, place, height, note, range, night) => ({ id: uid(), plan: plan.id, seq, x: xy[0], y: xy[1], dir, product_id, place, height, note, range, show_night: !!night });
  const cams = [
    cam(1, m(4.3, 11.3), 160, out, '대문·진입로', 2.8, '대문으로 들어오는 사람과 마당 전체를 촬영합니다.', 14),
    cam(2, m(24.7, 11.4), 200, out, '주차장', 2.8, '주차 차량과 차량 출입을 촬영합니다.', 11),
    cam(3, m(14.9, 11.8), 180, out, '현관 앞', 2.5, '현관 출입과 택배 수령 위치를 확인합니다.', 7),
    cam(4, m(24.8, 2.7), 135, out, '집 옆 통로', 2.8, '집 옆과 뒤편 통로 침입을 감시합니다.', 10),
    cam(5, m(12.3, 2.8), 135, dome, '거실', 2.4, '거실 전체를 확인합니다(외출 시 실내 확인용).', 7),
    cam(6, m(4.4, 7.3), 115, dome2, '주방·식당', 2.4, '주방과 식당 공간을 확인합니다.', 6)
  ];
  const nvr = { id: uid(), plan: plan.id, type: 'nvr', x: 20 * S, y: 10.6 * S };
  const mon = { id: uid(), plan: plan.id, type: 'monitor', x: 16.5 * S, y: 3.3 * S };
  const route = pts => ({ id: uid(), plan: plan.id, type: 'route', points: pts.map(p => m(p[0], p[1])) });
  const marks = [nvr, mon, route([[20, 10.6], [20, 11.2], [4.3, 11.2]]), route([[20, 10.6], [24.7, 10.6], [24.7, 11.4]]), route([[20, 10.6], [24.6, 10.6], [24.6, 2.7]]), route([[20, 10.6], [20, 8], [12.3, 8], [12.3, 2.8]]), route([[12.3, 8], [4.4, 8], [4.4, 7.3]]), route([[20, 11.2], [14.9, 11.2], [14.9, 11.8]]), route([[20, 8], [16.5, 8], [16.5, 3.3]])];
  const data = {
    plans: [plan], cams, marks, date: new Date().toISOString().slice(0, 10),
    quote: { vat: true, discount: 0, auto_price: { [out]: 180000, [dome]: 150000, [dome2]: 110000 }, lines: [
      { name: '녹화기(NVR) 8채널', spec: '4K 녹화, 스마트폰 원격 확인', unit: '대', qty: 1, price: 320000 },
      { name: '하드디스크 2TB', spec: '감시용 · 약 30일 녹화', unit: '개', qty: 1, price: 110000 },
      { name: '모니터 22인치', spec: 'FHD', unit: '대', qty: 1, price: 150000 },
      { name: '설치비', spec: '카메라 1대당', unit: '대', qty: 6, price: 50000 },
      { name: '배선·배관 공사', spec: 'UTP·전선관', unit: '식', qty: 1, price: 250000 },
      { name: 'CCTV 안내판', spec: '아크릴', unit: '개', qty: 1, price: 20000 }] },
    options: { paper: 'A4', orient: 'landscape', show_detail: true, show_quote: true, show_notice: true },
    memo: '샘플 제안서입니다. 표시된 금액은 예시이며 실제 견적이 아닙니다. 녹화기는 거실(2) 수납장에 두고, 실외 카메라 배선은 외벽 전선관으로 정리합니다.'
  };
  const id = uid();
  db.prepare('INSERT INTO proposals(id,title,customer_name,customer_phone,customer_address,site_type,status,data,is_sample) VALUES(?,?,?,?,?,?,?,?,1)').run(id, '[샘플] 단독주택 CCTV 6대 설치 제안', '홍길동', '010-0000-0000', '○○시 ○○동 (예시 주소)', '단독주택', '작성 중', JSON.stringify(data));
  db.prepare('UPDATE files SET proposal_id=? WHERE id=?').run(id, f.id);
  return id;
}
module.exports = { seed };
