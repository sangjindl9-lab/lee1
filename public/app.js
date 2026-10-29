(function(){
'use strict';
/* ================= 기본 도구 ================= */
const $=s=>document.querySelector(s);
const pad=n=>String(n).padStart(2,'0');
const TODAY=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
const NOW=()=>{const d=new Date();return TODAY()+' '+pad(d.getHours())+':'+pad(d.getMinutes());};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>{if(v===null||v===undefined)return null;const t=String(v).replace(/[^\d.\-]/g,'');if(t===''||t==='-'||t==='.')return null;const n=Number(t);return isFinite(n)?n:null;};
const fmt=n=>(n==null||isNaN(n))?'—':Math.round(n).toLocaleString('ko-KR');
const won=n=>(n==null||isNaN(n))?'—':fmt(n)+'원';
const pct=n=>(n==null||!isFinite(n))?'계산 불가':(Math.round(n*100)/100).toFixed(2)+'%';
const sum=(arr,f)=>(arr||[]).reduce((a,x)=>a+(Number(f(x))||0),0);
const dday=d=>d?Math.round((Date.parse(d)-Date.parse(TODAY()))/864e5):null;
const vatOf=s=>Math.floor(s/10);
function toSupply(a,b){if(a==null)return null;return b==='total'?Math.round(a*10/11):a;}
function tri(a,b){if(a==null)return null;if(b==='total'){const s=Math.round(a*10/11);return{s,v:a-s,t:a};}const v=vatOf(a);return{s:a,v,t:a+v};}
const BASIS=[['supply','공급가액 기준'],['total','부가세 포함 합계']];
const bl=b=>b==='total'?'부가세 포함 합계':'공급가액';
const RULE='반올림 기준 · 하도급금액 = 원도급 공급가액 × 하도급률 ÷ 100 (원 미만 버림) · 부가세 = 공급가액 × 10% (원 미만 버림) · 합계로 입력한 금액은 ÷1.1로 공급가액 환산 (원 미만 반올림), 부가세 = 합계 − 공급가액 · 하도급률은 소수점 셋째 자리에서 반올림해 둘째 자리까지 표시';
const STATUSES=['계약 전','계약 완료','진행 중','준공','정산 중','완료'];
const STCLS={'계약 전':'','계약 완료':'info','진행 중':'accent','준공':'info','정산 중':'warn','완료':'ok'};
const ROLES={admin:'관리자',office:'사무직원',field:'현장직원'};
const PERMS=[
 ['viewMoney','계약금액·비용·수익 보기'],['allSites','배정되지 않은 현장도 보기'],['editSites','현장 등록·수정'],
 ['editChanges','계약 변경 관리'],['editLogs','작업일지 작성·수정'],['editLabor','인력·인건비 관리'],
 ['editCosts','자재·비용·외주 관리'],['editBills','기성·청구·수금 관리'],['editDocs','사진·서류 등록'],['editPartners','거래처 관리']];
const PARTNER_TYPES=['발주기관','원도급업체','자재 구매처','협력업체','장비업체','기타'];
const COLS=['sites','logs','labor','costs','subs','bills','docs','partners'];

/* ================= 서버 연결 ================= */
let S=null,snap=null,lastStr=null,nextHash=null;
async function api(url,body,method){
  const o={method:method||(body!==undefined?'POST':'GET'),headers:{'X-Requested-With':'fetch'},credentials:'same-origin'};
  if(body instanceof FormData)o.body=body;
  else if(body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body);}
  let r;
  try{r=await fetch(url,o);}catch(e){throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.');}
  let j=null;try{j=await r.json();}catch(e){}
  if(r.status===401&&!url.endsWith('/login')){showLogin();throw Object.assign(new Error('로그인이 만료되었습니다. 다시 로그인하세요.'),{auth:true});}
  if(!r.ok)throw Object.assign(new Error((j&&j.error)||('서버 오류 ('+r.status+')')),{state:j&&j.state});
  return j;
}
function applyState(st){
  S=st;
  COLS.forEach(c=>S[c]=S[c]||[]);
  S.sites.forEach(s=>{s.changes=s.changes||[];s.history=s.history||[];s.primeInput=s.primeInput||{amt:null,basis:'supply'};s.subInput=s.subInput||{amt:null,basis:'supply'};s.ourInput=s.ourInput||{amt:null,basis:'supply'};});
  S.bills.forEach(b=>b.receipts=b.receipts||[]);S.subs.forEach(b=>b.payments=b.payments||[]);
  lastStr=JSON.stringify(S);takeSnap();
}
function takeSnap(){snap={};for(const c of COLS)snap[c]=new Map(S[c].map(r=>[r.id,JSON.stringify(r)]));snap.settings=JSON.stringify(S.settings);}
function diff(){
  const up={},del={};let n=0;
  for(const c of COLS){
    const cur=new Map(S[c].map(r=>[r.id,r]));
    for(const[id,r]of cur){if(snap[c].get(id)!==JSON.stringify(r)){(up[c]=up[c]||[]).push(r);n++;}}
    for(const[id,j]of snap[c])if(!cur.has(id)){(del[c]=del[c]||[]).push({id,_rev:JSON.parse(j)._rev});n++;}
  }
  if(JSON.stringify(S.settings)!==snap.settings){up.settings=[S.settings];n++;}
  return{up,del,n};
}
async function sync(){
  if(!snap)return false;
  const d=diff();if(!d.n)return true;
  try{const r=await api('/api/batch',{upserts:d.up,deletes:d.del});applyState(r.state);return true;}
  catch(e){if(e.state)applyState(e.state);else if(lastStr)applyState(JSON.parse(lastStr));toast(e.message,'err');return false;}
}
const save=()=>true; /* 저장은 창을 닫을 때 서버로 한 번에 보냄 */
async function refresh(quiet){
  try{const st=await api('/api/state');applyState(st);if($('#modal').hidden)render();}
  catch(e){if(!e.auth&&!quiet)toast(e.message,'err');}
}

/* ================= 권한 ================= */
const me=()=>S.me;
const isAdmin=()=>S.me.role==='admin';
const can=p=>!!(S.me.perms||{})[p];
const visibleSites=()=>S.sites;
const visIds=()=>new Set(S.sites.map(s=>s.id));
const siteById=id=>S.sites.find(s=>s.id===id);
const siteName=id=>(siteById(id)||{}).name||'(삭제된 현장)';

/* ================= 계산 ================= */
function primeSupplyOf(s){return s.type==='sub'?toSupply(s.primeInput.amt,s.primeInput.basis):null;}
const rateOf=(our,prime)=>(our!=null&&prime>0)?our/prime*100:null;
function changeRows(s){
  let prevOur=s.confirmedSupply??null,prime=primeSupplyOf(s);
  const rows=[{initial:true,our:prevOur,prime,rate:rateOf(prevOur,prime)}];
  const list=[...s.changes].sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.created||0)-(b.created||0));
  let pending=0,pendingN=0;
  for(const c of list){
    if(c.status==='확정'){
      const p=c.primeAfter!=null?c.primeAfter:prime,o=c.ourAfter!=null?c.ourAfter:prevOur;
      rows.push({c,prime:p,our:o,delta:(o!=null&&prevOur!=null)?o-prevOur:null,primeDelta:(c.primeAfter!=null&&prime!=null)?c.primeAfter-prime:null,rate:rateOf(o,p)});
      prime=p;prevOur=o;
    }else{rows.push({c,pending:true});pending+=c.estimate||0;pendingN++;}
  }
  return{rows,current:prevOur,prime,pending,pendingN};
}
function metrics(s){
  const cr=changeRows(s);
  const labor=S.labor.filter(x=>x.siteId===s.id),costs=S.costs.filter(x=>x.siteId===s.id),subs=S.subs.filter(x=>x.siteId===s.id),bills=S.bills.filter(x=>x.siteId===s.id);
  const laborSum=sum(labor,x=>x.amount),costSum=sum(costs,x=>x.supply),subSum=sum(subs,x=>x.supply),cost=laborSum+costSum+subSum;
  const subPaid=sum(subs,x=>sum(x.payments,p=>p.amount)),subTotal=sum(subs,x=>(x.supply||0)+(x.vat||0));
  const billedS=sum(bills,b=>b.supply),billedT=sum(bills,b=>(b.supply||0)+(b.vat||0)),recvT=sum(bills,b=>sum(b.receipts,r=>r.amount));
  const contract=cr.current;
  return{contract,prime:cr.prime,rate:s.type==='sub'?rateOf(contract,cr.prime):null,pending:cr.pending,pendingN:cr.pendingN,
    laborSum,costSum,subSum,subPaid,subUnpaid:subTotal-subPaid,cost,billedS,billedT,recvT,
    unbilled:contract!=null?contract-billedS:null,receivable:billedT-recvT,profit:contract!=null?contract-cost:null};
}
function subCalc(v){
  const o={msgs:[],warn:[]};
  o.prime=tri(v.primeAmt,v.primeBasis);const pS=o.prime?o.prime.s:null;
  if(v.subMode==='rate'){
    if(pS==null)o.msgs.push('원도급 계약금액을 입력하면 하도급금액이 계산됩니다.');
    else if(pS<=0)o.msgs.push('원도급 금액이 0원이라 하도급금액을 계산하지 않습니다.');
    if(v.rate==null)o.msgs.push('하도급률(%)을 입력해 주세요.');
    else if(v.rate<=0||v.rate>100)o.warn.push('하도급률이 0% 이하이거나 100%를 넘습니다. 입력값을 확인해 주세요.');
    if(pS>0&&v.rate!=null&&v.rate>0){o.sub=tri(Math.floor(pS*v.rate/100+1e-7),'supply');o.rate=v.rate;o.src='입력한 비율';}
    if(v.primeBasis==='total'&&pS!=null)o.msgs.push('원도급 금액을 부가세 포함 합계로 입력해 공급가액으로 환산한 뒤 하도급률을 적용했습니다.');
  }else{
    o.sub=tri(v.subAmt,v.subBasis);
    if(!o.sub)o.msgs.push('실제 하도급 계약금액을 입력해 주세요.');
    if(pS==null)o.msgs.push('원도급 금액이 없어 하도급률은 계산 불가로 표시합니다.');
    else if(pS<=0)o.msgs.push('원도급 금액이 0원이라 하도급률을 계산하지 않습니다.');
    if(o.sub&&pS>0){o.rate=o.sub.s/pS*100;o.src='역산';if(o.rate>100)o.warn.push('하도급금액이 원도급금액보다 큽니다. 금액을 확인해 주세요.');}
    if(v.primeAmt!=null&&v.subAmt!=null&&v.primeBasis!==v.subBasis)
      o.warn.push(`두 금액의 입력 기준이 다릅니다 (원도급: ${bl(v.primeBasis)}, 하도급: ${bl(v.subBasis)}). 비율은 둘 다 공급가액으로 환산해 계산했습니다. 계약서의 금액 기준을 확인해 같은 기준으로 맞춰 주세요.`);
  }
  return o;
}
function triRow(label,t){return `<tr><td>${label}</td><td class="r">${t?fmt(t.s):'—'}</td><td class="r">${t?fmt(t.v):'—'}</td><td class="r">${t?fmt(t.t):'—'}</td></tr>`;}
function calcPanel(c,mode){
  return `<div class="tbl-wrap"><table><thead><tr><th>구분</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th></tr></thead><tbody>
  ${triRow('원도급 계약금액',c.prime)}${triRow(mode==='rate'?'하도급금액 (계산값)':'하도급 계약금액 (입력값)',c.sub)}</tbody></table></div>
  <div class="rate">하도급률: ${pct(c.rate)} ${c.rate!=null?`<span class="small muted">(${c.src})</span>`:''}</div>
  ${c.msgs.map(m=>`<p class="note">${esc(m)}</p>`).join('')}${c.warn.map(m=>`<p class="note warn">${esc(m)}</p>`).join('')}
  <p class="rule">${RULE}</p>`;
}
function triTable(rows){return `<div class="tbl-wrap"><table><thead><tr><th>구분</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th></tr></thead><tbody>${rows.map(r=>triRow(r[0],r[1])).join('')}</tbody></table></div>`;}

/* ================= 예시 데이터 (교육용) ================= */
function sampleData(){
  const A='a'+uid(),B='b'+uid(),C='c'+uid(),L1='l'+uid(),L2='l'+uid(),L3='l'+uid(),t=Date.now();
  return{
    sites:[
      {id:A,sample:true,name:'(예시) ○○시청 청사 구내통신 개선공사',address:'○○시 ○○로 100 (예시 주소)',type:'sub',kind:'구내통신',client:'○○시청',clientContact:'정보통신과 담당 주무관 · 031-000-0000',clientPerson:'',contractNo:'',prime:'예시종합건설㈜',primeContact:'공무 담당 과장 · 010-0000-0000',primeNo:'예시-2026-071',contractDate:'2026-07-20',startDate:'2026-08-01',endPlanned:'2026-12-20',endActual:'',status:'진행 중',manager:'',billTo:'예시종합건설㈜',note:'예시 현장입니다. 원도급 1억 원에 하도급률 80%를 적용해 계산한 뒤 확정했습니다.',
       primeInput:{amt:100000000,basis:'supply'},subMode:'rate',rate:80,subInput:{amt:null,basis:'supply'},ourInput:{amt:null,basis:'supply'},confirmedSupply:80000000,
       changes:[{id:uid(),created:t,date:'2026-09-25',kind:'설계변경',reason:'케이블 트레이 경로 변경 및 통신 단자함 2개소 추가',status:'확정',primeAfter:110000000,ourAfter:87000000,estimate:null,note:'1차 변경계약'},
        {id:uid(),created:t+1,date:'2026-10-20',kind:'추가공사',reason:'3층 회의실 무선AP 추가 요청 (금액 협의 중)',status:'미확정',primeAfter:null,ourAfter:null,estimate:3000000,note:'견적 제출 완료'}],history:[]},
      {id:B,sample:true,name:'(예시) △△교육지원청 학교 CCTV 설치공사',address:'△△시 일대 초·중학교 4개교 (예시)',type:'prime',kind:'CCTV',client:'△△교육지원청',clientContact:'시설과 담당 · 02-000-0000',clientPerson:'재무과 계약 담당',contractNo:'제2026-0915호 (예시)',prime:'',primeContact:'',primeNo:'',contractDate:'2026-09-28',startDate:'2026-10-05',endPlanned:'2026-11-30',endActual:'',status:'진행 중',manager:'',billTo:'△△교육지원청',note:'예시 원도급 현장입니다. 계약금액을 부가세 포함 합계 49,500,000원으로 입력했습니다.',
       primeInput:{amt:null,basis:'supply'},subMode:'rate',rate:null,subInput:{amt:null,basis:'supply'},ourInput:{amt:49500000,basis:'total'},confirmedSupply:45000000,changes:[],history:[]},
      {id:C,sample:true,name:'(예시) □□군 광통신선로 이설공사',address:'□□군 □□면 일대 (예시)',type:'sub',kind:'통신선로',client:'□□군청',clientContact:'',clientPerson:'',contractNo:'',prime:'예시건설산업㈜',primeContact:'현장소장 · 010-0000-1111',primeNo:'',contractDate:'',startDate:'2026-11-10',endPlanned:'2027-02-26',endActual:'',status:'계약 전',manager:'',billTo:'예시건설산업㈜',note:'원도급 금액을 모르는 예시입니다. 하도급 금액만 직접 입력해 하도급률은 계산 불가로 표시됩니다.',
       primeInput:{amt:null,basis:'supply'},subMode:'direct',rate:null,subInput:{amt:30000000,basis:'supply'},ourInput:{amt:null,basis:'supply'},confirmedSupply:null,changes:[],history:[]}],
    logs:[
      {id:L1,sample:true,siteId:A,date:'2026-10-26',content:'2층 통신실 케이블 트레이 설치\nUTP Cat.6 40회선 포설',workers:3,manDays:3,hours:'08:00~17:00',equipment:'고소작업대 1대',note:'내일 천장 점검구 개방 필요 — 원도급 공무 과장에게 전달',author:'예시 작성자',createdAt:'2026-10-26 17:40'},
      {id:L2,sample:true,siteId:A,date:'2026-10-27',content:'통신 단자함 2개소 설치, 회선 성단 24회선',workers:2,manDays:2,hours:'08:00~17:00',equipment:'',note:'',author:'예시 작성자',createdAt:'2026-10-27 17:25'},
      {id:L3,sample:true,siteId:B,date:'2026-10-27',content:'1차 학교 카메라 브라켓 설치 8개소',workers:2,manDays:2,hours:'09:00~18:00',equipment:'사다리차 반일',note:'학교 행정실 요청으로 수업 시간 중 소음 작업 금지',author:'예시 작성자',createdAt:'2026-10-27 18:10'}],
    labor:[
      {id:uid(),sample:true,siteId:A,date:'2026-10-26',worker:'작업자 3명 (예시)',content:'케이블 트레이 설치·UTP 포설',qty:3,unit:'공수',unitPrice:230000,amount:690000,payDue:'2026-11-10',paidDate:'',paid:false,logId:L1},
      {id:uid(),sample:true,siteId:B,date:'2026-10-27',worker:'예시전설 (협력업체)',content:'카메라 브라켓 설치',qty:2,unit:'공수',unitPrice:250000,amount:500000,payDue:'2026-10-28',paidDate:'2026-10-28',paid:true,logId:L3}],
    costs:[
      {id:uid(),sample:true,siteId:A,cat:'자재',name:'UTP Cat.6 케이블',spec:'305m/BOX',qty:6,unitPrice:145000,supply:870000,vat:87000,taxed:true,vendor:'예시전선상사',date:'2026-10-20',note:''},
      {id:uid(),sample:true,siteId:A,cat:'자재',name:'케이블 트레이',spec:'300×100',qty:40,unitPrice:38000,supply:1520000,vat:152000,taxed:true,vendor:'예시전선상사',date:'2026-10-21',note:''},
      {id:uid(),sample:true,siteId:A,cat:'장비 임대료',name:'고소작업대',spec:'1일',qty:1,unitPrice:180000,supply:180000,vat:18000,taxed:true,vendor:'예시중기',date:'2026-10-26',note:''},
      {id:uid(),sample:true,siteId:B,cat:'자재',name:'IP 카메라',spec:'4MP 돔형',qty:24,unitPrice:210000,supply:5040000,vat:504000,taxed:true,vendor:'예시보안유통',date:'2026-10-15',note:''},
      {id:uid(),sample:true,siteId:B,cat:'운반비',name:'자재 운반',spec:'1톤',qty:1,unitPrice:120000,supply:120000,vat:12000,taxed:true,vendor:'예시용달',date:'2026-10-16',note:''}],
    subs:[{id:uid(),sample:true,siteId:B,partner:'예시통신㈜ (예시)',scope:'2~4차 학교 배관·배선',contractDate:'2026-10-10',supply:8000000,vat:800000,note:'',payments:[{id:uid(),date:'2026-10-25',amount:4400000,note:'선급 50%'}]}],
    bills:[
      {id:uid(),sample:true,siteId:A,seq:1,kind:'기성',date:'2026-09-30',supply:20000000,vat:2000000,billTo:'예시종합건설㈜',dueDate:'2026-10-31',note:'1회 기성',receipts:[{id:uid(),date:'2026-10-15',amount:15000000,note:'일부 입금'}]},
      {id:uid(),sample:true,siteId:A,seq:2,kind:'기성',date:'2026-10-25',supply:15000000,vat:1500000,billTo:'예시종합건설㈜',dueDate:'2026-11-25',note:'2회 기성',receipts:[]},
      {id:uid(),sample:true,siteId:B,seq:1,kind:'기성',date:'2026-10-20',supply:9000000,vat:900000,billTo:'△△교육지원청',dueDate:'2026-11-05',note:'1회 기성',receipts:[{id:uid(),date:'2026-10-27',amount:9900000,note:''}]}],
    docs:[],
    partners:[
      {id:uid(),sample:true,name:'예시종합건설㈜',type:'원도급업체',person:'공무 과장',phone:'010-0000-0000',bizNo:'',note:'예시'},
      {id:uid(),sample:true,name:'예시전선상사',type:'자재 구매처',person:'영업 담당',phone:'010-0000-2222',bizNo:'',note:'예시'}]
  };
}

