import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, post, put } from "../api";
import { useAuth } from "../auth";
import PtzPanel from "../components/PtzPanel";
import LivePlayer from "../components/LivePlayer";
import { Alert, StatusBadge, errMsg, useData } from "../ui";

const GRIDS = [1, 4, 9, 16, 25, 36];
const TOUR_SECONDS = [10, 20, 30, 60];

export default function Live() {
  const { can } = useAuth();
  const [tour, setTour] = useState(0); // 화면 순환 간격(초), 0 = 끔
  const [tourPage, setTourPage] = useState(0);
  const [audioTile, setAudioTile] = useState<number | null>(null);
  const [audioInfo, setAudioInfo] = useState<Record<number, { allowAudio: boolean; hasAudio: boolean; mode: string }>>({});
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
  const tourPages = Math.max(1, Math.ceil(list.length / grid));
  const shown = tour
    ? Array.from({ length: grid }, (_, i) => list[(tourPage % tourPages) * grid + i]?.id ?? null)
    : Array.from({ length: grid }, (_, i) => cells[i] ?? null);

  useEffect(() => {
    if (!tour) return;
    const t = window.setInterval(() => setTourPage((p) => p + 1), tour * 1000);
    return () => window.clearInterval(t);
  }, [tour]);

  const markEvent = async (camId: number) => {
    try {
      const r = await post(`/api/cameras/${camId}/events/manual`, { seconds: 60 });
      setMsg(r.note);
    } catch (e) {
      setMsg(errMsg(e));
    }
    window.setTimeout(() => setMsg(""), 5000);
  };

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
          <select value={tour} onChange={(e) => { setTour(Number(e.target.value)); setTourPage(0); setFocus(null); }} aria-label="화면 순환">
            <option value={0}>화면 순환 끔</option>
            {TOUR_SECONDS.map((s) => <option key={s} value={s}>{s}초마다 순환</option>)}
          </select>
          {tour > 0 && <span className="small muted num">{(tourPage % tourPages) + 1}/{tourPages}쪽</span>}
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
                    <LivePlayer cameraId={cam.id} stream={focus !== null ? "main" : "sub"} zoom={z} onVideo={bindVideo(i)}
                      muted={audioTile !== i} onInfo={(inf) => setAudioInfo((a) => ({ ...a, [i]: inf }))} />
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
                      {can("audio") && audioInfo[i]?.allowAudio && (
                        <button onClick={(e) => { e.stopPropagation(); setAudioTile(audioTile === i ? null : i); }}
                          title={audioInfo[i]?.hasAudio ? "" : "이 카메라에서 음성 트랙을 확인하지 못했습니다"}>
                          {audioTile === i ? "음소거" : "소리 듣기"}</button>)}
                      <button onClick={(e) => { e.stopPropagation(); markEvent(cam.id); }} title="지금 시각에 수동 이벤트를 남깁니다(이벤트 녹화 설정 시 전후 구간 녹화)">이벤트</button>
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
            onClick={() => { setTour(0); place(selected, c.id); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && place(selected, c.id)}
            title="클릭하면 선택한 칸에 배치합니다"
          >
            <span className="nm">{c.name}{c.is_test_source && <span className="tag test" style={{ marginLeft: 6 }}>시험</span>}<div className="muted small">{c.site_name}{c.zone ? ` / ${c.zone}` : ""}</div></span>
            <StatusBadge status={c.status} />
          </div>
        ))}
        {can("ptz") && shown[selected] && camById[shown[selected] as number]?.capabilities?.ptz && (
          <section>
            <h3>PTZ — {camById[shown[selected] as number].name}</h3>
            <PtzPanel cameraId={shown[selected] as number} />
          </section>
        )}
        <p className="muted small" style={{ padding: 12 }}>칸 더블클릭: 확대(메인 스트림) / Ctrl+휠: 디지털 줌. PTZ 는 칸을 선택하면 여기에 나타납니다(PTZ 지원 카메라).
          음성은 WebRTC 에서 Opus·G.711, HLS 에서 AAC 를 재생합니다. 양방향 음성은 지원하지 않습니다.</p>
      </aside>
    </div>
  );
}
