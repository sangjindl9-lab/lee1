import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { fmtHm, fmtNum, fmtTime } from '../lib/format';

export interface ChartPoint {
  t: number; // epoch ms
  v: number | null;
}

interface Props {
  title: string;
  points: ChartPoint[];
  unit: string;
  digits?: number;
  color?: string;
  height?: number;
  xMin: number;
  xMax: number;
  /** 이 간격(ms)보다 데이터가 비면 선을 끊는다 (미수신 구간을 이어 그리지 않음) */
  gapMs?: number;
}

const PAD = { l: 48, r: 12, t: 10, b: 22 };

/** 외부 라이브러리 없이 그리는 간단한 SVG 선 그래프 */
export function LineChart({ title, points, unit, digits = 1, color = 'var(--accent)', height = 160, xMin, xMax, gapMs = 5 * 60_000 }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<ChartPoint | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const valid = useMemo(
    () => points.filter((p): p is { t: number; v: number } => p.v !== null && Number.isFinite(p.v) && p.t >= xMin && p.t <= xMax).sort((a, b) => a.t - b.t),
    [points, xMin, xMax],
  );

  const { yMin, yMax } = useMemo(() => {
    if (valid.length === 0) return { yMin: 0, yMax: 1 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of valid) {
      if (p.v < lo) lo = p.v;
      if (p.v > hi) hi = p.v;
    }
    if (lo === hi) {
      const d = Math.abs(lo) * 0.1 || 1;
      return { yMin: lo - d, yMax: hi + d };
    }
    const pad = (hi - lo) * 0.08;
    return { yMin: lo - pad, yMax: hi + pad };
  }, [valid]);

  const iw = Math.max(10, width - PAD.l - PAD.r);
  const ih = Math.max(10, height - PAD.t - PAD.b);
  const sx = (t: number) => PAD.l + ((t - xMin) / Math.max(1, xMax - xMin)) * iw;
  const sy = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const path = useMemo(() => {
    let d = '';
    let prev: { t: number; v: number } | null = null;
    for (const p of valid) {
      const cmd = !prev || p.t - prev.t > gapMs ? 'M' : 'L';
      d += `${cmd}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`;
      prev = p;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, width, height, yMin, yMax, xMin, xMax, gapMs]);

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];
  const xTicks: number[] = [];
  const span = xMax - xMin;
  const n = width < 420 ? 3 : 6;
  for (let i = 0; i <= n; i++) xTicks.push(xMin + (span * i) / n);

  function onMove(e: MouseEvent<SVGSVGElement>) {
    if (valid.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = xMin + ((x - PAD.l) / iw) * span;
    let best = valid[0];
    for (const p of valid) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    setHover(best);
  }

  const last = valid.length ? valid[valid.length - 1] : null;

  return (
    <div className="chart" ref={wrap}>
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-val">
          {hover ? (
            <>
              {fmtTime(hover.t)} · <b>{fmtNum(hover.v, digits, unit)}</b>
            </>
          ) : (
            <>
              최근 <b>{last ? fmtNum(last.v, digits, unit) : '—'}</b>
            </>
          )}
        </span>
      </div>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={title}>
        {yTicks.map((v, i) => (
          <g key={'y' + i}>
            <line x1={PAD.l} x2={width - PAD.r} y1={sy(v)} y2={sy(v)} className="chart-grid" />
            <text x={PAD.l - 6} y={sy(v) + 4} className="chart-axis" textAnchor="end">
              {valid.length ? fmtNum(v, digits) : ''}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={'x' + i} x={sx(t)} y={height - 6} className="chart-axis" textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
            {fmtHm(t)}
          </text>
        ))}
        {valid.length ? <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" /> : null}
        {valid.length === 1 ? <circle cx={sx(valid[0].t)} cy={sy(valid[0].v)} r={2.5} fill={color} /> : null}
        {hover && hover.v !== null ? (
          <g>
            <line x1={sx(hover.t)} x2={sx(hover.t)} y1={PAD.t} y2={PAD.t + ih} className="chart-cursor" />
            <circle cx={sx(hover.t)} cy={sy(hover.v)} r={3} fill={color} />
          </g>
        ) : null}
        {valid.length === 0 ? (
          <text x={PAD.l + iw / 2} y={PAD.t + ih / 2} className="chart-empty" textAnchor="middle">
            표시할 계측값이 없습니다
          </text>
        ) : null}
      </svg>
    </div>
  );
}
