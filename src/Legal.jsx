import React, { useEffect, useState } from 'react';

// 수사 협조: 회원 조회 → 보존 조치 → 자료 추출(해시·제공 이력 자동 기록)
const dt = (t) => new Date(t).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const day = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const LOG = { join: '가입', login: '접속', logout: '종료', 'admin.login': '관리자 로그인', 'admin.fail': '관리자 로그인 실패' };
const DOCS = ['압수·수색·검증 영장', '통신사실확인자료 제공요청(법원 허가)', '수사협조 공문', '법원 문서제출명령', '기타'];

function Download({ res }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!res) return undefined;
    const u = URL.createObjectURL(new Blob([res.text], { type: 'application/json' }));
    setUrl(u); return () => URL.revokeObjectURL(u);
  }, [res]);
  if (!res) return null;
  return (
    <section className="a-card a-done">
      <h3>추출 완료</h3>
      <p className="meta">파일: {res.name}</p>
      <p className="meta">SHA-256 (위·변조 확인용): <code className="a-hash">{res.sha256}</code></p>
      <div className="btn-row">
        <a className="btn sm" href={url} download={res.name}>파일 내려받기</a>
        <button className="btn sm ghost" onClick={() => navigator.clipboard?.writeText(res.sha256).catch(() => {})}>해시값 복사</button>
      </div>
      <p className="hint">제공할 때 해시값을 함께 적어 주면, 받은 쪽에서 파일이 바뀌지 않았는지 확인할 수 있습니다.</p>
    </section>
  );
}

