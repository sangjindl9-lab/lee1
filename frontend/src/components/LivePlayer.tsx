import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { post } from "../api";

type Session = { prefer_hls?: boolean; token: string; expires_at: number; whep_url: string; hls_url: string; stream: string; warnings: string[]; is_test_source: boolean };
type Mode = "connecting" | "webrtc" | "hls" | "error" | "paused";

/**
 * 실시간 시청: WebRTC(WHEP) 우선, 실패하면 HLS 로 전환.
 * - 토큰은 API 가 발급(10분), 만료 전에 갱신한다. mediamtx 가 API 로 매 요청을 검증한다.
 * - 화면에 보이지 않으면(탭 숨김·스크롤 밖) 시청 세션을 닫는다. 녹화와는 무관하다.
 */
export default function LivePlayer({ cameraId, stream, zoom = 1, onVideo }: {
  cameraId: number; stream: "sub" | "main"; zoom?: number; onVideo?: (v: HTMLVideoElement | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("connecting");
  const [error, setError] = useState("");
  const [warn, setWarn] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    onVideo?.(video.current);
    return () => onVideo?.(null);
  }, [onVideo]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && !document.hidden), { threshold: 0.05 });
    io.observe(el);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setMode("paused");
      return;
    }
    let closed = false;
    let pc: RTCPeerConnection | null = null;
    let hls: Hls | null = null;
    let whepLocation = "";
    let token = "";
    let refreshTimer: number | undefined;
    let watchdog: number | undefined;
    const v = video.current!;

    const getSession = async (refresh: boolean) => {
      const s = await post<Session>("/api/live/sessions", { camera_id: cameraId, stream, refresh });
      token = s.token;
      const ms = Math.max(30_000, (s.expires_at * 1000 - Date.now()) - 60_000);
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => getSession(true).catch(() => {}), ms);
      return s;
    };

    const startHls = async (s: Session, reason: string) => {
      if (closed) return;
      const { default: HlsLib } = await import("hls.js"); // HLS 대체 재생 때만 불러옴
      cleanupRtc();
      setMode("hls");
      if (reason) setWarn((w) => [...w.filter((x) => !x.startsWith("WebRTC")), `WebRTC 연결 실패(${reason}) — HLS로 재생 중(지연 수 초)`]);
      if (closed) return;
      if (HlsLib.isSupported()) {
        hls = new HlsLib({
          lowLatencyMode: true,
          xhrSetup: (xhr) => xhr.setRequestHeader("Authorization", `Bearer ${token}`),
        });
        hls.on(HlsLib.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            setMode("error");
            setError(data.response?.code === 401 || data.response?.code === 403 ? "시청 권한이 없거나 토큰이 만료되었습니다." : "영상을 불러오지 못했습니다(카메라 연결 또는 코덱 확인).");
          }
        });
        hls.loadSource(s.hls_url);
        hls.attachMedia(v);
        v.play().catch(() => {});
      } else {
        setMode("error");
        setError("이 브라우저는 WebRTC·HLS 재생을 지원하지 않습니다.");
      }
    };

    const cleanupRtc = () => {
      if (pc) {
        pc.close();
        pc = null;
      }
      if (whepLocation) {
        fetch(whepLocation, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
        whepLocation = "";
      }
    };

    const startRtc = async (s: Session) => {
      pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (ev) => {
        v.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
        v.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === "failed") startHls(s, "ICE 연결 실패 — UDP 8189 또는 TURN 설정 확인");
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise<void>((res) => {
        if (pc!.iceGatheringState === "complete") return res();
        const t = window.setTimeout(res, 1500);
        pc!.addEventListener("icegatheringstatechange", () => {
          if (pc?.iceGatheringState === "complete") {
            window.clearTimeout(t);
            res();
          }
        });
      });
      const r = await fetch(s.whep_url, {
        method: "POST",
        headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${token}` },
        body: pc.localDescription!.sdp,
      });
      if (r.status === 401 || r.status === 403) throw new Error("권한 없음");
      if (!r.ok) throw new Error(`WHEP ${r.status}`);
      const loc = r.headers.get("location");
      if (loc) {
        // mediamtx 가 '/경로/whep/세션' 형태로 주면 프록시 접두사(/rtc)를 붙인다
        const fixed = loc.startsWith("/") && !loc.startsWith("/rtc/") ? `/rtc${loc}` : loc;
        whepLocation = new URL(fixed, new URL(s.whep_url, location.href)).toString();
      }
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    };

    (async () => {
      setMode("connecting");
      setError("");
      try {
        const s = await getSession(false);
        if (closed) return;
        setWarn(s.warnings);
        if (s.prefer_hls) {
          await startHls(s, "");
          return;
        }
        try {
          await startRtc(s);
          setMode("webrtc");
          // 영상 프레임이 일정 시간 안 들어오면 HLS 로 전환
          watchdog = window.setTimeout(() => {
            if (!closed && v.readyState < 2 && pc) startHls(s, "영상 수신 없음");
          }, 9000);
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === "권한 없음") {
            setMode("error");
            setError("시청 권한이 없습니다.");
            return;
          }
          startHls(s, msg);
        }
      } catch (e) {
        setMode("error");
        setError((e as Error).message);
      }
    })();

    return () => {
      closed = true;
      window.clearTimeout(refreshTimer);
      window.clearTimeout(watchdog);
      cleanupRtc();
      hls?.destroy();
      v.removeAttribute("src");
      v.srcObject = null;
    };
  }, [cameraId, stream, visible]);

  return (
    <div ref={wrap} style={{ position: "absolute", inset: 0 }}>
      <video ref={video} muted playsInline autoPlay style={{ transform: `scale(${zoom})` }} />
      {mode !== "webrtc" && mode !== "hls" && (
        <div className="msg">
          {mode === "connecting" && "연결 중…"}
          {mode === "paused" && "화면에 보이지 않아 시청을 멈췄습니다(녹화는 계속)."}
          {mode === "error" && <span style={{ color: "var(--warn)" }}>{error}</span>}
        </div>
      )}
      <div style={{ position: "absolute", left: 6, bottom: 6, display: "flex", gap: 4, flexWrap: "wrap", pointerEvents: "none" }}>
        {(mode === "webrtc" || mode === "hls") && <span className="tag" style={{ background: "rgba(0,0,0,.6)" }}>{mode === "webrtc" ? "WebRTC" : "HLS"} {stream === "main" ? "메인" : "서브"}</span>}
        {warn.map((w) => <span key={w} className="tag" style={{ background: "rgba(0,0,0,.7)", color: "var(--warn)", borderColor: "var(--warn)" }}>{w}</span>)}
      </div>
    </div>
  );
}
