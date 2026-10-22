// 예시 숙소 데이터 (SEED_DEMO=true 이고 숙소가 하나도 없을 때만 1회 생성)
// 사진은 실사가 아니라 서버에서 그린 풍경 일러스트이며, 후기는 만들지 않는다 (가짜 후기 금지).
import sharp from 'sharp';
import { one, q } from './db.js';
import { REGION_COORDS } from './config.js';

function rng(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
const SKIES = [['#8EC5DA', '#E6F1EC'], ['#E9946A', '#F5D4A8'], ['#1E2A48', '#53618F'], ['#BBD3EA', '#F1E9DC']];

function sceneSvg(id, cat, v) {
  const r = rng(id * 13 + v * 5), sky = SKIES[v % 4], night = v % 4 === 2;
  const win = night ? '#F4C86A' : '#F7EBD0', e = [];
  const hill = (y, amp, c) => { let p = `M0 ${y}`; for (let x = 0; x <= 400; x += 50) p += ` Q${x + 25} ${y - amp * (0.4 + r())} ${x + 50} ${y - (r() - 0.5) * amp * 0.6}`; e.push(`<path d="${p} L400 300 L0 300Z" fill="${c}"/>`); };
  if (cat === 'ocean' || cat === 'pool') {
    hill(170, 30, night ? '#2E3B5E' : '#7FA79A');
    e.push(`<rect y="190" width="400" height="110" fill="${night ? '#1A2644' : '#3F8FA8'}"/>`);
    for (let i = 0; i < 5; i++) e.push(`<path d="M${r() * 300} ${205 + i * 18} q20 -5 40 0 t40 0" stroke="rgba(255,255,255,.45)" stroke-width="2" fill="none"/>`);
    e.push(`<rect y="232" width="400" height="68" fill="${night ? '#2A2A36' : '#E8DCC2'}"/>`);
    if (cat === 'pool') e.push(`<rect x="40" y="246" width="230" height="30" rx="4" fill="#6FD0D8"/><rect x="40" y="246" width="230" height="5" fill="#9FE6EA"/>`);
    e.push(`<rect x="230" y="168" width="140" height="72" fill="${night ? '#3A3F55' : '#FAF7F0'}"/><rect x="222" y="160" width="156" height="10" fill="${night ? '#20253A' : '#2D3A35'}"/><rect x="245" y="182" width="110" height="40" fill="${win}" opacity=".85"/>`);
  } else if (cat === 'city') {
    e.push(`<rect y="230" width="400" height="70" fill="${night ? '#101830' : '#3B6E87'}"/>`);
    let x = -10;
    while (x < 400) {
      const w = 30 + r() * 40, h = 60 + r() * 140;
      e.push(`<rect x="${x}" y="${232 - h}" width="${w}" height="${h}" fill="${night ? '#28324F' : ['#5D6F82', '#7F8FA0', '#4E5E70'][Math.floor(r() * 3)]}"/>`);
      for (let wy = 242 - h; wy < 222; wy += 14) for (let wx = x + 5; wx < x + w - 8; wx += 10) if (r() < (night ? 0.55 : 0.3)) e.push(`<rect x="${wx}" y="${wy}" width="5" height="7" fill="${win}"/>`);
      x += w + 4;
    }
  } else {
    hill(150, 60, night ? '#2A3556' : '#93AE9C'); hill(195, 40, night ? '#22304A' : '#5E8A6C');
    if (['forest', 'cabin', 'camp'].includes(cat)) for (let i = 0; i < 14; i++) { const tx = r() * 400, ty = 200 + r() * 60, s = 0.6 + r() * 0.8; e.push(`<path d="M${tx} ${ty - 46 * s} L${tx + 14 * s} ${ty} L${tx - 14 * s} ${ty}Z" fill="${night ? '#17243A' : ['#2F5B43', '#3E6B4F', '#284D3A'][i % 3]}"/>`); }
    e.push(`<rect y="250" width="400" height="50" fill="${night ? '#1B2436' : cat === 'camp' ? '#9AAE6A' : '#B8A98A'}"/>`);
    if (cat === 'hanok') {
      e.push(`<rect x="110" y="176" width="190" height="66" fill="${night ? '#4A4038' : '#F1E6D2'}"/>`);
      for (let i = 0; i < 5; i++) e.push(`<rect x="${122 + i * 36}" y="190" width="26" height="40" fill="${win}" stroke="${night ? '#2A2420' : '#7A5C3E'}" stroke-width="2"/>`);
      e.push(`<path d="M80 180 Q110 168 205 150 Q300 168 330 180 Q300 172 205 162 Q110 172 80 180Z" fill="${night ? '#141A26' : '#2E3438'}"/><rect x="90" y="240" width="230" height="10" fill="${night ? '#3A3028' : '#8C6A48'}"/>`);
    } else if (cat === 'camp') {
      e.push(`<path d="M140 252 L210 160 L280 252Z" fill="${night ? '#E8D9B8' : '#F4EEDF'}"/><path d="M200 252 L210 200 L222 252Z" fill="${win}"/>`);
      if (night) for (let i = 0; i < 40; i++) e.push(`<circle cx="${r() * 400}" cy="${r() * 130}" r="${r() * 1.4 + 0.3}" fill="#fff"/>`);
    } else {
      e.push(`<rect x="150" y="190" width="120" height="62" fill="${night ? '#5A4535' : '#8C5E3C'}"/><path d="M138 194 L210 140 L282 194Z" fill="${night ? '#1A1F2A' : '#3B2E28'}"/><rect x="168" y="206" width="30" height="24" fill="${win}"/><rect x="222" y="206" width="30" height="46" fill="${night ? '#3A2C22' : '#5E3E28'}"/>`);
    }
  }
  const sx = 60 + r() * 280, sy = 40 + r() * 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="1600" height="1200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="${sx}" cy="${sy}" r="${night ? 14 : 22}" fill="${night ? '#F2EEDC' : '#FFF6DA'}"/>${e.join('')}</svg>`;
}

const DEMO = [
  ['hanok', '서촌 담장 아래 작은 한옥', '서울', '종로구 누하동', 189000, 30000, 2, 1, 1, ['wifi', 'heat', 'kitchen', 'washer', 'tea'], '1930년대 도시형 한옥을 손본 집입니다. 대청마루에 앉으면 인왕산 능선이 담장 위로 걸리고, 아침에는 마당 감나무에 볕이 듭니다. 경복궁역에서 걸어서 9분, 골목 끝이라 밤이 조용해요.'],
  ['ocean', '애월 바다가 통창 가득한 집', '제주', '제주시 애월읍', 265000, 40000, 4, 2, 1, ['wifi', 'parking', 'kitchen', 'view', 'bbq', 'washer'], '거실 창 전체가 바다입니다. 해 질 녘에는 한림 쪽으로 해가 떨어져요. 해안도로까지 걸어서 2분, 카페 거리까지 차로 5분입니다.'],
  ['forest', '가평 잣나무숲 오두막', '가평', '가평군 상면', 158000, 25000, 3, 2, 1, ['parking', 'fire', 'bbq', 'heat', 'kitchen'], '잣나무 숲 한가운데 혼자 서 있는 오두막입니다. 밤에는 별이 많고 계곡물 소리가 들려요. 장작 난로와 장작 한 묶음을 기본으로 드립니다.'],
  ['city', '해운대 31층 하버뷰 스튜디오', '부산', '해운대구 우동', 142000, 20000, 2, 1, 1, ['wifi', 'parking', 'view', 'washer', 'ac', 'work'], '마린시티 야경과 광안대교가 한 번에 보이는 고층 스튜디오입니다. 해운대역 도보 6분, 지하 주차 1대 무료.'],
  ['pool', '남해 다랭이 언덕 프라이빗 풀빌라', '남해', '남해군 남면', 420000, 60000, 6, 3, 2, ['pool', 'parking', 'view', 'bbq', 'kitchen', 'washer', 'ac'], '다랭이논이 계단처럼 바다로 내려가는 언덕 위 독채 풀빌라입니다. 바비큐 그릴과 숯을 준비해 둡니다.'],
  ['hanok', '경주 황리단길 돌담 한옥', '경주', '경주시 황남동', 176000, 30000, 4, 2, 1, ['wifi', 'heat', 'tea', 'parking', 'washer'], '대릉원 돌담을 따라 걷다 보면 나오는 ㄱ자 한옥입니다. 툇마루에서 첨성대까지 걸어서 10분.'],
  ['ocean', '양양 서피비치 앞 서퍼 하우스', '양양', '양양군 현북면', 132000, 20000, 4, 2, 1, ['wifi', 'parking', 'shower', 'bbq', 'washer'], '해변까지 맨발로 30초. 보드 거치대와 야외 샤워가 있습니다.'],
  ['camp', '강릉 안반데기 별보기 글램핑', '강릉', '강릉시 왕산면', 119000, 15000, 2, 1, 1, ['parking', 'heat', 'bbq', 'fire'], '해발 1,100m 고랭지 배추밭 옆 벨텐트입니다. 맑은 날에는 은하수가 보여요. 전기 매트와 온풍기를 갖췄습니다.'],
  ['cabin', '전주 한옥마을 옆 정원 독채', '전주', '완산구 교동', 138000, 25000, 3, 2, 1, ['wifi', 'parking', 'kitchen', 'ac', 'washer'], '한옥마을 북문에서 3분. 작은 잔디 정원이 딸린 단층 독채입니다. 남부시장 야시장까지 걸어갈 수 있어요.'],
  ['ocean', '여수 돌산 바다 위 테라스 하우스', '여수', '여수시 돌산읍', 228000, 35000, 4, 2, 2, ['wifi', 'parking', 'view', 'bbq', 'kitchen', 'ac'], '테라스 끝이 바다 위로 나가 있는 2층 하우스입니다. 밤에는 돌산대교 조명이 잘 보여요.'],
  ['forest', '속초 설악 자락 통나무집', '속초', '속초시 설악동', 167000, 25000, 4, 2, 1, ['parking', 'fire', 'heat', 'sauna', 'kitchen'], '설악산 소공원 입구까지 차로 4분. 단풍철에는 창밖이 온통 붉어집니다. 벽난로와 사우나가 있어요.'],
  ['pool', '통영 미륵도 인피니티 풀 스테이', '통영', '통영시 산양읍', 356000, 50000, 4, 2, 2, ['pool', 'parking', 'view', 'ac', 'kitchen', 'washer'], '다도해 섬들이 수평선처럼 이어지는 인피니티 풀이 있는 스테이입니다. 달아공원 일몰 명소까지 차로 5분.'],
];

export async function seedDemo() {
  const has = await one('SELECT count(*)::int n FROM listings');
  if (has.n) return;
  const host = await one(`INSERT INTO users(provider, provider_id, name, role, host_agreed_at, phone, bio)
    VALUES ('demo','host','데모 호스트','host',now(),'010-0000-0000','서비스 시연용 예시 계정입니다.')
    ON CONFLICT (provider, provider_id) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
  let i = 0;
  for (const [cat, title, region, area, price, clean, guests, beds, baths, amen, desc] of DEMO) {
    i++;
    const [lat, lng] = REGION_COORDS[region];
    const l = await one(`INSERT INTO listings(host_id,title,description,category,region,area,address,lat,lng,price,cleaning_fee,max_guests,bedrooms,beds,baths,amenities,rules,status,instant_book)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'approved',$18) RETURNING id`,
      [host.id, title, desc + '\n\n※ 서비스 시연용 예시 숙소입니다. 실제로 예약되지 않아요.', cat, region, area, `${region} ${area} (예시 주소)`,
        lat + (i % 3) * 0.02, lng + (i % 2) * 0.02, price, clean, guests, beds, beds, baths, amen,
        '실내 금연\n반려동물 동반 불가\n밤 10시 이후 정숙', i % 4 === 0]);
    for (const [k, v] of [0, 1, 3, 2, 1].entries()) {
      const buf = await sharp(Buffer.from(sceneSvg(i + k * 31, cat, v))).webp({ quality: 80 }).toBuffer();
      const thumb = await sharp(buf).resize(640, 608, { fit: 'cover' }).webp({ quality: 74 }).toBuffer();
      await q('INSERT INTO listing_photos(listing_id, sort, data, thumb, width, height) VALUES ($1,$2,$3,$4,1600,1200)', [l.id, k + 1, buf, thumb]);
    }
  }
  console.log('예시 숙소 생성 완료');
}
