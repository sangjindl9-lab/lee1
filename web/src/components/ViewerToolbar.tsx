import { useWS } from '../store';
import { viewerBridge } from './Viewer';
import { BACKGROUNDS, TEMPLATE_ORDER } from '../engine/stage';

const VIEW_BTNS: [string, string][] = [['iso', '등각'], ['front', '정면'], ['back', '후면'], ['left', '좌측'], ['right', '우측'], ['top', '상부'], ['bottom', '하부']];

export default function ViewerToolbar({ container, simple = false }: { container: React.RefObject<HTMLDivElement>; simple?: boolean }) {
  const s = useWS();
  const T = (on: boolean, label: string, fn: () => void, title?: string) =>
    <button className={`btn h-7 px-2 text-xs ${on ? 'btn-on' : ''}`} title={title || label} onClick={fn}>{label}</button>;
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start gap-1.5">
      <div className="pointer-events-auto flex flex-wrap gap-0.5 rounded-lg border border-line bg-panel/90 p-1 backdrop-blur">
        {VIEW_BTNS.map(([v, l]) => T(false, l, () => s.view(v), `${l} 보기`))}
      </div>
      <div className="pointer-events-auto flex flex-wrap gap-0.5 rounded-lg border border-line bg-panel/90 p-1 backdrop-blur">
        {!simple && T(s.ortho, s.ortho ? '직교' : '원근', () => { s.set({ ortho: !s.ortho }); setTimeout(() => s.view('iso'), 0); }, '원근/직교 투영')}
        {T(s.autoRotate, '자동회전', () => s.set({ autoRotate: !s.autoRotate }))}
        {T(s.xray, '투시', () => s.set({ xray: !s.xray }), '전체 투명화 (선택 부품만 불투명)')}
        {!simple && T(s.wireframe, '와이어', () => s.set({ wireframe: !s.wireframe }))}
        {T(s.section.on, '단면', () => s.set({ section: { ...s.section, on: !s.section.on } }))}
        {!simple && T(false, 'PNG', () => {
          const c = viewerBridge.gl?.domElement; if (!c) return;
          const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `eum3d-${Date.now()}.png`; a.click();
        }, '현재 화면 이미지 저장')}
        <select className="input h-7 py-0 pl-2 pr-6 text-xs" style={{ width: "auto", maxWidth: "11rem" }} title="쇼룸 템플릿 (배경·조명·바닥)" data-testid="template-select"
          value={s.scene?.background || 'studio'} onChange={(e) => s.patchScene((sc: any) => { sc.background = e.target.value; })}>
          {TEMPLATE_ORDER.map((k) => <option key={k} value={k}>{BACKGROUNDS[k].label}</option>)}
        </select>
        {T(false, '⛶', () => { const el = container.current; if (!el) return; document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.(); }, '전체 화면')}
      </div>
      {s.section.on && (
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-panel/90 p-1 px-2 text-xs backdrop-blur">
          {(['x', 'y', 'z'] as const).map((a) => T(s.section.axis === a, a.toUpperCase(), () => s.set({ section: { ...s.section, axis: a } })))}
          <input type="range" min={0} max={1} step={0.005} value={s.section.pos} className="w-28" onChange={(e) => s.set({ section: { ...s.section, pos: +e.target.value } })} />
          {T(s.section.flip, '반전', () => s.set({ section: { ...s.section, flip: !s.section.flip } }))}
        </div>
      )}
    </div>
  );
}
