import { one, tx } from './db.js';
import { today, addDays } from './util.js';

/** 처음 실행 시 숙소가 하나도 없으면 '예시' 표시된 숙소·배너를 넣는다. 관리자 화면에서 한 번에 지울 수 있다. */
export async function seedIfEmpty() {
  if (process.env.SEED_SAMPLE === '0') return;
  const has = await one(`SELECT 1 FROM places LIMIT 1`);
  if (has) return;
  const P = [
    ['해운대 오션스테이 (예시)', '호텔/리조트', '4성급', '부산', '해운대', '부산 해운대구 해운대해변로 000 (예시 주소)', ['무료주차', '수영장', '조식', '와이파이', '오션뷰'], ['이번주특가', '즉시할인'], true,
      [['디럭스 더블 (오션뷰)', 2, 3, 5, 129000, 189000, 169000, '더블 침대 1 · 32㎡'], ['패밀리 트윈', 3, 4, 3, 159000, 219000, 199000, '더블 1 · 싱글 1 · 40㎡']]],
    ['애월 노을 풀빌라 (예시)', '펜션/풀빌라', '', '제주', '애월', '제주 제주시 애월읍 000 (예시 주소)', ['무료주차', '수영장', '바베큐', '취사가능', '넷플릭스', '오션뷰'], ['신축/리모델링'], true,
      [['A동 독채 풀빌라', 2, 4, 1, 290000, 390000, 0, '개별 온수풀 · 침실 2']]],
    ['강남 시티 호텔 (예시)', '호텔/리조트', '프리미엄', '서울', '강남/역삼', '서울 강남구 테헤란로 000 (예시 주소)', ['와이파이', '조식', '넷플릭스'], ['즉시할인'], false,
      [['스탠다드 퀸', 2, 2, 10, 99000, 119000, 129000, '퀸 침대 1 · 24㎡']]],
    ['경주 한옥스테이 담 (예시)', '게하/한옥', '', '경상', '경주', '경북 경주시 000 (예시 주소)', ['무료주차', '와이파이', '조식'], ['이번주특가'], true,
      [['사랑채 온돌방', 2, 4, 2, 110000, 150000, 140000, '온돌 · 마당 전망']]],
    ['가평 숲속 글램핑 (예시)', '캠핑/글램핑', '', '경기', '가평', '경기 가평군 000 (예시 주소)', ['무료주차', '바베큐', '반려견동반', '취사가능'], ['신규'], false,
      [['카라반 글램핑', 2, 4, 4, 139000, 179000, 0, '개별 바베큐 데크']]]
  ];
  await tx(async c => {
    for (const [name, type, grade, sido, area, address, amen, tags, featured, rooms] of P) {
      const p = (await c.query(`INSERT INTO places(name,type,grade,sido,area,address,amenities,tags,featured,sample,intro)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'예시 숙소입니다. 관리자 › 숙소·객실에서 실제 숙소로 바꾸거나 삭제하세요.') RETURNING id`,
        [name, type, grade, sido, area, address, amen, tags, featured])).rows[0];
      for (const [i, [rn, base, max, stock, price, wk, list, descr]] of rooms.entries())
        await c.query(`INSERT INTO rooms(place_id,name,base,max,stock,price,weekend_price,list_price,descr,sort) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [p.id, rn, base, max, stock, price, wk, list, descr, i]);
    }
    await c.query(`INSERT INTO banners(title,sub,advertiser,slot,link,bg,start_date,end_date,fee,priority,sample)
      VALUES('광고 구좌 판매 중 (예시)','이 자리에 광고주 배너가 노출됩니다','예시 광고주','home','', '#1f2a6b', $1, $2, 0, 0, true)`, [today(), addDays(today(), 60)]);
  });
  console.log('예시 숙소를 넣었습니다.');
}
