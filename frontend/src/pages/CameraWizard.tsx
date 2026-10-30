import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Alert, Field, errMsg } from "../ui";

type Site = { id: number; name: string; allowed_networks: string[] };
type Profile = { token: string; name: string; encoding: string; width: number; height: number; fps: number; bitrate_kbps: number; stream_uri: string; snapshot_uri: string; uri_error: string };

const STEPS = ["현장", "연결 방식", "주소·인증", "장치 조회·시험", "미리보기", "이름·녹화", "완료"];

export default function CameraWizard({ sites, onDone }: { sites: Site[]; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [siteId, setSiteId] = useState<number | null>(sites[0]?.id ?? null);
  const [type, setType] = useState<"onvif" | "rtsp">("onvif");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(80);
  const [path, setPath] = useState("/onvif/device_service");
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [probe, setProbe] = useState<any>(null);
  const [main, setMain] = useState("");
  const [sub, setSub] = useState("");
  const [mainTok, setMainTok] = useState("");
  const [subTok, setSubTok] = useState("");
  const [snapUrl, setSnapUrl] = useState("");
  const [transport, setTransport] = useState("tcp");
  const [tests, setTests] = useState<Record<string, any>>({});
  const [snap, setSnap] = useState<string>("");
  const [name, setName] = useState("");
  const [building, setBuilding] = useState("");
  const [zone, setZone] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [record, setRecord] = useState("continuous");
  const [retention, setRetention] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [allowDup, setAllowDup] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const site = sites.find((s) => s.id === siteId);

  useEffect(() => () => { if (snap) URL.revokeObjectURL(snap); }, [snap]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const doProbe = () => run(async () => {
    const r = await post("/api/onvif/probe", { site_id: siteId, host, port, device_path: path, username: user, password: pw });
    setProbe(r);
    const usable = (r.profiles as Profile[]).filter((p) => p.stream_uri);
    if (usable[0]) { setMain(usable[0].stream_uri); setMainTok(usable[0].token); setSnapUrl(usable[0].snapshot_uri || ""); }
    if (usable[1]) { setSub(usable[1].stream_uri); setSubTok(usable[1].token); }
    if (!name) setName(r.device?.Model ? `${r.device.Model}` : "");
  });

  const test = (which: "main" | "sub") => run(async () => {
    const url = which === "main" ? main : sub;
    const r = await post("/api/cameras/test", { site_id: siteId, url, username: user, password: pw, rtsp_transport: transport });
    setTests((t) => ({ ...t, [which]: r }));
  });

  const doSnap = () => run(async () => {
    const r: Response = await api("POST", "/api/cameras/snapshot-preview",
      { site_id: siteId, snapshot_url: snapUrl, stream_url: sub || main, username: user, password: pw, rtsp_transport: transport }, { raw: true });
    const b = await r.blob();
    setSnap(URL.createObjectURL(b));
  });

  const save = () => run(async () => {
    const info: Record<string, unknown> = {};
    for (const k of ["main", "sub"]) if (tests[k]?.ok) info[k] = { video: tests[k].video, audio: tests[k].audio, bitrate_kbps: tests[k].bitrate_kbps, measured_fps: tests[k].measured_fps };
    const r = await post("/api/cameras", {
      site_id: siteId, name, building, zone, connection_type: type, host: type === "onvif" ? host : "",
      onvif_port: type === "onvif" ? port : null, onvif_device_path: path, rtsp_transport: transport,
      main_stream_url: main, sub_stream_url: sub, main_profile_token: mainTok, sub_profile_token: subTok, snapshot_url: snapUrl,
      username: user, password: pw, vendor: probe?.device?.Manufacturer ?? "", model: probe?.device?.Model ?? "",
      firmware: probe?.device?.FirmwareVersion ?? "", serial: probe?.device?.SerialNumber ?? "",
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean), location_note: note, record_mode: record,
      retention_days: retention ? Number(retention) : null, is_test_source: isTest, capabilities: probe?.capabilities ?? {},
      stream_info: info, allow_duplicate: allowDup,
    });
    setCreated(r);
    setPw("");
    setStep(6);
  });

  const canNext = [
    !!siteId,
    true,
    type === "onvif" ? !!host && !!port : true,
    !!main && (type === "rtsp" ? tests.main?.ok : !!probe),
    true,
    !!name.trim(),
  ][step];

  return (
    <div>
      <div className="steps" aria-label="등록 단계">
        {STEPS.map((s, i) => <span key={s} className={i === step ? "on" : i < step ? "done" : ""}>{i + 1}. {s}</span>)}
      </div>

      {step === 0 && (
        <div className="stack">
          {sites.length === 0 && <Alert kind="err">먼저 현장 관리에서 현장과 허용 네트워크(카메라 IP 대역)를 등록하세요.</Alert>}
          <Field label="현장">
            <select value={siteId ?? ""} onChange={(e) => setSiteId(Number(e.target.value))}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {site && <p className="muted small">이 현장에서 연결할 수 있는 주소 범위: {site.allowed_networks.join(", ") || "(없음 — 연결 불가)"}</p>}
        </div>
      )}

      {step === 1 && (
        <div className="choice">
          <button className={type === "onvif" ? "sel" : ""} onClick={() => setType("onvif")}><b>ONVIF로 등록 (권장)</b><span className="muted small">장치 정보와 스트림 주소를 카메라에서 직접 조회합니다.</span></button>
          <button className={type === "rtsp" ? "sel" : ""} onClick={() => setType("rtsp")}><b>RTSP 주소로 등록</b><span className="muted small">ONVIF를 지원하지 않거나 주소를 이미 알고 있을 때 사용합니다.</span></button>
          <p className="muted small full">ONVIF 자동 탐색은 2단계에서 제공합니다. 지금은 IP를 직접 입력합니다.</p>
        </div>
      )}

      {step === 2 && (
        <div className="form">
          {type === "onvif" && <>
            <Field label="카메라 IP 또는 호스트명"><input value={host} onChange={(e) => setHost(e.target.value.trim())} placeholder="예: 192.168.10.21" /></Field>
            <Field label="ONVIF 포트"><input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></Field>
            <Field label="장치 서비스 경로" hint="대부분 기본값을 사용합니다."><input value={path} onChange={(e) => setPath(e.target.value)} /></Field>
          </>}
          <Field label="카메라 계정"><input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" /></Field>
          <Field label="카메라 비밀번호" hint="암호화해 저장하며 화면·로그에 다시 표시하지 않습니다."><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="RTSP 전송 방식" hint="TCP가 손실·방화벽에 강합니다.">
            <select value={transport} onChange={(e) => setTransport(e.target.value)}><option value="tcp">TCP</option><option value="udp">UDP</option></select>
          </Field>
        </div>
      )}

      {step === 3 && type === "onvif" && (
        <div className="stack">
          <button className="primary" onClick={doProbe} disabled={busy}>{busy ? "조회 중…" : probe ? "다시 조회" : "장치 정보 조회"}</button>
          {probe && <>
            <table><tbody>
              <tr><th>제조사 / 모델</th><td>{probe.device.Manufacturer} / {probe.device.Model}</td></tr>
              <tr><th>펌웨어 / 시리얼</th><td>{probe.device.FirmwareVersion} / {probe.device.SerialNumber}</td></tr>
              <tr><th>시계 오차</th><td>{probe.time_offset_seconds === null ? "확인 불가" : `${probe.time_offset_seconds}초`}</td></tr>
              <tr><th>미디어 서비스</th><td>{probe.media2 ? "Media2 (Profile T 방식)" : "Media ver10 (Profile S 방식)"}</td></tr>
              <tr><th>기타 기능</th><td className="small">PTZ {probe.capabilities.ptz ? "지원(2단계에서 제어)" : "없음"} / 이벤트 {probe.capabilities.events ? "지원(2단계에서 연동)" : "없음"} / 장치 녹화(Profile G) {probe.capabilities.recording_profile_g ? "지원(3단계)" : "없음"}</td></tr>
            </tbody></table>
            <p className="muted small">{probe.note}</p>
            {probe.warnings.map((w: string) => <Alert key={w}>{w}</Alert>)}
            {probe.duplicates.length > 0 && (
              <Alert kind="err">같은 주소/시리얼의 카메라가 이미 있습니다: {probe.duplicates.map((d: any) => `${d.name}(#${d.id})`).join(", ")}
                <label className="check" style={{ marginLeft: 8 }}><input type="checkbox" checked={allowDup} onChange={(e) => setAllowDup(e.target.checked)} />그래도 등록</label></Alert>
            )}
            <h3>영상 프로파일 선택</h3>
            <div className="tablewrap"><table>
              <thead><tr><th>프로파일</th><th>코덱</th><th>해상도</th><th>FPS</th><th>비트레이트</th><th>메인</th><th>서브(웹 시청)</th></tr></thead>
              <tbody>{(probe.profiles as Profile[]).map((p) => (
                <tr key={p.token}>
                  <td>{p.name}<div className="muted small">{p.uri_error || p.stream_uri}</div></td>
                  <td>{p.encoding}</td><td className="num">{p.width}×{p.height}</td><td className="num">{p.fps ?? "-"}</td><td className="num">{p.bitrate_kbps ? `${p.bitrate_kbps} kbps` : "-"}</td>
                  <td><input type="radio" name="main" disabled={!p.stream_uri} checked={mainTok === p.token} onChange={() => { setMain(p.stream_uri); setMainTok(p.token); setSnapUrl(p.snapshot_uri || snapUrl); }} aria-label={`${p.name} 메인`} /></td>
                  <td><input type="radio" name="sub" disabled={!p.stream_uri} checked={subTok === p.token} onChange={() => { setSub(p.stream_uri); setSubTok(p.token); }} aria-label={`${p.name} 서브`} /></td>
                </tr>))}
              </tbody>
            </table></div>
            <div className="row">
              <button onClick={() => test("main")} disabled={busy || !main}>메인 스트림 시험</button>
              <button onClick={() => test("sub")} disabled={busy || !sub}>서브 스트림 시험</button>
            </div>
            <TestResults tests={tests} />
          </>}
        </div>
      )}

      {step === 3 && type === "rtsp" && (
        <div className="stack">
          <Alert kind="info">카메라 매뉴얼 또는 ONVIF 조회로 확인한 주소만 입력하세요. 계정·비밀번호는 주소에 넣지 말고 앞 단계에서 입력합니다.</Alert>
          <Field label="메인 스트림 RTSP 주소 (녹화용)"><input value={main} onChange={(e) => setMain(e.target.value.trim())} placeholder="rtsp://192.168.10.22:554/..." /></Field>
          <Field label="서브 스트림 RTSP 주소 (웹 시청용, 선택)" hint="분할 화면에서 사용합니다. 없으면 메인 스트림을 시청에 씁니다."><input value={sub} onChange={(e) => setSub(e.target.value.trim())} /></Field>
          <Field label="스냅샷 HTTP 주소 (선택)"><input value={snapUrl} onChange={(e) => setSnapUrl(e.target.value.trim())} /></Field>
          <div className="row">
            <button className="primary" onClick={() => test("main")} disabled={busy || !main}>{busy ? "시험 중…" : "메인 연결 시험"}</button>
            <button onClick={() => test("sub")} disabled={busy || !sub}>서브 연결 시험</button>
          </div>
          <TestResults tests={tests} />
        </div>
      )}

      {step === 4 && (
        <div className="stack">
          <button className="primary" onClick={doSnap} disabled={busy}>{busy ? "가져오는 중…" : "스냅샷 미리보기"}</button>
          {snap && <img className="snap" src={snap} alt="카메라 미리보기" />}
          <p className="muted small">미리보기는 저장 전 연결 확인용입니다. 저장 후 실시간 관제에서 WebRTC로 확인할 수 있습니다.</p>
        </div>
      )}

      {step === 5 && (
        <div className="form">
          <Field label="카메라 이름"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="건물"><input value={building} onChange={(e) => setBuilding(e.target.value)} /></Field>
          <Field label="구역"><input value={zone} onChange={(e) => setZone(e.target.value)} /></Field>
          <Field label="태그" hint="쉼표로 구분"><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          <Field label="녹화">
            <select value={record} onChange={(e) => setRecord(e.target.value)}>
              <option value="continuous">24시간 연속 녹화</option>
              <option value="off">녹화 안 함(시청만)</option>
            </select>
          </Field>
          <Field label="보관 기간(일)" hint="비우면 시스템 기본값"><input type="number" min={1} value={retention} onChange={(e) => setRetention(e.target.value)} /></Field>
          <Field label="설치 위치 메모" full><textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <label className="check full"><input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />시험용 스트림(실제 카메라 아님)으로 표시</label>
        </div>
      )}

      {step === 6 && created && (
        <div className="stack">
          <Alert kind="ok">“{created.name}” 카메라를 등록했습니다. {created.record_mode === "continuous" ? "녹화 서비스가 몇 초 안에 연결해 녹화를 시작합니다." : "녹화는 꺼져 있습니다."}</Alert>
          <button className="primary" onClick={onDone}>카메라 목록으로</button>
        </div>
      )}

      {err && <Alert kind="err">{err}</Alert>}
      {step < 6 && (
        <div className="row" style={{ marginTop: 16 }}>
          {step > 0 && <button onClick={() => setStep(step - 1)} disabled={busy}>이전</button>}
          <span style={{ flex: 1 }} />
          {step < 5 && <button className="primary" disabled={!canNext || busy} onClick={() => setStep(step + 1)}>다음</button>}
          {step === 5 && <button className="primary" disabled={!canNext || busy} onClick={save}>저장하고 {record === "continuous" ? "녹화 시작" : "등록"}</button>}
        </div>
      )}
      {step === 3 && type === "rtsp" && !tests.main?.ok && <p className="muted small">메인 스트림 연결 시험에 성공해야 다음 단계로 갈 수 있습니다.</p>}
    </div>
  );
}

function TestResults({ tests }: { tests: Record<string, any> }) {
  return (
    <>
      {(["main", "sub"] as const).map((k) => tests[k] && (
        <Alert key={k} kind={tests[k].ok ? "ok" : "err"}>
          <b>{k === "main" ? "메인" : "서브"}: </b>
          {tests[k].ok
            ? `${tests[k].video.codec.toUpperCase()} ${tests[k].video.width}×${tests[k].video.height}, 실측 ${tests[k].measured_fps ?? "-"}fps, 약 ${tests[k].bitrate_kbps ?? "-"}kbps, 음성 ${tests[k].audio?.codec ?? "없음"}`
            : tests[k].error_message}
          {(tests[k].warnings ?? []).map((w: string) => <div key={w} className="small">{w}</div>)}
        </Alert>
      ))}
    </>
  );
}
