/* 스테이온 관리자 콘솔 — 관리자 계정으로 로그인했을 때만 불러온다. 데이터 보호는 서버(/api/admin)가 한다. */
window.SOAdmin = (() => {
'use strict';
let root, X, api, toast, confirmBox, esc, won;
const $ = (s, r=document) => r.querySelector(s);
const p2 = n => String(n).padStart(2,'0');
const WD = ['일','월','화','수','목','금','토'];
const TYPES = ['호텔/리조트','모텔','펜션/풀빌라','게하/한옥','캠핑/글램핑'];
const SIDO = ['서울','경기','인천','강원','부산','경상','제주','전라','충청'];
const AMEN = ['무료주차','수영장','조식','바베큐','와이파이','스파/월풀','반려견동반','취사가능','넷플릭스','오션뷰'];
const TAGS = ['이번주특가','신축/리모델링','즉시할인','신규'];
const STATUS = {pending:'결제대기', wait:'입금대기', ok:'예약확정', done:'이용완료', cancel:'취소'};
const STCLS = {pending:'wait', wait:'wait', ok:'ok', done:'done', cancel:'cancel'};
const PAY = {card:'카드', bank:'무통장', site:'현장결제', points:'포인트'};
const PST = {ready:'결제 전', paid:'결제완료', failed:'실패', cancelled:'취소·환불', partial_cancelled:'부분환불', refund_pending:'환불 대기', kept:'환불 없음(규정)'};
const PKIND = {signup:'가입 축하', earn:'적립', use:'사용', use_cancel:'사용 취소', earn_cancel:'적립 취소', admin_add:'관리자 지급', admin_sub:'관리자 차감', expire:'소멸'};
const SLOTS = {home:{name:'홈 상단 슬라이드', size:'1200×500px', where:'홈 검색창 아래, 여러 개면 좌우로 넘김'}, list:{name:'숙소 목록 중간', size:'1200×400px', where:'검색 결과 3번째 숙소 다음'}, detail:{name:'숙소 상세', size:'1200×400px', where:'숙소 상세의 이용 안내 위'}};
const sv = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const IC = {
  dash: sv('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'), book: sv('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  pay: sv('<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>'), inv: sv('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0"/>'),
  place: sv('<path d="M4 20V6l8-3 8 3v14M4 20h16M9 20v-4h6v4M8 8h1M11.5 8h1M15 8h1"/>'), member: sv('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.5c2 .8 3.2 2.6 3.5 5.5"/>'),
  point: sv('<circle cx="12" cy="12" r="8.5"/><path d="M10 16V8h3a2.5 2.5 0 010 5h-3"/>'), review: sv('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'),
  ad: sv('<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M7 14l2.5-6 2.5 6M7.8 12h3.4M15 8v6h1.5a2 2 0 002-2v-2a2 2 0 00-2-2z"/>'),
  set: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/>'),
  log: sv('<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/>'), out: sv('<path d="M9 21H5a1 1 0 01-1-1V4a1 1 0 011-1h4M16 17l5-5-5-5M21 12H9"/>'),
  close: sv('<path d="M6 6l12 12M18 6L6 18"/>'), prev: sv('<path d="M15 5l-7 7 7 7"/>'), next: sv('<path d="M9 5l7 7-7 7"/>'),
  bolt: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>'
};
const SECS = [['dash','대시보드',IC.dash],['bookings','예약',IC.book],['payments','결제·환불',IC.pay],['inventory','요금·재고',IC.inv],['places','숙소·객실',IC.place],['members','회원',IC.member],['points','포인트',IC.point],['reviews','후기',IC.review],['ads','광고 배너',IC.ad],['settings','설정',IC.set],['audit','활동 기록',IC.log]];

const S = { sec:'dash', bq:{status:'all', q:'', place:'', from:'', to:'', page:1}, mq:{q:'', status:'all', page:1}, rv:'all', adDays:30, pk:'all', pm:{status:'all', method:'all'},
  inv:{room:null, month:null, sel:[]}, data:{}, waits:0 };
const fmtDT = iso => { if(!iso) return '-'; const d = new Date(iso); return `${d.getFullYear()}.${p2(d.getMonth()+1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtD = s => s ? String(s).slice(0,10).replace(/-/g,'.') : '-';
const ymd = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const short = v => v >= 1e8 ? (v/1e8).toFixed(1).replace('.0','')+'억' : v >= 1e4 ? (Math.round(v/1e3)/10).toString().replace(/\.0$/,'')+'만' : won(v);
const stTag = s => `<span class="st ${STCLS[s]||'done'}">${STATUS[s]||s}</span>`;
const ctr = (c,i) => i ? (c/i*100).toFixed(1)+'%' : '-';
const qs = o => new URLSearchParams(Object.entries(o).filter(([,v])=>v!==''&&v!=null)).toString();
const img = id => id ? '/img/' + encodeURIComponent(id) : '';

function niceMax(v){ if (v<=0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1,2,2.5,5,10]) if (m*p >= v) return m*p; return 10*p; }
function bars(data, fmt, tip){
  const top = niceMax(Math.max(0, ...data.map(d=>d.v)));
  return `<div class="bc" role="img" aria-label="${esc(data.map(d=>d.label+' '+tip(d.v)).join(', '))}">
    <div class="bc-y tnum">${[top, top/2, 0].map(t=>`<span>${fmt(t)}</span>`).join('')}</div>
    <div class="bc-plot"><div class="bc-area"><i class="gl" style="bottom:100%"></i><i class="gl" style="bottom:50%"></i><i class="gl base" style="bottom:0"></i>
      <div class="bc-bars">${data.map(d=>`<div class="bc-col" tabindex="0" data-tip="${esc(d.label)} · ${esc(tip(d.v))}"><div class="bc-bar" style="height:${d.v/top*100}%"></div><span class="bc-x">${esc(d.short)}</span></div>`).join('')}</div></div></div></div>
    <details class="tblv"><summary>표로 보기</summary><table class="tbl"><tbody>${data.map(d=>`<tr><td>${esc(d.label)}</td><td class="r tnum">${esc(tip(d.v))}</td></tr>`).join('')}</tbody></table></details>`;
}

/* ---------- 틀 ---------- */
function frame(body){
  const st = X.set();
  root.innerHTML = `<div class="adm">
    <aside class="side" aria-label="관리 메뉴">
      <div class="sbrand"><i>${IC.bolt}</i><div>${esc(st.brand)}<small>관리자 콘솔</small></div></div>
      ${SECS.map(([k,l,ic])=>`<button class="${S.sec===k?'on':''}" data-x="sec" data-v="${k}">${ic}<span>${l}</span>${k==='bookings'&&S.waits?`<em class="tnum">${S.waits}</em>`:''}</button>`).join('')}
      <div class="sgap"></div>
      <button data-x="exit">${IC.out}<span>고객 화면으로</span></button>
    </aside>
    <main class="amain" id="amain">${body}</main></div>`;
}
async function show(sec){
  if (sec) S.sec = sec;
  frame(`<div class="empty">불러오는 중…</div>`);
  try { $('#amain').innerHTML = await SEC[S.sec](); after(); }
  catch (e) { $('#amain').innerHTML = `<div class="empty"><b>불러오지 못했습니다</b>${esc(e.message)}</div>`; }
}
async function refresh(){ const y = window.scrollY; try { $('#amain').innerHTML = await SEC[S.sec](); after(); window.scrollTo(0,y); } catch(e){ toast(e.message); } }
function after(){ document.body.classList.add('wide'); }

/* ---------- 대시보드 ---------- */
const SEC = {};
SEC.dash = async () => {
  const d = await api('GET','/api/admin/dashboard'); S.waits = d.kpi.waits;
  const k = d.kpi, t = d.today;
  const months = []; for (let i=5;i>=0;i--){ const x = new Date(t+'T00:00:00'); x.setDate(1); x.setMonth(x.getMonth()-i); const key = `${x.getFullYear()}-${p2(x.getMonth()+1)}`; const m = d.months.find(r=>r.k===key); months.push({label:`${x.getFullYear()}년 ${x.getMonth()+1}월`, short:`${x.getMonth()+1}월`, v: m?m.v:0}); }
  const days = []; for (let i=13;i>=0;i--){ const x = new Date(t+'T00:00:00'); x.setDate(x.getDate()-i); const key = ymd(x); const m = d.days.find(r=>r.k===key); days.push({label:`${x.getMonth()+1}/${x.getDate()} (${WD[x.getDay()]})`, short:String(x.getDate()), v: m?m.n:0}); }
  const occ = d.occ.stock ? Math.round(d.occ.used/d.occ.stock*100) : 0;
  return `<div class="ah"><h2>대시보드</h2><span class="note tnum">${fmtD(t)} 기준 · ${d.pay.test?'<b style="color:var(--warn)">테스트 결제 모드</b>':'실결제 '+esc(d.pay.provider)}</span></div>
    <div class="kpis tnum">
      <div class="kpi"><small>이번달 결제 매출</small><b>${won(k.month_sales)}<em>원</em></b><span>${k.month_cnt}건 · 포인트 ${won(k.month_points)}P 별도</span></div>
      <div class="kpi ${k.waits?'hot':''}"><small>입금 확인 대기</small><b>${k.waits}<em>건</em></b><span>${k.pendings?`카드 결제 진행 중 ${k.pendings}건`:'카드 결제 진행 중 없음'}</span></div>
      <div class="kpi ${d.payments.refund_pending?'hot':''}"><small>무통장 환불 대기</small><b>${d.payments.refund_pending}<em>건</em></b><span>결제·환불 메뉴에서 처리</span></div>
      <div class="kpi"><small>오늘 객실 점유율</small><b>${occ}<em>%</em></b><span>${d.occ.used} / ${d.occ.stock}실</span></div>
      <div class="kpi"><small>회원</small><b>${won(d.members.total)}<em>명</em></b><span>최근 30일 +${d.members.new30}명</span></div>
      <div class="kpi"><small>광고 (30일)</small><b>${won(d.ads.clk)}<em>클릭</em></b><span>노출 ${won(d.ads.imp)} · 클릭률 ${ctr(d.ads.clk,d.ads.imp)} · 진행 ${d.ads.live}개</span></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>월별 결제 매출 <span class="note">최근 6개월 · 예약일 기준 · 취소 제외</span></h3>${bars(months, short, v=>won(v)+'원')}</div>
      <div class="panel"><h3>일별 예약 건수 <span class="note">최근 14일</span></h3>${bars(days, v=>String(Math.round(v)), v=>v+'건')}</div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>입금 확인 대기 <button class="linkbtn" data-x="goBookings" data-v="wait">전체 보기</button></h3>
        ${d.waits.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${d.waits.map(b=>`<tr class="click" data-x="booking" data-v="${b.id}"><td><b>${esc(b.guest_name)}</b><br><span class="note">${esc(b.phone)}</span></td><td>${esc(b.place_name)}<br><span class="note tnum">${fmtD(b.check_in)} · ${fmtDT(b.created_at).slice(5)} 예약</span></td><td class="r tnum"><b>${won(b.amount_due)}원</b></td><td class="r"><button class="btn sm" data-x="setStatus" data-v="ok" data-id="${b.id}">입금확인</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="note">대기 중인 예약이 없습니다.</p>`}</div>
      <div class="panel"><h3>오늘·내일 체크인</h3>
        ${d.ins.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${d.ins.map(b=>`<tr class="click" data-x="booking" data-v="${b.id}"><td><span class="st ${b.check_in===t?'ok':'done'}">${b.check_in===t?'오늘':'내일'}</span></td><td><b>${esc(b.guest_name)}</b> · ${b.adults+b.children}명<br><span class="note">${esc(b.place_name)} ${esc(b.room_name)}</span></td><td class="r">${stTag(b.status)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">예정된 체크인이 없습니다.</p>`}</div>
    </div>
    <div class="panel"><h3>숙소별 매출 순위 <span class="note">전체 기간 · 객실요금 기준 · 취소 제외</span></h3>
      ${d.rank.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>숙소</th><th class="r">예약</th><th class="r">매출</th></tr></thead><tbody>${d.rank.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.name)}</td><td class="r tnum">${x.n}건</td><td class="r tnum"><b>${won(x.v)}원</b></td></tr>`).join('')}</tbody></table></div>` : `<p class="note">아직 예약이 없습니다.</p>`}</div>`;
};

/* ---------- 예약 ---------- */
const bkActs = b => `${b.status==='wait'?`<button class="btn sm" data-x="setStatus" data-v="ok" data-id="${b.id}">입금확인</button>`:''}${b.status==='ok'?`<button class="btn sm soft" data-x="setStatus" data-v="done" data-id="${b.id}">이용완료</button>`:''}`;
SEC.bookings = async () => {
  const [d, pl] = await Promise.all([api('GET','/api/admin/bookings?'+qs(S.bq)), S.data.places ? Promise.resolve(S.data.places) : api('GET','/api/admin/places')]);
  S.data.places = pl; S.waits = d.counts.wait || 0;
  const c = d.counts, all = Object.values(c).reduce((a,b)=>a+b,0), pages = Math.max(1, Math.ceil(d.total/d.size));
  return `<div class="ah"><h2>예약</h2><a class="btn sm ghost" href="/api/admin/bookings.csv?${qs({...S.bq, page:''})}" style="display:inline-flex;align-items:center;text-decoration:none">CSV 내려받기</a></div>
    <div class="chips flat">${[['all','전체',all],['pending','결제대기',c.pending||0],['wait','입금대기',c.wait||0],['ok','예약확정',c.ok||0],['done','이용완료',c.done||0],['cancel','취소',c.cancel||0]].map(([k,l,n])=>`<button class="chip ${S.bq.status===k?'on':''}" data-x="bqStatus" data-v="${k}">${l} ${n}</button>`).join('')}</div>
    <form class="toolbar" data-af="bq">
      <input class="in" name="q" placeholder="예약번호, 이름, 전화번호, 숙소" value="${esc(S.bq.q)}" style="flex:2 1 220px" aria-label="검색어">
      <select class="in" name="place" style="flex:1 1 160px" aria-label="숙소"><option value="">전체 숙소</option>${pl.places.map(p=>`<option value="${p.id}" ${String(S.bq.place)===String(p.id)?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <span class="note nowrap">체크인</span><input class="in" type="date" name="from" value="${esc(S.bq.from)}" aria-label="체크인 시작"><span>~</span><input class="in" type="date" name="to" value="${esc(S.bq.to)}" aria-label="체크인 끝">
      <button class="btn sm" type="submit">검색</button>${S.bq.q||S.bq.place||S.bq.from||S.bq.to?`<button class="btn sm ghost" type="button" data-x="bqReset">초기화</button>`:''}
    </form>
    <p class="note tnum" style="margin:6px 0 10px">${won(d.total)}건 · 결제금액 합계 ${won(d.sum)}원 (취소 제외)</p>
    ${d.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>예약번호</th><th>상태</th><th>숙소 / 객실</th><th>일정</th><th>예약자</th><th>결제</th><th class="r">결제금액</th><th>예약일</th><th></th></tr></thead><tbody>
      ${d.rows.map(b=>`<tr class="click" data-x="booking" data-v="${b.id}"><td class="tnum nowrap">${esc(b.code)}</td><td>${stTag(b.status)}</td><td>${esc(b.place_name)}<br><span class="note">${esc(b.room_name)}</span></td><td class="tnum nowrap">${fmtD(b.check_in)}<br><span class="note">${b.nights}박 · ${b.adults+b.children}명</span></td><td class="nowrap"><b>${esc(b.guest_name)}</b><br><span class="note">${esc(b.phone)}</span></td><td class="nowrap">${PAY[b.pay_method]}${b.points_used?`<br><span class="note">+${won(b.points_used)}P</span>`:''}</td><td class="r tnum nowrap">${won(b.amount_due)}원</td><td class="tnum nowrap note">${fmtDT(b.created_at).slice(2)}</td><td class="r nowrap">${bkActs(b)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="pager">${S.bq.page>1?`<button class="btn sm ghost" data-x="bqPage" data-v="${S.bq.page-1}">이전</button>`:''}<span class="tnum">${S.bq.page} / ${pages}</span>${S.bq.page<pages?`<button class="btn sm ghost" data-x="bqPage" data-v="${S.bq.page+1}">다음</button>`:''}</div>` : `<div class="empty">조건에 맞는 예약이 없습니다.</div>`}`;
};
async function bookingDrawer(id){
  const b = await api('GET','/api/admin/bookings/'+id);
  const pv = b.preview;
  drawer(`예약 ${b.code}`, `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">${stTag(b.status)}<span class="note">${fmtDT(b.created_at)} 예약</span></div>
    <dl class="kv2 tnum"><dt>숙소</dt><dd>${esc(b.place_name)} · ${esc(b.room_name)}</dd><dt>일정</dt><dd>${fmtD(b.check_in)} ~ ${fmtD(b.check_out)} (${b.nights}박)</dd><dt>인원</dt><dd>성인 ${b.adults}${b.children?`, 아동 ${b.children}`:''}</dd>
      <dt>예약자</dt><dd><b>${esc(b.guest_name)}</b> · <span style="user-select:all">${esc(b.phone)}</span></dd><dt>회원</dt><dd>${b.user_id?`${esc(b.user_name||'')} ${esc(b.user_email||'')} <button class="linkbtn" data-x="member" data-v="${b.user_id}">회원 보기</button>`:'-'}</dd>
      <dt>방문</dt><dd>${esc(b.visit)}</dd><dt>요청사항</dt><dd>${esc(b.request||'-')}</dd>
      <dt>객실요금</dt><dd>${won(b.total)}원 ${b.lines.map(l=>`<span class="note">${l.date.slice(5)} ${won(l.price)}</span>`).join(' ')}</dd><dt>포인트</dt><dd>${won(b.points_used)}P 사용${b.points_earned?` · ${won(b.points_earned)}P 적립`:''}</dd>
      <dt>결제</dt><dd><b>${PAY[b.pay_method]} ${won(b.amount_due)}원</b></dd>
      ${b.status==='cancel'?`<dt>취소</dt><dd>${esc(b.cancel_reason)} (${esc(b.cancelled_by)}) · 환불 ${won(b.refund_amount)}원 · 포인트 ${won(b.refund_points)}P 반환</dd>`:''}</dl>
    <h4 style="margin:20px 0 8px">결제 기록</h4>
    ${b.payments.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${b.payments.map(p=>`<tr><td class="tnum nowrap">${esc(p.order_id)}<br><span class="note">${esc(p.provider)}</span></td><td>${esc(PST[p.status]||p.status)}${p.fail_reason?`<br><span class="note">${esc(p.fail_reason)}</span>`:''}</td><td class="r tnum">${won(p.amount)}원${p.cancelled_amount?`<br><span class="note">환불 ${won(p.cancelled_amount)}</span>`:''}</td><td>${p.receipt_url?`<a class="linkbtn" href="${esc(p.receipt_url)}" target="_blank" rel="noopener">영수증</a>`:''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="note">결제 기록 없음</p>`}
    <h4 style="margin:20px 0 8px">관리 메모</h4>
    <form data-af="memo" data-id="${b.id}"><textarea class="in" name="admin_memo" style="min-height:80px">${esc(b.admin_memo)}</textarea><button class="btn sm" type="submit" style="margin-top:6px">메모 저장</button></form>
    ${b.status!=='cancel'?`<h4 style="margin:24px 0 8px">처리</h4><div class="acts">${bkActs(b)}</div>
      <div class="hint" style="margin-top:12px">취소 시 환불: <b>규정대로</b> ${pv.rate}% (결제 ${won(pv.paid)}원 → ${won(Math.round(pv.paid*pv.rate/100))}원, 포인트 ${won(Math.floor(b.points_used*pv.rate/100))}P 반환)${pv.manual?'<br>무통장 결제는 취소 후 직접 계좌로 환불하고 결제·환불 메뉴에서 완료 처리하세요.':''}</div>
      <div class="acts"><button class="btn sm danger" data-x="cancelBk" data-v="policy" data-id="${b.id}">규정대로 취소</button><button class="btn sm danger" data-x="cancelBk" data-v="full" data-id="${b.id}">전액 환불 취소</button><button class="btn sm ghost" data-x="cancelBk" data-v="none" data-id="${b.id}">환불 없이 취소</button></div>`:''}`);
}

/* ---------- 결제·환불 ---------- */
SEC.payments = async () => {
  const d = await api('GET','/api/admin/payments?'+qs(S.pm));
  return `<div class="ah"><h2>결제·환불</h2></div>
    <div class="kpis tnum"><div class="kpi"><small>결제 순액 (전체)</small><b>${won(d.sums.net)}<em>원</em></b><span>환불 제외</span></div>
      <div class="kpi ${d.sums.refund_pending?'hot':''}"><small>무통장 환불 대기</small><b>${d.sums.refund_pending}<em>건</em></b><span>계좌로 보낸 뒤 '환불 완료'</span></div>
      <div class="kpi"><small>PG 연결</small><b style="font-size:17px">${d.pay.test?'테스트 모드':esc(d.pay.provider)}</b><span>${d.pay.ready?'결제 가능':'키 설정 필요'}</span></div></div>
    <div class="chips flat" style="margin-top:14px">${[['all','전체'],['paid','결제완료'],['refund_pending','환불 대기'],['cancelled','취소·환불'],['partial_cancelled','부분환불'],['failed','실패'],['ready','결제 전']].map(([k,l])=>`<button class="chip ${S.pm.status===k?'on':''}" data-x="pmStatus" data-v="${k}">${l}</button>`).join('')}</div>
    ${d.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>주문번호</th><th>예약</th><th>수단</th><th>상태</th><th class="r">금액</th><th class="r">환불</th><th>일시</th><th></th></tr></thead><tbody>
      ${d.rows.map(p=>`<tr><td class="tnum nowrap">${esc(p.order_id)}</td><td class="click" data-x="booking" data-v="${p.booking_id}"><b>${esc(p.guest_name)}</b><br><span class="note">${esc(p.place_name)}</span></td><td>${PAY[p.method]||p.method}<br><span class="note">${esc(p.provider)}</span></td><td>${esc(PST[p.status]||p.status)}${p.fail_reason?`<br><span class="note">${esc(p.fail_reason)}</span>`:''}</td><td class="r tnum">${won(p.amount)}원</td><td class="r tnum">${p.cancelled_amount?won(p.cancelled_amount)+'원':'-'}</td><td class="tnum note nowrap">${fmtDT(p.paid_at||p.created_at).slice(2)}</td><td class="r">${p.status==='refund_pending'?`<button class="btn sm" data-x="refunded" data-v="${p.id}">환불 완료</button>`:p.receipt_url?`<a class="linkbtn" href="${esc(p.receipt_url)}" target="_blank" rel="noopener">영수증</a>`:''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">결제 기록이 없습니다.</div>`}`;
};

/* ---------- 요금·재고 ---------- */
SEC.inventory = async () => {
  const pl = await api('GET','/api/admin/places'); S.data.places = pl;
  const rooms = pl.rooms.filter(r => pl.places.some(p=>p.id===r.place_id));
  if (!rooms.length) return `<div class="ah"><h2>요금·재고</h2></div><div class="empty">객실을 먼저 등록하세요.</div>`;
  if (!S.inv.room || !rooms.some(r=>r.id===S.inv.room)) S.inv.room = rooms[0].id;
  const now = new Date(); if (!S.inv.month) S.inv.month = `${now.getFullYear()}-${p2(now.getMonth()+1)}`;
  const d = await api('GET', `/api/admin/inventory?room=${S.inv.room}&month=${S.inv.month}`);
  const r = d.room, map = Object.fromEntries(d.nights.map(n=>[n.night, n]));
  const [y, m] = S.inv.month.split('-').map(Number), first = new Date(y, m-1, 1), dim = new Date(y, m, 0).getDate(), t = ymd(new Date());
  let cells = ''; for (let i=0;i<first.getDay();i++) cells += '<span></span>';
  for (let dd=1; dd<=dim; dd++) {
    const s = `${y}-${p2(m)}-${p2(dd)}`, n = map[s] || {}, wk = new Date(y,m-1,dd).getDay();
    const price = n.price != null ? n.price : ((wk===5||wk===6) && r.weekend_price ? r.weekend_price : r.price), used = n.booked||0;
    cells += `<button class="ivd ${S.inv.sel.includes(s)?'sel':''} ${n.closed?'closed':''} ${used>=r.stock?'full':''} ${wk===0?'sun':''}" data-x="invDay" data-v="${s}" ${s<t?'disabled':''} aria-pressed="${S.inv.sel.includes(s)}"><span class="d">${dd}</span><span class="pr tnum ${n.price!=null?'ov':''}">${n.closed?'판매중지':short(price)}</span><span class="us tnum">${used}/${r.stock}</span></button>`;
  }
  const n = S.inv.sel.length;
  return `<div class="ah"><h2>요금·재고</h2></div>
    <div class="toolbar"><select class="in" id="invRoom" style="flex:1 1 280px" aria-label="객실">${rooms.map(x=>`<option value="${x.id}" ${x.id===r.id?'selected':''}>${esc((pl.places.find(p=>p.id===x.place_id)||{}).name)} · ${esc(x.name)}</option>`).join('')}</select>
      <div class="monthnav"><button class="ib" data-x="invMonth" data-v="-1" aria-label="이전 달">${IC.prev}</button><b class="tnum">${y}년 ${m}월</b><button class="ib" data-x="invMonth" data-v="1" aria-label="다음 달">${IC.next}</button></div></div>
    <p class="note" style="margin:8px 0 12px;line-height:1.7">기본 요금 평일 ${won(r.price)}원 · 주말(금·토) ${won(r.weekend_price||r.price)}원 · 객실 ${r.stock}실. 날짜를 눌러 여러 날을 고른 뒤 아래에서 적용하세요. <span class="ovk">파란 요금</span>은 직접 지정한 요금, 아래 숫자는 예약/객실 수입니다.</p>
    <div class="ivcal"><div class="ivwk">${WD.map(w=>`<span>${w}</span>`).join('')}</div><div class="ivgrid">${cells}</div></div>
    <div class="selbar"><span class="tnum"><b>${n}</b>일 선택</span>
      <button class="btn sm ghost" data-x="invPick" data-v="weekend">이 달 금·토</button><button class="btn sm ghost" data-x="invPick" data-v="all">이 달 전체</button>${n?`<button class="btn sm ghost" data-x="invPick" data-v="none">해제</button>`:''}
      <form data-af="invPrice" class="inline"><input class="in tnum" name="price" type="number" min="0" step="1000" placeholder="1박 요금(원)" ${n?'':'disabled'} aria-label="지정 요금"><button class="btn sm" type="submit" ${n?'':'disabled'}>요금 지정</button></form>
      <button class="btn sm ghost" data-x="invAct" data-v="resetPrice" ${n?'':'disabled'}>기본 요금으로</button><button class="btn sm danger" data-x="invAct" data-v="close" ${n?'':'disabled'}>판매중지</button><button class="btn sm soft" data-x="invAct" data-v="open" ${n?'':'disabled'}>판매재개</button></div>`;
};

/* ---------- 숙소·객실 ---------- */
SEC.places = async () => {
  const d = await api('GET','/api/admin/places'); S.data.places = d;
  const samples = d.places.filter(p=>p.sample).length;
  return `<div class="ah"><h2>숙소·객실</h2><button class="btn sm" data-x="placeNew">+ 숙소 등록</button></div>
    ${d.places.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>숙소</th><th>지역</th><th class="r">객실</th><th class="r">최저가</th><th class="r">예약</th><th class="c">초이스</th><th class="c">판매</th><th></th></tr></thead><tbody>
      ${d.places.map(p=>{ const rs = d.rooms.filter(r=>r.place_id===p.id); const mn = rs.length ? Math.min(...rs.map(r=>r.price)) : 0; return `<tr><td style="width:64px">${p.photos[0]?`<img class="thumbs" style="object-fit:cover" src="${img(p.photos[0])}" alt="">`:`<span class="thumbs" style="display:block;background:var(--bg2)"></span>`}</td>
        <td><b>${esc(p.name)}</b>${p.sample?'<span class="exbadge">예시</span>':''}<br><span class="note">${esc(p.type)}${p.grade?` · ${esc(p.grade)}`:''}</span></td><td class="nowrap">${esc(p.sido)} ${esc(p.area)}</td><td class="r tnum">${rs.length}개 · ${rs.reduce((s,r)=>s+r.stock,0)}실</td><td class="r tnum nowrap">${mn?won(mn)+'원':'-'}</td><td class="r tnum">${p.bookings}</td>
        <td class="c"><button class="tg ${p.featured?'on':''}" data-x="plToggle" data-k="featured" data-v="${p.id}" aria-pressed="${p.featured}" aria-label="초이스 노출"></button></td>
        <td class="c"><button class="tg ${p.active?'on':''}" data-x="plToggle" data-k="active" data-v="${p.id}" aria-pressed="${p.active}" aria-label="판매 중"></button></td>
        <td class="r nowrap"><button class="btn sm ghost" data-x="placeEdit" data-v="${p.id}">수정 · 객실</button></td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="empty">등록된 숙소가 없습니다.</div>`}
    ${samples?`<button class="btn sm danger" style="margin-top:16px" data-x="delSamples">예시 숙소 ${samples}곳 · 예시 배너 모두 삭제</button>`:''}`;
};
let photoDraft = [];
function photoField(max=20){
  return `<div class="photos" id="photoBox">${photoDraft.map((id,i)=>`<div class="t"><img alt="" src="${img(id)}"><button type="button" data-x="photoDel" data-v="${i}" aria-label="사진 삭제">×</button></div>`).join('')}
    ${photoDraft.length<max?`<label class="addp">사진 추가<input type="file" id="photoIn" accept="image/jpeg,image/png,image/webp" ${max>1?'multiple':''}></label>`:''}</div>`;
}
const chk = (name, list, sel, type='checkbox') => `<div class="checks">${list.map(v=>`<label><input type="${type}" name="${name}" value="${esc(v)}" ${(Array.isArray(sel)?sel.includes(v):sel===v)?'checked':''}><span>${esc(v)}</span></label>`).join('')}</div>`;
function placeDrawer(id){
  const d = S.data.places, p = id ? d.places.find(x=>x.id===id) : {type:TYPES[0], sido:SIDO[0], check_in:'15:00', check_out:'11:00', active:true, amenities:[], tags:[], photos:[]};
  photoDraft = [...(p.photos||[])];
  const rooms = id ? d.rooms.filter(r=>r.place_id===id) : [];
  drawer(id?'숙소 수정':'숙소 등록', `<form class="aform" data-af="place" data-id="${id||''}">
    <label class="fl" for="apName">숙소 이름</label><input class="in" id="apName" name="name" value="${esc(p.name)}" required maxlength="60">
    <div class="fl">유형</div>${chk('type', TYPES, p.type, 'radio')}
    <label class="fl" for="apGrade">등급 표시 (선택)</label><input class="in" id="apGrade" name="grade" value="${esc(p.grade)}" placeholder="예) 5성급, 프리미엄">
    <div class="fl">지역</div>${chk('sido', SIDO, p.sido, 'radio')}
    <div class="row2"><div><label class="fl" for="apArea">세부 지역</label><input class="in" id="apArea" name="area" value="${esc(p.area)}" required placeholder="예) 해운대, 강남/역삼"></div><div><label class="fl" for="apPhone">숙소 연락처</label><input class="in" id="apPhone" name="phone" value="${esc(p.phone)}"></div></div>
    <label class="fl" for="apAddr">주소</label><input class="in" id="apAddr" name="address" value="${esc(p.address)}">
    <div class="row2"><div><label class="fl" for="apIn">체크인</label><input class="in" type="time" id="apIn" name="check_in" value="${esc(p.check_in)}"></div><div><label class="fl" for="apOut">체크아웃</label><input class="in" type="time" id="apOut" name="check_out" value="${esc(p.check_out)}"></div></div>
    <div class="fl">사진 (첫 장이 대표 사진)</div>${photoField()}
    <label class="fl" for="apIntro">숙소 소개</label><textarea class="in" id="apIntro" name="intro" style="min-height:120px">${esc(p.intro)}</textarea>
    <label class="fl" for="apNotice">이용 안내 · 공지</label><textarea class="in" id="apNotice" name="notice">${esc(p.notice)}</textarea>
    <div class="fl">편의시설</div>${chk('amenities', AMEN, p.amenities)}
    <div class="fl">태그</div>${chk('tags', TAGS, p.tags)}
    <div class="fl">노출</div><div class="checks"><label><input type="checkbox" name="featured" ${p.featured?'checked':''}><span>홈 초이스 노출</span></label><label><input type="checkbox" name="active" ${p.active?'checked':''}><span>판매 중</span></label></div>
    <button class="btn full" type="submit" style="margin-top:18px">${id?'저장':'등록하고 객실 추가'}</button>
  </form>
  ${id?`<h4 style="margin:30px 0 8px">객실 ${rooms.length}개</h4>
    ${rooms.length?`<div class="tbl-wrap"><table class="tbl"><tbody>${rooms.map(r=>`<tr class="click" data-x="roomEdit" data-v="${r.id}"><td><b>${esc(r.name)}</b>${r.active?'':' <span class="st cancel">중지</span>'}<br><span class="note">기준 ${r.base}/최대 ${r.max}명 · ${r.stock}실</span></td><td class="r tnum">평일 ${won(r.price)}<br><span class="note">주말 ${won(r.weekend_price||r.price)}</span></td></tr>`).join('')}</tbody></table></div>`:''}
    <button class="btn soft full" style="margin-top:10px" data-x="roomNew" data-v="${id}">+ 객실 추가</button>
    <button class="btn danger full" style="margin-top:30px" data-x="placeDel" data-v="${id}">숙소 삭제</button>`:''}`);
}
function roomDrawer(placeId, id){
  const r = id ? S.data.places.rooms.find(x=>x.id===id) : {base:2, max:2, stock:1, active:true, photos:[]};
  photoDraft = [...(r.photos||[])];
  drawer(id?'객실 수정':'객실 추가', `<form class="aform" data-af="room" data-id="${id||''}" data-p="${placeId}">
    <label class="fl" for="arName">객실 이름</label><input class="in" id="arName" name="name" value="${esc(r.name)}" required maxlength="60" placeholder="예) 디럭스 더블">
    <div class="row3"><div><label class="fl" for="arBase">기준 인원</label><input class="in" id="arBase" name="base" type="number" min="1" value="${r.base}" required></div><div><label class="fl" for="arMax">최대 인원</label><input class="in" id="arMax" name="max" type="number" min="1" value="${r.max}" required></div><div><label class="fl" for="arStock">객실 수</label><input class="in" id="arStock" name="stock" type="number" min="1" max="500" value="${r.stock}" required></div></div>
    <div class="row3"><div><label class="fl" for="arPrice">평일 1박 (원)</label><input class="in tnum" id="arPrice" name="price" type="number" min="0" step="1000" value="${r.price||''}" required></div><div><label class="fl" for="arWk">금·토 1박 (원)</label><input class="in tnum" id="arWk" name="weekend_price" type="number" min="0" step="1000" value="${r.weekend_price||''}" placeholder="비우면 평일가"></div><div><label class="fl" for="arList">정가 (할인 표시)</label><input class="in tnum" id="arList" name="list_price" type="number" min="0" step="1000" value="${r.list_price||''}"></div></div>
    <label class="fl" for="arDesc">객실 설명</label><textarea class="in" id="arDesc" name="descr" placeholder="침대 구성, 전망, 크기 등">${esc(r.descr)}</textarea>
    <div class="fl">사진</div>${photoField()}
    <label class="fl" for="arSort">정렬 순서 (작을수록 위)</label><input class="in" id="arSort" name="sort" type="number" value="${r.sort||0}">
    <div class="checks" style="margin-top:12px"><label><input type="checkbox" name="active" ${r.active?'checked':''}><span>판매 중</span></label></div>
    <button class="btn full" type="submit" style="margin-top:18px">${id?'저장':'추가'}</button>
    ${id?`<button class="btn danger full" type="button" style="margin-top:10px" data-x="roomDel" data-v="${id}">객실 삭제</button>`:''}
  </form>`, () => placeDrawer(placeId));
}

/* ---------- 회원 ---------- */
SEC.members = async () => {
  const d = await api('GET','/api/admin/members?'+qs(S.mq)), pages = Math.max(1, Math.ceil(d.total/d.size));
  return `<div class="ah"><h2>회원</h2><a class="btn sm ghost" href="/api/admin/members.csv" style="display:inline-flex;align-items:center;text-decoration:none">CSV 내려받기</a></div>
    <div class="chips flat">${[['all','전체'],['active','정상'],['blocked','정지'],['withdrawn','탈퇴']].map(([k,l])=>`<button class="chip ${S.mq.status===k?'on':''}" data-x="mqStatus" data-v="${k}">${l}</button>`).join('')}</div>
    <form class="toolbar" data-af="mq"><input class="in" name="q" placeholder="이메일, 이름, 전화번호" value="${esc(S.mq.q)}" style="flex:1 1 240px" aria-label="회원 검색"><button class="btn sm" type="submit">검색</button></form>
    <p class="note" style="margin:6px 0 10px">${won(d.total)}명</p>
    ${d.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>회원</th><th>가입 경로</th><th>연락처</th><th class="r">포인트</th><th class="r">예약</th><th class="r">결제 합계</th><th>가입일</th><th>상태</th></tr></thead><tbody>
      ${d.rows.map(u=>`<tr class="click" data-x="member" data-v="${u.id}"><td><b>${esc(u.name||'(미입력)')}</b>${u.role==='admin'?' <span class="tag b">관리자</span>':''}<br><span class="note">${esc(u.email||'-')}</span></td><td>${(u.providers||'').split(',').filter(Boolean).map(p=>p==='kakao'?'카카오':'Google').join(', ')||'이메일'}</td><td class="tnum nowrap">${esc(u.phone)}</td><td class="r tnum">${won(u.points)}P</td><td class="r tnum">${u.bookings}</td><td class="r tnum">${won(u.spent)}원</td><td class="tnum note">${fmtD(u.created_at)}</td><td>${u.status==='active'?(u.profile_done?'정상':'<span class="note">가입 미완료</span>'):u.status==='blocked'?'<span class="st cancel">정지</span>':'<span class="note">탈퇴</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="pager">${S.mq.page>1?`<button class="btn sm ghost" data-x="mqPage" data-v="${S.mq.page-1}">이전</button>`:''}<span class="tnum">${S.mq.page} / ${pages}</span>${S.mq.page<pages?`<button class="btn sm ghost" data-x="mqPage" data-v="${S.mq.page+1}">다음</button>`:''}</div>` : `<div class="empty">회원이 없습니다.</div>`}`;
};
async function memberDrawer(id){
  const u = await api('GET','/api/admin/members/'+id);
  drawer(`회원 · ${u.name||u.email||id}`, `
    <dl class="kv2 tnum"><dt>회원번호</dt><dd>${u.id}</dd><dt>이메일</dt><dd>${esc(u.email||'-')}</dd><dt>이름</dt><dd>${esc(u.name)}</dd><dt>휴대폰</dt><dd style="user-select:all">${esc(u.phone||'-')}</dd>
      <dt>가입 경로</dt><dd>${u.identities.map(i=>i.provider==='kakao'?'카카오':'Google').join(', ')||'이메일'}</dd><dt>가입일</dt><dd>${fmtDT(u.created_at)}</dd><dt>최근 로그인</dt><dd>${fmtDT(u.last_login_at)}</dd>
      <dt>마케팅 동의</dt><dd>${u.marketing?'동의':'미동의'}</dd><dt>상태</dt><dd>${u.status==='active'?'정상':u.status==='blocked'?'정지':'탈퇴'} · ${u.role==='admin'?'관리자':'일반'}</dd></dl>
    ${u.status!=='withdrawn'?`<div class="acts" style="margin-top:14px">
      ${u.status==='active'?`<button class="btn sm danger" data-x="mSet" data-k="status" data-v="blocked" data-id="${u.id}">이용 정지</button>`:`<button class="btn sm" data-x="mSet" data-k="status" data-v="active" data-id="${u.id}">정지 해제</button>`}
      ${u.role==='admin'?`<button class="btn sm ghost" data-x="mSet" data-k="role" data-v="user" data-id="${u.id}">관리자 해제</button>`:`<button class="btn sm ghost" data-x="mSet" data-k="role" data-v="admin" data-id="${u.id}">관리자 지정</button>`}
      ${u.email?`<button class="btn sm ghost" data-x="tempPw" data-v="${u.id}">임시 비밀번호 발급</button>`:''}</div>`:''}
    <h4 style="margin:24px 0 8px">포인트 <span class="tnum" style="color:var(--brand)">${won(u.balance)}P</span></h4>
    ${u.status!=='withdrawn'?`<form class="toolbar" data-af="mPoints" data-id="${u.id}"><input class="in tnum" name="amount" type="number" step="100" placeholder="+1000 지급 / -1000 차감" style="flex:1 1 160px" required aria-label="포인트"><input class="in" name="memo" placeholder="사유 (고객에게 보임)" style="flex:2 1 200px" required aria-label="사유"><button class="btn sm" type="submit">적용</button></form>`:''}
    ${u.points.length?`<div class="tbl-wrap"><table class="tbl"><tbody>${u.points.slice(0,30).map(x=>`<tr><td>${esc(PKIND[x.kind]||x.kind)}<br><span class="note">${esc(x.memo)}</span></td><td class="r tnum ${x.amount>0?'':''}" style="color:${x.amount>0?'var(--brand)':'var(--ink)'}">${x.amount>0?'+':''}${won(x.amount)}</td><td class="note tnum nowrap">${fmtDT(x.created_at).slice(2)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="note">내역 없음</p>'}
    <h4 style="margin:24px 0 8px">예약 ${u.bookings.length}건</h4>
    ${u.bookings.length?`<div class="tbl-wrap"><table class="tbl"><tbody>${u.bookings.map(b=>`<tr class="click" data-x="booking" data-v="${b.id}"><td>${stTag(b.status)}</td><td>${esc(b.place_name)}<br><span class="note tnum">${fmtD(b.check_in)} · ${b.nights}박</span></td><td class="r tnum">${won(b.amount_due)}원</td></tr>`).join('')}</tbody></table></div>`:'<p class="note">예약 없음</p>'}
    <h4 style="margin:24px 0 8px">관리 메모</h4>
    <form data-af="mMemo" data-id="${u.id}"><textarea class="in" name="memo" style="min-height:70px">${esc(u.memo)}</textarea><button class="btn sm" type="submit" style="margin-top:6px">메모 저장</button></form>`);
}

/* ---------- 포인트 ---------- */
SEC.points = async () => {
  const d = await api('GET','/api/admin/points?kind='+S.pk), st = X.set().points;
  return `<div class="ah"><h2>포인트</h2></div>
    <div class="kpis tnum"><div class="kpi"><small>누적 지급</small><b>${won(d.sum.issued)}<em>P</em></b></div><div class="kpi"><small>누적 사용</small><b>${won(d.sum.used)}<em>P</em></b></div><div class="kpi"><small>소멸</small><b>${won(d.sum.expired)}<em>P</em></b></div><div class="kpi"><small>미사용 잔액 (부채)</small><b>${won(d.sum.outstanding)}<em>P</em></b><span>1P = 1원 기준</span></div></div>
    <div class="hint" style="margin-top:14px">현재 정책: 가입 ${won(st.signupBonus)}P · 숙박 결제금액의 ${st.earnRate}% · 후기 ${won(st.reviewBonus)}P · ${won(st.minUse)}P부터 ${st.unit}P 단위로 객실요금의 ${st.maxUseRate}%까지 사용 · ${st.expireDays}일 후 소멸. <button class="linkbtn" data-x="sec" data-v="settings">설정에서 바꾸기</button></div>
    <div class="chips flat" style="margin-top:14px">${[['all','전체'],...Object.entries(PKIND)].map(([k,l])=>`<button class="chip ${S.pk===k?'on':''}" data-x="pk" data-v="${k}">${l}</button>`).join('')}</div>
    ${d.rows.length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>일시</th><th>회원</th><th>구분</th><th>내용</th><th class="r">포인트</th><th>처리자</th></tr></thead><tbody>${d.rows.map(x=>`<tr class="click" data-x="member" data-v="${x.user_id}"><td class="tnum note nowrap">${fmtDT(x.created_at).slice(2)}</td><td>${esc(x.name)}<br><span class="note">${esc(x.email||'')}</span></td><td>${esc(PKIND[x.kind]||x.kind)}</td><td>${esc(x.memo)}</td><td class="r tnum" style="color:${x.amount>0?'var(--brand)':'var(--ink)'}">${x.amount>0?'+':''}${won(x.amount)}</td><td class="note">${esc(x.admin_name||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">내역이 없습니다.</div>'}`;
};

/* ---------- 후기 ---------- */
SEC.reviews = async () => {
  const d = await api('GET','/api/admin/reviews?filter='+S.rv), c = d.counts;
  return `<div class="ah"><h2>후기</h2><span class="note tnum">평균 ★ ${c.avg.toFixed(2)}</span></div>
    <div class="chips flat">${[['all','전체',c.all],['need','답글 필요',c.need],['low','별점 2점 이하',c.low],['hidden','숨김',c.hidden]].map(([k,l,n])=>`<button class="chip ${S.rv===k?'on':''}" data-x="rv" data-v="${k}">${l} ${n}</button>`).join('')}</div>
    ${d.rows.length ? d.rows.map(r=>`<div class="panel" style="${r.hidden?'opacity:.6':''}">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="color:var(--star)">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span><b>${esc(r.author)}</b><span class="note">${esc(r.place_name||'삭제된 숙소')} · ${esc(r.room_name)} · ${fmtD(r.created_at)}</span>${r.hidden?'<span class="st cancel">숨김</span>':''}</div>
      <p style="margin:10px 0;line-height:1.7;white-space:pre-wrap">${esc(r.text)}</p>
      <form data-af="reply" data-id="${r.id}"><textarea class="in" name="reply" placeholder="사장님 답글" style="min-height:70px" aria-label="답글">${esc(r.reply)}</textarea>
        <div class="acts"><button class="btn sm" type="submit">${r.reply?'답글 수정':'답글 등록'}</button><button class="btn sm ghost" type="button" data-x="rvHide" data-v="${r.id}" data-h="${r.hidden?0:1}">${r.hidden?'다시 공개':'숨기기'}</button><button class="btn sm danger" type="button" data-x="rvDel" data-v="${r.id}">삭제</button>${r.reply_at?`<span class="note">답글 ${fmtDT(r.reply_at)}</span>`:''}</div></form></div>`).join('') : `<div class="empty">해당하는 후기가 없습니다.</div>`}`;
};

/* ---------- 광고 ---------- */
const bState = (b, t) => !b.active ? ['중지','done'] : t < b.start_date ? ['예정','wait'] : t > b.end_date ? ['종료','cancel'] : ['진행중','ok'];
SEC.ads = async () => {
  const d = await api('GET','/api/admin/banners?days='+S.adDays); S.data.banners = d.rows;
  const t = d.today, mo = t.slice(0,7), live = d.rows.filter(b=>bState(b,t)[0]==='진행중');
  const ti = d.rows.reduce((s,b)=>s+b.imp,0), tc = d.rows.reduce((s,b)=>s+b.clk,0);
  const fee = d.rows.filter(b=>b.start_date.slice(0,7)===mo).reduce((s,b)=>s+b.fee,0), feeAll = d.rows.reduce((s,b)=>s+b.fee,0);
  const daily = []; for (let i=Math.min(S.adDays,30)-1;i>=0;i--){ const x = new Date(t+'T00:00:00'); x.setDate(x.getDate()-i); const k = ymd(x), m = d.daily.find(r=>r.day===k); daily.push({label:`${x.getMonth()+1}/${x.getDate()}`, short: i%5===0?String(x.getDate()):'', v: m?m.clk:0}); }
  return `<div class="ah"><h2>광고 배너</h2><div class="acts"><a class="btn sm ghost" href="/api/admin/banners.csv" style="display:inline-flex;align-items:center;text-decoration:none">광고주 리포트 CSV</a><button class="btn sm" data-x="bannerNew">+ 배너 등록</button></div></div>
    <div class="kpis tnum"><div class="kpi"><small>진행중 배너</small><b>${live.length}<em>개</em></b><span>전체 ${d.rows.length}개</span></div>
      <div class="kpi"><small>이번달 시작 계약액</small><b>${won(fee)}<em>원</em></b><span>누적 ${won(feeAll)}원</span></div>
      <div class="kpi"><small>노출 (${S.adDays}일)</small><b>${won(ti)}<em>회</em></b><span>관리자 제외 · 방문당 1회</span></div>
      <div class="kpi"><small>클릭 · 클릭률</small><b>${won(tc)}<em>회</em></b><span>${ctr(tc,ti)}</span></div></div>
    <div class="chips flat" style="margin-top:14px">${[7,30,90,365].map(x=>`<button class="chip ${S.adDays===x?'on':''}" data-x="adDays" data-v="${x}">최근 ${x}일</button>`).join('')}</div>
    <div class="panel"><h3>일별 광고 클릭 <span class="note">최근 ${Math.min(S.adDays,30)}일 · 전체 배너</span></h3>${bars(daily, v=>String(Math.round(v)), v=>v+'회')}</div>
    ${d.rows.length ? `<div class="panel"><h3>배너별 성과</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>배너</th><th>구좌</th><th>상태</th><th>기간</th><th class="r">계약금</th><th class="r">노출</th><th class="r">클릭</th><th class="r">클릭률</th><th class="r">클릭당 단가</th><th></th></tr></thead><tbody>
      ${d.rows.map(b=>{ const s = bState(b,t); return `<tr><td><div class="adthumb">${b.image?`<img src="${img(b.image)}" alt="">`:`<span style="background:${esc(b.bg)}">${esc(b.title)}</span>`}</div><b>${esc(b.title)}</b>${b.sample?'<span class="exbadge">예시</span>':''}<br><span class="note">${esc(b.advertiser||'-')}${b.contact?` · ${esc(b.contact)}`:''}</span></td>
        <td class="nowrap">${esc(SLOTS[b.slot].name)}</td><td><span class="st ${s[1]}">${s[0]}</span></td><td class="tnum nowrap">${fmtD(b.start_date)}<br>~ ${fmtD(b.end_date)}</td><td class="r tnum nowrap">${won(b.fee)}원</td><td class="r tnum">${won(b.imp)}</td><td class="r tnum">${won(b.clk)}</td><td class="r tnum">${ctr(b.clk,b.imp)}</td><td class="r tnum">${b.clk_all&&b.fee?won(Math.round(b.fee/b.clk_all))+'원':'-'}</td>
        <td class="r"><button class="btn sm ghost" data-x="bannerEdit" data-v="${b.id}">수정</button></td></tr>`; }).join('')}
    </tbody></table></div></div>` : `<div class="empty">등록된 배너가 없습니다.</div>`}
    <div class="panel"><h3>광고 구좌 안내 <span class="note">광고주 상담용</span></h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>구좌</th><th>노출 위치</th><th>권장 이미지</th><th class="r">진행중</th></tr></thead><tbody>${Object.entries(SLOTS).map(([k,s])=>`<tr><td><b>${s.name}</b></td><td>${s.where}</td><td class="tnum">${s.size}</td><td class="r tnum">${live.filter(b=>b.slot===k).length}개</td></tr>`).join('')}</tbody></table></div>
      <p class="note" style="margin-top:10px;line-height:1.7">모든 배너에 '광고' 표시가 붙습니다(표시광고법). 같은 구좌에 여러 배너가 있으면 우선순위가 높은 배너가 먼저, 같은 순위끼리는 번갈아 노출됩니다. 클릭당 단가는 계약금을 누적 클릭으로 나눈 값입니다.</p></div>`;
};
function bannerDrawer(id){
  const t = ymd(new Date()), e = new Date(); e.setDate(e.getDate()+30);
  const b = id ? S.data.banners.find(x=>x.id===id) : {slot:'home', start_date:t, end_date:ymd(e), priority:0, active:true, bg:X.set().color, fee:0};
  photoDraft = b.image ? [b.image] : [];
  drawer(id?'배너 수정':'배너 등록', `<form class="aform" data-af="banner" data-id="${id||''}">
    <div class="row2"><div><label class="fl" for="abAdv">광고주</label><input class="in" id="abAdv" name="advertiser" value="${esc(b.advertiser)}" required></div><div><label class="fl" for="abCon">광고주 연락처 (내부용)</label><input class="in" id="abCon" name="contact" value="${esc(b.contact)}"></div></div>
    <div class="row2"><div><label class="fl" for="abFee">계약 금액 (원)</label><input class="in tnum" id="abFee" name="fee" type="number" min="0" step="10000" value="${b.fee}"></div><div><label class="fl" for="abPri">우선순위 (0~99, 높을수록 앞)</label><input class="in tnum" id="abPri" name="priority" type="number" min="0" max="99" value="${b.priority}"></div></div>
    <div class="row2"><div><label class="fl" for="abS">시작일</label><input class="in" id="abS" name="start_date" type="date" value="${esc(String(b.start_date).slice(0,10))}" required></div><div><label class="fl" for="abE">종료일</label><input class="in" id="abE" name="end_date" type="date" value="${esc(String(b.end_date).slice(0,10))}" required></div></div>
    <div class="fl">노출 위치</div><div class="checks">${Object.entries(SLOTS).map(([k,s])=>`<label><input type="radio" name="slot" value="${k}" ${b.slot===k?'checked':''}><span>${s.name} · ${s.size}</span></label>`).join('')}</div>
    <label class="fl" for="abT">제목 (이미지 대체 문구)</label><input class="in" id="abT" name="title" value="${esc(b.title)}" required maxlength="60">
    <label class="fl" for="abSub">부제 (이미지 없을 때 표시)</label><input class="in" id="abSub" name="sub" value="${esc(b.sub)}" maxlength="80">
    <label class="fl" for="abLink">연결 주소</label><input class="in" id="abLink" name="link" type="url" value="${esc(b.link)}" placeholder="https://">
    <label class="fl" for="abBg">배경색 (이미지 없을 때)</label><input type="color" id="abBg" name="bg" value="${esc(b.bg)}" style="width:56px;height:44px;border:1px solid var(--line);border-radius:4px;background:none;padding:2px">
    <div class="fl">배너 이미지 (1장)</div>${photoField(1)}
    <div class="checks" style="margin-top:12px"><label><input type="checkbox" name="active" ${b.active?'checked':''}><span>노출 켜기</span></label></div>
    <button class="btn full" type="submit" style="margin-top:18px">${id?'저장':'등록'}</button>
    ${id?`<button class="btn danger full" type="button" style="margin-top:10px" data-x="bannerDel" data-v="${id}">배너 삭제</button>`:''}
  </form>`);
}

/* ---------- 설정 ---------- */
SEC.settings = async () => {
  const d = await api('GET','/api/admin/settings'), s = d.settings, pt = s.points;
  S.data.settings = s;
  const dot = (ok, y, n) => `<span class="${ok?'ok-dot':'no-dot'}">${ok?y:n}</span>`;
  return `<div class="ah"><h2>설정</h2></div>
    <div class="panel"><h3>연결 상태 <span class="note">키는 Render 환경변수에서 넣습니다 (코드에 넣지 마세요)</span></h3>
      <div class="tbl-wrap"><table class="tbl"><tbody>
        <tr><td>결제(PG)</td><td>${d.pay.test?dot(false,'','테스트 결제 모드'):dot(d.pay.ready, esc(d.pay.provider)+' 연결됨', '키 없음')}</td><td class="note"><code>PAYMENT_PROVIDER=toss</code> · <code>TOSS_CLIENT_KEY</code> · <code>TOSS_SECRET_KEY</code></td></tr>
        <tr><td>카카오 로그인</td><td>${dot(d.login.kakao,'켜짐','꺼짐')}</td><td class="note"><code>KAKAO_REST_KEY</code> (+ <code>KAKAO_CLIENT_SECRET</code>) · Redirect URI <code>${esc(d.env.baseUrl)}/auth/kakao/callback</code></td></tr>
        <tr><td>Google 로그인</td><td>${dot(d.login.google,'켜짐','꺼짐')}</td><td class="note"><code>GOOGLE_CLIENT_ID</code> · <code>GOOGLE_CLIENT_SECRET</code> · Redirect URI <code>${esc(d.env.baseUrl)}/auth/google/callback</code></td></tr>
        <tr><td>로그인 보안키</td><td>${dot(d.env.sessionSecret,'설정됨','없음 (재시작 시 로그아웃)')}</td><td class="note"><code>SESSION_SECRET</code></td></tr>
      </tbody></table></div></div>
    <form data-af="settings">
      <div class="grid2">
        <div class="panel"><h3>브랜드·고객센터</h3>
          <label class="fl" for="sBrand">서비스 이름</label><input class="in" id="sBrand" name="brand" value="${esc(s.brand)}" required maxlength="20">
          <label class="fl" for="sColor">대표 색상</label><input type="color" id="sColor" name="color" value="${esc(s.color)}" style="width:56px;height:44px;border:1px solid var(--line);border-radius:4px;background:none;padding:2px">
          <label class="fl" for="sPhone">고객센터 전화</label><input class="in" id="sPhone" name="phone" value="${esc(s.phone)}">
          <label class="fl" for="sMail">고객센터 이메일</label><input class="in" id="sMail" name="email" value="${esc(s.email)}">
          <label class="fl" for="sAd">광고 문의 연락처 (하단 표시)</label><input class="in" id="sAd" name="adContact" value="${esc(s.adContact)}"></div>
        <div class="panel"><h3>결제</h3>
          <div class="fl">사용할 결제 방법</div><div class="checks">${[['card','카드·간편결제'],['bank','무통장입금'],['site','현장결제']].map(([k,l])=>`<label><input type="checkbox" name="payMethods" value="${k}" ${s.payMethods.includes(k)?'checked':''}><span>${l}</span></label>`).join('')}</div>
          <label class="fl" for="sBank">입금 계좌 (은행 · 계좌번호 · 예금주)</label><input class="in" id="sBank" name="bank" value="${esc(s.bank)}">
          <div class="row2"><div><label class="fl" for="sBankH">미입금 자동취소 (시간, 0=끔)</label><input class="in tnum" id="sBankH" name="bankDeadlineHours" type="number" min="0" max="168" value="${s.bankDeadlineHours}"></div><div><label class="fl" for="sHold">카드 결제 대기 (분)</label><input class="in tnum" id="sHold" name="cardHoldMinutes" type="number" min="5" max="60" value="${s.cardHoldMinutes}"></div></div>
          <label class="fl" for="sDead">입금 안내 문구</label><textarea class="in" id="sDead" name="payDeadline">${esc(s.payDeadline)}</textarea></div>
      </div>
      <div class="grid2">
        <div class="panel"><h3>취소·환불 규정</h3>
          <div id="rules">${s.cancelRules.map((r,i)=>`<div class="rulerow">체크인 <input class="in tnum" name="rd${i}" type="number" min="0" value="${r.days}" aria-label="며칠 전">일 전 이상 → <input class="in tnum" name="rr${i}" type="number" min="0" max="100" value="${r.rate}" aria-label="환불 비율">% 환불</div>`).join('')}
            <div class="rulerow">체크인 <input class="in tnum" name="rd${s.cancelRules.length}" type="number" min="0" placeholder="-" aria-label="새 규칙 며칠 전">일 전 이상 → <input class="in tnum" name="rr${s.cancelRules.length}" type="number" min="0" max="100" placeholder="-" aria-label="새 규칙 환불 비율">% (추가)</div></div>
          <p class="note" style="margin-top:8px">일수를 비우면 그 규칙은 지워집니다. 체크인 당일(0일) 규칙은 자동으로 들어갑니다.</p>
          <label class="fl" for="sNote">추가 안내 문구</label><textarea class="in" id="sNote" name="cancelNote">${esc(s.cancelNote)}</textarea></div>
        <div class="panel"><h3>포인트 정책</h3>
          <div class="row2"><div><label class="fl" for="pSign">가입 축하 (P)</label><input class="in tnum" id="pSign" name="p_signupBonus" type="number" min="0" value="${pt.signupBonus}"></div><div><label class="fl" for="pRate">숙박 적립률 (%)</label><input class="in tnum" id="pRate" name="p_earnRate" type="number" min="0" max="30" step="0.5" value="${pt.earnRate}"></div></div>
          <div class="row2"><div><label class="fl" for="pRev">후기 적립 (P)</label><input class="in tnum" id="pRev" name="p_reviewBonus" type="number" min="0" value="${pt.reviewBonus}"></div><div><label class="fl" for="pExp">유효기간 (일)</label><input class="in tnum" id="pExp" name="p_expireDays" type="number" min="30" value="${pt.expireDays}"></div></div>
          <div class="row3"><div><label class="fl" for="pMin">최소 사용 (P)</label><input class="in tnum" id="pMin" name="p_minUse" type="number" min="0" value="${pt.minUse}"></div><div><label class="fl" for="pUnit">사용 단위 (P)</label><input class="in tnum" id="pUnit" name="p_unit" type="number" min="1" value="${pt.unit}"></div><div><label class="fl" for="pMax">최대 사용 (%)</label><input class="in tnum" id="pMax" name="p_maxUseRate" type="number" min="0" max="100" value="${pt.maxUseRate}"></div></div></div>
      </div>
      <div class="panel"><h3>사업자 정보 <span class="note">전자상거래법상 화면 하단 표시 항목</span></h3>
        <div class="row3"><div><label class="fl" for="sCo">상호</label><input class="in" id="sCo" name="company" value="${esc(s.company)}"></div><div><label class="fl" for="sCeo">대표자</label><input class="in" id="sCeo" name="ceo" value="${esc(s.ceo)}"></div><div><label class="fl" for="sPo">개인정보 보호책임자</label><input class="in" id="sPo" name="privacyOfficer" value="${esc(s.privacyOfficer)}"></div></div>
        <div class="row3"><div><label class="fl" for="sBiz">사업자등록번호</label><input class="in" id="sBiz" name="bizNo" value="${esc(s.bizNo)}"></div><div><label class="fl" for="sSale">통신판매업 신고번호</label><input class="in" id="sSale" name="saleNo" value="${esc(s.saleNo)}"></div><div><label class="fl" for="sAddr">사업장 주소</label><input class="in" id="sAddr" name="address" value="${esc(s.address)}"></div></div></div>
      <div class="grid2">
        <div class="panel"><h3>이용약관 <span class="note">{상호} {서비스명} 자동 치환</span></h3><textarea class="in" name="termsService" style="min-height:260px;font-size:13px" aria-label="이용약관">${esc(s.termsService)}</textarea></div>
        <div class="panel"><h3>개인정보처리방침</h3><textarea class="in" name="termsPrivacy" style="min-height:260px;font-size:13px" aria-label="개인정보처리방침">${esc(s.termsPrivacy)}</textarea></div>
      </div>
      <div style="position:sticky;bottom:12px;margin-top:16px"><button class="btn" type="submit" style="min-width:200px;box-shadow:0 4px 14px rgba(0,0,0,.15)">설정 저장</button></div>
    </form>`;
};

SEC.audit = async () => {
  const rows = await api('GET','/api/admin/audit');
  const L = {booking_status:'예약 상태 변경', booking_cancel:'예약 취소', refund_done:'환불 완료', inventory_close:'판매중지', inventory_open:'판매재개', inventory_price:'요금 지정', inventory_resetPrice:'기본 요금 복원', place_create:'숙소 등록', place_update:'숙소 수정', place_delete:'숙소 삭제', room_create:'객실 등록', room_update:'객실 수정', room_delete:'객실 삭제', samples_delete:'예시 삭제', member_update:'회원 정보 변경', points_adjust:'포인트 조정', temp_password:'임시 비밀번호', review_update:'후기 처리', review_delete:'후기 삭제', banner_create:'배너 등록', banner_update:'배너 수정', banner_delete:'배너 삭제', settings_update:'설정 저장', export_bookings:'예약 내려받기', export_members:'회원 내려받기'};
  return `<div class="ah"><h2>활동 기록</h2><span class="note">관리자가 한 작업 최근 300건</span></div>
    ${rows.length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>일시</th><th>관리자</th><th>작업</th><th>대상</th><th>내용</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="tnum note nowrap">${fmtDT(r.created_at)}</td><td>${esc(r.admin_name||r.admin_email||'')}</td><td>${esc(L[r.action]||r.action)}</td><td class="tnum">${esc(r.target)}</td><td class="note" style="max-width:340px;overflow-wrap:anywhere">${r.detail?esc(JSON.stringify(r.detail)):''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">기록이 없습니다.</div>'}`;
};

/* ---------- 서랍(상세·폼) ---------- */
let drawerBack = null;
function drawer(title, html, onBack){
  closeDrawer(true);
  drawerBack = onBack || null;
  const d = document.createElement('div'); d.className = 'drawer'; d.id = 'drawer';
  d.innerHTML = `<div class="dp" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dh">${onBack?`<button class="ib" data-x="dBack" aria-label="뒤로">${IC.prev}</button>`:''}<h3 style="flex:1">${esc(title)}</h3><button class="ib" data-x="dClose" aria-label="닫기">${IC.close}</button></div><div class="db">${html}</div></div>`;
  document.body.appendChild(d);
  d.addEventListener('click', e => { if (e.target === d) closeDrawer(); });
}
function closeDrawer(silent){ const d = $('#drawer'); if (d) d.remove(); if (!silent) drawerBack = null; }

/* ---------- 이미지 ---------- */
function shrink(file, max=1600, q=.85){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const r = Math.min(1, max/Math.max(im.width, im.height)); const cv = document.createElement('canvas'); cv.width=Math.round(im.width*r); cv.height=Math.round(im.height*r); cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height); URL.revokeObjectURL(url); cv.toBlob(b=>b?res(b):rej(new Error('변환 실패')), 'image/jpeg', q); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 읽지 못했습니다.')); };
    im.src = url;
  });
}
async function upload(file){
  const blob = await shrink(file);
  const r = await fetch('/api/admin/images', {method:'POST', headers:{'Content-Type':'image/jpeg','X-Requested-With':'stayon'}, body: blob, credentials:'same-origin'});
  const j = await r.json().catch(()=>({})); if (!r.ok) throw new Error(j.error || '업로드 실패');
  return j.id;
}

/* ---------- 이벤트 ---------- */
async function onClick(e){
  const t = e.target.closest('[data-x]'); if (!t) return;
  const a = t.dataset.x, v = t.dataset.v;
  try {
    if (a==='sec') { closeDrawer(); return show(v); }
    if (a==='exit') { closeDrawer(); document.body.classList.remove('wide'); root.removeEventListener('click', onClick); document.removeEventListener('click', onDocClick); document.removeEventListener('submit', onSubmit); document.removeEventListener('change', onChange); return X.exit(); }
    if (a==='dClose') return closeDrawer();
    if (a==='dBack') { const f = drawerBack; closeDrawer(); return f && f(); }
    if (a==='goBookings') { S.bq = {...S.bq, status:v, page:1}; return show('bookings'); }
    if (a==='booking') return bookingDrawer(+v);
    if (a==='member') return memberDrawer(+v);
    if (a==='setStatus') {
      const msg = v==='ok' ? '입금을 확인하고 예약을 확정할까요?' : '이용완료로 바꾸고 포인트를 적립할까요?';
      if (!(await confirmBox('예약 상태 변경', msg, '변경'))) return;
      await api('POST', `/api/admin/bookings/${t.dataset.id}/status`, {status:v}); toast('변경했습니다.'); closeDrawer(); return refresh();
    }
    if (a==='cancelBk') {
      const L = {policy:'취소 규정대로 환불하고', full:'전액 환불하고', none:'환불 없이'};
      if (!(await confirmBox('예약 취소', `${L[v]} 예약을 취소할까요? 객실은 다시 판매됩니다. 카드 결제는 PG사로 즉시 취소 요청됩니다.`, '예약 취소', true))) return;
      await api('POST', `/api/admin/bookings/${t.dataset.id}/cancel`, {mode:v, reason:'관리자 취소'}); toast('취소했습니다.'); closeDrawer(); return refresh();
    }
    if (a==='bqStatus') { S.bq.status = v; S.bq.page = 1; return refresh(); }
    if (a==='bqReset') { S.bq = {status:S.bq.status, q:'', place:'', from:'', to:'', page:1}; return refresh(); }
    if (a==='bqPage') { S.bq.page = +v; return refresh(); }
    if (a==='pmStatus') { S.pm.status = v; return refresh(); }
    if (a==='refunded') { if (!(await confirmBox('환불 완료', '고객 계좌로 환불을 보냈나요? 완료로 기록합니다.', '완료 처리'))) return; await api('POST', `/api/admin/payments/${v}/refunded`, {}); toast('완료로 기록했습니다.'); return refresh(); }
    if (a==='invMonth') { const [y,m] = S.inv.month.split('-').map(Number); const d = new Date(y, m-1+(+v), 1); S.inv.month = `${d.getFullYear()}-${p2(d.getMonth()+1)}`; S.inv.sel = []; return refresh(); }
    if (a==='invDay') { S.inv.sel = S.inv.sel.includes(v) ? S.inv.sel.filter(x=>x!==v) : [...S.inv.sel, v]; return refresh(); }
    if (a==='invPick') {
      if (v==='none') S.inv.sel = [];
      else { const [y,m] = S.inv.month.split('-').map(Number), dim = new Date(y,m,0).getDate(), t0 = ymd(new Date()); const out = []; for (let d=1; d<=dim; d++){ const s = `${y}-${p2(m)}-${p2(d)}`, w = new Date(y,m-1,d).getDay(); if (s>=t0 && (v==='all' || w===5 || w===6)) out.push(s); } S.inv.sel = out; }
      return refresh();
    }
    if (a==='invAct') { await api('POST','/api/admin/inventory', {room:S.inv.room, dates:S.inv.sel, action:v}); S.inv.sel = []; toast('적용했습니다.'); return refresh(); }
    if (a==='placeNew') return placeDrawer(null);
    if (a==='placeEdit') return placeDrawer(+v);
    if (a==='plToggle') { await api('PATCH', '/api/admin/places/'+v, {key:t.dataset.k, value: !t.classList.contains('on')}); return refresh(); }
    if (a==='placeDel') { if (!(await confirmBox('숙소 삭제', '숙소와 객실을 삭제합니다. 진행 중 예약이 있으면 삭제되지 않습니다.', '삭제', true))) return; await api('DELETE','/api/admin/places/'+v); toast('삭제했습니다.'); closeDrawer(); return refresh(); }
    if (a==='delSamples') { if (!(await confirmBox('예시 삭제', '예시 숙소·객실·배너를 모두 삭제할까요?', '삭제', true))) return; const r = await api('POST','/api/admin/samples/delete',{}); toast(`예시 숙소 ${r.deleted}곳을 삭제했습니다.`); return refresh(); }
    if (a==='roomNew') return roomDrawer(+v, null);
    if (a==='roomEdit') { const r = S.data.places.rooms.find(x=>x.id===+v); return roomDrawer(r.place_id, +v); }
    if (a==='roomDel') { if (!(await confirmBox('객실 삭제', '객실을 삭제할까요?', '삭제', true))) return; const r = S.data.places.rooms.find(x=>x.id===+v); await api('DELETE','/api/admin/rooms/'+v); S.data.places = await api('GET','/api/admin/places'); toast('삭제했습니다.'); return placeDrawer(r.place_id); }
    if (a==='photoDel') { photoDraft.splice(+v,1); $('#photoBox').outerHTML = photoField($('form[data-af="banner"]')?1:20); return; }
    if (a==='mqStatus') { S.mq.status = v; S.mq.page = 1; return refresh(); }
    if (a==='mqPage') { S.mq.page = +v; return refresh(); }
    if (a==='mSet') {
      const L = {blocked:'이 회원의 이용을 정지할까요? 바로 로그아웃됩니다.', active:'정지를 해제할까요?', admin:'이 회원을 관리자로 지정할까요? 모든 관리 기능을 쓸 수 있게 됩니다.', user:'관리자 권한을 해제할까요?'};
      if (!(await confirmBox('회원 변경', L[v], '변경', v==='blocked'||v==='admin'))) return;
      await api('PATCH','/api/admin/members/'+t.dataset.id, {[t.dataset.k]: v}); toast('변경했습니다.'); return memberDrawer(+t.dataset.id);
    }
    if (a==='tempPw') { if (!(await confirmBox('임시 비밀번호', '새 임시 비밀번호를 만들고 기존 비밀번호는 쓸 수 없게 됩니다. 회원에게 직접 전달하세요.', '발급'))) return; const r = await api('POST',`/api/admin/members/${v}/temp-password`,{}); return confirmBox('임시 비밀번호', `${r.password}\n\n회원에게 전달하고 로그인 후 비밀번호를 바꾸도록 안내하세요. 이 창을 닫으면 다시 볼 수 없습니다.`, '확인'); }
    if (a==='pk') { S.pk = v; return refresh(); }
    if (a==='rv') { S.rv = v; return refresh(); }
    if (a==='rvHide') { await api('PATCH','/api/admin/reviews/'+v, {hidden: t.dataset.h==='1'}); toast(t.dataset.h==='1'?'숨겼습니다.':'다시 공개했습니다.'); return refresh(); }
    if (a==='rvDel') { if (!(await confirmBox('후기 삭제', '후기를 완전히 삭제할까요? 되돌릴 수 없습니다. 보통은 숨기기를 권합니다.', '삭제', true))) return; await api('DELETE','/api/admin/reviews/'+v); toast('삭제했습니다.'); return refresh(); }
    if (a==='adDays') { S.adDays = +v; return refresh(); }
    if (a==='bannerNew') return bannerDrawer(null);
    if (a==='bannerEdit') return bannerDrawer(+v);
    if (a==='bannerDel') { if (!(await confirmBox('배너 삭제', '배너와 성과 기록을 삭제할까요?', '삭제', true))) return; await api('DELETE','/api/admin/banners/'+v); toast('삭제했습니다.'); closeDrawer(); return refresh(); }
  } catch (er) { toast(er.message); }
}
function onDocClick(e){ if (e.target.closest('#drawer')) onClick(e); }

async function onSubmit(e){
  const f = e.target.closest('form[data-af]'); if (!f) return;
  e.preventDefault();
  const k = f.dataset.af, fd = new FormData(f), b = Object.fromEntries(fd);
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (k==='bq') { Object.assign(S.bq, {q:b.q, place:b.place, from:b.from, to:b.to, page:1}); return refresh(); }
    if (k==='mq') { S.mq.q = b.q; S.mq.page = 1; return refresh(); }
    if (k==='memo') { await api('PATCH','/api/admin/bookings/'+f.dataset.id, {admin_memo:b.admin_memo}); return toast('메모를 저장했습니다.'); }
    if (k==='mMemo') { await api('PATCH','/api/admin/members/'+f.dataset.id, {memo:b.memo}); return toast('메모를 저장했습니다.'); }
    if (k==='mPoints') { const r = await api('POST',`/api/admin/members/${f.dataset.id}/points`, {amount:+b.amount, memo:b.memo}); toast(`적용했습니다. 잔액 ${won(r.balance)}P`); return memberDrawer(+f.dataset.id); }
    if (k==='invPrice') { await api('POST','/api/admin/inventory', {room:S.inv.room, dates:S.inv.sel, action:'price', price:+b.price}); S.inv.sel = []; toast('요금을 지정했습니다.'); return refresh(); }
    if (k==='reply') { await api('PATCH','/api/admin/reviews/'+f.dataset.id, {reply:b.reply}); toast('답글을 저장했습니다.'); return refresh(); }
    if (k==='place') {
      const body = {...b, amenities: fd.getAll('amenities'), tags: fd.getAll('tags'), featured: fd.has('featured'), active: fd.has('active'), photos: photoDraft};
      const id = f.dataset.id;
      const p = id ? await api('PUT','/api/admin/places/'+id, body) : await api('POST','/api/admin/places', body);
      S.data.places = await api('GET','/api/admin/places'); toast(id?'저장했습니다.':'등록했습니다. 객실을 추가하세요.');
      if (S.sec==='places') refresh();
      return id ? placeDrawer(p.id) : roomDrawer(p.id, null);
    }
    if (k==='room') {
      const body = {...b, active: fd.has('active'), photos: photoDraft, place_id: +f.dataset.p};
      const id = f.dataset.id;
      if (id) await api('PUT','/api/admin/rooms/'+id, body); else await api('POST','/api/admin/rooms', body);
      S.data.places = await api('GET','/api/admin/places'); toast('저장했습니다.'); if (S.sec==='places') refresh();
      return placeDrawer(+f.dataset.p);
    }
    if (k==='banner') {
      const body = {...b, active: fd.has('active'), image: photoDraft[0] || null};
      const id = f.dataset.id;
      if (id) await api('PUT','/api/admin/banners/'+id, body); else await api('POST','/api/admin/banners', body);
      toast('저장했습니다.'); closeDrawer(); return refresh();
    }
    if (k==='settings') {
      const rules = []; for (let i=0;i<20;i++){ if (!fd.has('rd'+i)) break; const dd = fd.get('rd'+i), rr = fd.get('rr'+i); if (dd!=='' && rr!=='') rules.push({days:+dd, rate:+rr}); }
      const body = {...b, payMethods: fd.getAll('payMethods'), cancelRules: rules,
        points: {signupBonus:+b.p_signupBonus, earnRate:+b.p_earnRate, reviewBonus:+b.p_reviewBonus, minUse:+b.p_minUse, unit:+b.p_unit, maxUseRate:+b.p_maxUseRate, expireDays:+b.p_expireDays}};
      await api('PUT','/api/admin/settings', body); toast('설정을 저장했습니다.');
      document.documentElement.style.setProperty('--brand', b.color);
      return refresh();
    }
  } catch (er) { toast(er.message); }
  finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
}
async function onChange(e){
  if (e.target.id === 'invRoom') { S.inv.room = +e.target.value; S.inv.sel = []; return refresh(); }
  if (e.target.id === 'photoIn') {
    const max = $('form[data-af="banner"]') ? 1 : 20;
    const files = [...e.target.files].slice(0, max - photoDraft.length);
    for (const f of files) { try { photoDraft.push(await upload(f)); } catch (er) { toast(er.message); } }
    $('#photoBox').outerHTML = photoField(max);
  }
}

return {
  mount(el, ctx){
    root = el; X = ctx; api = ctx.api; toast = ctx.toast; confirmBox = ctx.confirmBox; esc = ctx.esc; won = ctx.won;
    root.addEventListener('click', onClick);
    document.addEventListener('click', onDocClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('change', onChange);
    show('dash');
  }
};
})();
