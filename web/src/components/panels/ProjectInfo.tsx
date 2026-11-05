import { fmtDate } from '../../api';
import { t } from '../../i18n';
import { useWS } from '../../store';

const METHOD: Record<string, string> = { 'step-brep-tessellation': 'STEP/IGES B-Rep → 테셀레이션', 'stl-mesh': 'STL 메시', 'glb-import': 'GLB 가져오기', 'dxf-extrude': 'DXF 윤곽 + 사용자 두께 돌출', 'dwg-extrude': 'DWG(→DXF) 윤곽 + 사용자 두께 돌출', 'pdf-extrude': 'PDF 벡터 윤곽 + 사용자 축척·두께 돌출', 'views-reconstruct': '투상도 결합 3D 초안 (AI 추정)' };

export default function ProjectInfo({ project, versions }: { project: any; versions: any[] }) {
  const model = useWS((s) => s.model);
  const sv = useWS((s) => s.sceneVersion);
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="panel-title">프로젝트</div>
      <div><div className="font-semibold">{project.name}</div><div className="text-xs text-mute">{t(`industry.${project.industry}` as any)} · {project.description || '설명 없음'}</div></div>
      {model && <div className="space-y-1.5 rounded-md border border-line p-2.5 text-xs">
        <div className="panel-title">현재 모델</div>
        <Row k="이름" v={model.name} /><Row k="원본 파일" v={`${model.source_name} (v${model.source_file_version})`} />
        <Row k="변환 방식" v={METHOD[model.method] || model.method} />
        <Row k="부품 수" v={String(model.stats.partCount)} /><Row k="전체 크기" v={`${model.stats.size?.map((x: number) => x.toFixed(1)).join(' × ')} ${model.stats.unit}`} />
        <Row k="삼각형" v={model.stats.triangles?.toLocaleString()} />
        {(model as any).review_status && (model as any).review_status !== 'n/a' && <Row k="검토" v={({ pending: '검토 대기', approved: '승인', rejected: '반려' } as any)[(model as any).review_status]} />}
        <div className="pt-1 text-mute">{model.provenance?.note}</div>
        {model.provenance?.items?.map((it: any, i: number) => (
          <div key={i} className="flex gap-2"><span className={it.source === 'drawing' ? 'text-ok' : it.source === 'user' ? 'text-warn' : it.source === 'ai' ? 'text-ai' : 'text-bad'}>■</span><span>{it.label}: {it.what}</span></div>
        ))}
      </div>}
      <div className="space-y-1"><div className="label">저장 버전</div>
        {versions.slice(0, 8).map((v) => <div key={v.version} className="flex text-xs"><span className={`num ${v.version === sv ? 'text-accent' : ''}`}>v{v.version}</span><span className="ml-auto text-mute">{fmtDate(v.created_at)}</span></div>)}
      </div>
    </div>
  );
}
const Row = ({ k, v }: { k: string; v: string }) => <div className="flex gap-2"><span className="w-16 shrink-0 text-mute">{k}</span><span className="num break-all">{v}</span></div>;
