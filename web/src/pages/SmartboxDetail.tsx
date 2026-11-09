import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorText } from '../api/client';
import type { Channel, Command, DeviceEvent, Smartbox, TelemetryRow } from '../api/types';
import { Card, CommandStatusBadge, Empty, ErrorState, Flag, InlineError, KV, Loading, Modal, OnlineDot, SeverityBadge } from '../components/common';
import { LineChart, type ChartPoint } from '../components/LineChart';
import { StepUpDialog } from '../components/StepUpDialog';
import { useAuth } from '../context/Auth';
import { useOnReconnect, useSocketEvent } from '../context/Realtime';
import { fmtBool, fmtDuration, fmtInt, fmtNum, fmtTime, isoNowMinus, relTime, toMs } from '../lib/format';
import {
  COMMAND_FINAL,
  COMMAND_TYPE_LABEL,
  ENV_KIND_LABEL,
  EVENT_TYPE_LABEL,
  INPUT_KEYS,
  INPUT_LABEL,
  ROLE_LABEL,
  commandParamsText,
  label,
} from '../lib/labels';
import { applyStatus, applyTelemetry, sortCommands, upsertById } from '../lib/live';
import { useApi, useNow } from '../lib/useApi';

const DAY = 24 * 3600_000;

type PowerType = 'power_off' | 'power_on' | 'power_cycle';
interface PowerReq {
  type: PowerType;
  ch: Channel;
  offSec: number;
}
interface AlarmReq {
  output: 'siren' | 'strobe';
  on: boolean;
}

