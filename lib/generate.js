// 홍보 글 생성 엔진
// 1) 내장 문구 엔진(한국어·영어, 비용 없음)  2) AI 연결(선택)  3) 구독 중인 AI에 붙여 넣을 요청문 만들기
// 원칙: 개발자 본인 시점으로 쓴다. 가짜 사용자 후기, 확인 안 된 수치, 타 앱 비방은 만들지 않는다.

const KINDS = [
  { key: 'blog_intro', label: '앱 소개글', group: 'blog', desc: '무엇을 하는 앱인지 처음부터 소개' },
  { key: 'blog_feature', label: '기능 하나 집중 소개', group: 'blog', desc: '기능 하나를 골라 자세히 — 기능 수만큼 새 글' },
  { key: 'blog_howto', label: '사용법 안내', group: 'blog', desc: '설치부터 사용까지 순서대로' },
  { key: 'blog_problem', label: '고민 해결형', group: 'blog', desc: '이럴 때 이렇게 쓰면 된다는 상황 중심 글' },
  { key: 'blog_update', label: '업데이트 소식', group: 'blog', desc: '바뀐 점 알림 (메모에 변경 내용 입력)' },
  { key: 'blog_devlog', label: '개발 이야기', group: 'blog', desc: '왜 만들었고 어떻게 만들었는지' },
  { key: 'sns_short', label: '짧은 SNS 글', group: 'sns', desc: 'X·블루스카이·스레드·마스토돈용 한두 문장' },
  { key: 'sns_caption', label: '인스타·페이스북 글', group: 'sns', desc: '캡션과 해시태그' },
  { key: 'community', label: '커뮤니티 소개글', group: 'etc', desc: '카페·커뮤니티 홍보 게시판용 담백한 글' },
  { key: 'shorts_script', label: '쇼츠 대본', group: 'etc', desc: '30초 화면 녹화 영상용 장면별 대본' },
  { key: 'press', label: '보도자료', group: 'etc', desc: '매체·뉴스레터 제보용' },
  { key: 'store_listing', label: '스토어 등록 문구', group: 'etc', desc: '앱 이름·간단한 설명·자세한 설명 초안' },
  { key: 'review_reply', label: '리뷰 답글 모음', group: 'etc', desc: '칭찬·불만·오류 제보·기능 요청별 답글' },
];
const KIND_MAP = Object.fromEntries(KINDS.map((k) => [k.key, k]));

const LANGS = [
  { key: 'ko', label: '한국어', native: true },
  { key: 'en', label: '영어', native: true },
  { key: 'ja', label: '일본어' },
  { key: 'zh-CN', label: '중국어(간체)' },
  { key: 'hi', label: '힌디어' },
  { key: 'es', label: '스페인어' },
  { key: 'de', label: '독일어' },
  { key: 'fr', label: '프랑스어' },
  { key: 'pt-BR', label: '포르투갈어(브라질)' },
  { key: 'id', label: '인도네시아어' },
];
const LANG_NAME = Object.fromEntries(LANGS.map((l) => [l.key, l.label]));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const stripHtml = (html) => String(html || '')
  .replace(/<\/(p|h[1-6]|li|div|ul|ol|blockquote)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<li[^>]*>/gi, '· ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n').trim();

// 한글 받침 여부로 조사 고르기
function josa(word, withBatchim, without) {
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? withBatchim : without;
  if (/[0-9]/.test(ch)) return /[013678]/.test(ch) ? withBatchim : without;
  if (/[a-zA-Z]/.test(ch)) return /[lmnLMN]/.test(ch) ? withBatchim : without;
  return without;
}

function view(app, lang) {
  const en = lang === 'en';
  const feats = (en && app.features_en?.length ? app.features_en : app.features) || [];
  return {
    en,
    name: (en && app.name_en) || app.name,
    tagline: (en && app.tagline_en) || app.tagline || '',
    desc: (en && app.description_en) || app.description || '',
    feats: feats.filter(Boolean),
    audience: app.audience || '',
    category: app.category || '',
    price: app.price || '무료',
    keywords: app.keywords || [],
  };
}

