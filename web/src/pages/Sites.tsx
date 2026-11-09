import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Cabinet, Provisioning, Site, Smartbox, SmartboxCreated } from '../api/types';
import { Card, Empty, ErrorState, InlineError, Loading, Modal, OnlineDot } from '../components/common';
import { useAuth } from '../context/Auth';
import { fmtTime } from '../lib/format';
import { useApi } from '../lib/useApi';

function numOrUndef(s: string): number | undefined {
  if (!s.trim()) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function SitesPage() {
  const { can } = useAuth();
  const sites = useApi(() => api<Site[]>('/sites'), []);
  const [selId, setSelId] = useState<string | null>(null);
  const cabinets = useApi(() => (selId ? api<Cabinet[]>('/cabinets', { query: { site_id: selId } }) : Promise.resolve<Cabinet[]>([])), [selId]);
  const boxes = useApi(() => (can('device.read') ? api<Smartbox[]>('/smartboxes') : Promise.resolve<Smartbox[]>([])), []);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [showCabForm, setShowCabForm] = useState(false);
  const [registerFor, setRegisterFor] = useState<Cabinet | null>(null);
  const [prov, setProv] = useState<SmartboxCreated | null>(null);

  useEffect(() => {
    if (!selId && sites.data && sites.data.length > 0) setSelId(sites.data[0].id);
  }, [sites.data, selId]);

  const boxByCab = useMemo(() => {
    const m = new Map<string, Smartbox[]>();
    for (const b of boxes.data ?? []) m.set(b.cabinet_id, [...(m.get(b.cabinet_id) ?? []), b]);
    return m;
  }, [boxes.data]);

  const sel = sites.data?.find((s) => s.id === selId) ?? null;

  if (sites.loading && !sites.data) return <Loading />;
  if (sites.error && !sites.data) return <ErrorState error={sites.error} onRetry={() => void sites.reload()} />;

  return (
    <div className="page">
      <div className="page-head">
        <h1>현장·함체 관리</h1>
        {can('site.write') ? (
          <button className="btn btn-primary" onClick={() => setShowSiteForm(true)}>
            현장 추가
          </button>
        ) : null}
      </div>
      <div className="split">
        <Card title={`현장 (${sites.data?.length ?? 0})`} className="split-left">
          {sites.data && sites.data.length === 0 ? <Empty text="등록된 현장이 없습니다." /> : null}
          <ul className="pick-list">
            {(sites.data ?? []).map((s) => (
              <li key={s.id}>
                <button className={s.id === selId ? 'active' : ''} onClick={() => setSelId(s.id)}>
                  <span className="pick-title">{s.name}</span>
                  <span className="muted small mono">{s.code}</span>
                  {s.address ? <span className="muted small">{s.address}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title={sel ? `${sel.name} — 함체` : '함체'}
          className="split-right"
          extra={
            sel && can('site.write') ? (
              <button className="btn btn-sm btn-primary" onClick={() => setShowCabForm(true)}>
                함체 추가
              </button>
            ) : null
          }
        >
          {!sel ? <Empty text="현장을 선택하세요." /> : null}
          {sel && cabinets.error ? <ErrorState error={cabinets.error} onRetry={() => void cabinets.reload()} /> : null}
          {sel && cabinets.loading && !cabinets.data ? <Loading /> : null}
          {sel && cabinets.data && cabinets.data.length === 0 ? <Empty text="등록된 함체가 없습니다." /> : null}
          {boxes.error ? <div className="banner banner-warn">스마트박스 목록을 불러오지 못했습니다: {boxes.error.message}</div> : null}
          {sel && cabinets.data && cabinets.data.length > 0 ? (
            <div className="table-wrap">
              <table className="tbl tbl-dense">
                <thead>
                  <tr>
                    <th>코드</th>
                    <th>이름</th>
                    <th>주소</th>
                    <th>설치일</th>
                    <th>스마트박스</th>
                  </tr>
                </thead>
                <tbody>
                  {cabinets.data.map((c) => {
                    const bs = boxByCab.get(c.id) ?? [];
                    return (
                      <tr key={c.id}>
                        <td className="mono">{c.code}</td>
                        <td>
                          {c.name}
                          {c.note ? <div className="muted small">{c.note}</div> : null}
                        </td>
                        <td>{c.address ?? '—'}</td>
                        <td className="nowrap">{c.install_date ?? '—'}</td>
                        <td>
                          {bs.map((b) => (
                            <div key={b.id}>
                              <OnlineDot online={b.online} />{' '}
                              <Link className="mono" to={`/smartboxes/${b.id}`}>
                                {b.device_id}
                              </Link>
                            </div>
                          ))}
                          {bs.length === 0 && can('device.write') ? (
                            <button className="btn btn-sm" onClick={() => setRegisterFor(c)}>
                              스마트박스 등록
                            </button>
                          ) : bs.length === 0 ? (
                            <span className="muted">미등록</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>

      {showSiteForm ? (
        <SiteForm
          onClose={() => setShowSiteForm(false)}
          onDone={(s) => {
            sites.setData((l) => [...(l ?? []), s]);
            setSelId(s.id);
          }}
        />
      ) : null}
      {showCabForm && sel ? <CabinetForm site={sel} onClose={() => setShowCabForm(false)} onDone={(c) => cabinets.setData((l) => [...(l ?? []), c])} /> : null}
      {registerFor ? (
        <RegisterForm
          cabinet={registerFor}
          onClose={() => setRegisterFor(null)}
          onDone={(r) => {
            setRegisterFor(null);
            setProv(r);
            const { provisioning: _p, ...box } = r;
            void _p;
            boxes.setData((l) => [...(l ?? []), box]);
          }}
        />
      ) : null}
      {prov ? <ProvisioningDialog created={prov} onClose={() => setProv(null)} /> : null}
    </div>
  );
}

function SiteForm({ onClose, onDone }: { onClose: () => void; onDone: (s: Site) => void }) {
  const [f, setF] = useState({ name: '', code: '', address: '', lat: '', lng: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const s = await api<Site>('/sites', {
        method: 'POST',
        body: { name: f.name.trim(), code: f.code.trim(), address: f.address.trim() || undefined, lat: numOrUndef(f.lat), lng: numOrUndef(f.lng) },
      });
      onDone(s);
      onClose();
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }
  return (
    <Modal title="현장 추가" onClose={() => !busy && onClose()}>
      <form className="form" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            <span>현장명 (필수)</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
          </label>
          <label className="field">
            <span>현장 코드 (필수)</span>
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
          </label>
        </div>
        <label className="field">
          <span>주소</span>
          <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>위도</span>
            <input inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} />
          </label>
          <label className="field">
            <span>경도</span>
            <input inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} />
          </label>
        </div>
        <InlineError error={err} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy || !f.name.trim() || !f.code.trim()}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CabinetForm({ site, onClose, onDone }: { site: Site; onClose: () => void; onDone: (c: Cabinet) => void }) {
  const [f, setF] = useState({ code: '', name: '', address: '', lat: '', lng: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const c = await api<Cabinet>('/cabinets', {
        method: 'POST',
        body: {
          site_id: site.id,
          code: f.code.trim(),
          name: f.name.trim(),
          address: f.address.trim() || undefined,
          lat: numOrUndef(f.lat),
          lng: numOrUndef(f.lng),
        },
      });
      onDone(c);
      onClose();
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }
  return (
    <Modal title={`함체 추가 — ${site.name}`} onClose={() => !busy && onClose()}>
      <form className="form" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            <span>함체 코드 (필수)</span>
            <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required autoFocus />
          </label>
          <label className="field">
            <span>함체 이름 (필수)</span>
            <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          </label>
        </div>
        <label className="field">
          <span>주소</span>
          <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>위도</span>
            <input inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} />
          </label>
          <label className="field">
            <span>경도</span>
            <input inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} />
          </label>
        </div>
        <InlineError error={err} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy || !f.code.trim() || !f.name.trim()}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RegisterForm({ cabinet, onClose, onDone }: { cabinet: Cabinet; onClose: () => void; onDone: (r: SmartboxCreated) => void }) {
  const [serial, setSerial] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<SmartboxCreated>('/smartboxes', {
        method: 'POST',
        body: { cabinet_id: cabinet.id, serial_no: serial.trim() || undefined, model: model.trim() || undefined },
      });
      onDone(r);
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }
  return (
    <Modal title={`스마트박스 등록 — ${cabinet.code} ${cabinet.name}`} onClose={() => !busy && onClose()}>
      <form className="form" onSubmit={submit}>
        <p className="muted">등록하면 장치 ID와 인증서·명령 서명키가 발급됩니다. 발급 정보는 이 화면에서 한 번만 표시됩니다.</p>
        <label className="field">
          <span>시리얼 번호</span>
          <input value={serial} onChange={(e) => setSerial(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>모델</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="예: SB-MB01" />
        </label>
        <InlineError error={err} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? '발급 중…' : '등록'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const PROV_FIELDS: { key: keyof Provisioning; label: string; multiline?: boolean }[] = [
  { key: 'device_id', label: '장치 ID (device_id)' },
  { key: 'cmd_secret', label: '명령 서명키 (cmd_secret)' },
  { key: 'mqtt_host', label: 'MQTT 호스트' },
  { key: 'mqtt_port', label: 'MQTT 포트' },
  { key: 'client_cert_pem', label: '클라이언트 인증서 (PEM)', multiline: true },
  { key: 'client_key_pem', label: '클라이언트 개인키 (PEM)', multiline: true },
  { key: 'ca_cert_pem', label: 'CA 인증서 (PEM)', multiline: true },
];

function ProvisioningDialog({ created, onClose }: { created: SmartboxCreated; onClose: () => void }) {
  const p = created.provisioning;
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      setCopied('fail');
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.device_id}-provisioning.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  }

  function close() {
    if (!saved && !window.confirm('발급 정보는 다시 볼 수 없습니다. 저장하지 않고 닫을까요?')) return;
    onClose();
  }

  return (
    <Modal title="스마트박스 발급 정보" onClose={close} wide closeOnBackdrop={false}>
      <div className="banner banner-err">
        <b>이 정보는 지금 한 번만 표시됩니다.</b> 창을 닫으면 서버에서 다시 받을 수 없습니다. 개인키와 명령 서명키는 외부에 노출되지 않게 보관하세요.
      </div>
      <div className="muted small">등록 시각 {fmtTime(Date.now())}</div>
      <div className="prov-actions">
        <button className="btn btn-primary" onClick={download}>
          JSON 파일로 저장
        </button>
        <button className="btn" onClick={() => void copy('all', JSON.stringify(p, null, 2))}>
          {copied === 'all' ? '복사됨' : '전체 복사(JSON)'}
        </button>
        {copied === 'fail' ? <span className="text-bad small">클립보드 복사에 실패했습니다. 직접 선택해 복사하세요.</span> : null}
      </div>
      <div className="prov-fields">
        {PROV_FIELDS.map((f) => {
          const v = String(p[f.key] ?? '');
          return (
            <div key={f.key} className="field">
              <div className="prov-label">
                <span>{f.label}</span>
                <button className="btn btn-sm" onClick={() => void copy(f.key, v)}>
                  {copied === f.key ? '복사됨' : '복사'}
                </button>
              </div>
              {f.multiline ? (
                <textarea className="mono" readOnly rows={5} value={v} onFocus={(e) => e.currentTarget.select()} />
              ) : (
                <input className="mono" readOnly value={v} onFocus={(e) => e.currentTarget.select()} />
              )}
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        <button className="btn" onClick={close}>
          닫기
        </button>
      </div>
    </Modal>
  );
}