export function SmartboxDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const sb = useApi(() => api<Smartbox>(`/smartboxes/${encodeURIComponent(id)}`), [id]);
  const tel = useApi(
    () =>
      api<TelemetryRow[]>(`/smartboxes/${encodeURIComponent(id)}/telemetry`, {
        query: { from: isoNowMinus(DAY), to: new Date().toISOString(), limit: 10000 },
      }),
    [id],
  );
  const events = useApi(() => api<DeviceEvent[]>(`/smartboxes/${encodeURIComponent(id)}/events`, { query: { limit: 100 } }), [id]);
  const cmds = useApi(() => api<Command[]>('/commands', { query: { smartbox_id: id } }).then(sortCommands), [id]);
  const [livePts, setLivePts] = useState<{ t: number; temp: number | null; w: number | null }[]>([]);
  const [power, setPower] = useState<PowerReq | null>(null);
  const [alarmReq, setAlarmReq] = useState<AlarmReq | null>(null);
  const [offSec, setOffSec] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const now = useNow(1000);
  const chartNow = useNow(60_000);

  useSocketEvent('telemetry', (ev) => {
    if (ev.smartbox_id !== id) return;
    sb.setData((b) => b && applyTelemetry(b, ev));
    const t = toMs(ev.data.ts ?? null) ?? Date.now();
    setLivePts((l) => [...l.slice(-2000), { t, temp: ev.data.env?.t ?? null, w: ev.data.ac?.w ?? null }]);
  });
  useSocketEvent('device_status', (ev) => {
    if (ev.smartbox_id === id) sb.setData((b) => b && applyStatus(b, ev));
  });
  useSocketEvent('device_event', (ev) => {
    if (ev.smartbox_id !== id) return;
    events.setData((l) => (l ? upsertById(l, ev.event) : l));
  });
  useSocketEvent('command', (c) => {
    if (c.smartbox_id !== id) return;
    cmds.setData((l) => (l ? sortCommands(upsertById(l, c)) : l));
  });
  useOnReconnect(() => {
    void sb.reload();
    void events.reload();
    void cmds.reload();
  });

  const series = useMemo(() => {
    const temp: ChartPoint[] = [];
    const w: ChartPoint[] = [];
    for (const r of tel.data ?? []) {
      const t = toMs(r.ts) ?? toMs(r.received_at) ?? toMs(r.data?.ts ?? null);
      if (t === null) continue;
      temp.push({ t, v: r.data?.env?.t ?? null });
      w.push({ t, v: r.data?.ac?.w ?? null });
    }
    for (const p of livePts) {
      temp.push({ t: p.t, v: p.temp });
      w.push({ t: p.t, v: p.w });
    }
    return { temp, w };
  }, [tel.data, livePts]);

  const activeByCh = useMemo(() => {
    const m = new Map<number, Command>();
    for (const c of cmds.data ?? []) {
      const ch = c.params && typeof c.params.ch === 'number' ? c.params.ch : null;
      if (ch !== null && !COMMAND_FINAL.includes(c.status) && !m.has(ch)) m.set(ch, c);
    }
    return m;
  }, [cmds.data]);

  if (sb.loading && !sb.data) return <Loading />;
  if (!sb.data) return <ErrorState error={sb.error ?? new Error('스마트박스를 찾을 수 없습니다.')} onRetry={() => void sb.reload()} />;

  const b = sb.data;
  const t = b.latest;
  const canPower = can('device.control.power');
  const canAlarmOut = can('device.control.alarm');

  async function send(type: string, params: Record<string, unknown>, reason: string, stepUpToken?: string): Promise<Command> {
    const c = await api<Command>(`/smartboxes/${encodeURIComponent(id)}/commands`, {
      method: 'POST',
      body: { type, params, reason },
      stepUpToken,
    });
    cmds.setData((l) => sortCommands(upsertById(l ?? [], c)));
    setMsg({
      kind: 'ok',
      text:
        c.status === 'pending_approval'
          ? `${label(COMMAND_TYPE_LABEL, type)} 요청이 등록되었습니다. 다른 승인자의 승인 후 실행됩니다.`
          : `${label(COMMAND_TYPE_LABEL, type)} 명령을 보냈습니다.`,
    });
    return c;
  }

  async function telemetryNow() {
    try {
      await send('telemetry_now', {}, '관제 화면 즉시 계측 요청');
    } catch (e) {
      setMsg({ kind: 'err', text: errorText(e) });
    }
  }

  function loadState(c: Channel): boolean | null {
    const v = t?.loads?.[c.ch - 1];
    return v === undefined ? c.load_on : v;
  }
  function coilState(c: Channel): boolean | null {
    const v = t?.relays?.[c.ch - 1];
    return v === undefined ? c.coil_on : v;
  }

  function openPower(type: PowerType, c: Channel) {
    const raw = offSec[c.ch] ?? '10';
    const n = Number(raw);
    if (type === 'power_cycle' && (!Number.isInteger(n) || n < 1 || n > 120)) {
      setMsg({ kind: 'err', text: '재투입 차단 시간은 1~120초 정수여야 합니다.' });
      return;
    }
    setPower({ type, ch: c, offSec: n });
  }

  const offlineNote = !b.online;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <Link to="/">대시보드</Link> / {b.site_name ?? '현장'} / {b.cabinet_code ?? '함체'}
          </div>
          <h1 className="detail-title">
            <OnlineDot online={b.online} /> <span className="mono">{b.device_id}</span>
            <span className={'pill ' + (b.online ? 'pill-ok' : 'pill-bad')}>{b.online ? '온라인' : '오프라인'}</span>
          </h1>
          <div className="detail-meta">
            <span>함체 {b.cabinet_name ?? '—'}</span>
            <span>FW {b.fw_version ?? '—'}</span>
            <span>모델 {b.model ?? '—'}</span>
            <span>S/N {b.serial_no ?? '—'}</span>
            <span>설정 v{b.config_version ?? '—'}</span>
            <span title={fmtTime(b.last_seen_at)}>
              최종 수신 {fmtTime(b.last_seen_at)} ({relTime(b.last_seen_at, now)})
            </span>
          </div>
        </div>
        <div className="head-actions">
          {can('device.read') ? (
            <button className="btn" onClick={() => void telemetryNow()}>
              즉시 계측
            </button>
          ) : null}
          <button className="btn" onClick={() => void sb.reload()}>
            새로고침
          </button>
        </div>
      </div>

      {sb.error ? <ErrorState error={sb.error} onRetry={() => void sb.reload()} /> : null}
      {offlineNote ? (
        <div className="banner banner-warn">장치가 오프라인입니다. 아래 계측값은 마지막 수신값({fmtTime(t?.received_at ?? b.last_seen_at)})이며 현재 상태와 다를 수 있습니다.</div>
      ) : null}
      {msg ? (
        <div className={'banner ' + (msg.kind === 'ok' ? 'banner-info' : 'banner-err')} onClick={() => setMsg(null)}>
          {msg.text}
        </div>
      ) : null}
      {!t ? <div className="banner banner-info">아직 수신된 계측값이 없습니다.</div> : null}

      <div className={'cards' + (offlineNote ? ' stale' : '')}>
        <Card title="전원">
          <div className="sub-h">AC {t && t.ac === null ? <span className="muted">(측정 불가)</span> : null}</div>
          <KV k="전압" v={fmtNum(t?.ac?.v, 1, 'V')} />
          <KV k="전류" v={fmtNum(t?.ac?.a, 2, 'A')} />
          <KV k="전력" v={fmtNum(t?.ac?.w, 1, 'W')} />
          <KV k="누적 전력량" v={fmtNum(t?.ac?.kwh, 1, 'kWh')} />
          <KV k="주파수 / 역률" v={`${fmtNum(t?.ac?.hz, 1, 'Hz')} / ${fmtNum(t?.ac?.pf, 2)}`} />
          <div className="sub-h">DC {t && t.dc === null ? <span className="muted">(측정 불가)</span> : null}</div>
          <KV k="입력 전압" v={fmtNum(t?.dc?.in_v, 2, 'V')} />
          <KV k="입력 전류" v={fmtNum(t?.dc?.in_a, 2, 'A')} />
          <KV k="배터리 전압" v={fmtNum(t?.dc?.batt_v, 2, 'V')} />
        </Card>
        <Card title="환경">
          <KV k="온도" v={<span className="big">{fmtNum(t?.env?.t, 1, '℃')}</span>} />
          <KV k="습도" v={<span className="big">{fmtNum(t?.env?.rh, 1, '%')}</span>} />
          <KV k="팬" v={`${fmtBool(b.channels.find((c) => c.role === 'fan')?.load_on, '동작', '정지')} · ${fmtBool(t?.auto?.fan, '자동', '수동')}`} />
          <KV k="히터" v={`${fmtBool(b.channels.find((c) => c.role === 'heater')?.load_on, '동작', '정지')} · ${fmtBool(t?.auto?.heater, '자동', '수동')}`} />
        </Card>
        <Card title="입력 8개">
          {INPUT_KEYS.map((k) => {
            const def = b.inputs.find((i) => i.key === k);
            const v = t?.inputs ? t.inputs[k] : def?.active;
            return <KV key={k} k={INPUT_LABEL[k] ?? def?.name ?? k} v={<Flag value={v ?? null} onText="이상" offText="정상" />} />;
          })}
        </Card>
        <Card title="충격 / 기울기">
          <KV k="충격" v={<Flag value={t?.accel?.shock} onText="감지" offText="없음" />} />
          <KV k="기울기" v={fmtNum(t?.accel?.tilt_deg, 1, '°')} />
        </Card>
        <Card title="네트워크">
          <KV k="이더넷 링크" v={<Flag value={t?.net?.eth_link === undefined || t?.net?.eth_link === null ? null : !t.net.eth_link} onText="끊김" offText="연결" />} />
          <KV k="MQTT 재접속" v={t?.net?.mqtt_reconnects == null ? '—' : `${fmtInt(t.net.mqtt_reconnects)}회`} />
          <KV k="오프라인 버퍼" v={t?.net?.offline_buffered == null ? '—' : `${fmtInt(t.net.offline_buffered)}건`} />
          <KV k="가동 시간" v={fmtDuration(t?.uptime_ms)} />
          <KV k="일련번호(seq)" v={fmtInt(t?.seq)} mono />
          <KV k="수신 시각" v={fmtTime(t?.received_at)} />
        </Card>
      </div>

      <Card title="릴레이 6채널 (부하 전원)">
        {!canPower ? <div className="muted small">전원 제어 권한이 없습니다. 상태만 표시합니다.</div> : null}
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>CH</th>
                <th>이름</th>
                <th>역할</th>
                <th>접점</th>
                <th>코일</th>
                <th>부하 전원</th>
                <th>진행 중</th>
                {canPower ? <th>제어</th> : null}
              </tr>
            </thead>
            <tbody>
              {b.channels.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted">
                    채널 정보가 없습니다.
                  </td>
                </tr>
              ) : null}
              {b.channels
                .slice()
                .sort((x, y) => x.ch - y.ch)
                .map((c) => {
                  const load = loadState(c);
                  const active = activeByCh.get(c.ch);
                  return (
                    <tr key={c.ch}>
                      <td className="mono">CH{c.ch}</td>
                      <td>{c.name || '—'}</td>
                      <td>
                        {label(ROLE_LABEL, c.role)}
                        {c.shared ? <span className="pill pill-warn">공유</span> : null}
                      </td>
                      <td>{c.contact}</td>
                      <td className="muted">{fmtBool(coilState(c), 'ON', 'OFF')}</td>
                      <td>
                        {load === true ? <span className="flag flag-ok">ON</span> : load === false ? <span className="flag flag-bad">OFF</span> : <span className="flag flag-unk">—</span>}
                      </td>
                      <td>{active ? <CommandStatusBadge status={active.status} /> : <span className="muted">—</span>}</td>
                      {canPower ? (
                        <td className="ctl">
                          <button className="btn btn-sm btn-danger" disabled={!!active} onClick={() => openPower('power_off', c)}>
                            끄기
                          </button>
                          <button className="btn btn-sm" disabled={!!active} onClick={() => openPower('power_on', c)}>
                            켜기
                          </button>
                          <span className="cycle">
                            <input
                              type="number"
                              min={1}
                              max={120}
                              value={offSec[c.ch] ?? '10'}
                              onChange={(e) => setOffSec((s) => ({ ...s, [c.ch]: e.target.value }))}
                              aria-label={`CH${c.ch} 재투입 차단 시간(초)`}
                            />
                            <span className="muted">초</span>
                            <button className="btn btn-sm btn-warn" disabled={!!active} onClick={() => openPower('power_cycle', c)}>
                              재투입
                            </button>
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="경보 출력">
        <div className="alarm-outs">
          {(['siren', 'strobe'] as const).map((o) => {
            const st = t?.alarm_out ? t.alarm_out[o] : null;
            return (
              <div key={o} className="alarm-out">
                <span className="ao-name">{o === 'siren' ? '사이렌' : '경광등'}</span>
                <Flag value={st ?? null} onText="동작 중" offText="꺼짐" />
                {canAlarmOut ? (
                  <>
                    <button className="btn btn-sm btn-warn" onClick={() => setAlarmReq({ output: o, on: true })}>
                      켜기
                    </button>
                    <button className="btn btn-sm" onClick={() => setAlarmReq({ output: o, on: false })}>
                      끄기
                    </button>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="최근 24시간 계측">
        {tel.error ? <ErrorState error={tel.error} onRetry={() => void tel.reload()} /> : null}
        {tel.loading && !tel.data ? <Loading /> : null}
        <div className="charts">
          <LineChart title="온도" unit="℃" digits={1} points={series.temp} xMin={chartNow - DAY} xMax={Math.max(chartNow, now)} color="var(--c-temp)" />
          <LineChart title="AC 전력" unit="W" digits={0} points={series.w} xMin={chartNow - DAY} xMax={Math.max(chartNow, now)} color="var(--c-power)" />
        </div>
      </Card>

      <div className="two-col">
        <Card title="최근 장치 이벤트">
          {events.error ? <ErrorState error={events.error} onRetry={() => void events.reload()} /> : null}
          {events.data && events.data.length === 0 ? <Empty text="이벤트가 없습니다." /> : null}
          {events.data && events.data.length > 0 ? (
            <div className="table-wrap scroll-y">
              <table className="tbl tbl-dense">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>등급</th>
                    <th>유형</th>
                    <th>내용</th>
                  </tr>
                </thead>
                <tbody>
                  {events.data.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{fmtTime(e.ts)}</td>
                      <td>
                        <SeverityBadge severity={e.severity} />
                      </td>
                      <td>{label(EVENT_TYPE_LABEL, e.type)}</td>
                      <td>{eventText(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
        <Card title="명령 이력">
          {cmds.error ? <ErrorState error={cmds.error} onRetry={() => void cmds.reload()} /> : null}
          {cmds.data && cmds.data.length === 0 ? <Empty text="명령 이력이 없습니다." /> : null}
          {cmds.data && cmds.data.length > 0 ? (
            <div className="table-wrap scroll-y">
              <table className="tbl tbl-dense">
                <thead>
                  <tr>
                    <th>요청 시각</th>
                    <th>명령</th>
                    <th>상태</th>
                    <th>요청자 / 승인자</th>
                    <th>사유</th>
                    <th>결과</th>
                  </tr>
                </thead>
                <tbody>
                  {cmds.data.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap">{fmtTime(c.created_at)}</td>
                      <td>
                        {label(COMMAND_TYPE_LABEL, c.type)} <span className="muted">{commandParamsText(c.type, c.params)}</span>
                      </td>
                      <td>
                        <CommandStatusBadge status={c.status} />
                      </td>
                      <td>
                        {c.requested_by_name ?? '—'}
                        {c.requires_approval ? <> / {c.approved_by_name ?? <span className="muted">미승인</span>}</> : null}
                      </td>
                      <td className="wrap">{c.reason || '—'}</td>
                      <td className="wrap small">
                        {c.error ? <span className="text-bad">{c.error}</span> : null}
                        {c.finished_at ? <span className="muted"> {fmtTime(c.finished_at)}</span> : null}
                        {!c.error && !c.finished_at ? '—' : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>

      {power ? (
        <StepUpDialog
          title={`CH${power.ch.ch} ${label(COMMAND_TYPE_LABEL, power.type)}`}
          confirmLabel={label(COMMAND_TYPE_LABEL, power.type)}
          danger={power.type !== 'power_on'}
          requireReason
          onClose={() => setPower(null)}
          onSubmit={async (token, reason) => {
            const params: Record<string, unknown> = { ch: power.ch.ch };
            if (power.type === 'power_cycle') params.off_sec = power.offSec;
            await send(power.type, params, reason, token);
          }}
        >
          <div className="confirm-summary">
            <KV k="장치" v={b.device_id} mono />
            <KV k="함체" v={`${b.site_name ?? ''} ${b.cabinet_code ?? ''}`} />
            <KV k="채널" v={`CH${power.ch.ch} ${power.ch.name || ''} (${label(ROLE_LABEL, power.ch.role)}, ${power.ch.contact})`} />
            <KV k="명령" v={label(COMMAND_TYPE_LABEL, power.type) + (power.type === 'power_cycle' ? ` · ${power.offSec}초 차단 후 공급` : '')} />
          </div>
          {power.ch.shared && power.type !== 'power_on' ? (
            <div className="banner banner-err">
              공유 장비 채널입니다. 이 채널 뒤에 연결된 <b>모든 카메라의 전원이 꺼집니다.</b> 요청 후 <b>다른 승인자의 2차 승인</b>이 있어야 실행되며 승인 유효시간은 10분입니다.
            </div>
          ) : power.ch.shared ? (
            <div className="banner banner-warn">공유 장비 채널입니다. 이 채널 뒤의 모든 카메라 전원에 영향을 줍니다.</div>
          ) : null}
          {!b.online ? <div className="banner banner-warn">장치가 오프라인입니다. 명령이 전달되지 않고 응답 없음(timeout)으로 끝날 수 있습니다.</div> : null}
        </StepUpDialog>
      ) : null}

      {alarmReq ? (
        <AlarmOutDialog
          req={alarmReq}
          onClose={() => setAlarmReq(null)}
          onSubmit={async (duration, reason) => {
            await send('alarm_out', { output: alarmReq.output, on: alarmReq.on, duration_s: alarmReq.on ? duration : 0 }, reason);
          }}
        />
      ) : null}
    </div>
  );
}

function eventText(e: DeviceEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'input_change':
      return `${label(INPUT_LABEL, String(d.input ?? ''))} ${d.value === true ? '발생' : d.value === false ? '해제' : ''}`;
    case 'shock':
      return d.peak_g !== undefined ? `최대 ${String(d.peak_g)} g` : '충격 감지';
    case 'tilt':
      return d.tilt_deg !== undefined ? `기울기 ${String(d.tilt_deg)}°` : '기울기 감지';
    case 'env_alarm':
      return `${label(ENV_KIND_LABEL, String(d.kind ?? ''))} ${d.value ?? ''} (기준 ${d.threshold ?? '—'})`;
    case 'boot':
      return `부팅 사유 ${String(d.boot_reason ?? '—')}, FW ${String(d.fw ?? '—')}`;
    case 'sensor_fault':
      return `센서 ${String(d.sensor ?? '—')}`;
    case 'recovery':
      return `대상 ${String(d.target_ip ?? '—')}${d.ch != null ? ` CH${String(d.ch)}` : ''} · ${String(d.step ?? '')} · ${String(d.result ?? '')}`;
    case 'local_action':
      return `${String(d.action ?? '')}${d.ch != null ? ` CH${String(d.ch)}` : ''} · ${String(d.reason ?? '')}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d) : '';
  }
}

function AlarmOutDialog({
  req,
  onClose,
  onSubmit,
}: {
  req: AlarmReq;
  onClose: () => void;
  onSubmit: (duration: number, reason: string) => Promise<void>;
}) {
  const [duration, setDuration] = useState('60');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const name = req.output === 'siren' ? '사이렌' : '경광등';
  const d = Number(duration);
  const valid = !req.on || (Number.isInteger(d) && d >= 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(d, reason.trim());
      onClose();
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }
  return (
    <Modal title={`${name} ${req.on ? '켜기' : '끄기'}`} onClose={() => !busy && onClose()}>
      <form className="form" onSubmit={submit}>
        {req.on ? (
          <label className="field">
            <span>동작 시간(초, 0 = 끌 때까지 계속)</span>
            <input type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
        ) : null}
        <label className="field">
          <span>사유</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <InlineError error={err} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className={'btn ' + (req.on ? 'btn-warn' : 'btn-primary')} disabled={busy || !valid}>
            {busy ? '전송 중…' : `${name} ${req.on ? '켜기' : '끄기'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
