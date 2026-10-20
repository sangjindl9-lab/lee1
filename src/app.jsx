
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ───────── 양식 정의 ───────── */
const TEMPLATES = [
  { id:'p2t4', name:'세로 2매', sub:'설명표 4항목',     o:'p', c:1, r:2, cap:'table4' },
  { id:'p3s',  name:'세로 3매', sub:'우측 설명표',      o:'p', c:1, r:3, cap:'side' },
  { id:'p4t2', name:'세로 4매', sub:'2×2 위치·내용',    o:'p', c:2, r:2, cap:'table2' },
  { id:'p6l',  name:'세로 6매', sub:'2×3 한 줄',        o:'p', c:2, r:3, cap:'line' },
  { id:'p8l',  name:'세로 8매', sub:'2×4 한 줄',        o:'p', c:2, r:4, cap:'line' },
  { id:'p1t4', name:'세로 1매', sub:'설명표 4항목',     o:'p', c:1, r:1, cap:'table4' },
  { id:'p2n',  name:'세로 2매', sub:'설명 없음',        o:'p', c:1, r:2, cap:'none' },
  { id:'p4s',  name:'세로 4매', sub:'우측 설명표',      o:'p', c:1, r:4, cap:'side' },
  { id:'pcmp', name:'전·후 비교', sub:'2×3 시공 전/후', o:'p', c:2, r:3, cap:'line', cmp:true },
  { id:'l2t4', name:'가로 2매', sub:'설명표 4항목',     o:'l', c:2, r:1, cap:'table4' },
  { id:'l4l',  name:'가로 4매', sub:'2×2 한 줄',        o:'l', c:2, r:2, cap:'line' },
  { id:'l6l',  name:'가로 6매', sub:'3×2 한 줄',        o:'l', c:3, r:2, cap:'line' },
];
const CAP_FIELDS = { table4:['gong','loc','desc','date'], side:['gong','loc','desc','date'], table2:['loc','desc'], line:['desc'], none:[] };
const LABEL = { gong:'공종', loc:'위치', desc:'내용', date:'일자' };
const SIZE = { p:{w:794,h:1123}, l:{w:1123,h:794} };
const getTpl = id => TEMPLATES.find(t=>t.id===id) || TEMPLATES[0];

/* ───────── 유틸 ───────── */
const uid = () => Math.random().toString(36).slice(2,10);
const fmtDate = ms => { const d=new Date(ms); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; };
const baseName = n => (n||'').replace(/^.*[\\/]/,'').replace(/\.[^.]+$/,'');
const nextFrame = () => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));

function loadImg(src){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=src; }); }

async function compressFile(file){
  const url = URL.createObjectURL(file);
  try{
    const img = await loadImg(url);
    const max = 1800, k = Math.min(1, max/Math.max(img.naturalWidth,img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth*k); c.height = Math.round(img.naturalHeight*k);
    const g = c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height);
    g.drawImage(img,0,0,c.width,c.height);
    return { src:c.toDataURL('image/jpeg',0.86), w:c.width, h:c.height };
  } finally { URL.revokeObjectURL(url); }
}

async function rotateSrc(src){
  const img = await loadImg(src);
  const c = document.createElement('canvas'); c.width=img.naturalHeight; c.height=img.naturalWidth;
  const g = c.getContext('2d'); g.translate(c.width,0); g.rotate(Math.PI/2); g.drawImage(img,0,0);
  return { src:c.toDataURL('image/jpeg',0.9), w:c.width, h:c.height };
}

/* 엑셀용: 상자 크기에 맞춰 채우기/전체보기로 잘라낸 이미지 */
async function fitToBox(src, bw, bh, mode){
  const img = await loadImg(src);
  const S = 2, c = document.createElement('canvas'); c.width=Math.round(bw*S); c.height=Math.round(bh*S);
  const g = c.getContext('2d'); g.fillStyle='#ffffff'; g.fillRect(0,0,c.width,c.height);
  const iw=img.naturalWidth, ih=img.naturalHeight;
  const k = mode==='cover' ? Math.max(c.width/iw, c.height/ih) : Math.min(c.width/iw, c.height/ih);
  const dw=iw*k, dh=ih*k; g.drawImage(img,(c.width-dw)/2,(c.height-dh)/2,dw,dh);
  return c.toDataURL('image/jpeg',0.9);
}