/* ================= 화면 도구 ================= */
const F=(label,control,hint='',cls='')=>`<label class="fld ${cls}"><span class="lb">${label}</span>${control}${hint?`<span class="hint">${hint}</span>`:''}</label>`;
const inp=(name,val,attrs='')=>`<input name="${name}" id="f-${name}" value="${esc(val??'')}" ${attrs}>`;
const money=(name,val)=>inp(name,val==null?'':fmt(val),'class="money" inputmode="numeric" autocomplete="off"');
const dateI=(name,val)=>inp(name,val,'type="date"');
const sel=(name,opts,val,attrs='')=>`<select name="${name}" id="f-${name}" ${attrs}>${opts.map(o=>{const[v,t]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(v)===String(val??'')?'selected':''}>${esc(t)}</option>`;}).join('')}</select>`;
const ta=(name,val,rows=3)=>`<textarea name="${name}" id="f-${name}" rows="${rows}">${esc(val??'')}</textarea>`;
const radio=(name,v,t,cur)=>`<label><input type="radio" name="${name}" value="${v}" ${cur===v?'checked':''}> ${t}</label>`;
const pill=(t,c='')=>`<span class="pill ${c}">${esc(t)}</span>`;
const stPill=s=>pill(s,STCLS[s]||'');
const typePill=t=>t==='sub'?pill('하도급','info'):pill('원도급','ok');
const sampleTag=x=>x&&x.sample?pill('예시','sample'):'';
const siteLink=s=>`<a class="sitelink" href="#site-${s.id}">${esc(s.name)}</a>`;
const pageHead=(title,acts='',sub='')=>`<div class="ph"><div class="tt"><h1>${title}</h1>${sub?`<p>${sub}</p>`:''}</div><div class="acts noprint">${acts}</div></div>`;
const btn=(t,act,extra='',cls='')=>`<button type="button" class="btn ${cls}" data-act="${act}" ${extra}>${t}</button>`;
const siteOpts=(all=true)=>[...(all?[['','전체 현장']]:[]),...visibleSites().map(s=>[s.id,s.name])];
const empty=t=>`<div class="empty">${t}</div>`;
const fileUrl=(d,o='')=>`/api/files/${encodeURIComponent(d.id)}${o}`;
const thumbOf=d=>d.file?(d.file.hasThumb?fileUrl(d,'?thumb=1'):((d.type||'').startsWith('image/')?fileUrl(d):null)):null;
function g(f,n){const el=f.elements[n];if(!el)return '';return (el.value||'').trim();}

function toast(msg,type){const t=$('#toast');t.textContent=msg;t.className=type||'';t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>{t.hidden=true;},type==='err'?7000:2600);}

let modalSubmit=null;
function openModal(title,body,o={}){
  const m=$('#modal');
  m.innerHTML=`<div class="sheet ${o.wide?'wide':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
   <div class="sh-head"><h2>${esc(title)}</h2>${o.noClose?'':'<button class="btn ghost" data-act="close-modal" type="button">닫기</button>'}</div>
   <form id="mform" novalidate><div class="sh-body">${body}</div>
   <div class="sh-foot">${o.foot||''}${o.submit?`<button class="btn primary big" type="submit">${o.submitLabel||'저장'}</button>`:''}</div></form></div>`;
  m.hidden=false;document.body.classList.add('noscroll');modalSubmit=o.submit||null;m.scrollTop=0;m.dataset.lock=o.noClose?'1':'';
}
function closeModal(){const m=$('#modal');m.hidden=true;m.innerHTML='';document.body.classList.remove('noscroll');modalSubmit=null;}
function confirmBox(msg,yes,fn){openModal('확인',`<p>${msg}</p>`,{submit:()=>{fn();},submitLabel:yes});}

function compress(file,max,q){
  return new Promise(res=>{
    if(!file.type||!file.type.startsWith('image/')){res(null);return;}
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{let w=img.width,h=img.height;const k=Math.min(1,max/Math.max(w,h));w=Math.round(w*k);h=Math.round(h*k);
      const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);URL.revokeObjectURL(url);
      c.toBlob(b=>res(b),'image/jpeg',q);};
    img.onerror=()=>{URL.revokeObjectURL(url);res(null);};img.src=url;
  });
}
/* 파일 올리기: 먼저 입력 내용을 저장한 뒤 원본 파일과 미리보기를 서버에 올림 */
async function addFiles(files,meta){
  if(!(await sync()))throw new Error('입력 내용을 먼저 저장하지 못해 파일을 올리지 않았습니다.');
  let n=0;const tot=files.length;
  for(const f of files){
    toast(`파일 올리는 중… (${n+1}/${tot}) ${f.name}`);
    const fd=new FormData();fd.append('meta',JSON.stringify(meta));fd.append('file',f,f.name);
    const th=await compress(f,480,0.7);if(th)fd.append('thumb',th,'thumb.jpg');
    try{const r=await api('/api/files',fd);S.docs.push(r.doc);n++;}
    catch(e){toast(`${f.name}: ${e.message}`,'err');}
  }
  lastStr=JSON.stringify(S);takeSnap();
  if(n)toast(`파일 ${n}개를 저장했습니다.`);
  return n;
}

/* ================= 내보내기 ================= */
function downloadCSV(filename,table){
  const text='﻿'+table.map(r=>r.map(c=>{const s=String(c??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\r\n');
  const b=new Blob([text],{type:'text/csv;charset=utf-8'}),u=URL.createObjectURL(b),a=document.createElement('a');
  a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000);
  toast(`${filename} 파일을 내려받았습니다. 엑셀에서 열 수 있습니다.`);
}

/* ================= 로그인 ================= */
function showLogin(msg){
  closeModal();$('#app').hidden=true;$('#boot').hidden=true;$('#fab').hidden=true;
  const L=$('#login');L.hidden=false;
  L.innerHTML=`<form class="box" id="loginform" novalidate><div><h1>현장 공사관리</h1><p class="co">${esc((S&&S.settings&&S.settings.company)||'')} 직원 전용</p></div>
   ${msg?`<p class="note warn">${esc(msg)}</p>`:''}
   ${F('아이디',`<input name="username" id="f-username" autocomplete="username" autocapitalize="off" required>`)}
   ${F('비밀번호',`<input name="password" id="f-password" type="password" autocomplete="current-password" required>`)}
   <button class="btn primary big" type="submit">로그인</button>
   <p class="hint">아이디나 비밀번호를 잊었으면 관리자에게 비밀번호 초기화를 요청하세요.</p></form>`;
  setTimeout(()=>{const i=$('#f-username');i&&i.focus();},50);
}
async function boot(){
  try{const st=await api('/api/state');applyState(st);}catch(e){if(!e.auth){$('#boot').innerHTML=`<p>${esc(e.message)}</p><p><button class="btn" onclick="location.reload()">다시 시도</button></p>`;}return;}
  $('#login').hidden=true;$('#login').innerHTML='';$('#boot').hidden=true;$('#app').hidden=false;
  route=parseHash();render();
  if(S.me.mustChange)pwForm(true);
}

/* ================= 레이아웃 ================= */
const MENU=[['dashboard','대시보드',()=>true],['sites','현장 관리',()=>true],['logs','작업일지',()=>true],['labor','인력·인건비',()=>can('editLabor')],
 ['costs','자재·비용·외주',()=>can('editCosts')],['bills','기성·청구·수금',()=>can('editBills')],['docs','사진·서류',()=>true],['partners','거래처 관리',()=>can('editPartners')],['setup','설정 및 사용자',()=>isAdmin()]];
let route={name:'dashboard'};let siteTab='info',lastSite=null;
function parseHash(){const h=decodeURIComponent((location.hash||'').slice(1));if(!h)return{name:'dashboard'};const m=h.match(/^(site|print)-(.+)$/);if(m)return{name:m[1],id:m[2]};return{name:h};}
function renderNav(){
  const cur=route.name==='site'||route.name==='print'?'sites':route.name==='printlogs'?'logs':route.name;
  $('#nav').innerHTML=`<div class="brand"><b>${esc(S.settings.company||'우리 회사')}</b><span>현장별 공사관리</span></div>
  ${MENU.map((m,i)=>m[2]()?`<a class="nav-a ${cur===m[0]?'on':''}" href="#${m[0]}"><span class="n">${i+1}</span>${m[1]}</a>`:'').join('')}
  <div class="nav-foot">${esc(S.me.name)} · ${ROLES[S.me.role]}<br><button class="btn sm ghost" data-act="account" type="button" style="padding-left:0">내 계정 · 로그아웃</button></div>`;
  const title=(MENU.find(m=>m[0]===cur)||[0,'현장 공사관리'])[1];
  $('#top').innerHTML=`<button id="menuBtn" class="btn sm" data-act="toggle-nav" type="button" aria-label="메뉴 열기">메뉴</button>
   <span class="t">${esc(title)}</span>
   <button type="button" class="userchip" data-act="account" aria-label="내 계정">${esc(S.me.name)} <small>(${ROLES[S.me.role]})</small> ▾</button>`;
  $('#fab').hidden=!(can('editLogs')&&visibleSites().length);
}
function render(){
  if(!S)return;
  renderNav();$('#app').classList.remove('navopen');
  const r=route,main=$('#main');let h='';
  const allowed=MENU.find(m=>m[0]===r.name);
  if(allowed&&!allowed[2]())h=empty('이 메뉴를 볼 권한이 없습니다. 관리자에게 권한 설정을 요청하세요.');
  else switch(r.name){
    case 'sites':h=vSites();break;
    case 'site':h=vSite(r.id);break;
    case 'logs':h=vLogs();break;
    case 'labor':h=vLabor();break;
    case 'costs':h=vCosts();break;
    case 'bills':h=vBills();break;
    case 'docs':h=vDocs();break;
    case 'partners':h=vPartners();break;
    case 'setup':h=vSetup();break;
    case 'print':h=vPrintSite(r.id);break;
    case 'printlogs':h=vPrintLogs();break;
    default:h=vDashboard();
  }
  main.innerHTML=h;
}

/* ================= 대시보드 ================= */
function alertsFor(sites){
  const a=[],money=can('viewMoney');
  for(const s of sites){
    const ds=dday(s.startDate),de=dday(s.endPlanned);
    if(ds!=null&&ds>=0&&ds<=30&&['계약 전','계약 완료'].includes(s.status))a.push(['info',`착공 예정 D-${ds} (${s.startDate})`,s]);
    if(de!=null&&de>=0&&de<=30&&['계약 완료','진행 중'].includes(s.status))a.push(['warn',`준공 예정 D-${de} (${s.endPlanned})`,s]);
    if(de!=null&&de<0&&['계약 완료','진행 중'].includes(s.status))a.push(['danger',`준공 예정일 ${-de}일 경과 (${s.endPlanned}) — 준공 처리 또는 일정 확인`,s]);
    if(money){
      const m=metrics(s);
      if(m.contract==null&&s.status!=='완료')a.push(['warn','확정 계약금액이 입력되지 않아 미청구금·예상 수익을 계산할 수 없습니다',s]);
      if(m.pendingN)a.push(['info',`금액 미확정 변경·추가공사 ${m.pendingN}건 (예상 ${won(m.pending)}) — 확정 계약금액에는 포함하지 않음`,s]);
      for(const b of S.bills.filter(b=>b.siteId===s.id)){
        const out=(b.supply+b.vat)-sum(b.receipts,r=>r.amount),d=dday(b.dueDate);
        if(out>0&&d!=null&&d<0)a.push(['danger',`${b.seq}회 ${b.kind} 미수금 ${won(out)} — 지급 예정일 ${-d}일 경과`,s]);
        else if(out>0&&d!=null&&d<=14)a.push(['warn',`${b.seq}회 ${b.kind} 수금 예정 D-${d} (${won(out)})`,s]);
      }
    }
    if(can('editLabor'))for(const l of S.labor.filter(l=>l.siteId===s.id&&!l.paid)){const d=dday(l.payDue);if(d!=null&&d<0)a.push(['danger',`인건비 미지급 (${l.worker}, 지급 예정 ${l.payDue})`,s]);}
  }
  const rank={danger:0,warn:1,info:2};return a.sort((x,y)=>rank[x[0]]-rank[y[0]]);
}
function formulaBox(){
  return `<div class="card stack"><h3>계산 기준</h3><div class="formula">
  <div><b>미청구금</b><span>= 우리 회사의 현재 확정 계약금액 − 누적 청구금액 (공급가액 기준)</span></div>
  <div><b>미수금</b><span>= 누적 청구금액 − 누적 수금액 (부가세 포함 합계 기준 — 실제 입금액이 부가세 포함이므로)</span></div>
  <div><b>예상 수익</b><span>= 우리 회사의 현재 확정 계약금액 − 지금까지 입력한 비용 (공급가액 기준)</span></div>
  <div><b>비용</b><span>= 인건비(부가세 없음) + 자재·장비·경비(공급가액) + 외주 계약금액(공급가액)</span></div>
  <div><b>계약금액</b><span>하도급 공사는 원도급 금액이 아니라 우리 회사의 확정 하도급 계약금액을 씁니다. 금액 미확정 추가공사는 포함하지 않습니다.</span></div></div>
  <p class="note warn">예상 수익은 아직 입력하지 않은 비용(남은 자재, 미입력 인건비, 경비 등)이 빠져 있어 최종 확정 이익이 아닙니다.</p></div>`;
}
function vDashboard(){
  const sites=visibleSites(),money=can('viewMoney');
  const ms=sites.map(s=>({s,m:metrics(s)}));
  const active=sites.filter(s=>s.status==='진행 중').length;
  const T=k=>sum(ms,x=>x.m[k]);
  const al=alertsFor(sites);
  const recent=[...S.logs].sort((a,b)=>(b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||''))).slice(0,5);
  let h=pageHead('대시보드',(can('editSites')?btn('+ 현장 등록','new-site','','primary'):'')+btn('새로 불러오기','refresh'),`${TODAY()} 기준 · ${esc(me().name)}(${ROLES[me().role]})님 화면`);
  if(S.sites.some(s=>s.sample))h+=`<p class="note sample" style="margin-bottom:16px">보라색 <b>예시</b> 표시가 붙은 현장과 기록은 사용법을 익히기 위한 가상 데이터입니다. ${isAdmin()?'[설정 및 사용자]에서 한 번에 지울 수 있습니다.':''}</p>`;
  if(!sites.length)h+=`<div class="empty stack" style="margin-bottom:16px"><b>아직 등록된 현장이 없습니다.</b>${can('editSites')?`<span>[+ 현장 등록]으로 첫 현장을 등록하세요.${isAdmin()?' 연습해 보려면 [설정 및 사용자]에서 예시 데이터를 넣을 수 있습니다.':''}</span>`:'<span>관리자가 현장을 배정하면 여기에 보입니다.</span>'}</div>`;
  h+=`<div class="stack"><div class="tiles">
   <div class="tile hl"><div class="k">진행 중 현장</div><div class="v">${active}곳</div><div class="s">전체 ${sites.length}곳</div></div>
   ${money?`<div class="tile"><div class="k">우리 회사 계약금액 합계</div><div class="v">${won(T('contract'))}</div><div class="s">확정 금액, 공급가액</div></div>
   <div class="tile"><div class="k">발생 비용 합계</div><div class="v">${won(T('cost'))}</div><div class="s">공급가액</div></div>
   <div class="tile"><div class="k">미청구금 합계</div><div class="v">${won(T('unbilled'))}</div><div class="s">공급가액</div></div>
   <div class="tile ${T('receivable')>0?'neg':''}"><div class="k">미수금 합계</div><div class="v">${won(T('receivable'))}</div><div class="s">부가세 포함</div></div>
   <div class="tile"><div class="k">예상 수익 합계</div><div class="v">${won(T('profit'))}</div><div class="s">확정 이익 아님</div></div>`:''}
  </div>
  <div class="cols">
   <div class="card stack"><h3>확인이 필요한 일정·금액</h3>${al.length?`<ul class="alerts">${al.slice(0,15).map(x=>`<li>${pill(x[0]==='danger'?'긴급':x[0]==='warn'?'확인':'안내',x[0])}<div><a href="#site-${x[2].id}"><b>${esc(x[2].name)}</b></a><br><span class="small">${esc(x[1])}</span></div></li>`).join('')}</ul>`:'<p class="muted">지금 확인할 항목이 없습니다.</p>'}</div>
   <div class="card stack"><h3>최근 작업일지</h3>${recent.length?`<ul class="alerts">${recent.map(l=>`<li><span class="pill">${esc((l.date||'').slice(5))}</span><div><a href="#site-${l.siteId}"><b>${esc(siteName(l.siteId))}</b></a><br><span class="small">${esc((l.content||'').split('\n')[0])} · ${esc(l.author)}</span></div></li>`).join('')}</ul>`:'<p class="muted">등록된 작업일지가 없습니다.</p>'}
   <a class="btn" href="#logs">작업일지 전체 보기</a></div>
  </div>
  ${sites.length?`<h2>현장별 현황</h2><div class="tbl-wrap"><table><thead><tr><th>현장명</th><th>구분</th><th>상태</th><th>준공 예정</th>${money?'<th class="r">계약금액</th><th class="r">발생 비용</th><th class="r">청구(공급가)</th><th class="r">수금(합계)</th><th class="r">미수금</th><th class="r">예상 수익</th>':''}</tr></thead><tbody>
  ${ms.map(({s,m})=>`<tr><td>${siteLink(s)} ${sampleTag(s)}</td><td>${typePill(s.type)}</td><td>${stPill(s.status)}</td><td>${esc(s.endPlanned||'—')}</td>
   ${money?`<td class="r">${m.contract==null?pill('미확정','warn'):fmt(m.contract)}</td><td class="r">${fmt(m.cost)}</td><td class="r">${fmt(m.billedS)}</td><td class="r">${fmt(m.recvT)}</td><td class="r ${m.receivable>0?'neg':''}">${fmt(m.receivable)}</td><td class="r ${m.profit<0?'neg':''}">${fmt(m.profit)}</td>`:''}</tr>`).join('')}
  </tbody>${money?`<tfoot><tr><td colspan="4">합계</td><td class="r">${fmt(T('contract'))}</td><td class="r">${fmt(T('cost'))}</td><td class="r">${fmt(T('billedS'))}</td><td class="r">${fmt(T('recvT'))}</td><td class="r">${fmt(T('receivable'))}</td><td class="r">${fmt(T('profit'))}</td></tr></tfoot>`:''}</table></div>`:''}
  ${money&&sites.length?formulaBox():''}</div>`;
  return h;
}

/* ================= 현장 목록 ================= */
let siteF={q:'',type:'',status:'',from:'',to:''};
function filteredSites(){
  const q=siteF.q.toLowerCase();
  return visibleSites().filter(s=>{
    if(siteF.type&&s.type!==siteF.type)return false;
    if(siteF.status&&s.status!==siteF.status)return false;
    if(siteF.from&&(s.endPlanned||'9999')<siteF.from)return false;
    if(siteF.to&&(s.startDate||'0000')>siteF.to)return false;
    if(q&&![s.name,s.client,s.prime,s.manager,s.address,s.kind].join(' ').toLowerCase().includes(q))return false;
    return true;});
}
function vSites(){
  const money=can('viewMoney'),list=filteredSites();
  let h=pageHead('현장 관리',(can('editSites')?btn('+ 현장 등록','new-site','','primary'):'')+(money?btn('엑셀(CSV) 내려받기','export-sites'):''),`${list.length}곳 표시`);
  h+=`<div class="filters noprint">
   ${F('검색',`<input data-filter="site" data-k="q" value="${esc(siteF.q)}" placeholder="공사명·발주기관·원도급업체·담당자">`)}
   ${F('공사 구분',sel('sf-type',[['','전체'],['sub','하도급'],['prime','원도급']],siteF.type,'data-filter="site" data-k="type"'))}
   ${F('현장 상태',sel('sf-status',[['','전체'],...STATUSES],siteF.status,'data-filter="site" data-k="status"'))}
   ${F('기간 시작',`<input type="date" data-filter="site" data-k="from" value="${esc(siteF.from)}">`)}
   ${F('기간 끝',`<input type="date" data-filter="site" data-k="to" value="${esc(siteF.to)}">`,'공사 기간이 겹치는 현장')}
  </div>`;
  h+=list.length?`<div class="tbl-wrap"><table><thead><tr><th>공사명</th><th>구분</th><th>종류</th><th>발주기관</th><th>원도급업체</th><th>담당자</th><th>착공 ~ 준공 예정</th><th>상태</th>${money?'<th class="r">원도급금액</th><th class="r">하도급률</th><th class="r">우리 계약금액</th>':''}</tr></thead><tbody>
  ${list.map(s=>{const m=metrics(s);return `<tr><td>${siteLink(s)} ${sampleTag(s)}</td><td>${typePill(s.type)}</td><td>${esc(s.kind||'')}</td><td>${esc(s.client||'')}</td><td>${esc(s.type==='sub'?s.prime||'':'—')}</td><td>${esc(s.manager||'')}</td><td>${esc(s.startDate||'?')} ~ ${esc(s.endPlanned||'?')}</td><td>${stPill(s.status)}</td>
   ${money?`<td class="r">${s.type==='sub'?fmt(m.prime):'—'}</td><td class="r">${s.type==='sub'?pct(m.rate):'—'}</td><td class="r">${m.contract==null?pill('미확정','warn'):fmt(m.contract)}</td>`:''}</tr>`;}).join('')}</tbody></table></div>`:empty('조건에 맞는 현장이 없습니다.');
  return h;
}

/* ================= 현장 등록·수정 ================= */
function siteForm(orig){
  const isNew=!orig;
  const s=orig?JSON.parse(JSON.stringify(orig)):{type:'sub',status:'계약 전',subMode:'rate',primeInput:{amt:null,basis:'supply'},subInput:{amt:null,basis:'supply'},ourInput:{amt:null,basis:'supply'},kind:'',changes:[],history:[]};
  const money=can('viewMoney');
  const partnersOf=t=>S.partners.filter(p=>p.type===t).map(p=>`<option value="${esc(p.name)}">`).join('');
  const body=`<div class="form" id="siteform" data-type="${s.type}" data-mode="${s.subMode||'rate'}">
  <datalist id="dl-client">${partnersOf('발주기관')}</datalist><datalist id="dl-prime">${partnersOf('원도급업체')}</datalist>
  <datalist id="dl-kinds">${S.settings.kinds.map(k=>`<option value="${esc(k)}">`).join('')}</datalist><datalist id="dl-users">${S.users.map(u=>`<option value="${esc(u.name)}">`).join('')}</datalist>
  <fieldset><legend>공사 구분 (수주 방식)</legend>
   <div class="seg">${radio('type','sub','하도급 공사',s.type)}${radio('type','prime','원도급 공사',s.type)}</div>
   <p class="hint only-sub">발주기관 → 원도급업체 → 우리 회사. 원도급업체와 맺은 하도급 계약금액이 우리 회사 계약금액입니다.</p>
   <p class="hint only-prime">발주기관 → 우리 회사. 우리 회사가 직접 낙찰받아 계약한 금액이 계약금액입니다.</p></fieldset>
  <fieldset><legend>기본 정보</legend><div class="grid2">
   ${F('공사명 *',inp('name',s.name,'required'),'','span2')}
   ${F('현장 주소',inp('address',s.address),'','span2')}
   ${F('공사 종류',inp('kind',s.kind,'list="dl-kinds" placeholder="목록에서 고르거나 직접 입력"'),'새 종류를 입력하면 목록에 추가됩니다.')}
   ${F('현장 상태',sel('status',STATUSES,s.status))}
   ${F('현장 담당자',inp('manager',s.manager,'list="dl-users"'))}
   ${F('계약일',dateI('contractDate',s.contractDate))}
   ${F('착공일',dateI('startDate',s.startDate))}
   ${F('준공 예정일',dateI('endPlanned',s.endPlanned))}
   ${F('실제 준공일',dateI('endActual',s.endActual))}
  </div></fieldset>
  <fieldset><legend>발주기관</legend><div class="grid2">
   ${F('발주기관명',inp('client',s.client,'list="dl-client"'))}
   ${F('담당자·연락처',inp('clientContact',s.clientContact,'placeholder="예: 정보통신과 홍길동 주무관 · 031-000-0000"'))}
   ${F('계약 담당자',inp('clientPerson',s.clientPerson),'','only-prime')}
   ${F('계약번호',inp('contractNo',s.contractNo),'','only-prime')}
  </div></fieldset>
  <fieldset class="only-sub"><legend>원도급업체</legend><div class="grid2">
   ${F('원도급업체명',inp('prime',s.prime,'list="dl-prime"'))}
   ${F('담당자·연락처',inp('primeContact',s.primeContact))}
   ${F('원도급업체 계약번호·현장번호',inp('primeNo',s.primeNo))}
  </div></fieldset>
  ${money?`<fieldset class="only-sub"><legend>하도급 금액 계산</legend>
   ${F('원도급 계약금액 (발주기관 ↔ 원도급업체)',`<div class="inrow">${money_('primeAmt',s.primeInput.amt)}${sel('primeBasis',BASIS,s.primeInput.basis)}</div>`,'모르면 비워 두세요. 나중에 입력할 수 있습니다.')}
   <div class="fld"><span class="lb">입력 방식</span><div class="seg">${radio('subMode','rate','하도급률로 계산',s.subMode||'rate')}${radio('subMode','direct','계약금액 직접 입력',s.subMode||'rate')}</div></div>
   ${F('하도급률 (%)',inp('rate',s.rate,'inputmode="decimal" placeholder="예: 80"'),'원도급 공급가액에 적용합니다.','only-rate')}
   ${F('실제 하도급 계약금액',`<div class="inrow">${money_('subAmt',s.subInput.amt)}${sel('subBasis',BASIS,s.subInput.basis)}</div>`,'계약서의 금액을 입력하면 하도급률을 역산합니다.','only-direct')}
   <div class="calc" id="calcbox"></div>
   ${F('우리 회사 확정 하도급 계약금액 (공급가액)',`<div class="inrow">${money_('confirmed',s.confirmedSupply)}${btn('계산값 넣기','fill-confirm','','sm')}</div>`,'자동 계산값은 실제 계약금액과 다를 수 있습니다. 계약서와 대조한 뒤 입력하세요. 비워 두면 “미확정”으로 표시되고 수익·미청구금 계산에서 빠집니다.')}
   <div id="confirmdiff"></div>
  </fieldset>
  <fieldset class="only-prime"><legend>우리 회사 계약금액</legend>
   ${F('낙찰금액 또는 계약금액',`<div class="inrow">${money_('ourAmt',s.ourInput.amt)}${sel('ourBasis',BASIS,s.ourInput.basis)}</div>`,'이 금액이 우리 회사 확정 계약금액이 됩니다.')}
   <div id="ourbox"></div></fieldset>`:'<p class="note">계약금액은 금액 보기 권한이 있는 사용자만 입력·수정할 수 있습니다.</p>'}
  <fieldset><legend>대금 청구·특이사항</legend>
   ${F('대금 청구·수금 상대방',inp('billTo',s.billTo,'placeholder="비워 두면 하도급은 원도급업체, 원도급은 발주기관"'))}
   ${F('특이사항',ta('note',s.note))}
  </fieldset>
  ${!isNew&&(s.changes||[]).length?'<p class="note">이 현장에는 변경 계약 기록이 있습니다. 여기서 고치는 금액은 <b>최초 계약금액</b>입니다. 변경 금액은 [계약 변경] 탭에서 관리하세요.</p>':''}
  </div>`;
  openModal(isNew?'현장 등록':'현장 정보 수정',body,{wide:true,submitLabel:isNew?'현장 등록':'저장',submit:f=>saveSite(f,isNew?null:s.id)});
  updateCalc();
}
const money_=money;
function readCalc(f){return{primeAmt:num(g(f,'primeAmt')),primeBasis:g(f,'primeBasis'),subMode:(f.querySelector('[name=subMode]:checked')||{}).value||'rate',rate:num(g(f,'rate')),subAmt:num(g(f,'subAmt')),subBasis:g(f,'subBasis')};}
function updateCalc(){
  const f=$('#mform');if(!f||!$('#calcbox'))return;
  const v=readCalc(f),c=subCalc(v);
  $('#calcbox').innerHTML=calcPanel(c,v.subMode);
  const conf=num(g(f,'confirmed'));
  $('#confirmdiff').innerHTML=(conf!=null&&c.sub&&conf!==c.sub.s)?`<p class="note warn">확정 금액이 ${v.subMode==='rate'?'계산값':'입력한 계약금액'}과 ${won(Math.abs(conf-c.sub.s))} 다릅니다. 계약서 금액이 맞는지 확인하세요.</p>`:(conf==null?'<p class="note warn">확정 계약금액이 비어 있습니다. 미확정으로 저장됩니다.</p>':`<p class="note ok">확정 계약금액 ${won(conf)} (부가세 ${won(vatOf(conf))}, 합계 ${won(conf+vatOf(conf))})</p>`);
  const ot=tri(num(g(f,'ourAmt')),g(f,'ourBasis'));
  if($('#ourbox'))$('#ourbox').innerHTML=triTable([['우리 회사 계약금액',ot]])+`<p class="rule">${RULE}</p>`;
}
function saveSite(f,id){
  const name=g(f,'name');if(!name){toast('공사명을 입력해 주세요.','err');return false;}
  const type=(f.querySelector('[name=type]:checked')||{}).value||'sub';
  const old=id?siteById(id):null;
  const s=old||{id:uid(),changes:[],history:[],created:Date.now(),primeInput:{amt:null,basis:'supply'},subInput:{amt:null,basis:'supply'},ourInput:{amt:null,basis:'supply'}};
  const money=can('viewMoney');
  const before=old?JSON.stringify([old.type,old.primeInput,old.rate,old.subMode,old.subInput,old.ourInput,old.confirmedSupply,old.status]):null;
  ['name','address','kind','status','manager','contractDate','startDate','endPlanned','endActual','client','clientContact','clientPerson','contractNo','prime','primeContact','primeNo','note'].forEach(k=>s[k]=g(f,k));
  s.name=name;s.type=type;
  if(money){
    if(type==='sub'){const v=readCalc(f);s.primeInput={amt:v.primeAmt,basis:v.primeBasis};s.subMode=v.subMode;s.rate=v.rate;s.subInput={amt:v.subAmt,basis:v.subBasis};s.confirmedSupply=num(g(f,'confirmed'));}
    else{s.ourInput={amt:num(g(f,'ourAmt')),basis:g(f,'ourBasis')};s.confirmedSupply=toSupply(s.ourInput.amt,s.ourInput.basis);}
  }
  s.billTo=g(f,'billTo')||(type==='sub'?s.prime:s.client)||'';
  if(s.kind&&!S.settings.kinds.includes(s.kind)&&isAdmin())S.settings.kinds.push(s.kind);
  if(money){
    const after=JSON.stringify([s.type,s.primeInput,s.rate,s.subMode,s.subInput,s.ourInput,s.confirmedSupply,s.status]);
    if(!old)s.history.push({at:NOW(),by:me().name,text:`현장 등록 (확정 계약금액 ${s.confirmedSupply==null?'미확정':won(s.confirmedSupply)})`});
    else if(before!==after)s.history.push({at:NOW(),by:me().name,text:`기본 계약 정보 수정 → 상태 ${s.status}, 최초 확정 계약금액 ${s.confirmedSupply==null?'미확정':won(s.confirmedSupply)}${s.type==='sub'?`, 원도급 ${won(primeSupplyOf(s))}, 하도급률 ${pct(rateOf(s.confirmedSupply,primeSupplyOf(s)))}`:''}`});
  }
  if(!old){S.sites.push(s);nextHash='site-'+s.id;}
}

/* ================= 현장 상세 ================= */
function vSite(id){
  const s=siteById(id);
  if(!s)return empty('현장을 찾을 수 없거나 볼 권한이 없습니다. <a href="#sites">현장 목록으로</a>');
  const money=can('viewMoney'),m=metrics(s);
  const tabs=[['info','기본 정보',true],['changes','계약 변경',money],['logs','작업일지',true],['costs','비용',money||can('editCosts')||can('editLabor')],['bills','청구·수금',money||can('editBills')],['docs','사진·서류',true]].filter(t=>t[2]);
  if(!tabs.find(t=>t[0]===siteTab))siteTab='info';
  let h=`<div class="ph"><div class="tt"><p class="small"><a href="#sites">현장 관리</a> ›</p><h1>${esc(s.name)}</h1>
   <p>${typePill(s.type)} ${stPill(s.status)} ${sampleTag(s)} ${esc(s.kind||'')} · ${esc(s.startDate||'착공일 미정')} ~ ${esc(s.endPlanned||'준공일 미정')}</p></div>
   <div class="acts noprint">${can('editLogs')?btn('+ 작업일지','new-log',`data-site="${s.id}"`,'primary'):''}${can('editSites')?btn('정보 수정','edit-site',`data-id="${s.id}"`):''}<a class="btn" href="#print-${s.id}">인쇄용 요약</a></div></div>`;
  if(s.sample)h+=`<p class="note sample">이 현장은 예시 데이터입니다.</p>`;
  if(money){
    h+=`<div class="tiles" style="margin-top:14px">
    <div class="tile hl"><div class="k">현재 확정 계약금액</div><div class="v">${m.contract==null?'미확정':won(m.contract)}</div><div class="s">${m.pendingN?`미확정 추가공사 ${m.pendingN}건 (${won(m.pending)}) 별도`:'공급가액'}</div></div>
    ${s.type==='sub'?`<div class="tile"><div class="k">원도급금액 · 하도급률</div><div class="v">${pct(m.rate)}</div><div class="s">원도급 ${won(m.prime)}</div></div>`:''}
    <div class="tile"><div class="k">발생 비용</div><div class="v">${won(m.cost)}</div><div class="s">인건비 ${fmt(m.laborSum)} · 자재·경비 ${fmt(m.costSum)} · 외주 ${fmt(m.subSum)}</div></div>
    <div class="tile"><div class="k">누적 청구</div><div class="v">${won(m.billedS)}</div><div class="s">공급가액 · 합계 ${fmt(m.billedT)}</div></div>
    <div class="tile"><div class="k">누적 수금</div><div class="v">${won(m.recvT)}</div><div class="s">부가세 포함</div></div>
    <div class="tile"><div class="k">미청구금</div><div class="v">${won(m.unbilled)}</div><div class="s">계약금액 − 청구 (공급가액)</div></div>
    <div class="tile ${m.receivable>0?'neg':''}"><div class="k">미수금</div><div class="v">${won(m.receivable)}</div><div class="s">청구 − 수금 (부가세 포함)</div></div>
    <div class="tile ${m.profit<0?'neg':''}"><div class="k">현재까지 예상 수익</div><div class="v">${won(m.profit)}</div><div class="s">미입력 비용 미반영 · 확정 이익 아님</div></div></div>`;
  }
  h+=`<div class="tabs noprint" role="tablist">${tabs.map(t=>`<button type="button" class="tab ${siteTab===t[0]?'on':''}" role="tab" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div>`;
  if(siteTab==='info')h+=siteInfo(s,m);
  if(siteTab==='changes')h+=siteChanges(s);
  if(siteTab==='logs')h+=(can('editLogs')?`<div class="acts" style="margin-bottom:12px">${btn('+ 작업일지 작성','new-log',`data-site="${s.id}"`,'primary')}</div>`:'')+logCards(S.logs.filter(l=>l.siteId===s.id),false);
  if(siteTab==='costs')h+=siteCosts(s,m);
  if(siteTab==='bills')h+=siteBills(s,m);
  if(siteTab==='docs')h+=(can('editDocs')?`<div class="acts" style="margin-bottom:12px">${btn('+ 사진·서류 올리기','new-doc',`data-site="${s.id}"`,'primary')}</div>`:'')+docGrid(S.docs.filter(d=>d.siteId===s.id),false);
  return h;
}
function siteInfo(s,m){
  const money=can('viewMoney');
  const kv=(k,v)=>`<dt>${k}</dt><dd>${v||'<span class="muted">—</span>'}</dd>`;
  let h=`<div class="cols"><div class="card stack"><h3>공사 개요</h3><dl class="kv">
   ${kv('공사명',esc(s.name))}${kv('현장 주소',esc(s.address))}${kv('공사 구분',s.type==='sub'?'하도급 (발주기관 → 원도급업체 → 우리 회사)':'원도급 (발주기관 → 우리 회사)')}${kv('공사 종류',esc(s.kind))}
   ${kv('계약일',esc(s.contractDate))}${kv('착공일',esc(s.startDate))}${kv('준공 예정일',esc(s.endPlanned))}${kv('실제 준공일',esc(s.endActual))}${kv('현장 담당자',esc(s.manager))}${kv('현장 상태',stPill(s.status))}</dl></div>
   <div class="card stack"><h3>계약 상대방</h3><dl class="kv">
   ${kv('발주기관',esc(s.client))}${kv('발주기관 담당자',esc(s.clientContact))}
   ${s.type==='prime'?kv('계약 담당자',esc(s.clientPerson))+kv('계약번호',esc(s.contractNo)):kv('원도급업체',esc(s.prime))+kv('원도급 담당자',esc(s.primeContact))+kv('계약·현장번호',esc(s.primeNo))}
   ${kv('청구·수금 상대방',`<b>${esc(s.billTo)}</b>`)}</dl></div></div>`;
  if(money){
    if(s.type==='sub'){
      const c=subCalc({primeAmt:s.primeInput.amt,primeBasis:s.primeInput.basis,subMode:s.subMode,rate:s.rate,subAmt:s.subInput.amt,subBasis:s.subInput.basis});
      h+=`<div class="card stack" style="margin-top:16px"><h3>최초 계약 · 하도급률 계산 (${s.subMode==='rate'?'하도급률로 계산':'계약금액 직접 입력'})</h3><div class="calc">${calcPanel(c,s.subMode)}</div>
       ${triTable([['우리 회사 최초 확정 계약금액',s.confirmedSupply==null?null:tri(s.confirmedSupply,'supply')],['우리 회사 현재 확정 계약금액',m.contract==null?null:tri(m.contract,'supply')]])}
       ${s.confirmedSupply==null?'<p class="note warn">확정 계약금액이 아직 없습니다. [정보 수정]에서 계약서 금액을 확인해 입력하세요.</p>':''}</div>`;
    }else{
      h+=`<div class="card stack" style="margin-top:16px"><h3>계약금액</h3>${triTable([['최초 계약금액 ('+bl(s.ourInput.basis)+'로 입력)',tri(s.ourInput.amt,s.ourInput.basis)],['현재 확정 계약금액',m.contract==null?null:tri(m.contract,'supply')]])}<p class="rule">${RULE}</p></div>`;
    }
  }
  h+=`<div class="cols" style="margin-top:16px"><div class="card stack"><h3>특이사항</h3><p style="white-space:pre-wrap;margin:0">${esc(s.note)||'<span class="muted">없음</span>'}</p></div>
   ${money?`<div class="card stack"><h3>계약 수정 기록</h3>${s.history.length?`<ul class="alerts">${[...s.history].reverse().map(x=>`<li><span class="small muted">${esc(x.at)}<br>${esc(x.by)}</span><span class="small">${esc(x.text)}</span></li>`).join('')}</ul>`:'<p class="muted">기록 없음</p>'}${btn('이 현장의 전체 변경 기록 보기','audit',`data-site="${s.id}"`,'sm')}</div>`:''}</div>`;
  if(can('editSites'))h+=`<div class="acts noprint" style="margin-top:16px">${btn('이 현장 삭제','del-site',`data-id="${s.id}"`,'danger')}</div>`;
  return h;
}
function siteChanges(s){
  const cr=changeRows(s),sub=s.type==='sub';
  let h=`<div class="stack"><div class="acts">${can('editChanges')?btn('+ 계약 변경·추가공사 등록','new-change',`data-site="${s.id}"`,'primary'):''}</div>
  <p class="note">확정된 변경만 현재 계약금액에 반영됩니다. 금액이 정해지지 않은 추가공사는 <b>미확정</b>으로 따로 표시하며 계약금액·수익 계산에 넣지 않습니다. 금액은 모두 공급가액입니다.</p>
  <div class="tbl-wrap"><table><thead><tr><th>일자</th><th>구분</th><th>사유·내용</th>${sub?'<th class="r">원도급 금액</th>':''}<th class="r">우리 계약금액</th><th class="r">증감액</th>${sub?'<th class="r">하도급률</th>':''}<th>상태</th><th class="noprint"></th></tr></thead><tbody>`;
  for(const r of cr.rows){
    if(r.initial){h+=`<tr><td>${esc(s.contractDate||'—')}</td><td>${pill('최초 계약')}</td><td class="wrap">최초 계약</td>${sub?`<td class="r">${fmt(r.prime)}</td>`:''}<td class="r">${r.our==null?pill('미확정','warn'):fmt(r.our)}</td><td class="r">—</td>${sub?`<td class="r">${pct(r.rate)}</td>`:''}<td>${pill('확정','ok')}</td><td></td></tr>`;continue;}
    const c=r.c,att=S.docs.filter(d=>d.changeId===c.id).length;
    const ed=can('editChanges')?btn('수정','edit-change',`data-site="${s.id}" data-id="${c.id}"`,'sm'):'';
    const reason=`${esc(c.reason)}${c.note?`<br><span class="small muted">${esc(c.note)}</span>`:''}${att?`<br><span class="small muted">첨부 ${att}건</span>`:''}`;
    if(r.pending)h+=`<tr><td>${esc(c.date)}</td><td>${pill(c.kind)}</td><td class="wrap">${reason}</td>${sub?'<td class="r muted">—</td>':''}<td class="r muted">미반영</td><td class="r muted">예상 ${c.estimate!=null?(c.estimate>=0?'+':'')+fmt(c.estimate):'미정'}</td>${sub?'<td></td>':''}<td>${pill('금액 미확정','warn')}</td><td class="noprint">${ed}</td></tr>`;
    else h+=`<tr><td>${esc(c.date)}</td><td>${pill(c.kind,'info')}</td><td class="wrap">${reason}</td>${sub?`<td class="r">${fmt(r.prime)}${r.primeDelta?`<br><span class="small muted">${r.primeDelta>0?'+':''}${fmt(r.primeDelta)}</span>`:''}</td>`:''}<td class="r"><b>${fmt(r.our)}</b></td><td class="r ${r.delta<0?'neg':''}">${r.delta==null?'—':(r.delta>0?'+':'')+fmt(r.delta)}</td>${sub?`<td class="r">${pct(r.rate)}</td>`:''}<td>${pill('확정','ok')}</td><td class="noprint">${ed}</td></tr>`;
  }
  h+=`</tbody></table></div>
  <div class="tiles"><div class="tile hl"><div class="k">현재 확정 계약금액</div><div class="v">${cr.current==null?'미확정':won(cr.current)}</div><div class="s">대시보드·수익 계산에 반영</div></div>
  ${sub?`<div class="tile"><div class="k">현재 원도급금액</div><div class="v">${won(cr.prime)}</div><div class="s">변경 후 하도급률 ${pct(rateOf(cr.current,cr.prime))}</div></div>`:''}
  <div class="tile"><div class="k">미확정 추가공사</div><div class="v">${cr.pendingN}건</div><div class="s">예상 ${won(cr.pending)} · 미반영</div></div></div></div>`;
  return h;
}
function changeForm(siteId,cid){
  const s=siteById(siteId),cr=changeRows(s),sub=s.type==='sub';
  const c=cid?s.changes.find(x=>x.id===cid):{date:TODAY(),kind:'설계변경',status:'확정'};
  const body=`<p class="note">현재 확정 계약금액 <b>${won(cr.current)}</b>${sub?` · 현재 원도급금액 <b>${won(cr.prime)}</b>`:''} (공급가액)</p><div class="grid2">
   ${F('변경 일자',dateI('date',c.date))}${F('구분',sel('kind',['설계변경','추가공사','물가변동','공기연장','기타'],c.kind))}
   ${F('사유·내용 *',ta('reason',c.reason,2),'','span2')}
   ${F('금액 확정 여부',sel('status',[['확정','확정 — 변경계약 체결'],['미확정','미확정 — 금액 협의 중']],c.status),'미확정은 계약금액에 포함하지 않습니다.','span2')}
   ${sub?F('변경 후 원도급 계약금액',`<div class="inrow">${money('primeAfter',c.primeAfter)}${sel('primeBasis',BASIS,'supply')}</div>`,'원도급 금액이 바뀌지 않았거나 모르면 비워 두세요.','span2'):''}
   ${F('변경 후 우리 회사 계약금액',`<div class="inrow">${money('ourAfter',c.ourAfter)}${sel('ourBasis',BASIS,'supply')}</div>`,'확정일 때 입력합니다. 증감액이 아니라 변경 후 총액입니다.','span2')}
   ${F('예상 증감액 (미확정일 때)',money('estimate',c.estimate),'참고용으로만 표시합니다.')}
   ${F('비고',inp('note',c.note))}
   ${F('변경 계약서 등 첨부',`<input type="file" name="files" multiple>`,'원본 그대로 서버에 저장됩니다.','span2')}</div>
   ${cid?`<div class="acts">${btn('이 변경 기록 삭제','del-change',`data-site="${siteId}" data-id="${cid}"`,'danger sm')}</div>`:''}`;
  openModal(cid?'계약 변경 수정':'계약 변경·추가공사 등록',body,{submit:async f=>{
    const reason=g(f,'reason');if(!reason){toast('사유·내용을 입력해 주세요.','err');return false;}
    const status=g(f,'status'),ourAfter=toSupply(num(g(f,'ourAfter')),g(f,'ourBasis'));
    if(status==='확정'&&ourAfter==null){toast('확정된 변경은 변경 후 우리 회사 계약금액을 입력해야 합니다.','err');return false;}
    const o=cid?c:{id:uid(),created:Date.now()};
    Object.assign(o,{date:g(f,'date'),kind:g(f,'kind'),reason,status,primeAfter:sub?toSupply(num(g(f,'primeAfter')),g(f,'primeBasis')):null,ourAfter,estimate:num(g(f,'estimate')),note:g(f,'note')});
    if(!cid)s.changes.push(o);
    s.history.push({at:NOW(),by:me().name,text:`계약 변경 ${cid?'수정':'등록'}: ${o.kind} (${status}) ${status==='확정'?'변경 후 '+won(ourAfter):''}`});
    const files=f.elements.files.files;if(files.length)await addFiles(files,{siteId,cat:'계약서·변경계약서',desc:`${o.date} ${o.kind}: ${reason}`,changeId:o.id});
  }});
}

/* ================= 작업일지 ================= */
let logF={site:'',from:'',to:''};
const laborUsed=logId=>sum(S.labor.filter(x=>x.logId===logId&&x.unit==='공수'),x=>x.qty);
function thumbs(list){return list.length?`<div class="thumbs">${list.map(d=>{const t=thumbOf(d);return t?`<button type="button" data-act="view-doc" data-id="${d.id}" aria-label="사진 크게 보기"><img src="${t}" alt="${esc(d.phase||'')} 사진" loading="lazy"></button>`:'';}).join('')}</div>`:'';}
function logCards(list,showSite){
  list=[...list].sort((a,b)=>(b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')));
  if(!list.length)return empty('작업일지가 없습니다.');
  const lab=can('editLabor');
  return `<div class="logs">${list.map(l=>{const ph=S.docs.filter(d=>d.logId===l.id);const used=laborUsed(l.id);
   return `<article class="log"><div class="hd"><b>${esc(l.date)}</b>${showSite?`<a class="sitelink" href="#site-${l.siteId}">${esc(siteName(l.siteId))}</a>`:''}${sampleTag(l)}
    ${lab&&l.manDays?(used>=l.manDays?pill('인건비 반영됨','ok'):used>0?pill(`인건비 ${used}/${l.manDays}공수 반영`,'warn'):pill('인건비 미반영')):''}
    <span style="flex:1"></span>${can('editLogs')?btn('수정','edit-log',`data-id="${l.id}"`,'sm noprint'):''}</div>
    <div class="ct">${esc(l.content)}</div>
    <div class="meta"><span>투입 ${l.workers??'—'}명</span><span>공수 ${l.manDays??'—'}</span>${l.hours?`<span>작업 시간 ${esc(l.hours)}</span>`:''}${l.equipment?`<span>장비: ${esc(l.equipment)}</span>`:''}</div>
    ${l.note?`<p class="note">${esc(l.note)}</p>`:''}${thumbs(ph)}
    <div class="meta"><span>작성 ${esc(l.author)} · ${esc(l.createdAt||'')}</span>${l.updatedAt?`<span>수정 ${esc(l.updatedBy||'')} · ${esc(l.updatedAt)}</span>`:''}</div></article>`;}).join('')}</div>`;
}
function vLogs(){
  const list=S.logs.filter(l=>(!logF.site||l.siteId===logF.site)&&(!logF.from||l.date>=logF.from)&&(!logF.to||l.date<=logF.to));
  return pageHead('작업일지',(can('editLogs')?btn('+ 작업일지 작성','new-log','','primary'):'')+'<a class="btn" href="#printlogs">인쇄용 보기</a>',`${list.length}건`)+
  `<div class="filters noprint">${F('현장',sel('lf-site',siteOpts(),logF.site,'data-filter="log" data-k="site"'))}${F('시작일',`<input type="date" data-filter="log" data-k="from" value="${esc(logF.from)}">`)}${F('종료일',`<input type="date" data-filter="log" data-k="to" value="${esc(logF.to)}">`)}</div>`+logCards(list,true);
}
function logForm(id,presetSite){
  const sites=visibleSites();if(!sites.length){toast('작업일지를 쓸 수 있는 현장이 없습니다.','err');return;}
  const l=id?S.logs.find(x=>x.id===id):{siteId:presetSite||(route.name==='site'?route.id:sites[0].id),date:TODAY()};
  const ph=id?S.docs.filter(d=>d.logId===id):[];
  const body=`<div class="grid2">
   ${F('현장',sel('siteId',sites.map(s=>[s.id,s.name]),l.siteId),'','span2')}
   ${F('작업 날짜',dateI('date',l.date))}${F('투입 인원 (명)',inp('workers',l.workers,'inputmode="numeric"'))}
   ${F('작업 내용 *',ta('content',l.content,4),'','span2')}
   ${F('공수',inp('manDays',l.manDays,'inputmode="decimal" placeholder="예: 3 또는 2.5"'),'인건비 불러오기에 쓰입니다.')}
   ${F('작업 시간',inp('hours',l.hours,'placeholder="예: 08:00~17:00"'))}
   ${F('사용 장비',inp('equipment',l.equipment),'','span2')}
   ${F('특이사항·전달사항',ta('note',l.note,2),'','span2')}
   ${can('editDocs')?F('현장 사진 첨부',`<div class="inrow">${sel('phase',['작업 전','작업 중','작업 후'],'작업 중')}</div><input type="file" name="photos" accept="image/*" multiple>`,'휴대폰에서는 카메라로 바로 찍거나 앨범에서 고를 수 있습니다. 원본 그대로 서버에 저장됩니다.','span2'):''}
  </div>${ph.length?`<div class="fld"><span class="lb">이미 첨부한 사진 ${ph.length}장</span>${thumbs(ph)}</div>`:''}
  ${id?`<div class="acts">${btn('이 작업일지 삭제','del-log',`data-id="${id}"`,'danger sm')}</div>`:''}`;
  openModal(id?'작업일지 수정':'작업일지 작성',body,{submitLabel:id?'저장':'작업일지 등록',submit:async f=>{
    const content=g(f,'content');if(!content){toast('작업 내용을 입력해 주세요.','err');return false;}
    const o=id?l:{id:uid(),author:me().name,createdAt:NOW()};
    Object.assign(o,{siteId:g(f,'siteId'),date:g(f,'date')||TODAY(),content,workers:num(g(f,'workers')),manDays:num(g(f,'manDays')),hours:g(f,'hours'),equipment:g(f,'equipment'),note:g(f,'note')});
    if(id){o.updatedAt=NOW();o.updatedBy=me().name;S.docs.filter(d=>d.logId===id).forEach(d=>d.siteId=o.siteId);}else S.logs.push(o);
    const files=f.elements.photos?f.elements.photos.files:[];
    if(files.length)await addFiles(files,{siteId:o.siteId,cat:'현장 사진',phase:g(f,'phase'),desc:`${o.date} 작업일지 · ${content.split('\n')[0].slice(0,40)}`,logId:o.id});
  }});
}

/* ================= 인력·인건비 ================= */
let labF={site:'',paid:''};
function laborTable(list,showSite){
  if(!list.length)return empty('인건비 기록이 없습니다.');
  list=[...list].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="tbl-wrap"><table><thead><tr><th>작업일</th>${showSite?'<th>현장</th>':''}<th>작업자·협력업체</th><th>작업 내용</th><th class="r">투입</th><th class="r">단가</th><th class="r">금액</th><th>지급 예정</th><th>지급</th><th class="noprint"></th></tr></thead><tbody>
  ${list.map(l=>`<tr><td>${esc(l.date)}</td>${showSite?`<td>${esc(siteName(l.siteId))}</td>`:''}<td>${esc(l.worker)} ${sampleTag(l)}${l.logId?'<br><span class="small muted">작업일지 연결</span>':''}</td><td class="wrap">${esc(l.content)}</td><td class="r">${l.qty??''} ${esc(l.unit||'')}</td><td class="r">${fmt(l.unitPrice)}</td><td class="r"><b>${fmt(l.amount)}</b></td><td>${esc(l.payDue||'—')}</td>
   <td>${l.paid?pill('지급 '+(l.paidDate||''),'ok'):(dday(l.payDue)<0?pill('미지급·기한 경과','danger'):pill('미지급','warn'))}</td><td class="noprint">${can('editLabor')?btn('수정','edit-labor',`data-id="${l.id}"`,'sm'):''}</td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="${showSite?6:5}">합계 (${list.length}건)</td><td class="r">${fmt(sum(list,x=>x.amount))}</td><td colspan="3">미지급 ${fmt(sum(list.filter(x=>!x.paid),x=>x.amount))}</td></tr></tfoot></table></div>`;
}
function vLabor(){
  const list=S.labor.filter(l=>(!labF.site||l.siteId===labF.site)&&(labF.paid===''||String(!!l.paid)===labF.paid));
  const bySite=visibleSites().map(s=>[s,sum(S.labor.filter(l=>l.siteId===s.id),x=>x.amount)]).filter(x=>x[1]);
  return pageHead('인력·인건비',btn('+ 인건비 등록','new-labor','','primary')+btn('작업일지에서 불러오기','labor-import')+btn('엑셀(CSV) 내려받기','export-labor'),'작업일지의 공수를 불러올 때 이미 반영된 공수는 다시 불러오지 않습니다 (서버에서도 검사).')+
  `<div class="filters noprint">${F('현장',sel('lab-site',siteOpts(),labF.site,'data-filter="lab" data-k="site"'))}${F('지급 여부',sel('lab-paid',[['','전체'],['false','미지급'],['true','지급 완료']],labF.paid,'data-filter="lab" data-k="paid"'))}</div>`+
  `<div class="stack">${laborTable(list,true)}${bySite.length?`<div class="card stack"><h3>현장별 인건비 합계</h3><div class="tbl-wrap"><table><tbody>${bySite.map(x=>`<tr><td>${siteLink(x[0])}</td><td class="r">${won(x[1])}</td></tr>`).join('')}</tbody></table></div></div>`:''}</div>`;
}
function laborForm(id,preset){
  const sites=visibleSites();if(!sites.length){toast('현장을 먼저 등록하세요.','err');return;}
  const l=id?S.labor.find(x=>x.id===id):Object.assign({siteId:labF.site||(route.name==='site'?route.id:sites[0].id),date:TODAY(),unit:'공수',paid:false},preset||{});
  const log=l.logId?S.logs.find(x=>x.id===l.logId):null;
  const body=`${log?`<p class="note">작업일지 연결: ${esc(log.date)} · ${esc(log.content.split('\n')[0])} (일지 공수 ${log.manDays}, 다른 기록에 이미 반영 ${laborUsed(log.id)-(id&&l.unit==='공수'?l.qty||0:0)})</p>`:''}
  <div class="grid2">${F('현장',sel('siteId',sites.map(s=>[s.id,s.name]),l.siteId),'','span2')}
   ${F('작업 날짜',dateI('date',l.date))}${F('작업자명 또는 협력업체명 *',inp('worker',l.worker))}
   ${F('작업 내용',inp('content',l.content),'','span2')}
   ${F('투입량',`<div class="inrow">${inp('qty',l.qty,'inputmode="decimal" data-labcalc')}${sel('unit',['공수','시간','일','식'],l.unit)}</div>`)}
   ${F('단가 (원)',inp('unitPrice',l.unitPrice==null?'':fmt(l.unitPrice),'class="money" inputmode="numeric" data-labcalc'))}
   ${F('금액 (원)',money('amount',l.amount),'투입량 × 단가로 자동 계산되며 고칠 수 있습니다. 부가세 없는 금액으로 봅니다.','span2')}
   ${F('지급 예정일',dateI('payDue',l.payDue))}${F('지급일',dateI('paidDate',l.paidDate))}
   <label class="chk span2"><input type="checkbox" name="paid" ${l.paid?'checked':''}> 지급 완료</label></div>
   <input type="hidden" name="logId" value="${esc(l.logId||'')}">
   ${id?`<div class="acts">${btn('이 기록 삭제','del-labor',`data-id="${id}"`,'danger sm')}</div>`:''}`;
  openModal(id?'인건비 수정':'인건비 등록',body,{submit:f=>{
    const worker=g(f,'worker');if(!worker){toast('작업자명 또는 협력업체명을 입력해 주세요.','err');return false;}
    const qty=num(g(f,'qty')),unit=g(f,'unit'),logId=g(f,'logId')||null;
    if(logId&&unit==='공수'){const lg=S.logs.find(x=>x.id===logId);if(lg&&lg.manDays!=null){const remain=lg.manDays-(laborUsed(logId)-(id&&l.unit==='공수'?l.qty||0:0));
      if((qty||0)>remain+1e-9){toast(`이 작업일지에 남은 공수는 ${remain}입니다. 같은 인건비가 두 번 계산되지 않도록 남은 공수 이내로 입력하세요.`,'err');return false;}}}
    const o=id?l:{id:uid()};
    const price=num(g(f,'unitPrice'));let amount=num(g(f,'amount'));if(amount==null&&qty!=null&&price!=null)amount=Math.round(qty*price);
    Object.assign(o,{siteId:g(f,'siteId'),date:g(f,'date'),worker,content:g(f,'content'),qty,unit,unitPrice:price,amount:amount||0,payDue:g(f,'payDue'),paidDate:g(f,'paidDate'),paid:f.elements.paid.checked,logId});
    if(o.paid&&!o.paidDate)o.paidDate=TODAY();
    if(!id)S.labor.push(o);
  }});
}
function laborImport(){
  const list=S.logs.filter(l=>(!labF.site||l.siteId===labF.site)&&l.manDays>0).map(l=>({l,remain:l.manDays-laborUsed(l.id)})).filter(x=>x.remain>0).sort((a,b)=>b.l.date.localeCompare(a.l.date));
  openModal('작업일지에서 인건비 불러오기',`<p class="note">공수가 입력된 작업일지 중 아직 인건비로 반영되지 않은 공수가 남은 일지만 보입니다. 하나를 고르면 날짜·현장·내용·남은 공수가 채워집니다.</p>
  ${list.length?`<ul class="alerts">${list.map(x=>`<li><div style="flex:1"><b>${esc(x.l.date)} · ${esc(siteName(x.l.siteId))}</b><br><span class="small">${esc(x.l.content.split('\n')[0])} · 투입 ${x.l.workers??'?'}명 · 남은 공수 ${x.remain}/${x.l.manDays}</span></div>${btn('선택','labor-from-log',`data-id="${x.l.id}"`,'sm primary')}</li>`).join('')}</ul>`:'<p class="muted">불러올 작업일지가 없습니다. 모든 공수가 이미 반영되었거나 공수가 비어 있습니다.</p>'}`);
}

/* ================= 자재·비용·외주 ================= */
let costF={site:'',cat:''};
function costTable(list,showSite){
  if(!list.length)return empty('자재·경비 기록이 없습니다.');
  list=[...list].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  return `<div class="tbl-wrap"><table><thead><tr><th>구매일</th>${showSite?'<th>현장</th>':''}<th>구분</th><th>품명</th><th>규격</th><th class="r">수량</th><th class="r">단가</th><th class="r">공급가액</th><th class="r">부가세</th><th class="r">합계</th><th>구매처</th><th class="noprint"></th></tr></thead><tbody>
  ${list.map(c=>{const att=S.docs.filter(d=>d.costId===c.id).length;return `<tr><td>${esc(c.date)}</td>${showSite?`<td>${esc(siteName(c.siteId))}</td>`:''}<td>${pill(c.cat)}</td><td>${esc(c.name)} ${sampleTag(c)}${att?`<br><span class="small muted">첨부 ${att}건</span>`:''}</td><td>${esc(c.spec)}</td><td class="r">${c.qty??''}</td><td class="r">${fmt(c.unitPrice)}</td><td class="r"><b>${fmt(c.supply)}</b></td><td class="r">${fmt(c.vat)}</td><td class="r">${fmt((c.supply||0)+(c.vat||0))}</td><td>${esc(c.vendor)}</td><td class="noprint">${can('editCosts')?btn('수정','edit-cost',`data-id="${c.id}"`,'sm'):''}</td></tr>`;}).join('')}
  </tbody><tfoot><tr><td colspan="${showSite?7:6}">합계 (${list.length}건)</td><td class="r">${fmt(sum(list,x=>x.supply))}</td><td class="r">${fmt(sum(list,x=>x.vat))}</td><td class="r">${fmt(sum(list,x=>(x.supply||0)+(x.vat||0)))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
}
function subTable(list,showSite){
  if(!list.length)return empty('외주(재하도급) 계약이 없습니다.');
  const ed=can('editCosts');
  return `<div class="tbl-wrap"><table><thead><tr><th>계약일</th>${showSite?'<th>현장</th>':''}<th>외주업체</th><th>공사 범위</th><th class="r">계약 공급가액</th><th class="r">부가세</th><th class="r">계약 합계</th><th class="r">지급액</th><th class="r">미지급</th><th class="noprint"></th></tr></thead><tbody>
  ${list.map(x=>{const tot=(x.supply||0)+(x.vat||0),paid=sum(x.payments,p=>p.amount),att=S.docs.filter(d=>d.subId===x.id).length;
   return `<tr><td>${esc(x.contractDate)}</td>${showSite?`<td>${esc(siteName(x.siteId))}</td>`:''}<td><b>${esc(x.partner)}</b> ${sampleTag(x)}${att?`<br><span class="small muted">첨부 ${att}건</span>`:''}</td><td class="wrap">${esc(x.scope)}${x.payments.length?`<br><span class="small muted">지급: ${x.payments.map(p=>esc(p.date)+' '+fmt(p.amount)).join(', ')}</span>`:''}</td><td class="r"><b>${fmt(x.supply)}</b></td><td class="r">${fmt(x.vat)}</td><td class="r">${fmt(tot)}</td><td class="r">${fmt(paid)}</td><td class="r ${tot-paid>0?'neg':''}">${fmt(tot-paid)}</td>
   <td class="noprint">${ed?btn('+ 지급','new-subpay',`data-id="${x.id}"`,'sm')+' '+btn('수정','edit-sub',`data-id="${x.id}"`,'sm'):''}</td></tr>`;}).join('')}
  </tbody><tfoot><tr><td colspan="${showSite?4:3}">합계</td><td class="r">${fmt(sum(list,x=>x.supply))}</td><td class="r">${fmt(sum(list,x=>x.vat))}</td><td class="r">${fmt(sum(list,x=>(x.supply||0)+(x.vat||0)))}</td><td class="r">${fmt(sum(list,x=>sum(x.payments,p=>p.amount)))}</td><td class="r">${fmt(sum(list,x=>(x.supply||0)+(x.vat||0)-sum(x.payments,p=>p.amount)))}</td><td></td></tr></tfoot></table></div>`;
}
const SUB_NOTE='<p class="note">외주(재하도급) 계약은 계약 공급가액 전체를 비용으로 잡습니다. 같은 외주비를 [자재·경비]의 외주비로 다시 넣지 마세요.</p>';
function vCosts(){
  const list=S.costs.filter(c=>(!costF.site||c.siteId===costF.site)&&(!costF.cat||c.cat===costF.cat));
  const subs=S.subs.filter(x=>!costF.site||x.siteId===costF.site);
  const cats=S.settings.costCats;
  const byCat=cats.map(k=>[k,sum(list.filter(c=>c.cat===k),c=>c.supply)]).filter(x=>x[1]);
  return pageHead('자재·비용·외주',btn('+ 자재·경비 등록','new-cost','','primary')+btn('+ 외주 계약 등록','new-sub')+btn('엑셀(CSV) 내려받기','export-costs'),'수익 계산에는 공급가액을 씁니다.')+
  `<div class="filters noprint">${F('현장',sel('cf-site',siteOpts(),costF.site,'data-filter="cost" data-k="site"'))}${F('구분',sel('cf-cat',[['','전체'],...cats],costF.cat,'data-filter="cost" data-k="cat"'))}</div>
  <div class="stack">${byCat.length?`<div class="tiles">${byCat.map(x=>`<div class="tile"><div class="k">${esc(x[0])}</div><div class="v">${won(x[1])}</div><div class="s">공급가액</div></div>`).join('')}</div>`:''}
  <h2>자재·장비·기타 비용</h2>${costTable(list,true)}<h2>외주(재하도급) 계약</h2>${SUB_NOTE}${subTable(subs,true)}</div>`;
}
function costForm(id,presetSite){
  const sites=visibleSites();if(!sites.length){toast('현장을 먼저 등록하세요.','err');return;}
  const c=id?S.costs.find(x=>x.id===id):{siteId:presetSite||costF.site||(route.name==='site'?route.id:sites[0].id),date:TODAY(),cat:'자재',taxed:true};
  const vendors=S.partners.filter(p=>['자재 구매처','장비업체','협력업체'].includes(p.type)).map(p=>`<option value="${esc(p.name)}">`).join('');
  const body=`<datalist id="dl-vendor">${vendors}</datalist><div class="grid2">
   ${F('사용 현장',sel('siteId',sites.map(s=>[s.id,s.name]),c.siteId),'','span2')}
   ${F('구분',sel('cat',S.settings.costCats,c.cat))}${F('구매일',dateI('date',c.date))}
   ${F('품명·내용 *',inp('name',c.name))}${F('규격',inp('spec',c.spec))}
   ${F('수량',inp('qty',c.qty,'inputmode="decimal" data-costcalc'))}${F('단가 (공급가액)',inp('unitPrice',c.unitPrice==null?'':fmt(c.unitPrice),'class="money" inputmode="numeric" data-costcalc'))}
   ${F('공급가액',money('supply',c.supply),'수량 × 단가로 자동 계산되며 고칠 수 있습니다.')}
   ${F('과세 구분',sel('taxed',[['1','과세 (부가세 10%)'],['0','면세·부가세 없음']],c.taxed===false?'0':'1','data-costcalc'))}
   ${F('부가세',money('vat',c.vat),'영수증과 다르면 직접 고치세요.')}
   ${F('구매처',inp('vendor',c.vendor,'list="dl-vendor"'))}
   ${F('비고',inp('note',c.note),'','span2')}
   ${F('영수증·거래명세서 첨부',`<input type="file" name="files" accept="image/*,application/pdf" multiple>`,'','span2')}</div>
   ${id?`<div class="acts">${btn('이 비용 삭제','del-cost',`data-id="${id}"`,'danger sm')}</div>`:''}`;
  openModal(id?'비용 수정':'자재·경비 등록',body,{submit:async f=>{
    const name=g(f,'name');if(!name){toast('품명·내용을 입력해 주세요.','err');return false;}
    const o=id?c:{id:uid()};
    const qty=num(g(f,'qty')),up=num(g(f,'unitPrice'));let sp=num(g(f,'supply'));if(sp==null&&qty!=null&&up!=null)sp=Math.round(qty*up);
    const taxed=g(f,'taxed')==='1';let vat=num(g(f,'vat'));if(vat==null)vat=taxed?vatOf(sp||0):0;
    Object.assign(o,{siteId:g(f,'siteId'),cat:g(f,'cat'),date:g(f,'date'),name,spec:g(f,'spec'),qty,unitPrice:up,supply:sp||0,vat,taxed,vendor:g(f,'vendor'),note:g(f,'note')});
    if(!id)S.costs.push(o);
    const files=f.elements.files.files;if(files.length)await addFiles(files,{siteId:o.siteId,cat:'영수증·거래명세서',desc:`${o.date} ${o.name}`,costId:o.id});
  }});
}
function subForm(id,presetSite){
  const sites=visibleSites();if(!sites.length){toast('현장을 먼저 등록하세요.','err');return;}
  const x=id?S.subs.find(v=>v.id===id):{siteId:presetSite||costF.site||(route.name==='site'?route.id:sites[0].id),contractDate:TODAY(),payments:[]};
  const partners=S.partners.filter(p=>['협력업체','기타'].includes(p.type)).map(p=>`<option value="${esc(p.name)}">`).join('');
  openModal(id?'외주 계약 수정':'외주(재하도급) 계약 등록',`${SUB_NOTE}<datalist id="dl-subp">${partners}</datalist><div class="grid2">
   ${F('현장',sel('siteId',sites.map(s=>[s.id,s.name]),x.siteId),'','span2')}
   ${F('외주업체 *',inp('partner',x.partner,'list="dl-subp"'))}${F('계약일',dateI('contractDate',x.contractDate))}
   ${F('공사 범위',inp('scope',x.scope),'','span2')}
   ${F('계약 공급가액 *',inp('supply',x.supply==null?'':fmt(x.supply),'class="money" inputmode="numeric" data-billcalc'))}${F('부가세',money('vat',x.vat),'비워 두면 10%')}
   ${F('비고',inp('note',x.note),'','span2')}
   ${F('외주 계약서 첨부',`<input type="file" name="files" multiple>`,'','span2')}</div>
   ${id?`<div class="acts">${btn('이 외주 계약 삭제','del-sub',`data-id="${id}"`,'danger sm')}</div>`:''}`,{submit:async f=>{
    const partner=g(f,'partner'),sp=num(g(f,'supply'));
    if(!partner||sp==null){toast('외주업체와 계약 공급가액을 입력해 주세요.','err');return false;}
    const o=id?x:{id:uid(),payments:[]};let vat=num(g(f,'vat'));if(vat==null)vat=vatOf(sp);
    Object.assign(o,{siteId:g(f,'siteId'),partner,contractDate:g(f,'contractDate'),scope:g(f,'scope'),supply:sp,vat,note:g(f,'note')});
    if(!id)S.subs.push(o);
    const files=f.elements.files.files;if(files.length)await addFiles(files,{siteId:o.siteId,cat:'계약서·변경계약서',desc:`외주 계약: ${partner}`,subId:o.id});
  }});
}
function subPayForm(id){
  const x=S.subs.find(v=>v.id===id),out=(x.supply+x.vat)-sum(x.payments,p=>p.amount);
  openModal('외주비 지급 입력',`<p class="note">${esc(x.partner)} · 남은 금액 <b>${won(out)}</b> (부가세 포함)</p><div class="grid2">${F('지급일',dateI('date',TODAY()))}${F('지급액 (부가세 포함)',money('amount',out>0?out:null))}${F('메모',inp('note',''),'','span2')}</div>
  ${x.payments.length?`<div class="fld"><span class="lb">지급 내역</span><ul class="alerts">${x.payments.map(p=>`<li><span style="flex:1">${esc(p.date)} · ${won(p.amount)} ${esc(p.note)}</span>${btn('삭제','del-subpay',`data-sub="${x.id}" data-id="${p.id}"`,'sm')}</li>`).join('')}</ul></div>`:''}`,{submit:f=>{
    const a=num(g(f,'amount'));if(!a){toast('지급액을 입력해 주세요.','err');return false;}
    x.payments.push({id:uid(),date:g(f,'date')||TODAY(),amount:a,note:g(f,'note')});}});
}
function siteCosts(s,m){
  return `<div class="stack"><div class="acts">${can('editLabor')?btn('+ 인건비','new-labor',`data-site="${s.id}"`):''}${can('editCosts')?btn('+ 자재·경비','new-cost',`data-site="${s.id}"`,'primary')+btn('+ 외주 계약','new-sub',`data-site="${s.id}"`):''}</div>
  ${can('viewMoney')?`<div class="tiles"><div class="tile hl"><div class="k">발생 비용 합계</div><div class="v">${won(m.cost)}</div><div class="s">공급가액</div></div><div class="tile"><div class="k">인건비</div><div class="v">${won(m.laborSum)}</div></div><div class="tile"><div class="k">자재·장비·경비</div><div class="v">${won(m.costSum)}</div></div><div class="tile"><div class="k">외주 계약</div><div class="v">${won(m.subSum)}</div><div class="s">미지급 ${fmt(m.subUnpaid)} (VAT 포함)</div></div></div>`:''}
  ${can('editLabor')||can('viewMoney')?`<h3>인건비</h3>${laborTable(S.labor.filter(x=>x.siteId===s.id),false)}`:''}
  ${can('editCosts')||can('viewMoney')?`<h3>자재·장비·기타 비용</h3>${costTable(S.costs.filter(x=>x.siteId===s.id),false)}<h3>외주(재하도급) 계약</h3>${subTable(S.subs.filter(x=>x.siteId===s.id),false)}`:''}</div>`;
}

/* ================= 기성·청구·수금 ================= */
let billF={site:''};
function billBlock(list,showSite){
  if(!list.length)return empty('청구 기록이 없습니다.');
  list=[...list].sort((a,b)=>(a.siteId+String(a.seq).padStart(3,'0')).localeCompare(b.siteId+String(b.seq).padStart(3,'0')));
  const ed=can('editBills');
  return `<div class="stack">${list.map(b=>{const tot=(b.supply||0)+(b.vat||0),rc=sum(b.receipts,r=>r.amount),out=tot-rc,d=dday(b.dueDate);
   const st=out<=0?pill('수금 완료','ok'):rc>0?pill('일부 수금','warn'):(d!=null&&d<0?pill('미수 · 기한 경과','danger'):pill('미수금','warn'));
   const att=S.docs.filter(x=>x.billId===b.id).length;
   return `<div class="bill"><div class="hd"><b>${b.seq}회 ${esc(b.kind)}</b>${showSite?`<a class="sitelink" href="#site-${b.siteId}">${esc(siteName(b.siteId))}</a>`:''}${st}${sampleTag(b)}<span class="small muted">청구처 ${esc(b.billTo)} · 청구일 ${esc(b.date)} · 지급 예정 ${esc(b.dueDate||'—')}${att?` · 첨부 ${att}건`:''}</span>
    <span style="flex:1"></span>${ed?btn('+ 수금 입력','new-receipt',`data-id="${b.id}"`,'sm primary')+btn('수정','edit-bill',`data-id="${b.id}"`,'sm'):''}</div>
    <div class="nums"><div><span>청구 공급가액</span><b>${fmt(b.supply)}</b></div><div><span>부가세</span><b>${fmt(b.vat)}</b></div><div><span>청구 합계</span><b>${fmt(tot)}</b></div><div><span>수금액</span><b>${fmt(rc)}</b></div><div><span>잔액 (미수금)</span><b class="${out>0?'neg':''}">${fmt(out)}</b></div></div>
    ${b.receipts.length?`<div class="tbl-wrap"><table><thead><tr><th>수금일</th><th class="r">수금액 (부가세 포함)</th><th>메모</th><th class="noprint"></th></tr></thead><tbody>${b.receipts.map(r=>`<tr><td>${esc(r.date)}</td><td class="r">${fmt(r.amount)}</td><td>${esc(r.note)}</td><td class="noprint">${ed?btn('삭제','del-receipt',`data-bill="${b.id}" data-id="${r.id}"`,'sm'):''}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${b.note?`<span class="small muted">${esc(b.note)}</span>`:''}</div>`;}).join('')}</div>`;
}
function vBills(){
  const sites=visibleSites().filter(s=>!billF.site||s.id===billF.site);
  const list=S.bills.filter(b=>!billF.site||b.siteId===billF.site);
  const ms=sites.map(s=>[s,metrics(s)]);
  return pageHead('기성·청구·수금',btn('+ 청구 등록','new-bill','','primary')+btn('엑셀(CSV) 내려받기','export-bills'))+
  `<div class="filters noprint">${F('현장',sel('bf-site',siteOpts(),billF.site,'data-filter="bill" data-k="site"'))}</div>
  <div class="stack">${ms.length?`<div class="tbl-wrap"><table><thead><tr><th>현장</th><th>기본 청구처</th><th class="r">확정 계약금액</th><th class="r">누적 청구 (공급가)</th><th class="r">미청구금</th><th class="r">청구 합계 (VAT 포함)</th><th class="r">누적 수금</th><th class="r">미수금</th></tr></thead><tbody>
  ${ms.map(([s,m])=>`<tr><td>${siteLink(s)}</td><td>${esc(s.billTo)}</td><td class="r">${m.contract==null?pill('미확정','warn'):fmt(m.contract)}</td><td class="r">${fmt(m.billedS)}</td><td class="r">${fmt(m.unbilled)}</td><td class="r">${fmt(m.billedT)}</td><td class="r">${fmt(m.recvT)}</td><td class="r ${m.receivable>0?'neg':''}">${fmt(m.receivable)}</td></tr>`).join('')}
  </tbody></table></div>`:''}
  <p class="note">미청구금 = 확정 계약금액 − 누적 청구 (공급가액끼리 비교) · 미수금 = 청구 합계 − 수금 (부가세 포함 금액끼리 비교)</p>
  <h2>청구 내역</h2>${billBlock(list,true)}</div>`;
}
function siteBills(s,m){
  return `<div class="stack"><div class="acts">${can('editBills')?btn('+ 청구 등록','new-bill',`data-site="${s.id}"`,'primary'):''}</div>
  <div class="tiles"><div class="tile"><div class="k">기본 청구처</div><div class="v" style="font-size:1.05rem">${esc(s.billTo||'—')}</div><div class="s">${s.type==='sub'?'하도급 → 원도급업체':'원도급 → 발주기관'}</div></div>
   ${can('viewMoney')?`<div class="tile"><div class="k">미청구금</div><div class="v">${won(m.unbilled)}</div><div class="s">공급가액</div></div>`:''}
   <div class="tile ${m.receivable>0?'neg':''}"><div class="k">미수금</div><div class="v">${won(m.receivable)}</div><div class="s">부가세 포함</div></div></div>
  ${billBlock(S.bills.filter(b=>b.siteId===s.id),false)}${can('viewMoney')?formulaBox():''}</div>`;
}
function billForm(id,presetSite){
  const sites=visibleSites();if(!sites.length){toast('현장을 먼저 등록하세요.','err');return;}
  let b;
  if(id)b=S.bills.find(x=>x.id===id);
  else{const sid=presetSite||billF.site||(route.name==='site'?route.id:sites[0].id);const s=siteById(sid)||{};const prev=S.bills.filter(x=>x.siteId===sid);
    b={siteId:sid,seq:prev.length?Math.max(...prev.map(x=>x.seq||0))+1:1,kind:'기성',date:TODAY(),billTo:s.billTo||'',receipts:[]};}
  const s=siteById(b.siteId),m=s&&can('viewMoney')?metrics(s):null;
  const body=`${m?`<p class="note">이 현장 확정 계약금액 ${won(m.contract)} · 누적 청구 ${won(m.billedS)} · 미청구금 ${won(m.unbilled)} (공급가액)</p>`:''}<div class="grid2">
   ${F('현장',sel('siteId',sites.map(x=>[x.id,x.name]),b.siteId,id?'':'data-billsite'),'','span2')}
   ${F('차수',inp('seq',b.seq,'inputmode="numeric"'))}${F('구분',sel('kind',['기성','준공','선급금','기타'],b.kind))}
   ${F('청구일',dateI('date',b.date))}${F('지급 예정일',dateI('dueDate',b.dueDate))}
   ${F('청구처',inp('billTo',b.billTo),'현장의 기본 청구처가 채워집니다. 실제 계약에 따라 고칠 수 있습니다.','span2')}
   ${F('청구 공급가액 *',inp('supply',b.supply==null?'':fmt(b.supply),'class="money" inputmode="numeric" data-billcalc'))}
   ${F('부가세',money('vat',b.vat),'비워 두면 공급가액의 10% (원 미만 버림)')}
   ${F('비고',inp('note',b.note),'','span2')}
   ${F('청구서·세금계산서 첨부',`<input type="file" name="files" multiple>`,'','span2')}</div>
   ${id?`<div class="acts">${btn('이 청구 삭제','del-bill',`data-id="${id}"`,'danger sm')}</div>`:''}`;
  openModal(id?'청구 수정':'기성·준공금 청구 등록',body,{submit:async f=>{
    const sp=num(g(f,'supply'));if(sp==null){toast('청구 공급가액을 입력해 주세요.','err');return false;}
    const o=id?b:{id:uid(),receipts:[]};let vat=num(g(f,'vat'));if(vat==null)vat=vatOf(sp);
    Object.assign(o,{siteId:g(f,'siteId'),seq:num(g(f,'seq'))||1,kind:g(f,'kind'),date:g(f,'date'),dueDate:g(f,'dueDate'),billTo:g(f,'billTo'),supply:sp,vat,note:g(f,'note')});
    if(!id)S.bills.push(o);
    const files=f.elements.files.files;if(files.length)await addFiles(files,{siteId:o.siteId,cat:'청구·정산 서류',desc:`${o.seq}회 ${o.kind} 청구 (${o.date})`,billId:o.id});
  }});
}
function receiptForm(billId){
  const b=S.bills.find(x=>x.id===billId);const out=(b.supply+b.vat)-sum(b.receipts,r=>r.amount);
  openModal('수금 입력',`<p class="note">${esc(siteName(b.siteId))} · ${b.seq}회 ${esc(b.kind)} · 남은 금액 <b>${won(out)}</b> (부가세 포함)</p><div class="grid2">
   ${F('수금일',dateI('date',TODAY()))}${F('수금액 (부가세 포함 실제 입금액)',money('amount',out>0?out:null),'일부만 들어왔다면 들어온 금액만 입력하세요.')}${F('메모',inp('note',''),'','span2')}</div>`,{submit:f=>{
    const a=num(g(f,'amount'));if(!a){toast('수금액을 입력해 주세요.','err');return false;}
    b.receipts.push({id:uid(),date:g(f,'date')||TODAY(),amount:a,note:g(f,'note')});
    if(a>out)toast('수금액이 남은 금액보다 많습니다. 확인해 주세요.','err');}});
}

/* ================= 사진·서류 ================= */
let docF={site:'',cat:'',q:''};
function docGrid(list,showSite){
  if(!list.length)return empty('등록된 사진·서류가 없습니다.');
  list=[...list].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.created||0)-(a.created||0));
  return `<div class="docs">${list.map(d=>{const ext=(d.name.split('.').pop()||'파일').toUpperCase().slice(0,4),t=thumbOf(d);
   return `<div class="doc"><button type="button" class="pv" data-act="view-doc" data-id="${d.id}" aria-label="${esc(d.name)} 자세히 보기">${t?`<img src="${t}" alt="" loading="lazy">`:`<span class="ext">${esc(ext)}</span>`}</button>
   <div class="bd"><b>${esc(d.name)}</b><span>${pill(d.cat)} ${d.phase?pill(d.phase,'info'):''} ${sampleTag(d)} ${d.file?'':pill('파일 없음','warn')}</span>${showSite?`<span>${esc(siteName(d.siteId))}</span>`:''}<span class="muted">${esc(d.date)} · ${esc(d.author)}</span>${d.desc?`<span>${esc(d.desc)}</span>`:''}</div></div>`;}).join('')}</div>`;
}
function vDocs(){
  const q=docF.q.toLowerCase();
  const list=S.docs.filter(d=>(!docF.site||d.siteId===docF.site)&&(!docF.cat||d.cat===docF.cat)&&(!q||[d.name,d.desc,d.author,d.date,d.phase].join(' ').toLowerCase().includes(q)));
  return pageHead('사진·서류',can('editDocs')?btn('+ 사진·서류 올리기','new-doc','','primary'):'',`${list.length}건 · 원본 파일 그대로 서버에 저장됩니다 (한 파일 최대 50MB).`)+
  `<div class="filters noprint">${F('현장',sel('df-site',siteOpts(),docF.site,'data-filter="doc" data-k="site"'))}${F('분류',sel('df-cat',[['','전체'],...S.settings.docCats],docF.cat,'data-filter="doc" data-k="cat"'))}${F('검색',`<input data-filter="doc" data-k="q" value="${esc(docF.q)}" placeholder="파일명·설명·작성자·날짜">`)}</div>`+docGrid(list,true);
}
function docForm(presetSite){
  const sites=visibleSites();if(!sites.length){toast('현장을 먼저 등록하세요.','err');return;}
  openModal('사진·서류 올리기',`<div class="grid2">${F('현장',sel('siteId',sites.map(s=>[s.id,s.name]),presetSite||docF.site||(route.name==='site'?route.id:sites[0].id)),'','span2')}
   ${F('분류',sel('cat',S.settings.docCats,docF.cat||S.settings.docCats[0]),'분류 항목은 관리자가 [설정]에서 추가·수정할 수 있습니다.')}${F('사진 단계',sel('phase',[['','해당 없음'],'작업 전','작업 중','작업 후'],''))}
   ${F('설명',inp('desc',''),'','span2')}${F('파일 선택 *',`<input type="file" name="files" multiple>`,'여러 개를 한 번에 고를 수 있습니다. 한 파일 최대 50MB.','span2')}</div>`,{submitLabel:'올리기',submit:async f=>{
    const files=f.elements.files.files;if(!files.length){toast('파일을 선택해 주세요.','err');return false;}
    await addFiles(files,{siteId:g(f,'siteId'),cat:g(f,'cat'),phase:g(f,'phase'),desc:g(f,'desc')});}});
}
function docView(id){
  const d=S.docs.find(x=>x.id===id);if(!d)return;
  const isImg=(d.type||'').startsWith('image/');
  openModal(d.name,`${d.file?(isImg?`<img src="${fileUrl(d)}" alt="" style="width:100%;border-radius:8px">`:''):'<p class="note warn">이 기록에는 파일이 없습니다 (예시 또는 목록만 등록된 항목).</p>'}
   ${d.file?`<div class="acts"><a class="btn primary" href="${fileUrl(d)}" target="_blank" rel="noopener">새 창에서 열기</a><a class="btn" href="${fileUrl(d,'?download=1')}">원본 내려받기</a></div>`:''}
   <dl class="kv"><dt>현장</dt><dd>${esc(siteName(d.siteId))}</dd><dt>분류</dt><dd>${esc(d.cat)} ${d.phase?'· '+esc(d.phase):''}</dd><dt>등록</dt><dd>${esc(d.date)} · ${esc(d.author)}</dd><dt>크기</dt><dd>${d.size?(d.size>1048576?(d.size/1048576).toFixed(1)+'MB':Math.round(d.size/1024).toLocaleString()+'KB'):'—'}</dd></dl>
   ${can('editDocs')?`<div class="grid2">${F('분류 변경',sel('cat',S.settings.docCats,d.cat))}${F('사진 단계',sel('phase',[['','해당 없음'],'작업 전','작업 중','작업 후'],d.phase||''))}${F('설명',inp('desc',d.desc),'','span2')}</div><div class="acts">${btn('삭제','del-doc',`data-id="${d.id}"`,'danger sm')}</div>`:''}`,
   {submit:can('editDocs')?(f=>{d.cat=g(f,'cat');d.phase=g(f,'phase');d.desc=g(f,'desc');}):null});
}

/* ================= 거래처 ================= */
function vPartners(){
  return pageHead('거래처 관리',btn('+ 거래처 등록','new-partner','','primary'),'여기 등록한 발주기관·원도급업체·구매처·협력업체는 입력할 때 자동완성 목록에 나옵니다.')+
  (S.partners.length?`<div class="tbl-wrap"><table><thead><tr><th>거래처명</th><th>구분</th><th>담당자</th><th>연락처</th><th>사업자번호</th><th class="r">관련 현장</th><th>메모</th><th></th></tr></thead><tbody>
  ${[...S.partners].sort((a,b)=>(a.type||'').localeCompare(b.type||'')||(a.name||'').localeCompare(b.name||'')).map(p=>{const n=S.sites.filter(s=>s.client===p.name||s.prime===p.name).length;return `<tr><td><b>${esc(p.name)}</b> ${sampleTag(p)}</td><td>${pill(p.type)}</td><td>${esc(p.person)}</td><td>${p.phone?`<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>`:''}</td><td>${esc(p.bizNo)}</td><td class="r">${n||''}</td><td class="wrap">${esc(p.note)}</td><td>${btn('수정','edit-partner',`data-id="${p.id}"`,'sm')}</td></tr>`;}).join('')}</tbody></table></div>`:empty('등록된 거래처가 없습니다.'));
}
function partnerForm(id){
  const p=id?S.partners.find(x=>x.id===id):{type:'발주기관'};
  openModal(id?'거래처 수정':'거래처 등록',`<div class="grid2">${F('거래처명 *',inp('name',p.name))}${F('구분',sel('type',PARTNER_TYPES,p.type))}${F('담당자',inp('person',p.person))}${F('연락처',inp('phone',p.phone,'inputmode="tel"'))}${F('사업자등록번호',inp('bizNo',p.bizNo))}${F('메모',inp('note',p.note))}</div>${id?`<div class="acts">${btn('삭제','del-partner',`data-id="${id}"`,'danger sm')}</div>`:''}`,{submit:f=>{
    const name=g(f,'name');if(!name){toast('거래처명을 입력해 주세요.','err');return false;}
    const o=id?p:{id:uid()};Object.assign(o,{name,type:g(f,'type'),person:g(f,'person'),phone:g(f,'phone'),bizNo:g(f,'bizNo'),note:g(f,'note')});if(!id)S.partners.push(o);}});
}

/* ================= 설정 ================= */
function vSetup(){
  const st=S.settings;
  return pageHead('설정 및 사용자')+`<div class="stack">
  <div class="card stack"><h3>사용자 계정</h3><p class="small">직원마다 아이디를 만들어 주세요. 처음 비밀번호로 로그인하면 본인이 새 비밀번호로 바꾸게 됩니다.</p><div class="acts">${btn('+ 사용자 추가','new-user','','primary')}</div>
   <div class="tbl-wrap"><table><thead><tr><th>이름</th><th>아이디</th><th>역할</th><th>배정 현장</th><th>최근 로그인</th><th></th></tr></thead><tbody>${S.users.map(u=>`<tr><td><b>${esc(u.name)}</b>${u.id===S.me.id?' '+pill('나','accent'):''}${u.active?'':' '+pill('사용 중지','danger')}${u.mustChange?' '+pill('비밀번호 변경 전','warn'):''}</td><td>${esc(u.username)}</td><td>${ROLES[u.role]}</td><td class="wrap">${u.role==='admin'?'모든 현장':((u.siteIds||[]).map(id=>esc(siteName(id))).join(', ')||'<span class="muted">없음</span>')}</td><td>${esc(u.lastLogin||'—')}</td><td>${btn('수정','edit-user',`data-id="${u.id}"`,'sm')}</td></tr>`).join('')}</tbody></table></div>
   <p class="small muted">현장직원은 배정된 현장만 보입니다. 사무직원도 아래 [배정되지 않은 현장도 보기]를 끄면 배정 현장만 보입니다.</p></div>
  <div class="card stack"><h3>역할별 권한</h3><p class="small">관리자는 항상 모든 권한을 가집니다. 체크를 바꾸면 바로 저장되고 서버에서 즉시 적용됩니다. 금액 보기 권한이 없으면 계약금액·비용·청구 자료가 서버에서 아예 전송되지 않습니다.</p>
   <div class="tbl-wrap"><table class="perm"><thead><tr><th>권한</th><th>관리자</th><th>사무직원</th><th>현장직원</th></tr></thead><tbody>
   ${PERMS.map(([k,t])=>`<tr><td>${t}</td><td>✓</td><td><input type="checkbox" data-perm="office.${k}" ${st.perms.office[k]?'checked':''} aria-label="사무직원 ${t}"></td><td><input type="checkbox" data-perm="field.${k}" ${st.perms.field[k]?'checked':''} aria-label="현장직원 ${t}"></td></tr>`).join('')}</tbody></table></div></div>
  <div class="cols">
   <div class="card stack"><h3>백업</h3><p class="small">서버가 매일 새벽 3시 이후 자동으로 데이터를 백업해 30일치를 보관합니다. 사진·파일까지 포함한 전체 백업은 한 달에 한 번 이상 내려받아 회사 PC나 외장 저장장치에 보관하세요.</p>
    <div class="acts"><a class="btn primary" href="/api/backup.zip">전체 백업 내려받기 (파일 포함)</a><a class="btn" href="/api/backup.json">데이터만 백업</a></div>
    <div class="acts">${btn('자동 백업 목록','backups')}${btn('백업 파일로 복원','restore','','danger')}</div></div>
   <div class="card stack"><h3>회사·기록</h3>${F('회사명 (메뉴 위에 표시)',`<input data-setting="company" value="${esc(st.company)}">`)}
    <div class="acts">${btn('전체 변경 기록 보기','audit')}</div>
    <div class="acts">${S.sites.some(s=>s.sample)||S.partners.some(x=>x.sample)?btn('예시 데이터 모두 삭제','del-samples','','danger'):btn('연습용 예시 데이터 넣기','add-samples')}</div></div>
  </div>
  <div class="cols">
   <div class="card stack"><h3>공사 종류</h3>${F('한 줄에 하나씩',`<textarea data-list="kinds" rows="6">${esc(st.kinds.join('\n'))}</textarea>`)}</div>
   <div class="card stack"><h3>서류 분류</h3>${F('한 줄에 하나씩',`<textarea data-list="docCats" rows="6">${esc(st.docCats.join('\n'))}</textarea>`,'회사가 실제로 쓰는 양식은 [회사 양식] 분류로 올려 두면 모두가 내려받아 쓸 수 있습니다.')}</div>
   <div class="card stack"><h3>비용 구분</h3>${F('한 줄에 하나씩',`<textarea data-list="costCats" rows="6">${esc(st.costCats.join('\n'))}</textarea>`)}</div>
  </div></div>`;
}
function userForm(id){
  const u=id?S.users.find(x=>x.id===id):{role:'field',siteIds:[],active:true};
  openModal(id?'사용자 수정':'사용자 추가',`<div class="grid2">${F('이름 *',inp('name',u.name))}${F('아이디 *',inp('username',u.username,'autocapitalize="off" autocomplete="off"'),'영문·숫자 3~30자')}
  ${F('역할',sel('role',Object.entries(ROLES),u.role))}
  ${F(id?'비밀번호 초기화':'처음 비밀번호 *',`<input name="password" id="f-password" type="text" autocomplete="new-password" placeholder="${id?'바꿀 때만 입력':'8자 이상'}">`,id?'입력하면 이 비밀번호로 바뀌고, 본인이 다음 로그인 때 새로 정합니다.':'직원에게 알려 주세요. 첫 로그인 때 본인이 바꿉니다.')}
  ${id?`<label class="chk span2"><input type="checkbox" name="active" ${u.active?'checked':''}> 사용 가능 (끄면 로그인할 수 없음)</label>`:''}</div>
  <div class="fld"><span class="lb">배정 현장</span><span class="hint">현장직원(또는 전체 현장 보기 권한이 없는 사무직원)이 볼 수 있는 현장입니다.</span>${S.sites.map(s=>`<label class="chk"><input type="checkbox" name="siteIds" value="${s.id}" ${(u.siteIds||[]).includes(s.id)?'checked':''}> ${esc(s.name)}</label>`).join('')||'<span class="muted">현장이 없습니다.</span>'}</div>
  ${id&&id!==S.me.id?`<div class="acts">${btn('사용자 삭제','del-user',`data-id="${id}"`,'danger sm')}</div>`:''}`,{submit:async f=>{
    const body={name:g(f,'name'),username:g(f,'username'),role:g(f,'role'),password:g(f,'password')||undefined,siteIds:[...f.querySelectorAll('[name=siteIds]:checked')].map(x=>x.value),active:id?f.elements.active.checked:true};
    try{const r=await api(id?'/api/users/'+id:'/api/users',body,id?'PUT':'POST');applyState(r.state);toast('저장했습니다.');}
    catch(e){toast(e.message,'err');return false;}
  }});
}
function pwForm(forced){
  openModal(forced?'새 비밀번호 정하기':'비밀번호 변경',`${forced?'<p class="note warn">처음 받은 비밀번호로 로그인했습니다. 본인만 아는 새 비밀번호로 바꿔 주세요.</p>':''}
  ${F('지금 비밀번호',`<input name="current" type="password" autocomplete="current-password">`)}${F('새 비밀번호',`<input name="next" type="password" autocomplete="new-password">`,'8자 이상')}${F('새 비밀번호 확인',`<input name="next2" type="password" autocomplete="new-password">`)}`,{noClose:forced,submitLabel:'비밀번호 바꾸기',submit:async f=>{
    if(g(f,'next')!==g(f,'next2')){toast('새 비밀번호 두 칸이 서로 다릅니다.','err');return false;}
    try{await api('/api/me/password',{current:g(f,'current'),next:g(f,'next')});S.me.mustChange=false;toast('비밀번호를 바꿨습니다.');}
    catch(e){toast(e.message,'err');return false;}
  }});
}
function accountMenu(){
  openModal('내 계정',`<dl class="kv"><dt>이름</dt><dd>${esc(S.me.name)}</dd><dt>아이디</dt><dd>${esc(S.me.username)}</dd><dt>역할</dt><dd>${ROLES[S.me.role]}</dd></dl>
  <div class="acts">${btn('비밀번호 변경','change-pw')}${btn('로그아웃','logout','','danger')}</div>
  <p class="hint">휴대폰에서는 브라우저 메뉴의 [홈 화면에 추가]를 누르면 앱처럼 쓸 수 있습니다.</p>`);
}
async function auditView(siteId){
  try{const r=await api('/api/audit'+(siteId?'?site='+encodeURIComponent(siteId):''));
    openModal(siteId?'현장 변경 기록':'전체 변경 기록',r.list.length?`<div class="tbl-wrap"><table><thead><tr><th>일시</th><th>사용자</th><th>작업</th><th>내용</th></tr></thead><tbody>${r.list.map(a=>`<tr><td>${esc(a.at)}</td><td>${esc(a.user_name)}</td><td>${pill(a.action,a.action==='삭제'?'danger':a.action==='등록'?'ok':'info')}</td><td class="wrap">${esc(a.summary)}${!siteId&&a.site_id&&siteById(a.site_id)?`<br><span class="small muted">${esc(siteName(a.site_id))}</span>`:''}</td></tr>`).join('')}</tbody></table></div><p class="hint">최근 300건까지 보입니다. 기록은 서버에서 자동으로 남기며 고칠 수 없습니다.</p>`:'<p class="muted">기록이 없습니다.</p>',{wide:true});
  }catch(e){toast(e.message,'err');}
}

/* ================= 인쇄용 ================= */
function vPrintSite(id){
  const s=siteById(id);if(!s)return empty('현장을 찾을 수 없거나 권한이 없습니다.');
  const money=can('viewMoney'),m=metrics(s),cr=changeRows(s);
  const logs=S.logs.filter(l=>l.siteId===id).sort((a,b)=>a.date.localeCompare(b.date));
  return `<div class="ph noprint"><div class="tt"><p class="small"><a href="#site-${id}">← 현장 상세로</a></p><h1>인쇄용 현장 요약</h1><p>회사 내부 참고용이며 공식 제출 서식이 아닙니다.</p></div><div class="acts">${btn('인쇄 · PDF 저장','print','','primary')}</div></div>
  <div class="print"><h1>현장 요약 — ${esc(s.name)}</h1><p class="small">${esc(S.settings.company)} · 출력일 ${TODAY()} · 출력자 ${esc(me().name)} · 내부 참고용${s.sample?' · 예시 데이터':''}</p>
  <table><tbody><tr><th>공사 구분</th><td>${s.type==='sub'?'하도급':'원도급'}</td><th>공사 종류</th><td>${esc(s.kind)}</td></tr>
  <tr><th>발주기관</th><td>${esc(s.client)}</td><th>${s.type==='sub'?'원도급업체':'계약번호'}</th><td>${esc(s.type==='sub'?s.prime:s.contractNo)}</td></tr>
  <tr><th>현장 주소</th><td colspan="3">${esc(s.address)}</td></tr>
  <tr><th>공사 기간</th><td>${esc(s.startDate)} ~ ${esc(s.endPlanned)}</td><th>상태</th><td>${esc(s.status)}</td></tr>
  ${money?`<tr><th>현재 확정 계약금액</th><td>${won(m.contract)} (공급가액)</td><th>${s.type==='sub'?'원도급금액 / 하도급률':'청구처'}</th><td>${s.type==='sub'?won(m.prime)+' / '+pct(m.rate):esc(s.billTo)}</td></tr>
  <tr><th>발생 비용</th><td>${won(m.cost)}</td><th>예상 수익 (미확정)</th><td>${won(m.profit)}</td></tr>
  <tr><th>누적 청구 (공급가)</th><td>${won(m.billedS)}</td><th>미청구금</th><td>${won(m.unbilled)}</td></tr>
  <tr><th>누적 수금 (VAT 포함)</th><td>${won(m.recvT)}</td><th>미수금</th><td>${won(m.receivable)}</td></tr>`:''}</tbody></table>
  ${money&&cr.rows.length>1?`<h3 style="margin-top:18px">계약 변경 내역</h3><table><thead><tr><th>일자</th><th>구분</th><th>내용</th><th>변경 후 계약금액</th><th>상태</th></tr></thead><tbody>${cr.rows.filter(r=>!r.initial).map(r=>`<tr><td>${esc(r.c.date)}</td><td>${esc(r.c.kind)}</td><td>${esc(r.c.reason)}</td><td>${r.pending?'미확정':won(r.our)}</td><td>${r.pending?'금액 미확정':'확정'}</td></tr>`).join('')}</tbody></table>`:''}
  <h3 style="margin-top:18px">작업일지 (${logs.length}건)</h3><table><thead><tr><th>날짜</th><th>작업 내용</th><th>인원/공수</th><th>장비</th><th>특이사항</th><th>작성</th></tr></thead><tbody>
  ${logs.map(l=>`<tr><td>${esc(l.date)}</td><td style="white-space:pre-wrap">${esc(l.content)}</td><td>${l.workers??''}명 / ${l.manDays??''}</td><td>${esc(l.equipment)}</td><td>${esc(l.note)}</td><td>${esc(l.author)}</td></tr>`).join('')||'<tr><td colspan="6">없음</td></tr>'}</tbody></table></div>`;
}
let plF={site:'',from:'',to:''};
function vPrintLogs(){
  const logs=S.logs.filter(l=>(!plF.site||l.siteId===plF.site)&&(!plF.from||l.date>=plF.from)&&(!plF.to||l.date<=plF.to)).sort((a,b)=>a.date.localeCompare(b.date));
  return `<div class="ph noprint"><div class="tt"><p class="small"><a href="#logs">← 작업일지로</a></p><h1>작업일지 인쇄용 보기</h1><p>회사 내부 참고용이며 공식 서식이 아닙니다.</p></div><div class="acts">${btn('인쇄 · PDF 저장','print','','primary')}</div></div>
  <div class="filters noprint">${F('현장',sel('pl-site',siteOpts(),plF.site,'data-filter="pl" data-k="site"'))}${F('시작일',`<input type="date" data-filter="pl" data-k="from" value="${esc(plF.from)}">`)}${F('종료일',`<input type="date" data-filter="pl" data-k="to" value="${esc(plF.to)}">`)}</div>
  <div class="print"><h1>작업일지 ${plF.site?'— '+esc(siteName(plF.site)):''}</h1><p class="small">${esc(S.settings.company)} · ${esc(plF.from||'처음')} ~ ${esc(plF.to||TODAY())} · ${logs.length}건</p>
  <table><thead><tr><th>날짜</th>${plF.site?'':'<th>현장</th>'}<th>작업 내용</th><th>인원</th><th>공수</th><th>작업 시간</th><th>장비</th><th>특이사항·전달사항</th><th>작성자</th></tr></thead><tbody>
  ${logs.map(l=>`<tr><td>${esc(l.date)}</td>${plF.site?'':`<td>${esc(siteName(l.siteId))}</td>`}<td style="white-space:pre-wrap">${esc(l.content)}</td><td>${l.workers??''}</td><td>${l.manDays??''}</td><td>${esc(l.hours)}</td><td>${esc(l.equipment)}</td><td>${esc(l.note)}</td><td>${esc(l.author)}</td></tr>`).join('')||'<tr><td colspan="9">해당 기간 작업일지가 없습니다.</td></tr>'}</tbody></table></div>`;
}

/* ================= 동작 ================= */
const A={
 'close-modal':()=>closeModal(),
 'toggle-nav':()=>$('#app').classList.toggle('navopen'),
 'account':()=>accountMenu(),
 'change-pw':()=>pwForm(false),
 'logout':async()=>{try{await api('/api/logout',{});}catch(e){}S=null;snap=null;showLogin('로그아웃했습니다.');},
 'refresh':()=>refresh().then(()=>toast('최신 내용을 불러왔습니다.')),
 'print':()=>window.print(),
 'tab':el=>{siteTab=el.dataset.tab;render();},
 'audit':el=>auditView(el.dataset.site),
 'new-site':()=>siteForm(null),
 'edit-site':el=>siteForm(siteById(el.dataset.id)),
 'fill-confirm':()=>{const f=$('#mform');const c=subCalc(readCalc(f));if(!c.sub){toast('계산된 하도급금액이 없습니다. 원도급 금액과 하도급률 또는 계약금액을 먼저 입력하세요.','err');return;}f.elements.confirmed.value=fmt(c.sub.s);updateCalc();},
 'del-site':el=>{const s=siteById(el.dataset.id);confirmBox(`<b>${esc(s.name)}</b> 현장과 연결된 작업일지·인건비·비용·외주·청구·사진 기록을 모두 삭제합니다. 되돌릴 수 없습니다 (자동 백업에서만 복원 가능).`,'삭제',()=>{const id=s.id;S.sites=S.sites.filter(x=>x.id!==id);['logs','labor','costs','subs','bills','docs'].forEach(k=>S[k]=S[k].filter(x=>x.siteId!==id));nextHash='sites';});},
 'new-change':el=>changeForm(el.dataset.site,null),
 'edit-change':el=>changeForm(el.dataset.site,el.dataset.id),
 'del-change':el=>{const s=siteById(el.dataset.site);confirmBox('이 계약 변경 기록을 삭제합니다. 현재 확정 계약금액이 다시 계산됩니다.','삭제',()=>{const c=s.changes.find(x=>x.id===el.dataset.id);s.changes=s.changes.filter(x=>x.id!==el.dataset.id);s.history.push({at:NOW(),by:me().name,text:`계약 변경 삭제: ${c?c.kind+' '+c.date:''}`});});},
 'new-log':el=>logForm(null,el.dataset.site),
 'edit-log':el=>logForm(el.dataset.id),
 'del-log':el=>{const id=el.dataset.id;const linked=S.labor.filter(x=>x.logId===id).length;confirmBox(`이 작업일지와 첨부 사진을 삭제합니다.${linked?` 연결된 인건비 ${linked}건은 남기고 연결만 끊습니다.`:''}`,'삭제',()=>{S.logs=S.logs.filter(x=>x.id!==id);S.docs=S.docs.filter(d=>d.logId!==id);S.labor.forEach(x=>{if(x.logId===id)x.logId=null;});});},
 'new-labor':el=>laborForm(null,el.dataset.site?{siteId:el.dataset.site}:null),
 'edit-labor':el=>laborForm(el.dataset.id),
 'del-labor':el=>confirmBox('이 인건비 기록을 삭제합니다.','삭제',()=>{S.labor=S.labor.filter(x=>x.id!==el.dataset.id);}),
 'labor-import':()=>laborImport(),
 'labor-from-log':el=>{const l=S.logs.find(x=>x.id===el.dataset.id);laborForm(null,{siteId:l.siteId,date:l.date,content:l.content.split('\n')[0],qty:l.manDays-laborUsed(l.id),unit:'공수',logId:l.id,worker:''});},
 'new-cost':el=>costForm(null,el.dataset.site),
 'edit-cost':el=>costForm(el.dataset.id),
 'del-cost':el=>confirmBox('이 비용 기록을 삭제합니다.','삭제',()=>{S.costs=S.costs.filter(x=>x.id!==el.dataset.id);}),
 'new-sub':el=>subForm(null,el.dataset.site),
 'edit-sub':el=>subForm(el.dataset.id),
 'del-sub':el=>confirmBox('이 외주 계약과 지급 내역을 삭제합니다.','삭제',()=>{S.subs=S.subs.filter(x=>x.id!==el.dataset.id);}),
 'new-subpay':el=>subPayForm(el.dataset.id),
 'del-subpay':el=>{const x=S.subs.find(v=>v.id===el.dataset.sub);x.payments=x.payments.filter(p=>p.id!==el.dataset.id);closeModal();sync().then(ok=>{if(ok)toast('지급 기록을 삭제했습니다.');render();});},
 'new-bill':el=>billForm(null,el.dataset.site),
 'edit-bill':el=>billForm(el.dataset.id),
 'del-bill':el=>confirmBox('이 청구와 수금 기록을 삭제합니다.','삭제',()=>{S.bills=S.bills.filter(x=>x.id!==el.dataset.id);}),
 'new-receipt':el=>receiptForm(el.dataset.id),
 'del-receipt':el=>{const b=S.bills.find(x=>x.id===el.dataset.bill);confirmBox('이 수금 기록을 삭제합니다.','삭제',()=>{b.receipts=b.receipts.filter(r=>r.id!==el.dataset.id);});},
 'new-doc':el=>docForm(el.dataset.site),
 'view-doc':el=>docView(el.dataset.id),
 'del-doc':el=>confirmBox('이 파일을 서버에서 삭제합니다.','삭제',()=>{S.docs=S.docs.filter(x=>x.id!==el.dataset.id);}),
 'new-partner':()=>partnerForm(null),
 'edit-partner':el=>partnerForm(el.dataset.id),
 'del-partner':el=>confirmBox('이 거래처를 삭제합니다. 현장에 적힌 이름은 그대로 남습니다.','삭제',()=>{S.partners=S.partners.filter(x=>x.id!==el.dataset.id);}),
 'new-user':()=>userForm(null),
 'edit-user':el=>userForm(el.dataset.id),
 'del-user':el=>{const u=S.users.find(x=>x.id===el.dataset.id);openModal('확인',`<p>${esc(u.name)}(${esc(u.username)}) 사용자를 삭제합니다. 퇴사자는 삭제 대신 [사용 가능]을 꺼 두면 기록이 더 잘 남습니다.</p>`,{submitLabel:'삭제',submit:async()=>{try{const r=await api('/api/users/'+u.id,undefined,'DELETE');applyState(r.state);toast('삭제했습니다.');}catch(e){toast(e.message,'err');return false;}}});},
 'export-sites':()=>{const rows=filteredSites().map(s=>{const m=metrics(s);return [s.name,s.type==='sub'?'하도급':'원도급',s.kind,s.status,s.client,s.prime,s.manager,s.contractDate,s.startDate,s.endPlanned,s.endActual,m.prime??'',m.rate==null?'':(Math.round(m.rate*100)/100),m.contract??'',m.pending,m.laborSum,m.costSum,m.subSum,m.cost,m.billedS,m.billedT,m.recvT,m.unbilled??'',m.receivable,m.profit??'',s.sample?'예시':''];});
   downloadCSV(`현장목록_${TODAY()}.csv`,[['공사명','구분','공사종류','상태','발주기관','원도급업체','담당자','계약일','착공일','준공예정일','실제준공일','원도급금액(공급가)','하도급률(%)','확정계약금액(공급가)','미확정추가공사(예상)','인건비','자재경비(공급가)','외주계약(공급가)','발생비용','누적청구(공급가)','누적청구(합계)','누적수금(합계)','미청구금','미수금','예상수익','비고'],...rows]);},
 'export-labor':()=>downloadCSV(`인건비_${TODAY()}.csv`,[['작업일','현장','작업자·협력업체','작업내용','투입량','단위','단가','금액','지급예정일','지급일','지급여부','작업일지연결'],...S.labor.map(l=>[l.date,siteName(l.siteId),l.worker,l.content,l.qty,l.unit,l.unitPrice,l.amount,l.payDue,l.paidDate,l.paid?'지급':'미지급',l.logId?'예':''])]),
 'export-costs':()=>downloadCSV(`자재비용외주_${TODAY()}.csv`,[['구분','날짜','현장','항목','품명·업체','규격·범위','수량','단가','공급가액','부가세','합계','구매처·지급액','비고'],
   ...S.costs.map(c=>['자재·경비',c.date,siteName(c.siteId),c.cat,c.name,c.spec,c.qty,c.unitPrice,c.supply,c.vat,(c.supply||0)+(c.vat||0),c.vendor,c.note]),
   ...S.subs.map(x=>['외주 계약',x.contractDate,siteName(x.siteId),'외주',x.partner,x.scope,'','',x.supply,x.vat,(x.supply||0)+(x.vat||0),sum(x.payments,p=>p.amount),x.note])]),
 'export-bills':()=>{const rows=S.bills.map(b=>{const rc=sum(b.receipts,r=>r.amount);return [siteName(b.siteId),b.seq,b.kind,b.date,b.billTo,b.dueDate,b.supply,b.vat,b.supply+b.vat,rc,b.supply+b.vat-rc,b.receipts.map(r=>r.date+' '+r.amount).join(' / ')];});
   downloadCSV(`청구수금_${TODAY()}.csv`,[['현장','차수','구분','청구일','청구처','지급예정일','청구공급가액','부가세','청구합계','수금액','미수금','수금내역'],...rows]);},
 'backups':async()=>{try{const r=await api('/api/backups');openModal('자동 백업 목록',r.list.length?`<ul class="alerts">${r.list.map(b=>`<li><span style="flex:1">${esc(b.name)} <span class="small muted">${Math.round(b.size/1024).toLocaleString()}KB</span></span><a class="btn sm" href="/api/backups/${encodeURIComponent(b.name)}">내려받기</a></li>`).join('')}</ul><p class="hint">자동 백업은 데이터만 들어 있습니다. 내려받은 파일은 [백업 파일로 복원]에 쓸 수 있습니다.</p>`:'<p class="muted">아직 자동 백업이 없습니다. 서버가 매일 새벽 3시 이후 만듭니다.</p>');}catch(e){toast(e.message,'err');}},
 'restore':()=>openModal('백업 파일로 복원',`<p class="note danger">복원하면 서버의 모든 데이터와 사용자 계정이 백업 시점으로 <b>바뀌고</b>, 모든 사용자가 로그아웃됩니다. 복원 직전 상태는 서버에 자동으로 따로 저장됩니다.</p>${F('백업 파일 (.zip 또는 .json)',`<input type="file" name="file" accept=".zip,.json,application/json,application/zip">`)}${F('확인을 위해 “복원”이라고 입력하세요',`<input name="ok">`)}`,{submitLabel:'복원',submit:async f=>{
   const file=f.elements.file.files[0];if(!file){toast('백업 파일을 선택하세요.','err');return false;}
   if(g(f,'ok')!=='복원'){toast('확인 칸에 “복원”이라고 입력하세요.','err');return false;}
   const fd=new FormData();fd.append('file',file);
   try{const r=await api('/api/restore',fd);toast(`복원했습니다${r.files?` (파일 ${r.files}개 포함)`:''}. 다시 로그인하세요.`);setTimeout(()=>location.reload(),1500);}catch(e){toast(e.message,'err');return false;}}}),
 'del-samples':()=>confirmBox('보라색 <b>예시</b> 표시가 붙은 현장과 그 현장의 모든 기록, 예시 거래처를 삭제합니다. 직접 입력한 다른 데이터는 남습니다.','예시 데이터 삭제',()=>{
   const ids=new Set(S.sites.filter(s=>s.sample).map(s=>s.id));S.sites=S.sites.filter(s=>!s.sample);
   ['logs','labor','costs','subs','bills','docs'].forEach(k=>S[k]=S[k].filter(x=>!x.sample&&!ids.has(x.siteId)));S.partners=S.partners.filter(p=>!p.sample);}),
 'add-samples':()=>confirmBox('연습용 예시 현장 3곳과 관련 기록을 추가합니다. 모두 보라색 <b>예시</b> 표시가 붙고, 나중에 한 번에 지울 수 있습니다.','추가',()=>{const d=sampleData();COLS.forEach(k=>S[k].push(...d[k]));})
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');
  if(el){const a=A[el.dataset.act];if(a){e.preventDefault();a(el,e);}return;}
  if($('#app').classList.contains('navopen')&&!e.target.closest('#nav'))$('#app').classList.remove('navopen');
});
const FILTERS={site:siteF,log:logF,lab:labF,cost:costF,bill:billF,doc:docF,pl:plF};
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.dataset.filter){FILTERS[t.dataset.filter][t.dataset.k]=t.value;const pos=t.selectionStart;render();const n=document.querySelector(`[data-filter="${t.dataset.filter}"][data-k="${t.dataset.k}"]`);if(n&&n.tagName==='INPUT'&&n.type!=='date'){n.focus();try{n.setSelectionRange(pos,pos);}catch(_){}}return;}
  const f=t.form;if(!f||f.id!=='mform')return;
  if(t.name==='type'&&$('#siteform'))$('#siteform').dataset.type=t.value;
  if(t.name==='subMode'&&$('#siteform'))$('#siteform').dataset.mode=t.value;
  if($('#calcbox')||$('#ourbox'))updateCalc();
  if(t.hasAttribute('data-labcalc')){const q=num(g(f,'qty')),p=num(g(f,'unitPrice'));if(q!=null&&p!=null)f.elements.amount.value=fmt(Math.round(q*p));}
  if(t.hasAttribute('data-costcalc')){const q=num(g(f,'qty')),p=num(g(f,'unitPrice'));if(q!=null&&p!=null)f.elements.supply.value=fmt(Math.round(q*p));const sp=num(g(f,'supply'));f.elements.vat.value=g(f,'taxed')==='1'&&sp!=null?fmt(vatOf(sp)):'0';}
  if(t.name==='supply'&&f.elements.taxed){const sp=num(t.value);f.elements.vat.value=g(f,'taxed')==='1'&&sp!=null?fmt(vatOf(sp)):'0';}
  if(t.hasAttribute('data-billcalc')){const sp=num(t.value);f.elements.vat.value=sp!=null?fmt(vatOf(sp)):'';}
  if(t.hasAttribute('data-billsite')){const s=siteById(t.value);if(s){f.elements.billTo.value=s.billTo||'';const prev=S.bills.filter(x=>x.siteId===s.id);f.elements.seq.value=prev.length?Math.max(...prev.map(x=>x.seq||0))+1:1;}}
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.dataset.perm){const[r,k]=t.dataset.perm.split('.');S.settings.perms[r][k]=t.checked;if(await sync())toast('권한을 바꿨습니다.');render();return;}
  if(t.dataset.setting){S.settings[t.dataset.setting]=t.value.trim();if(await sync())toast('저장했습니다.');render();return;}
  if(t.dataset.list){const v=t.value.split('\n').map(x=>x.trim()).filter(Boolean);if(!v.length){toast('항목이 하나 이상 있어야 합니다.','err');return;}S.settings[t.dataset.list]=[...new Set(v)];if(await sync())toast('목록을 저장했습니다.');render();return;}
  if(t.type==='radio'&&t.form&&t.form.id==='mform'&&(t.name==='type'||t.name==='subMode')){const sf=$('#siteform');if(sf){if(t.name==='type')sf.dataset.type=t.value;else sf.dataset.mode=t.value;updateCalc();}}
});
document.addEventListener('focusout',e=>{const t=e.target;if(t.classList&&t.classList.contains('money')){const n=num(t.value);t.value=n==null?'':fmt(n);if($('#calcbox'))updateCalc();}});
document.addEventListener('submit',async e=>{
  if(e.target.id==='loginform'){
    e.preventDefault();const f=e.target,b=f.querySelector('[type=submit]');b.disabled=true;
    try{await api('/api/login',{username:g(f,'username'),password:f.elements.password.value});await boot();}
    catch(err){toast(err.message,'err');}finally{b.disabled=false;}return;
  }
  if(e.target.id!=='mform')return;e.preventDefault();if(!modalSubmit)return;
  const b=e.target.querySelector('[type=submit]');if(b){b.disabled=true;b.dataset.t=b.textContent;b.textContent='저장 중…';}
  try{
    const r=await modalSubmit(e.target);
    if(r===false)return;
    const ok=await sync();
    closeModal();
    if(ok){toast('저장했습니다.');if(nextHash){const h=nextHash;nextHash=null;if(location.hash==='#'+h){render();}else location.hash=h;}else render();}
    else{nextHash=null;render();}
  }catch(err){toast(err.message,'err');}
  finally{if(b&&document.body.contains(b)){b.disabled=false;b.textContent=b.dataset.t||'저장';}}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal').hidden&&!$('#modal').dataset.lock)closeModal();});
window.addEventListener('hashchange',()=>{route=parseHash();if(route.name==='site'&&route.id!==lastSite){siteTab='info';lastSite=route.id;}render();window.scrollTo(0,0);});
/* 다른 직원이 입력한 내용 반영: 화면으로 돌아올 때와 5분마다 새로 불러옴 */
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S&&$('#modal').hidden)refresh(true);});
setInterval(()=>{if(S&&!document.hidden&&$('#modal').hidden)refresh(true);},5*60e3);
window.addEventListener('offline',()=>toast('인터넷 연결이 끊겼습니다. 연결된 뒤 저장하세요.','err'));

boot();
})();
