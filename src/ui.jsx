import { useState, useEffect } from 'react';

export const num = (v) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[,\s원]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function NumInput({ value, onChange, dec = 0, className = '', disabled, ...rest }) {
  const [focus, setFocus] = useState(false);
  const [txt, setTxt] = useState('');
  useEffect(() => { if (!focus) setTxt(String(value ?? '')); }, [value, focus]);
  const shown = focus ? txt : (Number(value) || Number(value) === 0 ? Number(value).toLocaleString('ko-KR', { maximumFractionDigits: dec || 4 }) : '');
  return (
    <input
      {...rest}
      className={'cell num ' + className}
      inputMode="decimal"
      disabled={disabled}
      value={shown}
      onFocus={(e) => { setFocus(true); setTxt(String(value ?? '')); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => { setFocus(false); onChange(num(txt)); }}
      onChange={(e) => setTxt(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

export function TextInput({ value, onChange, className = '', ...rest }) {
  const [txt, setTxt] = useState(value ?? '');
  useEffect(() => setTxt(value ?? ''), [value]);
  return (
    <input {...rest} className={'cell ' + className} value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { if (txt !== (value ?? '')) onChange(txt); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="btn ghost" onClick={onClose}>닫기</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function parseTSV(text) {
  return String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split('\t').map((c) => c.trim()));
}

export function PasteBox({ hint, columns, onApply, onClose }) {
  const [t, setT] = useState('');
  const rows = parseTSV(t);
  return (
    <Modal title="엑셀에서 붙여넣기" onClose={onClose} wide>
      <p className="muted">{hint}</p>
      <p className="cols">열 순서: {columns.map((c, i) => <span key={c} className="chip">{i + 1}. {c}</span>)}</p>
      <textarea id="paste-box" className="paste" autoFocus placeholder="엑셀에서 행을 복사한 뒤 여기에 Ctrl+V" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="row-between">
        <span className="muted">{rows.length}개 행 인식</span>
        <button className="btn primary" disabled={!rows.length} onClick={() => { onApply(rows); onClose(); }}>{rows.length}개 행 추가</button>
      </div>
    </Modal>
  );
}