async function filesFromDataTransfer(dt){
  const entries = dt.items ? Array.from(dt.items).map(i=>i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean) : [];
  const plain = Array.from(dt.files||[]);
  if(!entries.length) return plain;
  const out = [];
  const walk = async (en, path) => {
    if(en.isFile){ const f = await new Promise((res,rej)=>en.file(res,rej)); f._path = path+f.name; out.push(f); }
    else if(en.isDirectory){
      const rd = en.createReader(); let batch;
      do { batch = await new Promise((res,rej)=>rd.readEntries(res,rej)); for(const b of batch) await walk(b, path+en.name+'/'); } while(batch.length);
    }
  };
  for(const en of entries) await walk(en,'');
  return out;
}

function saveBlob(blob, name){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
const safeName = s => (s||'사진대지').replace(/[\\/:*?"<>|]/g,'_').slice(0,60);

/* IndexedDB 자동저장 */
const DB = {
  open(){ return new Promise((res,rej)=>{ const r=indexedDB.open('sajindaeji',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); },
  async get(k){ const db=await this.open(); return new Promise((res,rej)=>{ const q=db.transaction('kv').objectStore('kv').get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); },
  async set(k,v){ const db=await this.open(); return new Promise((res,rej)=>{ const t=db.transaction('kv','readwrite'); t.objectStore('kv').put(v,k); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error); }); },
};

/* 예시 사진 (캔버스로 그림) */
function sampleImage(n, title){
  const c=document.createElement('canvas'); c.width=1200; c.height=900; const g=c.getContext('2d');
  const hues=[[196,24],[32,30],[150,18],[210,16]][n%4];
  const grd=g.createLinearGradient(0,0,0,900); grd.addColorStop(0,`hsl(${hues[0]} ${hues[1]}% 82%)`); grd.addColorStop(1,`hsl(${hues[0]} ${hues[1]}% 62%)`);
  g.fillStyle=grd; g.fillRect(0,0,1200,900);
  g.fillStyle='rgba(0,0,0,.08)'; for(let x=0;x<1200;x+=60) g.fillRect(x,0,2,900);
  g.fillStyle='#e9ece8'; g.strokeStyle='#59625e'; g.lineWidth=6;
  g.fillRect(380,170,440,560); g.strokeRect(380,170,440,560);
  g.fillStyle='#3f4744'; for(let i=0;i<6;i++){ g.fillRect(430,230+i*70,150,40); g.fillRect(620,230+i*70,150,40); }
  g.fillStyle='rgba(20,20,20,.72)'; g.fillRect(0,790,1200,110);
  g.fillStyle='#fff'; g.font='bold 46px "Noto Sans KR",sans-serif'; g.fillText(`예시 사진 ${n+1}  ·  ${title}`,40,860);
  return { src:c.toDataURL('image/jpeg',0.8), w:1200, h:900 };
}
function makeSample(){
  const today=fmtDate(Date.now());
  const rows=[['전기','지하1층 전기실','분전반 설치 전 현황'],['전기','지하1층 전기실','분전반 설치 및 결선'],['전기','1층 복도','케이블트레이 설치'],['통신','2층 통신실','통신랙 설치 및 접지']];
  return rows.map((r,i)=>({ id:uid(), ...sampleImage(i,r[2]), name:`예시${i+1}.jpg`, gong:r[0], loc:r[1], desc:r[2], date:today }));
}
const DEFAULT_DOC = { title:'사 진 대 지', project:'○○아파트 전기설비 개보수공사', company:'㈜에스에스전력', fit:'cover', autoDate:true, nameDesc:false, sample:true };

/* ───────── 아이콘 ───────── */
const Ico = {
  rot:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>,
  del:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>,
  rep:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>,
};

/* ───────── 양식 미니 썸네일 ───────── */
function Mini({ t }){
  const n=t.c*t.r, capN = t.cap==='table4'?3 : t.cap==='table2'?2 : t.cap==='line'?1 : 0;
  return (
    <div className={'mini '+t.o}>
      <div className="t"/>
      <div className="g" style={{gridTemplateColumns:`repeat(${t.c},1fr)`,gridTemplateRows:`repeat(${t.r},1fr)`}}>
        {Array.from({length:n}).map((_,i)=>(
          <div key={i} className={'c'+(t.cap==='side'?' sd':'')}>
            <div className="ph"/>
            {t.cap==='side' ? <div className="sc"/> : Array.from({length:capN}).map((_,k)=><div key={k} className="cp"/>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── 한 장의 사진대지 ───────── */
function Sheet({ tpl, doc, items, page, pageCount, ia, sel, over, h }){
  const per = tpl.c*tpl.r, start = page*per, size = SIZE[tpl.o];
  const fields = CAP_FIELDS[tpl.cap];
  const field = (idx, item, f) => ia && item
    ? <input aria-label={LABEL[f]} value={item[f]||''} onChange={e=>h.update(idx,{[f]:e.target.value})} onFocus={()=>h.select(idx)} onClick={e=>e.stopPropagation()}/>
    : <span>{item ? item[f] : ''}</span>;
  return (
    <div className={'sheet'+(ia?' ia':'')} style={{width:size.w,height:size.h}}>
      <div className="sh-title">{doc.title}</div>
      <div className="sh-info"><div className="lb">공사명</div><div>{doc.project}</div></div>
      <div className="sh-grid" style={{gridTemplateColumns:`repeat(${tpl.c},minmax(0,1fr))`,gridTemplateRows:`repeat(${tpl.r},minmax(0,1fr))`}}>
        {Array.from({length:per}).map((_,k)=>{
          const idx=start+k, item=items[idx]||null;
          const cls='cell'+(tpl.cap==='side'?' side':'')+(ia&&sel===idx?' sel':'')+(ia&&over===idx?' over':'');
          const dnd = ia ? {
            onDragOver:e=>{e.preventDefault(); h.over(idx);},
            onDragLeave:()=>h.over(null),
            onDrop:e=>{e.preventDefault(); e.stopPropagation(); h.over(null); h.drop(e, idx);},
          } : {};
          return (
            <div key={k} className={cls} {...dnd} onClick={ia?()=>h.select(idx):undefined}>
              <div className={'photo'+(item?'':' empty')}
                   draggable={ia && !!item}
                   onDragStart={ia&&item ? e=>{ e.dataTransfer.setData('text/x-slot',String(idx)); e.dataTransfer.effectAllowed='move'; } : undefined}
                   onClick={ia ? e=>{ if(!item){ e.stopPropagation(); h.pick(idx); } } : undefined}
                   style={item?{backgroundImage:`url(${item.src})`,backgroundSize:doc.fit==='cover'?'cover':'contain'}:null}>
                {tpl.cmp && <div className="badge">{idx%2===0?'시공 전':'시공 후'}</div>}
                {ia && item && (
                  <div className="tools" onClick={e=>e.stopPropagation()}>
                    <button title="오른쪽으로 90° 회전" aria-label="회전" onClick={()=>h.rotate(idx)}>{Ico.rot}</button>
                    <button title="사진 바꾸기" aria-label="사진 바꾸기" onClick={()=>h.pick(idx,true)}>{Ico.rep}</button>
                    <button title="사진 빼기" aria-label="사진 빼기" onClick={()=>h.remove(idx)}>{Ico.del}</button>
                  </div>
                )}
              </div>
              {fields.length>0 && (
                <div className="caps">
                  {fields.map(f=> tpl.cap==='line'
                    ? <div key={f} className="cap line"><div className="vl">{field(idx,item,f)}</div></div>
                    : <div key={f} className="cap"><div className="lb">{LABEL[f]}</div><div className="vl">{field(idx,item,f)}</div></div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sh-foot"><span>{doc.company}</span><span>{page+1} / {pageCount}</span></div>
    </div>
  );
}

/* ───────── PDF 내보내기 ───────── */
async function exportPDF(stageEl, tpl, name, onProg){
  if(document.fonts && document.fonts.ready) await document.fonts.ready;
  const { jsPDF } = window.jspdf;
  const portrait = tpl.o==='p';
  const pdf = new jsPDF({ orientation: portrait?'portrait':'landscape', unit:'mm', format:'a4', compress:true });
  const W = portrait?210:297, H = portrait?297:210;
  const sheets = stageEl.querySelectorAll('.sheet');
  for(let i=0;i<sheets.length;i++){
    onProg(i, sheets.length);
    const cv = await html2canvas(sheets[i], { scale:2, backgroundColor:'#ffffff', useCORS:true, logging:false, scrollX:0, scrollY:0, windowWidth:document.documentElement.clientWidth });
    if(i) pdf.addPage('a4', portrait?'portrait':'landscape');
    pdf.addImage(cv.toDataURL('image/jpeg',0.92),'JPEG',0,0,W,H);
  }
  pdf.save(name+'.pdf');
}

/* ───────── 엑셀 내보내기 ───────── */
async function exportExcel(tpl, doc, items, pageCount, name, onProg){
  const wb = new ExcelJS.Workbook(); wb.creator = doc.company || '';
  const portrait = tpl.o==='p';
  const ws = wb.addWorksheet('사진대지', { pageSetup:{ paperSize:9, orientation:portrait?'portrait':'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, horizontalCentered:true,
    margins:{ left:0.4, right:0.4, top:0.4, bottom:0.4, header:0.2, footer:0.2 } }, views:[{ showGridLines:false }] });
  const NC = portrait?12:18, COLPX = 57;
  ws.columns = Array.from({length:NC},()=>({ width:7.43 }));
  const PT = 15, PX = 20, CAP_PT = 20, CAP_PX = 26.67;
  const usable = portrait ? 1010 : 690;
  const capRows = { table4:4, table2:2, line:1, none:0, side:0 }[tpl.cap];
  const head = 48 + 27 + 8 + 27;
  const block = (usable - head) / tpl.r;
  const photoRows = Math.max(4, Math.floor((block - capRows*CAP_PX - 8) / PX));
  const span = NC / tpl.c, per = tpl.c*tpl.r, fields = CAP_FIELDS[tpl.cap];
  const thin = { style:'thin', color:{argb:'FF222222'} }, med = { style:'medium', color:{argb:'FF111111'} };
  const font = { name:'맑은 고딕', size:10 };
  const labelFill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF0F0EC'} };

  const range = (r1,c1,r2,c2,o={}) => {
    if(r1!==r2 || c1!==c2) ws.mergeCells(r1,c1,r2,c2);
    const m = ws.getCell(r1,c1);
    if(o.value!==undefined) m.value = o.value;
    m.font = o.font || font;
    m.alignment = { vertical:'middle', horizontal:o.h||'left', wrapText:!!o.wrap, indent:o.h==='left'||!o.h?1:0 };
    if(o.fill) m.fill = o.fill;
    if(o.border!==false){
      const b = o.strong ? med : thin;
      for(let r=r1;r<=r2;r++) for(let c=c1;c<=c2;c++){
        const cell = ws.getCell(r,c), bd = {...(cell.border||{})};
        if(r===r1) bd.top=b; if(r===r2) bd.bottom=b; if(c===c1) bd.left=b; if(c===c2) bd.right=b;
        cell.border = bd;
      }
    }
  };

  let row = 1;
  for(let p=0;p<pageCount;p++){
    onProg(p, pageCount);
    ws.getRow(row).height = 36;
    range(row,1,row,NC,{ value:doc.title, font:{name:'맑은 고딕',size:20,bold:true}, h:'center', border:false }); row++;
    ws.getRow(row).height = 22;
    range(row,1,row,2,{ value:'공사명', font:{...font,bold:true}, h:'center', fill:labelFill, strong:true });
    range(row,3,row,NC,{ value:doc.project, strong:true }); row++;
    ws.getRow(row).height = 6; row++;

    for(let r=0;r<tpl.r;r++){
      const top = row;
      for(let k=0;k<photoRows;k++) ws.getRow(top+k).height = PT;
      for(let k=0;k<capRows;k++) ws.getRow(top+photoRows+k).height = CAP_PT;
      for(let c=0;c<tpl.c;c++){
        const idx = p*per + r*tpl.c + c, item = items[idx] || null;
        const c0 = c*span + 1;
        const isSide = tpl.cap==='side';
        const pSpan = isSide ? Math.round(span*2/3) : span;
        range(top, c0, top+photoRows-1, c0+pSpan-1, { value:'', border:true });
        if(item){
          const bw = pSpan*COLPX - 8, bh = photoRows*PX - 8;
          const data = await fitToBox(item.src, bw, bh, doc.fit);
          const id = wb.addImage({ base64:data, extension:'jpeg' });
          ws.addImage(id, { tl:{ col:c0-1+0.07, row:top-1+0.2 }, ext:{ width:bw, height:bh }, editAs:'oneCell' });
        }
        const pre = tpl.cmp ? (idx%2===0?'[시공 전] ':'[시공 후] ') : '';
        if(isSide){
          const lc = c0+pSpan, rest = span - pSpan;
          const each = Math.floor(photoRows/4);
          fields.forEach((f,k)=>{
            const r1 = top + k*each, r2 = k===3 ? top+photoRows-1 : r1+each-1;
            range(r1, lc, r2, lc, { value:LABEL[f], font:{...font,bold:true}, h:'center', fill:labelFill });
            range(r1, lc+1, r2, lc+rest-1, { value:item?(item[f]||''):'', wrap:true });
          });
        } else {
          fields.forEach((f,k)=>{
            const rr = top+photoRows+k;
            if(tpl.cap==='line') range(rr, c0, rr, c0+span-1, { value:item?pre+(item[f]||''):pre.trim(), h:'center' });
            else {
              const lw = span>=6 ? 2 : 1;
              range(rr, c0, rr, c0+lw-1, { value:LABEL[f], font:{...font,bold:true}, h:'center', fill:labelFill });
              range(rr, c0+lw, rr, c0+span-1, { value:item?(item[f]||''):'' });
            }
          });
        }
      }
      row = top + photoRows + capRows;
      ws.getRow(row).height = 6; row++;
    }
    ws.getRow(row).height = 20;
    range(row,1,row,NC/2,{ value:doc.company, border:false, font:{...font,size:9} });
    range(row,NC/2+1,row,NC,{ value:`${p+1} / ${pageCount}`, border:false, h:'right', font:{...font,size:9} });
    if(p<pageCount-1) ws.getRow(row).addPageBreak();
    row++;
  }
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), name+'.xlsx');
}

/* ───────── 앱 ───────── */
function App(){
  const [tplId, setTplId] = useState('p2t4');
  const [doc, setDoc] = useState(DEFAULT_DOC);
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(null);
  const [over, setOver] = useState(null);
  const [trayOver, setTrayOver] = useState(false);
  const [busy, setBusy] = useState(null);       // {title, prog}
  const [stage, setStage] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [extraPages, setExtraPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState(false);

  const tpl = getTpl(tplId), per = tpl.c*tpl.r, size = SIZE[tpl.o];
  const lastFilled = useMemo(()=>{ for(let i=items.length-1;i>=0;i--) if(items[i]) return i; return -1; },[items]);
  const pageCount = Math.max(1, Math.ceil((lastFilled+1)/per) + extraPages);
  const photoCount = items.filter(Boolean).length;

  const boxRef = useRef(null), stageRef = useRef(null);
  const fileRef = useRef(null), dirRef = useRef(null), jsonRef = useRef(null);
  const pickTarget = useRef({ idx:null, replace:false });
  const sampleRef = useRef(true);

  const say = useCallback(msg=>{ setToast(msg); clearTimeout(say.t); say.t=setTimeout(()=>setToast(null),3200); },[]);

  /* 불러오기 / 자동저장 */
  useEffect(()=>{ (async()=>{
    try{
      const saved = await DB.get('project');
      if(saved && saved.v===1){ setTplId(saved.tplId); setDoc({...DEFAULT_DOC,...saved.doc}); setItems(saved.items||[]); setExtraPages(saved.extraPages||0); sampleRef.current=!!saved.doc.sample; }
      else { setItems(makeSample()); }
    }catch(e){ setItems(makeSample()); }
    setLoaded(true);
  })(); },[]);
  useEffect(()=>{ if(!loaded) return; const t=setTimeout(()=>{ DB.set('project',{v:1,tplId,doc,items,extraPages}).catch(()=>{}); },700); return ()=>clearTimeout(t); },[loaded,tplId,doc,items,extraPages]);

  useEffect(()=>{ const s=document.getElementById('pagestyle'); if(s) s.textContent=`@page{size:A4 ${tpl.o==='p'?'portrait':'landscape'};margin:0}`; },[tpl.o]);
  useEffect(()=>{ if(dirRef.current){ dirRef.current.setAttribute('webkitdirectory',''); dirRef.current.setAttribute('directory',''); } },[]);

  /* 미리보기 배율 */
  useEffect(()=>{
    const el=boxRef.current; if(!el) return;
    const fit=()=>{ const w=el.clientWidth-32; setScale(Math.min(1, w/size.w)); };
    fit(); const ro=new ResizeObserver(fit); ro.observe(el); return ()=>ro.disconnect();
  },[size.w]);

  /* 사진 추가 */
  const insertFiles = async (files, idx=null, replace=false) => {
    const all = Array.from(files||[]);
    const imgs = all.filter(f=>/^image\/(jpeg|png|webp|gif|bmp)/.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
    const heic = all.filter(f=>/\.(heic|heif)$/i.test(f.name)).length;
    if(!imgs.length){ say(heic ? 'HEIC 사진은 지원하지 않습니다. 휴대폰에서 JPG로 바꿔 올려 주세요.' : '사진 파일(JPG, PNG)을 넣어 주세요.'); return; }
    imgs.sort((a,b)=>(a._path||a.webkitRelativePath||a.name).localeCompare(b._path||b.webkitRelativePath||b.name,'ko',{numeric:true}));
    const out = [];
    for(let i=0;i<imgs.length;i++){
      setBusy({ title:'사진 불러오는 중', prog:`${i+1} / ${imgs.length}`, pct:(i+1)/imgs.length });
      try{
        const f=imgs[i], c=await compressFile(f);
        out.push({ id:uid(), ...c, name:f.name, gong:'', loc:'', desc:doc.nameDesc?baseName(f.name):'', date:doc.autoDate?fmtDate(f.lastModified||Date.now()):'' });
      }catch(e){}
    }
    setBusy(null);
    const wasSample = sampleRef.current;
    if(wasSample){ sampleRef.current=false; setDoc(d=>({...d,sample:false})); }
    setItems(prev=>{
      let arr = wasSample ? [] : [...prev];
      if(replace && idx!=null && out[0]){ const old=arr[idx]||{}; arr[idx]={...out[0], gong:old.gong||'', loc:old.loc||'', desc:old.desc||out[0].desc, date:old.date||out[0].date}; return arr; }
      let start = idx==null || wasSample ? (()=>{ let l=-1; arr.forEach((x,i)=>{ if(x) l=i; }); return l+1; })() : idx;
      if(idx!=null && !wasSample && arr[idx]) { arr.splice(idx,0,...out); }
      else { let i=start; for(const o of out){ while(arr[i]) i++; arr[i]=o; i++; } }
      return Array.from(arr, x=>x||null);
    });
    if(wasSample) setExtraPages(0);
    say(`사진 ${out.length}장을 넣었습니다.`+(heic?` (HEIC ${heic}장 제외)`:''));
  };

  const h = {
    update:(idx,patch)=>setItems(prev=>{ const a=[...prev]; if(a[idx]) a[idx]={...a[idx],...patch}; return a; }),
    select:idx=>setSel(idx),
    over:idx=>setOver(idx),
    pick:(idx,replace=false)=>{ pickTarget.current={idx,replace}; fileRef.current && fileRef.current.click(); },
    remove:idx=>{ setItems(prev=>{ const a=[...prev]; a[idx]=null; return a; }); },
    rotate:async idx=>{ const it=items[idx]; if(!it) return; const r=await rotateSrc(it.src); h.update(idx,r); },
    drop:async (e, idx)=>{
      const from = e.dataTransfer.getData('text/x-slot');
      if(from!==''){ const a=+from; if(a===idx) return; setItems(prev=>{ const arr=[...prev]; const t=arr[a]||null; arr[a]=arr[idx]||null; arr[idx]=t; return Array.from(arr,x=>x||null); }); setSel(idx); return; }
      const files = await filesFromDataTransfer(e.dataTransfer);
      insertFiles(files, idx);
    },
  };

  const applyAll = f => {
    if(sel==null || !items[sel]) return;
    const v = items[sel][f];
    setItems(prev=>prev.map(x=>x?{...x,[f]:v}:x));
    say(`모든 사진의 ${LABEL[f]}을(를) "${v||'빈칸'}"(으)로 맞췄습니다.`);
  };

  const removePage = p => {
    setItems(prev=>{ const a=[...prev]; a.splice(p*per, per); return a; });
    if(p >= Math.ceil((lastFilled+1)/per)) setExtraPages(n=>Math.max(0,n-1));
    setSel(null);
  };

  /* 내보내기 */
  const name = safeName(doc.project ? `${doc.project}_사진대지` : '사진대지');
  const runPDF = () => { setBusy({title:'PDF 만드는 중', prog:'준비', pct:0}); setStage(true); };
  useEffect(()=>{ if(!stage) return; (async()=>{
    try{ await nextFrame(); await exportPDF(stageRef.current, tpl, name, (i,n)=>setBusy({title:'PDF 만드는 중', prog:`${i+1} / ${n} 쪽`, pct:(i+1)/n})); say('PDF를 내려받았습니다.'); }
    catch(e){ console.error(e); say('PDF를 만들지 못했습니다. 사진 수를 줄여 다시 시도해 주세요.'); }
    finally{ setStage(false); setBusy(null); }
  })(); },[stage]);

  const runExcel = async () => {
    try{
      setBusy({title:'엑셀 만드는 중', prog:'준비', pct:0});
      await exportExcel(tpl, doc, items, pageCount, name, (i,n)=>setBusy({title:'엑셀 만드는 중', prog:`${i+1} / ${n} 쪽`, pct:(i+1)/n}));
      say('엑셀 파일을 내려받았습니다.');
    }catch(e){ console.error(e); say('엑셀을 만들지 못했습니다. 다시 시도해 주세요.'); }
    finally{ setBusy(null); }
  };

  const saveJSON = () => { saveBlob(new Blob([JSON.stringify({v:1,app:'sajindaeji',tplId,doc,items,extraPages})],{type:'application/json'}), name+'.sajin.json'); say('작업 파일을 저장했습니다.'); };
  const loadJSON = async file => {
    try{
      const d = JSON.parse(await file.text());
      if(d.app!=='sajindaeji' || !Array.isArray(d.items)) throw 0;
      setTplId(getTpl(d.tplId).id); setDoc({...DEFAULT_DOC,...d.doc}); setItems(d.items); setExtraPages(d.extraPages||0); sampleRef.current=!!(d.doc&&d.doc.sample); setSel(null);
      say('작업 파일을 불러왔습니다.');
    }catch(e){ say('이 파일은 사진대지 작업 파일이 아닙니다.'); }
  };
  const newProject = () => { setItems([]); setDoc(d=>({...DEFAULT_DOC, project:'', company:d.company, sample:false})); sampleRef.current=false; setExtraPages(0); setSel(null); setConfirmNew(false); say('새 사진대지를 시작합니다.'); };
  const clearSample = () => { setItems([]); sampleRef.current=false; setDoc(d=>({...d, sample:false, project:''})); setSel(null); };

  const selItem = sel!=null ? items[sel] : null;
  const pages = Array.from({length:pageCount},(_,p)=>p);

  return (
    <>
      <header className="top">
        <div className="brand"><b>현장 사진대지</b><span>양식 고르고 사진 끌어다 놓기 · PDF·엑셀 저장</span></div>
        <div className="acts">
          <button className="btn" onClick={()=>setConfirmNew(true)}>새로 만들기</button>
          <button className="btn" onClick={()=>jsonRef.current.click()}>불러오기</button>
          <button className="btn" onClick={saveJSON}>작업 저장</button>
          <button className="btn" onClick={()=>window.print()}>인쇄</button>
          <button className="btn pri" onClick={runExcel} disabled={!photoCount}>엑셀 다운로드</button>
          <button className="btn pri" onClick={runPDF} disabled={!photoCount}>PDF 다운로드</button>
        </div>
      </header>

      <div className="main">
        <aside className="side">
          <section className="sec">
            <h3>양식 <em>{tpl.name} · {tpl.sub}</em></h3>
            <div className="tpls">
              {TEMPLATES.map(t=>(
                <button key={t.id} className={'tpl'+(t.id===tplId?' on':'')} onClick={()=>{ setTplId(t.id); setExtraPages(0); }} aria-pressed={t.id===tplId}>
                  <Mini t={t}/><small>{t.name}<i>{t.sub}</i></small>
                </button>
              ))}
            </div>
          </section>

          <section className="sec">
            <h3>문서 정보</h3>
            <div className="field"><label htmlFor="f-title">제목</label><input id="f-title" className="inp" value={doc.title} onChange={e=>setDoc({...doc,title:e.target.value})}/></div>
            <div className="field"><label htmlFor="f-proj">공사명</label><input id="f-proj" className="inp" value={doc.project} placeholder="예) ○○초등학교 전기설비 개선공사" onChange={e=>setDoc({...doc,project:e.target.value})}/></div>
            <div className="field"><label htmlFor="f-comp">업체명 (쪽 아래 표시)</label><input id="f-comp" className="inp" value={doc.company} onChange={e=>setDoc({...doc,company:e.target.value})}/></div>
            <div className="field"><label>사진 맞춤</label>
              <div className="seg">
                <button className={doc.fit==='cover'?'on':''} onClick={()=>setDoc({...doc,fit:'cover'})}>칸 채우기</button>
                <button className={doc.fit==='contain'?'on':''} onClick={()=>setDoc({...doc,fit:'contain'})}>사진 전체 보기</button>
              </div>
            </div>
          </section>

          <section className="sec">
            <h3>사진 <em>{photoCount}장 · {pageCount}쪽</em></h3>
            <div className={'drop'+(trayOver?' over':'')}
              onClick={()=>h.pick(null)}
              onDragOver={e=>{e.preventDefault(); setTrayOver(true);}}
              onDragLeave={()=>setTrayOver(false)}
              onDrop={async e=>{ e.preventDefault(); setTrayOver(false); const fs=await filesFromDataTransfer(e.dataTransfer); insertFiles(fs,null); }}>
              <b>사진이나 폴더를 여기에 끌어다 놓으세요</b>
              파일 이름 순서대로 빈 칸부터 채웁니다
            </div>
            <div className="drop-btns">
              <button className="btn" onClick={()=>h.pick(null)}>사진 선택</button>
              <button className="btn" onClick={()=>dirRef.current.click()}>폴더 선택</button>
            </div>
            <div style={{marginTop:10}}>
              <label className="chk"><input type="checkbox" checked={doc.autoDate} onChange={e=>setDoc({...doc,autoDate:e.target.checked})}/>사진 파일 날짜를 일자에 넣기</label>
              <label className="chk"><input type="checkbox" checked={doc.nameDesc} onChange={e=>setDoc({...doc,nameDesc:e.target.checked})}/>파일 이름을 내용에 넣기</label>
            </div>
            <p className="hint">미리보기에서 사진을 끌어 다른 칸에 놓으면 자리가 바뀝니다.</p>
          </section>

          <section className="sec">
            <h3>선택한 사진 {sel!=null && <em>{sel+1}번 칸</em>}</h3>
            {selItem ? (
              <div className="selbox">
                <div className="selhead">
                  <div className="selthumb" style={{backgroundImage:`url(${selItem.src})`}}/>
                  <div><b>{Math.floor(sel/per)+1}쪽 {sel%per+1}번째</b><span>{selItem.name}</span></div>
                </div>
                {['gong','loc','desc','date'].map(f=>(
                  <div className="field" key={f}>
                    <label htmlFor={'s-'+f}>{LABEL[f]}</label>
                    <div className="row2">
                      <input id={'s-'+f} className="inp" value={selItem[f]||''} onChange={e=>h.update(sel,{[f]:e.target.value})}/>
                      {f!=='desc' && <button className="btn sm" onClick={()=>applyAll(f)} title={`모든 사진에 같은 ${LABEL[f]} 적용`}>전체 적용</button>}
                    </div>
                  </div>
                ))}
                <div className="row2">
                  <button className="btn sm" onClick={()=>h.rotate(sel)}>90° 회전</button>
                  <button className="btn sm" onClick={()=>h.pick(sel,true)}>사진 바꾸기</button>
                  <button className="btn sm danger" onClick={()=>h.remove(sel)}>빼기</button>
                </div>
                {!CAP_FIELDS[tpl.cap].length && <p className="hint" style={{marginTop:8}}>지금 양식은 설명칸이 없어 입력한 내용이 인쇄되지 않습니다.</p>}
              </div>
            ) : <p className="hint">미리보기에서 사진을 누르면 여기서 공종·위치·내용·일자를 고치고, 같은 값을 모든 사진에 한 번에 넣을 수 있습니다.</p>}
          </section>
        </aside>

        <main className="stagebox" ref={boxRef}>
          {doc.sample && (
            <div className="banner">
              <span>지금 보이는 사진과 설명은 예시입니다. 사진을 넣으면 예시는 자동으로 사라집니다.</span>
              <button className="btn sm" onClick={clearSample}>예시 지우기</button>
            </div>
          )}
          <div className="pages">
            {pages.map(p=>(
              <div className="pg" key={p}>
                <div className="pgbar" style={{width:size.w*scale}}>
                  <span className="n">{p+1} / {pageCount}</span>
                  {pageCount>1 && <button className="btn sm" onClick={()=>removePage(p)}>이 쪽 삭제</button>}
                </div>
                <div className="wrap" style={{width:size.w*scale,height:size.h*scale}}>
                  <div style={{transform:`scale(${scale})`,transformOrigin:'0 0',position:'absolute',left:0,top:0}}>
                    <Sheet tpl={tpl} doc={doc} items={items} page={p} pageCount={pageCount} ia sel={sel} over={over} h={h}/>
                  </div>
                </div>
              </div>
            ))}
            <button className="btn addpg" onClick={()=>setExtraPages(n=>n+1)}>+ 빈 쪽 추가</button>
          </div>
        </main>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e=>{ const {idx,replace}=pickTarget.current; insertFiles(e.target.files, idx, replace); e.target.value=''; }}/>
      <input ref={dirRef} type="file" multiple hidden onChange={e=>{ insertFiles(e.target.files, null); e.target.value=''; }}/>
      <input ref={jsonRef} type="file" accept=".json,application/json" hidden onChange={e=>{ e.target.files[0] && loadJSON(e.target.files[0]); e.target.value=''; }}/>

      {stage && (
        <div className="exstage" ref={stageRef} aria-hidden="true">
          {pages.map(p=><Sheet key={p} tpl={tpl} doc={doc} items={items} page={p} pageCount={pageCount} ia={false} h={h}/>)}
        </div>
      )}
      {busy && (
        <div className="busy" role="status">
          <b>{busy.title}</b>
          <div className="bar"><i style={{width:`${Math.round((busy.pct||0)*100)}%`}}/></div>
          <span>{busy.prog}</span>
        </div>
      )}
      {confirmNew && (
        <div className="modal" onClick={()=>setConfirmNew(false)}>
          <div onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true">
            <h4>새 사진대지를 시작할까요?</h4>
            <p>지금 넣은 사진과 설명이 모두 지워집니다. 필요하면 먼저 '작업 저장'으로 파일을 받아 두세요.</p>
            <div className="acts">
              <button className="btn" onClick={()=>setConfirmNew(false)}>취소</button>
              <button className="btn pri" onClick={newProject}>새로 시작</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
