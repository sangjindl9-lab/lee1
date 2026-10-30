import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, put } from "../api";
import LivePlayer from "../components/LivePlayer";
import { Alert, StatusBadge, errMsg, useData } from "../ui";

const GRIDS = [1, 4, 9, 16];

export default function Live() {
  const cams = useData(() => get("/api/cameras"), [], 15000);
  const layouts = useData(() => get("/api/layouts"), []);
  const [grid, setGrid] = useState(4);
  const [cells, setCells] = useState<(number | null)[]>([]);
  const [selected, setSelected] = useState(0);
  const [focus, setFocus] = useState<number | null>(null); // 확대 보기 칸
  const [zoom, setZoom] = useState<Record<number, number>>({});
  const [site, setSite] = useState<number | "">("");
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const wallRef = useRef<HTMLDivElement>(null);
  const videos = useRef<Record<number, HTMLVideoElement | null>>({});

  useEffect(() => {
    const def = layouts.data?.items?.find((l: any) => l.is_default) ?? layouts.data?.items?.[0];
    if (def) {
      setGrid(def.grid);
      setCells(def.cells);
    }
  }, [layouts.data]);

  const camById = useMemo(() => Object.fromEntries((cams.data?.items ?? []).map((c: any) => [c.id, c])), [cams.data]);
  const list = (cams.data?.items ?? []).filter((c: any) => c.enabled && (site === "" || c.site_id === site));
  const sites = Array.from(new Map((cams.data?.items ?? []).map((c: any) => [c.site_id, c.site_name])).entries());
  const shown = Array.from({ length: grid }, (_, i) => cells[i] ?? null);

  const place = (idx: number, camId: number | null) => {
    setCells((prev) => {
      const next = Array.from({ length: Math.max(grid, prev.length) }, (_, i) => prev[i] ?? null);
      const from = next.indexOf(camId);
      if (camId !== null && from >= 0 && from !== idx) next[from] = next[idx]; // 자리 바꾸기
      next[idx] = camId;
      return next;
    });
  };

  const fillAuto = () => setCells(list.slice(0, grid).map((c: any) => c.id));

  const save = async () => {
    try {
      await put("/api/layouts", { name: "기본", grid, cells: shown, is_default: true });
      setMsg("화면 배치를 저장했습니다.");
    } catch (e) {
      setMsg(errMsg(e));
    }
    window.setTimeout(() => setMsg(""), 3000);
  };

  const snapshot = (idx: number) => {
    const v = videos.current[idx];
    const cam = camById[shown[idx] as number];
    if (!v || !v.videoWidth) return setMsg("영상이 표시된 뒤에 스냅샷을 저장할 수 있습니다.");
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const a = document.createElement("a");
    const t = new Date();
    a.download = `${cam?.name ?? "camera"}_${t.toISOString().replace(/[:.]/g, "-")}.jpg`;
    a.href = c.toDataURL("image/jpeg", 0.92);
    a.click();
  };

  const fullscreen = (el: HTMLElement | null) => {
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const bindVideo = useCallback((idx: number) => (v: HTMLVideoElement | null) => { videos.current[idx] = v; }, []);

  const cols = focus !== null ? 1 : Math.sqrt(grid);
  const tiles = focus !== null ? [focus] : shown.map((_, i) => i);

  return (
    <div className="live">
      <div className="stage">
        <div className="toolbar">
          {GRIDS.map((g) => (
            <button key={g} className={grid === g && focus === null ? "sel" : ""} onClick={() => { setGrid(g); setFocus(null); }}>{g}분할</button>
          ))}
          <span className="disabled muted small hide-m" title="2단계 예정">25·36분할, 화면 순환은 2단계</span>
          <span style={{ flex: 1 }} />
          {msg && <span className="small" role="status">{msg}</span>}
          <button onClick={fillAuto}>자동 채우기</button>
          <button onClick={save}>배치 저장</button>
          <button onClick={() => fullscreen(wallRef.current)}>전체화면</button>
        </div>
        <div className="wall" ref={wallRef} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${cols}, 1fr)` }}>
          {tiles.map((i) => {
            const camId = shown[i];
            const cam = camId ? camById[camId] : null;
            const z = zoom[i] ?? 1;
            return (
              <div
                key={`${i}-${camId}`}
                className={`tile${selected === i ? " selected" : ""}${dropAt === i ? " drop" : ""}`}
                tabIndex={0}
                onClick={() => setSelected(i)}
                onDoubleClick={() => cam && setFocus(focus === null ? i : null)}
                onDragOver={(e) => { e.preventDefault(); setDropAt(i); }}
                onDragLeave={() => setDropAt(null)}
                onDrop={(e) => { e.preventDefault(); setDropAt(null); const id = Number(e.dataTransfer.getData("text/camera")); if (id) place(i, id); }}
                onWheel={(e) => { if (cam && e.ctrlKey) { e.preventDefault(); setZoom((zz) => ({ ...zz, [i]: Math.min(4, Math.max(1, z + (e.deltaY < 0 ? 0.25 : -0.25))) })); } }}
                aria-label={cam ? `${cam.name} 영상` : `빈 칸 ${i + 1}`}
              >
                {cam ? (
                  <>
                    <LivePlayer cameraId={cam.id} stream={focus !== null ? "main" : "sub"} zoom={z} onVideo={bindVideo(i)} />
                    <div className="hud">
                      {cam.status.state === "recording" && <span className="rec">REC</span>}
                      <span className="name">{cam.name}</span>
                      {cam.is_test_source && <span className="tag test">시험 영상</span>}
                      {cam.status.state !== "recording" && cam.record_mode !== "off" && <span className="tag" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>{cam.status.state_label}</span>}
                    </div>
                    <div className="ctl">
                      <button onClick={(e) => { e.stopPropagation(); setFocus(focus === null ? i : null); }}>{focus === null ? "확대(메인)" : "분할로"}</button>
                      <button onClick={(e) => { e.stopPropagation(); setZoom((zz) => ({ ...zz, [i]: Math.min(4, z + 0.5) })); }} aria-label="디지털 줌 확대">＋</button>
                      <button onClick={(e) => { e.stopPropagation(); setZoom((zz) => ({ ...zz, [i]: Math.max(1, z - 0.5) })); }} aria-label="디지털 줌 축소">－</button>
                      <button onClick={(e) => { e.stopPropagation(); snapshot(i); }}>스냅샷</button>
                      <button onClick={(e) => { e.stopPropagation(); fullscreen((e.currentTarget as HTMLElement).closest(".tile")); }}>전체</button>
                      <button onClick={(e) => { e.stopPropagation(); place(i, null); if (focus !== null) setFocus(null); }}>비우기</button>
                    </div>
                  </>
                ) : (
                  <div className="msg placeholder">카메라 목록에서 선택하거나<br />끌어다 놓으세요</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <aside className="camlist">
        <h3>카메라</h3>
        <div style={{ padding: "0 12px 8px" }}>
          <select value={site} onChange={(e) => setSite(e.target.value ? Number(e.target.value) : "")} style={{ width: "100%" }} aria-label="현장 선택">
            <option value="">전체 현장</option>
            {sites.map(([id, name]) => <option key={id as number} value={id as number}>{name as string}</option>)}
          </select>
        </div>
        {cams.error && <div style={{ padding: 12 }}><Alert kind="err">{cams.error}</Alert></div>}
        {list.length === 0 && !cams.loading && <p className="muted small" style={{ padding: 12 }}>사용 중인 카메라가 없습니다.</p>}
        {list.map((c: any) => (
          <div
            key={c.id}
            className={`camitem${shown.includes(c.id) ? " on" : ""}`}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("text/camera", String(c.id))}
            onClick={() => place(selected, c.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && place(selected, c.id)}
            title="클릭하면 선택한 칸에 배치합니다"
          >
            <span className="nm">{c.name}{c.is_test_source && <span className="tag test" style={{ marginLeft: 6 }}>시험</span>}<div className="muted small">{c.site_name}{c.zone ? ` / ${c.zone}` : ""}</div></span>
            <StatusBadge status={c.status} />
          </div>
        ))}
        <p className="muted small" style={{ padding: 12 }}>칸 더블클릭: 확대(메인 스트림) / Ctrl+휠: 디지털 줌. 오디오·PTZ는 2단계에서 제공합니다.</p>
      </aside>
    </div>
  );
}