function hashtags(app, v, max = 8) {
  const base = [v.name, ...(v.keywords || []), v.category].filter(Boolean)
    .map((t) => String(t).replace(/[\s#]+/g, ''));
  const extra = v.en ? ['androidapp', 'indiedev'] : ['안드로이드앱', '앱추천', '1인개발'];
  return [...new Set([...base, ...extra])].filter(Boolean).slice(0, max);
}

// 기능 문구를 "제목 — 설명" 꼴로 나눔
function splitFeat(f) {
  const m = String(f).split(/\s*[:—–-]\s+|\s*:\s*/);
  return m.length > 1 ? { head: m[0].trim(), body: m.slice(1).join(' ').trim() } : { head: String(f).trim(), body: '' };
}

function cta(v, link) {
  if (!link) return '';
  const label = v.en ? `Get ${esc(v.name)} on Google Play` : `${esc(v.name)} 설치하러 가기`;
  return `<p><a href="${esc(link)}"><strong>${label}</strong></a></p>`;
}

// ---------- 한국어 ----------
const KO = {
  blog_intro(v, o) {
    const title = pick([
      `${v.name} — ${v.tagline || `${v.category || '안드로이드'} 앱을 직접 만들었습니다`}`,
      `직접 만든 ${v.category || '안드로이드'} 앱 ${v.name}${josa(v.name, '을', '를')} 소개합니다`,
      `${v.name}, 이런 분들을 위해 만들었습니다`,
    ]);
    const open = pick([
      `안녕하세요, ${v.name}${josa(v.name, '을', '를')} 만든 개발자입니다. 직접 만든 앱이라 장점만 늘어놓기보다는 무엇을 할 수 있고 어떤 분께 맞는지 있는 그대로 적어 보겠습니다.`,
      `${v.name}${josa(v.name, '은', '는')} 제가 필요해서 만들기 시작한 앱입니다. 만든 사람 입장에서 어떤 앱인지 차근차근 소개해 드립니다.`,
    ]);
    const feats = v.feats.map((f) => { const s = splitFeat(f); return `<li><strong>${esc(s.head)}</strong>${s.body ? ` — ${esc(s.body)}` : ''}</li>`; }).join('');
    const html = [
      `<p>${esc(open)}</p>`,
      `<h2>${esc(v.name)}${josa(v.name, '은', '는')} 어떤 앱인가요</h2>`,
      `<p>${esc(v.desc || v.tagline)}</p>`,
      feats ? `<h2>할 수 있는 일</h2><ul>${feats}</ul>` : '',
      v.audience ? `<h2>이런 분께 맞습니다</h2><p>${esc(v.audience)}</p>` : '',
      `<h2>가격과 설치</h2><p>${esc(v.name)}${josa(v.name, '은', '는')} 구글 플레이에서 받을 수 있고 가격은 ${esc(v.price)}입니다. 아래 링크에서 바로 설치할 수 있습니다.</p>`,
      cta(v, o.link),
      `<p>써 보시고 불편한 점이나 필요한 기능이 있으면 스토어 리뷰나 댓글로 알려 주세요. 혼자 만드는 앱이라 의견 하나하나가 다음 업데이트에 그대로 반영됩니다.</p>`,
    ].join('\n');
    return { title, html };
  },

  blog_feature(v, o) {
    if (!v.feats.length) return KO.blog_intro(v, o);
    const f = splitFeat(v.feats[o.focus % v.feats.length]);
    const title = pick([
      `${v.name} 기능 소개 — ${f.head}`,
      `${f.head}, ${v.name}에서는 이렇게 됩니다`,
      `${v.name}의 ${f.head} 기능을 자세히 설명합니다`,
    ]);
    const others = v.feats.filter((_, i) => i !== o.focus % v.feats.length).slice(0, 4)
      .map((x) => `<li>${esc(splitFeat(x).head)}</li>`).join('');
    const html = [
      `<p>${esc(v.name)}${josa(v.name, '을', '를')} 만든 개발자입니다. 오늘은 여러 기능 가운데 <strong>${esc(f.head)}</strong> 하나만 골라 자세히 적어 봅니다.</p>`,
      `<h2>${esc(f.head)}${josa(f.head, '이란', '란')}</h2>`,
      `<p>${esc(f.body || `${v.name}에서 가장 자주 쓰이는 기능 가운데 하나입니다.`)}</p>`,
      `<h2>이렇게 쓰면 됩니다</h2>`,
      `<ul><li>${esc(v.name)}${josa(v.name, '을', '를')} 열고 첫 화면에서 해당 메뉴를 찾습니다.</li><li>안내에 따라 필요한 항목을 고르거나 입력합니다.</li><li>결과를 확인하고, 필요하면 저장하거나 공유합니다.</li></ul>`,
      `<p>화면 구성은 버전에 따라 조금 달라질 수 있습니다. 헷갈리는 부분이 있으면 댓글로 물어봐 주세요.</p>`,
      `<h2>이 기능을 만든 이유</h2>`,
      `<p>${esc(v.audience ? `${v.audience} 분들이 가장 자주 하는 일을 줄여 드리고 싶었습니다.` : '직접 써 보면서 가장 번거로웠던 부분을 줄이고 싶었습니다.')} 단계를 줄이고 한 화면에서 끝나도록 만드는 데 가장 신경을 썼습니다.</p>`,
      others ? `<h2>함께 쓸 수 있는 다른 기능</h2><ul>${others}</ul>` : '',
      cta(v, o.link),
    ].join('\n');
    return { title, html };
  },

  blog_howto(v, o) {
    const title = pick([
      `${v.name} 사용법 — 설치부터 첫 사용까지`,
      `처음 쓰는 분을 위한 ${v.name} 안내`,
    ]);
    const steps = v.feats.slice(0, 5).map((f, i) => { const s = splitFeat(f); return `<h3>${i + 2}. ${esc(s.head)}</h3><p>${esc(s.body || `${s.head} 메뉴를 눌러 안내에 따라 진행합니다.`)}</p>`; }).join('\n');
    const html = [
      `<p>${esc(v.name)}${josa(v.name, '을', '를')} 처음 설치한 분이 헤매지 않도록, 만든 사람이 직접 순서대로 정리했습니다.</p>`,
      `<h2>시작하기</h2>`,
      `<h3>1. 설치</h3><p>구글 플레이에서 ${esc(v.name)}${josa(v.name, '을', '를')} 검색하거나 아래 링크로 들어가 설치합니다. 가격은 ${esc(v.price)}입니다.</p>`,
      cta(v, o.link),
      steps,
      `<h2>자주 묻는 질문</h2>`,
      `<h3>권한은 왜 필요한가요</h3><p>앱이 동작하는 데 꼭 필요한 권한만 요청합니다. 요청 화면에 사용 목적이 함께 표시되며, 설정에서 언제든 끌 수 있습니다.</p>`,
      `<h3>오류가 나면 어떻게 하나요</h3><p>앱을 최신 버전으로 업데이트한 뒤에도 같은 문제가 나면 스토어 리뷰나 개발자 이메일로 기기 이름과 상황을 알려 주세요. 확인하는 대로 고치겠습니다.</p>`,
    ].join('\n');
    return { title, html };
  },

  blog_problem(v, o) {
    const f = v.feats.length ? splitFeat(v.feats[o.focus % v.feats.length]) : { head: v.tagline, body: '' };
    const who = v.audience || `${v.category || '이런'} 앱을 찾던 분`;
    const title = pick([
      `${f.head}${josa(f.head, '이', '가')} 필요할 때 — ${v.name}${josa(v.name, '으로', '로')} 해결하는 방법`,
      `${who}께, ${v.name}${josa(v.name, '을', '를')} 만든 이유`,
    ]);
    const html = [
      `<p>${esc(who)}이라면 한 번쯤 겪는 상황이 있습니다. 필요한 순간에 맞는 도구가 없어서 여러 앱을 오가거나, 결국 손으로 처리하게 되는 경우입니다.</p>`,
      `<h2>이런 상황에서 씁니다</h2>`,
      `<p>${esc(f.body || v.desc || v.tagline)}</p>`,
      `<h2>${esc(v.name)}에서는</h2>`,
      `<p>${esc(v.name)}${josa(v.name, '은', '는')} 이 과정을 한 앱 안에서 끝내도록 만들었습니다. <strong>${esc(f.head)}</strong> 기능을 열고 안내대로 진행하면 됩니다.</p>`,
      v.feats.length > 1 ? `<h2>함께 되는 일</h2><ul>${v.feats.slice(0, 5).map((x) => `<li>${esc(splitFeat(x).head)}</li>`).join('')}</ul>` : '',
      `<h2>한계도 적어 둡니다</h2><p>혼자 만드는 앱이라 아직 부족한 부분이 있습니다. 써 보시고 안 되는 상황이 있으면 알려 주세요. 가능한 것부터 순서대로 넣고 있습니다.</p>`,
      cta(v, o.link),
    ].join('\n');
    return { title, html };
  },

  blog_update(v, o) {
    const title = `${v.name} 업데이트 안내`;
    const items = String(o.note || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const list = items.length
      ? `<ul>${items.map((x) => `<li>${esc(x.replace(/^[-·*]\s*/, ''))}</li>`).join('')}</ul>`
      : `<p>(여기에 이번에 바뀐 내용을 적어 주세요)</p>`;
    const html = [
      `<p>${esc(v.name)} 새 버전을 올렸습니다. 이번에 바뀐 내용을 정리합니다.</p>`,
      `<h2>바뀐 점</h2>`, list,
      `<h2>업데이트 방법</h2><p>구글 플레이에서 ${esc(v.name)} 페이지를 열면 업데이트 버튼이 보입니다. 자동 업데이트를 켜 두셨다면 따로 하실 일은 없습니다.</p>`,
      cta(v, o.link),
      `<p>보내 주신 의견을 바탕으로 고친 부분이 많습니다. 다음 버전에 넣었으면 하는 기능이 있으면 리뷰나 댓글로 남겨 주세요.</p>`,
    ].join('\n');
    return { title, html };
  },

  blog_devlog(v, o) {
    const title = pick([
      `${v.name}${josa(v.name, '을', '를')} 혼자 만들면서 배운 것`,
      `1인 개발 기록 — ${v.name}${josa(v.name, '은', '는')} 이렇게 만들었습니다`,
    ]);
    const html = [
      `<p>${esc(v.name)}${josa(v.name, '을', '를')} 만들고 운영하는 1인 개발자입니다. 홍보글이라기보다 만든 과정을 기록으로 남겨 둡니다.</p>`,
      `<h2>왜 만들었나</h2><p>${esc(o.note || v.desc || v.tagline)}</p>`,
      `<h2>가장 신경 쓴 부분</h2><p>${esc(v.feats[0] ? `${splitFeat(v.feats[0]).head} 기능입니다. 처음 쓰는 분도 설명 없이 쓸 수 있어야 한다는 기준으로 여러 번 고쳤습니다.` : '처음 쓰는 분도 설명 없이 쓸 수 있어야 한다는 기준으로 화면을 여러 번 고쳤습니다.')}</p>`,
      `<h2>어려웠던 점</h2><p>기기마다 화면 크기와 안드로이드 버전이 달라서 같은 기능도 다르게 보이는 문제가 가장 오래 걸렸습니다. 테스트 기기를 늘려 가며 하나씩 맞췄습니다.</p>`,
      `<h2>앞으로</h2><p>사용하시는 분들의 의견을 받아 우선순위를 정하고 있습니다. 써 보시고 느낀 점을 알려 주시면 큰 도움이 됩니다.</p>`,
      cta(v, o.link),
    ].join('\n');
    return { title, html };
  },

  sns_short(v, o) {
    const f = v.feats.length ? splitFeat(v.feats[o.focus % v.feats.length]).head : '';
    const body = pick([
      `${v.name}${josa(v.name, '을', '를')} 만들었습니다. ${v.tagline}`,
      f ? `${v.name}에 ${f} 기능이 있습니다. ${v.tagline}` : `${v.tagline} — ${v.name}`,
      `혼자 만든 ${v.category || '안드로이드'} 앱 ${v.name}. ${v.tagline}`,
    ]).trim();
    return { title: '', text: body };
  },

  sns_caption(v, o) {
    const lines = [
      `${v.name} — ${v.tagline}`, '',
      ...(v.feats.slice(0, 4).map((f) => `· ${splitFeat(f).head}`)), '',
      `구글 플레이에서 받을 수 있습니다 (${v.price})`,
      o.link ? `설치: ${o.link}` : '',
    ].filter((x) => x !== null);
    return { title: '', text: lines.join('\n').trim() };
  },

  community(v, o) {
    const title = `[직접 만든 앱] ${v.name} — ${v.tagline}`;
    const text = [
      `안녕하세요. ${v.category || '안드로이드'} 앱을 혼자 만들고 있는 개발자입니다.`,
      `홍보 글이 허용되는 게시판이라 직접 만든 앱 하나를 소개드립니다. 규정에 어긋나면 알려 주세요. 바로 내리겠습니다.`, '',
      `■ 앱 이름: ${v.name}`,
      `■ 한 줄 설명: ${v.tagline}`,
      `■ 가격: ${v.price}`, '',
      `■ 주요 기능`,
      ...v.feats.slice(0, 6).map((f) => `- ${splitFeat(f).head}`), '',
      v.audience ? `■ 이런 분께: ${v.audience}\n` : '',
      o.link ? `■ 설치: ${o.link}\n` : '',
      `써 보시고 아쉬운 점을 댓글로 남겨 주시면 다음 업데이트에 반영하겠습니다. 쓴소리도 환영합니다.`,
    ].filter((x) => x !== '').join('\n');
    return { title, text };
  },

  shorts_script(v, o) {
    const fs = v.feats.slice(0, 3).map((f) => splitFeat(f).head);
    const text = [
      `[0~3초] 화면: 불편한 상황을 한 컷으로`,
      `자막: "${fs[0] || v.tagline}, 아직도 번거롭게 하세요?"`, '',
      `[3~8초] 화면: ${v.name} 아이콘을 눌러 여는 장면`,
      `자막: "${v.name} 하나면 됩니다"`, '',
      ...fs.map((f, i) => `[${8 + i * 6}~${14 + i * 6}초] 화면: ${f} 실제 사용 화면 녹화\n자막: "${f}"\n`),
      `[마지막 4초] 화면: 구글 플레이 검색창에 "${v.name}" 입력`,
      `자막: "구글 플레이에서 ${v.name} 검색 (${v.price})"`, '',
      `촬영 팁: 휴대폰 화면 녹화로 실제 사용 장면만 이어 붙이면 됩니다. 세로 9:16, 자막은 화면 가운데 위쪽에 크게.`,
      `설명란: ${v.tagline}${o.link ? ` ${o.link}` : ''}`,
    ].join('\n');
    return { title: `${v.name} 쇼츠 대본 (약 30초)`, text };
  },

  press(v, o) {
    const title = `${v.name} 출시 — ${v.tagline}`;
    const text = [
      `[보도자료]`, '',
      title, '',
      `${v.category || '안드로이드'} 앱 '${v.name}'${josa(v.name, '이', '가')} 구글 플레이에 출시됐다. ${v.desc || v.tagline}`, '',
      `주요 기능은 다음과 같다.`,
      ...v.feats.slice(0, 5).map((f) => { const s = splitFeat(f); return `- ${s.head}${s.body ? `: ${s.body}` : ''}`; }), '',
      v.audience ? `개발자는 "${v.audience}의 불편을 줄이기 위해 만들었다"고 밝혔다.\n` : '',
      `${v.name}${josa(v.name, '은', '는')} 구글 플레이에서 내려받을 수 있으며 가격은 ${v.price}다.`,
      o.link ? `다운로드: ${o.link}` : '', '',
      `문의: (이메일을 적어 주세요)`,
    ].filter((x) => x !== '').join('\n').replace(/\n{3,}/g, '\n\n');
    return { title, text };
  },

  store_listing(v) {
    const name30 = `${v.name}${v.tagline ? ` - ${v.tagline}` : ''}`.slice(0, 30);
    const short80 = (v.tagline || v.desc).slice(0, 80);
    const text = [
      `■ 앱 이름 (30자 이내)`, name30, '',
      `■ 간단한 설명 (80자 이내)`, short80, '',
      `■ 자세한 설명`,
      v.desc || v.tagline, '',
      `[주요 기능]`,
      ...v.feats.map((f) => { const s = splitFeat(f); return `• ${s.head}${s.body ? ` — ${s.body}` : ''}`; }), '',
      v.audience ? `[이런 분께 추천합니다]\n${v.audience}\n` : '',
      `[문의]`, `사용 중 불편한 점이나 제안은 개발자 이메일로 보내 주세요. 빠르게 확인하겠습니다.`, '',
      `■ 점검할 것`,
      `- 가장 많이 검색될 낱말이 앱 이름과 간단한 설명에 들어갔는지`,
      `- 첫 스크린샷 한 장만 봐도 무슨 앱인지 알 수 있는지`,
      `- "최고", "1위", "무료" 같은 표현은 구글 정책상 이름·아이콘에 넣지 않기`,
    ].filter((x) => x !== '').join('\n');
    return { title: `${v.name} 스토어 등록 문구`, text };
  },

  review_reply(v) {
    const text = [
      `■ 칭찬 리뷰`,
      `소중한 리뷰 감사합니다. ${v.name}${josa(v.name, '을', '를')} 잘 써 주신다니 만드는 보람이 큽니다. 더 편하게 쓰실 수 있도록 계속 다듬겠습니다.`, '',
      `■ 불만 리뷰`,
      `불편을 드려 죄송합니다. 말씀해 주신 부분을 확인하고 있습니다. 사용하신 기기 이름과 어떤 화면에서 생긴 일인지 개발자 이메일로 알려 주시면 더 빨리 고칠 수 있습니다.`, '',
      `■ 오류 제보`,
      `알려 주셔서 감사합니다. 같은 문제를 재현해 보고 다음 업데이트에서 고치겠습니다. 고쳐지면 이 답글을 수정해 알려 드리겠습니다.`, '',
      `■ 기능 요청`,
      `좋은 제안 감사합니다. 요청하신 기능을 검토 목록에 올렸습니다. 넣을 수 있게 되면 업데이트 안내에 적겠습니다.`, '',
      `■ 별점만 낮고 내용이 없는 리뷰`,
      `리뷰 감사합니다. 어떤 점이 아쉬우셨는지 조금만 더 알려 주시면 고치는 데 큰 도움이 됩니다.`,
    ].join('\n');
    return { title: `${v.name} 리뷰 답글 모음`, text };
  },
};

// ---------- 영어 ----------
const EN = {
  blog_intro(v, o) {
    const title = pick([`${v.name} — ${v.tagline || 'an Android app I built'}`, `Introducing ${v.name}`]);
    const feats = v.feats.map((f) => { const s = splitFeat(f); return `<li><strong>${esc(s.head)}</strong>${s.body ? ` — ${esc(s.body)}` : ''}</li>`; }).join('');
    const html = [
      `<p>Hi, I'm the developer of ${esc(v.name)}. Since I built it myself, I'd rather describe plainly what it does and who it is for than oversell it.</p>`,
      `<h2>What ${esc(v.name)} does</h2><p>${esc(v.desc || v.tagline)}</p>`,
      feats ? `<h2>Features</h2><ul>${feats}</ul>` : '',
      `<h2>Price and install</h2><p>${esc(v.name)} is available on Google Play.</p>`,
      cta(v, o.link),
      `<p>I work on this alone, so every piece of feedback goes straight into the next update. Tell me what is missing.</p>`,
    ].join('\n');
    return { title, html };
  },
  blog_feature(v, o) {
    if (!v.feats.length) return EN.blog_intro(v, o);
    const f = splitFeat(v.feats[o.focus % v.feats.length]);
    const html = [
      `<p>I'm the developer of ${esc(v.name)}. Today I want to explain one feature in detail: <strong>${esc(f.head)}</strong>.</p>`,
      `<h2>What it is</h2><p>${esc(f.body || `One of the most used parts of ${v.name}.`)}</p>`,
      `<h2>How to use it</h2><ul><li>Open ${esc(v.name)} and find the feature on the first screen.</li><li>Follow the prompts and choose what you need.</li><li>Check the result, then save or share it.</li></ul>`,
      `<h2>Why I built it</h2><p>I wanted the task to finish on one screen with fewer steps.</p>`,
      cta(v, o.link),
    ].join('\n');
    return { title: `${v.name} feature guide — ${f.head}`, html };
  },
  blog_howto(v, o) {
    const steps = v.feats.slice(0, 5).map((f, i) => { const s = splitFeat(f); return `<h3>${i + 2}. ${esc(s.head)}</h3><p>${esc(s.body || `Open ${s.head} and follow the prompts.`)}</p>`; }).join('\n');
    const html = [
      `<p>A step-by-step guide to ${esc(v.name)}, written by the person who built it.</p>`,
      `<h3>1. Install</h3><p>Search for ${esc(v.name)} on Google Play or use the link below.</p>`, cta(v, o.link), steps,
      `<h2>Something not working?</h2><p>Update to the latest version first. If the problem remains, send me your device model and what happened, and I will fix it.</p>`,
    ].join('\n');
    return { title: `How to use ${v.name} — from install to first use`, html };
  },
  blog_problem(v, o) { return EN.blog_feature(v, o); },
  blog_update(v, o) {
    const items = String(o.note || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const list = items.length ? `<ul>${items.map((x) => `<li>${esc(x.replace(/^[-·*]\s*/, ''))}</li>`).join('')}</ul>` : `<p>(List what changed here)</p>`;
    return { title: `${v.name} update notes`, html: [`<p>A new version of ${esc(v.name)} is out. Here is what changed.</p>`, `<h2>What's new</h2>`, list, cta(v, o.link)].join('\n') };
  },
  blog_devlog(v, o) {
    const html = [
      `<p>I build and maintain ${esc(v.name)} on my own. This is less a promo post and more a record of how it was made.</p>`,
      `<h2>Why I built it</h2><p>${esc(o.note || v.desc || v.tagline)}</p>`,
      `<h2>The hardest part</h2><p>Devices differ in screen size and Android version, so the same feature can look different. I kept adding test devices until it held up.</p>`,
      `<h2>What's next</h2><p>I set priorities from user feedback, so tell me what you think.</p>`, cta(v, o.link),
    ].join('\n');
    return { title: `What I learned building ${v.name} alone`, html };
  },
  sns_short(v, o) {
    const f = v.feats.length ? splitFeat(v.feats[o.focus % v.feats.length]).head : '';
    return { title: '', text: pick([`I built ${v.name}. ${v.tagline}`, f ? `${v.name} now does ${f}. ${v.tagline}` : `${v.name} — ${v.tagline}`]).trim() };
  },
  sns_caption(v, o) {
    return { title: '', text: [`${v.name} — ${v.tagline}`, '', ...v.feats.slice(0, 4).map((f) => `· ${splitFeat(f).head}`), '', 'Available on Google Play', o.link ? `Install: ${o.link}` : ''].join('\n').trim() };
  },
  community(v, o) {
    const text = [
      `Hi, I'm a solo developer. Sharing an app I made — mods, please remove this if it breaks the rules.`, '',
      `Name: ${v.name}`, `What it does: ${v.tagline}`, '', 'Features:', ...v.feats.slice(0, 6).map((f) => `- ${splitFeat(f).head}`), '',
      o.link ? `Link: ${o.link}\n` : '', `Honest feedback is welcome, including the harsh kind.`,
    ].filter((x) => x !== '').join('\n');
    return { title: `[I made this] ${v.name} — ${v.tagline}`, text };
  },
  shorts_script(v, o) {
    const fs = v.feats.slice(0, 3).map((f) => splitFeat(f).head);
    const text = [
      `[0-3s] Screen: the annoying situation in one shot`, `Caption: "Still doing ${fs[0] || 'this'} the slow way?"`, '',
      `[3-8s] Screen: tapping the ${v.name} icon`, `Caption: "${v.name} handles it"`, '',
      ...fs.map((f, i) => `[${8 + i * 6}-${14 + i * 6}s] Screen: recording of ${f}\nCaption: "${f}"\n`),
      `[Last 4s] Screen: typing "${v.name}" into Google Play`, `Caption: "Search ${v.name} on Google Play"`, '',
      `Description: ${v.tagline}${o.link ? ` ${o.link}` : ''}`,
    ].join('\n');
    return { title: `${v.name} short video script (about 30s)`, text };
  },
  press(v, o) {
    const text = [`[Press release]`, '', `${v.name} is now available on Google Play. ${v.desc || v.tagline}`, '', 'Key features:', ...v.feats.slice(0, 5).map((f) => `- ${splitFeat(f).head}`), '', o.link ? `Download: ${o.link}` : '', '', 'Contact: (your email)'].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
    return { title: `${v.name} launches on Google Play — ${v.tagline}`, text };
  },
  store_listing(v) {
    const text = [`App name (max 30)`, `${v.name}${v.tagline ? ` - ${v.tagline}` : ''}`.slice(0, 30), '', `Short description (max 80)`, (v.tagline || v.desc).slice(0, 80), '', `Full description`, v.desc || v.tagline, '', '[Features]', ...v.feats.map((f) => `• ${splitFeat(f).head}`), '', '[Contact]', 'Send feedback to the developer email. I read every message.'].join('\n');
    return { title: `${v.name} store listing`, text };
  },
  review_reply(v) {
    const text = [
      `Positive review`, `Thank you for the kind words. Glad ${v.name} is useful to you. I'll keep improving it.`, '',
      `Negative review`, `Sorry for the trouble. I'm looking into it. If you can email me your device model and the screen where it happened, I can fix it faster.`, '',
      `Bug report`, `Thanks for reporting this. I'll reproduce it and ship a fix in the next update.`, '',
      `Feature request`, `Good suggestion, thank you. I've added it to the review list and will mention it in the release notes when it ships.`,
    ].join('\n');
    return { title: `${v.name} review replies`, text };
  },
};

function textToHtml(text) {
  return String(text || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

// 글 종류·대상에 맞춰 길이를 줄이고 링크·태그를 붙임
const SHORT_LIMITS = { x: 280, bluesky: 300, mastodon: 500, threads: 500, telegram: 1000, discord: 1900 };
function xLen(s) { let n = 0; for (const ch of String(s)) n += ch.charCodeAt(0) > 0x10ff ? 2 : 1; return n; }

function fitShort(text, link, tags, target) {
  const limit = SHORT_LIMITS[target] || 500;
  const measure = target === 'x' ? xLen : (s) => [...String(s)].length;
  const linkCost = link ? (target === 'x' ? 24 : measure(link) + 1) : 0;
  let tagStr = '';
  for (const t of tags.slice(0, 3)) {
    const next = `${tagStr} #${t}`.trim();
    if (measure(text) + linkCost + measure(next) + 2 <= limit) tagStr = next;
  }
  let body = text;
  while (measure(body) + linkCost + measure(tagStr) + 2 > limit && body.length > 10) body = body.slice(0, -2);
  if (body !== text) body = `${body.trimEnd()}…`;
  return [body, link, tagStr].filter(Boolean).join('\n');
}

function generateLocal(app, kind, lang, opts = {}) {
  const useLang = lang === 'en' ? 'en' : 'ko';
  const v = view(app, useLang);
  const set = useLang === 'en' ? EN : KO;
  const fn = set[kind] || set.blog_intro;
  const o = { link: opts.link || '', note: opts.note || '', focus: Number(opts.focus) || 0 };
  const out = fn(v, o);
  const tags = hashtags(app, v);
  let html = out.html;
  let text = out.text;
  if (kind === 'sns_short') text = fitShort(out.text, o.link, tags, opts.target);
  if (kind === 'sns_caption') text = `${out.text}\n\n${tags.map((t) => `#${t}`).join(' ')}`;
  if (!html) html = textToHtml(text);
  if (!text) text = stripHtml(html);
  return { title: out.title || '', html, text, tags, engine: 'template' };
}

// AI에게 보낼 요청문 (API 호출용이자, 구독 중인 AI 채팅에 붙여 넣는 용도)
function buildPrompt(app, kind, lang, opts = {}) {
  const k = KIND_MAP[kind] || KIND_MAP.blog_intro;
  const isBlog = k.group === 'blog';
  const limit = kind === 'sns_short' ? `본문은 ${SHORT_LIMITS[opts.target] ? Math.floor(SHORT_LIMITS[opts.target] * (opts.target === 'x' ? 0.4 : 0.7)) : 200}자 이내로.` : '';
  return [
    `너는 1인 개발자의 앱 홍보를 돕는 글쓴이다. 아래 앱 정보만 사용해서 "${k.label}"(${k.desc}) 글을 ${LANG_NAME[lang] || lang}로 써라.`,
    '',
    '[반드시 지킬 것]',
    '- 개발자 본인이 직접 쓰는 1인칭 글이다. 제3자 사용자인 척하는 후기, 지어낸 사용 경험담은 쓰지 않는다.',
    '- 앱 정보에 없는 기능, 다운로드 수, 순위, 수상 같은 사실을 지어내지 않는다.',
    '- 다른 앱을 깎아내리지 않는다. 과장 표현(최고, 혁신, 완벽)과 느낌표를 쓰지 않는다.',
    '- 해당 언어를 쓰는 사람이 읽기에 자연스러운 표현으로 쓴다. 번역투를 피한다.',
    isBlog ? '- 1,200~1,800자 분량. 소제목(h2)을 3~5개 두고, 검색하는 사람이 궁금해할 내용을 먼저 답한다.' : '',
    limit,
    opts.link ? `- 설치 링크는 반드시 이 주소를 그대로 쓴다: ${opts.link}` : '',
    opts.note ? `- 추가 메모(반드시 반영): ${opts.note}` : '',
    '',
    '[앱 정보]',
    `이름: ${app.name}${app.name_en ? ` (영문 ${app.name_en})` : ''}`,
    `한 줄 설명: ${app.tagline}`,
    `분류: ${app.category}`,
    `가격: ${app.price}`,
    `설명: ${app.description}`,
    `주요 기능:\n${(app.features || []).map((f) => `- ${f}`).join('\n')}`,
    `대상 사용자: ${app.audience}`,
    `검색어: ${(app.keywords || []).join(', ')}`,
    '',
    '[출력 형식] 아래 JSON 하나만 출력한다. 다른 말은 붙이지 않는다.',
    isBlog
      ? '{"title": "제목", "html": "<p>…</p><h2>…</h2> 형태의 본문 HTML (h2, h3, p, ul, li, strong, a 태그만 사용)", "tags": ["태그", "5~8개"]}'
      : '{"title": "제목(필요 없으면 빈 문자열)", "text": "본문 전체(줄바꿈은 \\n)", "tags": ["태그", "3~8개"]}',
  ].filter((x) => x !== '').join('\n');
}

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

// AI 응답(또는 사용자가 붙여 넣은 결과)을 글 형태로 해석
function parseAiOutput(raw, kind) {
  const s = String(raw || '').trim();
  let obj = null;
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { obj = JSON.parse(m[0]); } catch {} }
  if (!obj) {
    const lines = s.split('\n');
    const first = lines[0].replace(/^(제목|title)\s*[:：]\s*/i, '').replace(/^#+\s*/, '');
    obj = { title: first, text: lines.slice(1).join('\n').trim() || s, tags: [] };
  }
  const html = obj.html ? sanitizeHtml(obj.html) : textToHtml(obj.text || '');
  const text = obj.text ? String(obj.text) : stripHtml(html);
  const tags = Array.isArray(obj.tags) ? obj.tags.map((t) => String(t).replace(/^#/, '').replace(/\s+/g, '')).filter(Boolean).slice(0, 10) : [];
  return { title: String(obj.title || ''), html, text, tags, engine: 'ai', kind };
}

async function callAi(ai, prompt) {
  const { provider, apiKey, model } = ai || {};
  if (!apiKey) throw new Error('AI 키가 설정되지 않았습니다');
  const signal = AbortSignal.timeout(90000);
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `AI 오류 ${r.status}`);
    return (j.content || []).map((c) => c.text || '').join('');
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `AI 오류 ${r.status}`);
    return j.choices?.[0]?.message?.content || '';
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || `AI 오류 ${r.status}`);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }
  throw new Error('지원하지 않는 AI 종류입니다');
}

async function generate(app, kind, lang, opts = {}, ai = null) {
  const nativeLang = lang === 'ko' || lang === 'en';
  const wantAi = ai?.apiKey && opts.engine !== 'template';
  if (wantAi) {
    const raw = await callAi(ai, buildPrompt(app, kind, lang, opts));
    const out = parseAiOutput(raw, kind);
    if (kind === 'sns_short') out.text = fitShort(out.text.replace(/https?:\/\/\S+/g, '').replace(/#\S+/g, '').trim(), opts.link, out.tags, opts.target);
    if (kind === 'sns_short') out.html = textToHtml(out.text);
    return out;
  }
  if (!nativeLang) {
    const err = new Error(`${LANG_NAME[lang] || lang} 글은 AI 연결이 있어야 자동으로 만들 수 있습니다. 설정에서 AI 키를 넣거나, "AI 요청문 복사"로 구독 중인 AI에 붙여 넣어 만드세요.`);
    err.code = 'NEED_AI';
    throw err;
  }
  return generateLocal(app, kind, lang, opts);
}

module.exports = { KINDS, KIND_MAP, LANGS, LANG_NAME, generate, generateLocal, buildPrompt, parseAiOutput, stripHtml, textToHtml, sanitizeHtml, esc, fitShort, SHORT_LIMITS };