export default function Legal({ d, send, lookup, exportRes }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [hold, setHold] = useState({ reason: '', agency: '' });
  const today = day(Date.now());
  const [ex, setEx] = useState({ purpose: 'agency', agency: '', docType: DOCS[0], docNo: '', memo: '', from: day(Date.now() - 90 * 86400e3), to: today });
  const u = lookup?.list?.find((x) => x.id === sel) || null;
  const setE = (k) => (e) => setEx({ ...ex, [k]: e.target.value });
  const okExport = ex.purpose === 'internal' || (ex.agency.trim() && ex.docNo.trim());

  return (
    <div className="a-stack">
      <section className="a-card">
        <h3>보관 현황</h3>
        <p className="meta">접속 기록 {d.evidence.logs.toLocaleString()}건 · 활동 원본 {d.evidence.trail.toLocaleString()}건 · 가장 오래된 기록 {dt(d.evidence.oldest)}</p>
        <p className="meta">보관 기간: 접속 기록 {d.config.keepLogsDays}일 · 활동 원본 {d.config.keepTrailDays}일 · 신고 {d.config.keepReportsDays}일 (설정 탭에서 변경). 기간이 지나면 자동 파기되며, 보존 조치된 회원 기록은 남습니다.</p>
      </section>

      <section className="a-card">
        <h3>1. 회원 찾기</h3>
        <form className="form" onSubmit={(e) => { e.preventDefault(); send({ t: 'admin.lookup', q }); setSel(null); }}>
          <input placeholder="닉네임 또는 회원 ID (탈퇴 회원 포함)" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn sm" disabled={!q.trim()}>찾기</button>
        </form>
        {lookup && lookup.list.length === 0 && <p className="empty">'{lookup.q}'에 해당하는 회원이 없습니다.</p>}
        {lookup?.list.map((x) => (
          <button key={x.id} className={`a-pick ${sel === x.id ? 'on' : ''}`} onClick={() => setSel(x.id)}>
            <b>{x.nick}</b> <span className="meta">ID {x.id} · {x.gender === 'F' ? '여' : '남'}·{x.age}·{x.region} · 가입 {dt(x.joined)}</span>
            {x.gone && <em className="tag soft">탈퇴</em>}{x.banned && <em className="tag">정지</em>}{x.held && <em className="tag">보존 중</em>}
          </button>
        ))}
      </section>

      {u && (
        <>
          <section className="a-card">
            <h3>2. 접속 기록 (최근 30건)</h3>
            {u.logs.length === 0 && <p className="meta">기록이 없습니다.</p>}
            <div className="a-table">
              {u.logs.map((l) => <div key={l.id} className="a-tr"><span>{dt(l.at)}</span><span>{LOG[l.type] || l.type}</span><span className="mono">{l.ip || '-'}</span><span className="meta ua">{l.ua}</span></div>)}
            </div>
            <p className="meta">활동 원본 {u.trail}건 · 이 회원에 대한 신고 {u.reported}건</p>
          </section>

          <section className="a-card">
            <h3>3. 보존 조치</h3>
            {u.held ? (
              <>
                <p className="meta">보존 중 · {dt(u.held.at)} · {u.held.agency} · {u.held.reason}</p>
                <button className="btn sm ghost danger" onClick={() => { send({ t: 'admin.hold', uid: u.id, on: false }); send({ t: 'admin.lookup', q: lookup.q }); }}>보존 해제</button>
              </>
            ) : (
              <div className="form">
                <p className="hint">수사기관이 자료 보존을 요청했거나 사건이 의심되면 먼저 보존 조치를 하세요. 보관 기간이 지나도 이 회원과 상대방 기록이 지워지지 않습니다.</p>
                <input placeholder="요청 기관 (예: ○○경찰서 사이버수사팀)" value={hold.agency} onChange={(e) => setHold({ ...hold, agency: e.target.value })} />
                <input placeholder="보존 사유 (예: 사기 신고 접수, 보존 요청 공문 제2026-123호)" value={hold.reason} onChange={(e) => setHold({ ...hold, reason: e.target.value })} />
                <button className="btn sm" disabled={!hold.reason.trim()} onClick={() => { send({ t: 'admin.hold', uid: u.id, on: true, ...hold }); send({ t: 'admin.lookup', q: lookup.q }); setHold({ reason: '', agency: '' }); }}>보존 조치</button>
              </div>
            )}
          </section>

          <section className="a-card">
            <h3>4. 자료 추출</h3>
            <div className="form">
              <div className="chips">
                <button className={`chip ${ex.purpose === 'agency' ? 'on' : ''}`} onClick={() => setEx({ ...ex, purpose: 'agency' })}>수사기관 제공</button>
                <button className={`chip ${ex.purpose === 'internal' ? 'on' : ''}`} onClick={() => setEx({ ...ex, purpose: 'internal' })}>내부 검토</button>
              </div>
              {ex.purpose === 'agency' && (
                <>
                  <p className="warn">영장, 법원 허가서 등 법적 근거 문서를 받은 경우에만 제공하세요. 전화나 구두 요청만으로는 제공하지 마세요.</p>
                  <input placeholder="요청 기관 (필수)" value={ex.agency} onChange={setE('agency')} />
                  <label>근거 문서 종류<select value={ex.docType} onChange={setE('docType')}>{DOCS.map((x) => <option key={x}>{x}</option>)}</select></label>
                  <input placeholder="문서 번호 (필수)" value={ex.docNo} onChange={setE('docNo')} />
                </>
              )}
              <div className="a-dates"><label>시작일<input type="date" value={ex.from} max={ex.to} onChange={setE('from')} /></label><label>종료일<input type="date" value={ex.to} max={today} onChange={setE('to')} /></label></div>
              <input placeholder="메모 (선택)" value={ex.memo} onChange={setE('memo')} />
              <button className="btn" disabled={!okExport} onClick={() => send({ t: 'admin.export', uid: u.id, ...ex })}>자료 추출</button>
              <p className="hint">포함 내용: 회원 정보, 접속 기록(IP·기기), 작성·삭제한 원문, 상대방과 주고받은 기록, 신고 내역, 결제 내역. 추출하면 제공 이력에 자동 기록됩니다.</p>
            </div>
          </section>
          <Download res={exportRes?.uid === u.id ? exportRes : null} />
        </>
      )}

      <section className="a-card">
        <h3>보존 조치 중인 회원</h3>
        {d.holds.length === 0 && <p className="meta">없습니다.</p>}
        {d.holds.map((h) => <div key={h.uid} className="a-led"><span><b>{h.nick}</b> <span className="meta">{h.agency} · {h.reason}</span><br /><span className="meta">{dt(h.at)}</span></span></div>)}
      </section>

      <section className="a-card">
        <h3>제공 이력 대장</h3>
        {d.disclosures.length === 0 && <p className="meta">아직 추출한 자료가 없습니다.</p>}
        {d.disclosures.map((x) => (
          <div key={x.id} className="a-led">
            <span>
              <b>{x.nick}</b> <em className={`tag ${x.purpose === '수사기관 제공' ? '' : 'soft'}`}>{x.purpose}</em><br />
              <span className="meta">{dt(x.at)} · {x.agency || '-'} · {x.docType || '-'} {x.docNo || ''} · 기간 {x.from || '처음'}~{x.to || '현재'}</span><br />
              <span className="meta">접속 {x.counts.accessLogs} · 활동 {x.counts.activity} · 상대 {x.counts.counterpart} · 신고 {x.counts.reports} · SHA-256 {x.sha256.slice(0, 16)}…</span>
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
