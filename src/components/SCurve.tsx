import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ProjectCalc } from '../lib/calc';
import type { Project } from '../lib/types';
import { fmtDot } from '../lib/date';
import { fmt1 } from './ui';

export function SCurve({ p, c }: { p: Project; c: ProjectCalc }) {
  const data = c.periods.map((x) => {
    const a = x.actCum;
    return {
      name: x.period.group.endsWith('년') ? `${x.period.group.slice(2, 4)}.${x.period.label.replace('월', '')}` : x.period.label,
      full: `${fmtDot(x.period.start)} ~ ${fmtDot(x.period.end)}`,
      plan: Math.round(x.planCum * 100) / 100,
      act: a == null ? null : Math.round(a * 100) / 100,
      gap: a == null ? null : ([Math.min(a, x.planCum), Math.max(a, x.planCum)] as [number, number]),
      actDate: x.actDate,
      inBase: p.info.baseDate >= x.period.start && p.info.baseDate <= x.period.end,
    };
  });
  const baseName = data.find((d) => d.inBase)?.name;
  const hasAct = data.some((d) => d.act != null);
  return (
    <div className="w-full" style={{ height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--line2)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'var(--mute)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fill: 'var(--mute)', fontSize: 11 }} tickLine={false} axisLine={false} unit="%" width={46} />
          <Tooltip
            cursor={{ stroke: 'var(--ink2)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              const dev = d.act == null ? null : d.act - d.plan;
              return (
                <div className="tip" style={{ position: 'static' }}>
                  <div className="font-semibold">{d.full}</div>
                  <div className="num">예정 누계 {fmt1(d.plan)}%</div>
                  <div className="num">실적 누계 {d.act == null ? '데이터 없음' : `${fmt1(d.act)}% (${d.actDate})`}</div>
                  {dev != null && <div className="num">편차 {dev >= 0 ? '+' : ''}{fmt1(dev)}%p</div>}
                </div>
              );
            }}
          />
          <Legend verticalAlign="top" align="right" height={26} iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--ink2)' }} />
          <Area dataKey="gap" name="편차" stroke="none" fill="var(--late)" fillOpacity={0.14} connectNulls isAnimationActive={false} legendType="square" />
          <Line dataKey="plan" name="누적 예정공정률" stroke="var(--plan)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          <Line dataKey="act" name="누적 실제공정률" stroke="var(--act)" strokeWidth={2} dot={{ r: 4, fill: 'var(--act)', stroke: 'var(--panel)', strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          {baseName && <ReferenceLine x={baseName} stroke="var(--late)" strokeDasharray="4 3" label={{ value: '기준일', fill: 'var(--late)', fontSize: 11, position: 'insideTopLeft' }} />}
        </ComposedChart>
      </ResponsiveContainer>
      {!hasAct && <div className="-mt-2 text-center text-[12px] text-mute">실적 이력이 없습니다. 아래 [기준일 실적 저장]으로 이력을 남기면 실적 곡선이 그려집니다.</div>}
    </div>
  );
}
