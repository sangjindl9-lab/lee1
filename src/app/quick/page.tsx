"use client";

import { useState } from "react";
import {
  runDiagnosis,
  RESULT_STATUS_LABEL,
  type DeviceInput,
  type PlaceContract,
  type DiagnosisResult,
  estimateKepcoFacilityCharge,
} from "@/lib/calculation-engine";

const SAMPLE_DEVICES = [
  { name: "에어컨 (가정용)", powerW: 1800, phase: "SINGLE" as const },
  { name: "인덕션 3구", powerW: 3300, phase: "SINGLE" as const },
  { name: "전기온수기", powerW: 3000, phase: "SINGLE" as const },
  { name: "냉장고", powerW: 150, phase: "SINGLE" as const },
  { name: "세탁기", powerW: 500, phase: "SINGLE" as const },
  { name: "전기차 충전기 7kW", powerW: 7000, phase: "SINGLE" as const },
  { name: "커피머신 (카페)", powerW: 2500, phase: "SINGLE" as const },
  { name: "튀김기", powerW: 4000, phase: "SINGLE" as const },
];

export default function QuickPage() {
  const [contractKw, setContractKw] = useState<string>("5");
  const [isDirectKepco, setIsDirectKepco] = useState(true);
  const [voltage, setVoltage] = useState(220);
  const [phase, setPhase] = useState<"SINGLE" | "THREE">("SINGLE");
  const [mainBreakerA, setMainBreakerA] = useState<string>("30");
  const [devices, setDevices] = useState<
    { name: string; powerW: number; quantity: number; status: "CURRENT" | "PLANNED" }[]
  >([
    { name: "에어컨", powerW: 1800, quantity: 1, status: "CURRENT" },
    { name: "냉장고", powerW: 150, quantity: 1, status: "CURRENT" },
    { name: "인덕션", powerW: 3300, quantity: 1, status: "PLANNED" },
  ]);
  const [newName, setNewName] = useState("");
  const [newPower, setNewPower] = useState("");
  const [newStatus, setNewStatus] = useState<"CURRENT" | "PLANNED">("PLANNED");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [kepco, setKepco] = useState<ReturnType<typeof estimateKepcoFacilityCharge> | null>(null);

  function addDevice() {
    const p = parseFloat(newPower);
    if (!newName.trim() || !p || p <= 0) return;
    setDevices((d) => [
      ...d,
      { name: newName.trim(), powerW: p, quantity: 1, status: newStatus },
    ]);
    setNewName("");
    setNewPower("");
  }

  function addSample(s: (typeof SAMPLE_DEVICES)[0]) {
    setDevices((d) => [
      ...d,
      { name: s.name, powerW: s.powerW, quantity: 1, status: "PLANNED" },
    ]);
  }

  function removeDevice(i: number) {
    setDevices((d) => d.filter((_, idx) => idx !== i));
  }

  function run() {
    const contract: PlaceContract = {
      contractPowerKw: contractKw === "" ? null : parseFloat(contractKw),
      supplyVoltage: voltage,
      phase,
      isDirectKepco,
    };

    const deviceInputs: DeviceInput[] = devices.map((d, i) => ({
      id: `d-${i}`,
      name: d.name,
      powerW: d.powerW,
      quantity: d.quantity,
      powerFactor: 0.9,
      voltage,
      phase,
      simultaneousFactor: 0.95,
      status: d.status,
      source: "MANUAL",
    }));

    const panel = {
      id: "p1",
      mainBreakerRatedA: mainBreakerA ? parseFloat(mainBreakerA) : null,
      mainBreakerSettingA: mainBreakerA ? parseFloat(mainBreakerA) : null,
      circuits: [
        {
          id: "c1",
          name: "주회로(통합)",
          breakerRatedA: mainBreakerA ? parseFloat(mainBreakerA) : null,
          breakerSettingA: mainBreakerA ? parseFloat(mainBreakerA) : null,
        },
      ],
    };

    // 회로에 기기 연결 (단순화)
    deviceInputs.forEach((d) => {
      d.circuitId = "c1";
    });

    const diag = runDiagnosis({
      contract,
      devices: deviceInputs,
      panel,
      assumptions: { safetyMargin: 1.1 },
    });
    setResult(diag);

    if (contract.contractPowerKw != null && diag.additionalIncreaseKw != null) {
      setKepco(
        estimateKepcoFacilityCharge({
          existingKw: contract.contractPowerKw,
          newKw: contract.contractPowerKw + diag.additionalIncreaseKw,
          isUnderground: false,
          isLowVoltage: true,
        })
      );
    } else {
      setKepco(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">무료 간편 계산</h1>
        <p className="text-sm text-slate-600 mt-1">
          로그인 없이 바로 검토할 수 있습니다. 결과는 입력 조건에 따른 기술적 검토이며, 한전 최종 산정·법적 적합성을 확정하지 않습니다.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 입력 */}
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="font-semibold">계약·공급 정보</h2>
            <div>
              <label className="label">계약전력 (kW) — 모르면 비워두세요</label>
              <input
                className="input"
                type="number"
                step="0.1"
                value={contractKw}
                onChange={(e) => setContractKw(e.target.value)}
                placeholder="예: 5"
              />
            </div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={isDirectKepco}
                  onChange={() => setIsDirectKepco(true)}
                />
                한전 직접 계약
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!isDirectKepco}
                  onChange={() => setIsDirectKepco(false)}
                />
                건물 관리비 납부 (아파트·호실 등)
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">공급전압 (V)</label>
                <select
                  className="input"
                  value={voltage}
                  onChange={(e) => setVoltage(Number(e.target.value))}
                >
                  <option value={220}>220</option>
                  <option value={380}>380</option>
                </select>
              </div>
              <div>
                <label className="label">상</label>
                <select
                  className="input"
                  value={phase}
                  onChange={(e) => setPhase(e.target.value as any)}
                >
                  <option value="SINGLE">단상</option>
                  <option value="THREE">삼상</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">주차단기 정격/설정 (A) — 모르면 비워두세요</label>
              <input
                className="input"
                type="number"
                value={mainBreakerA}
                onChange={(e) => setMainBreakerA(e.target.value)}
                placeholder="예: 30"
              />
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="font-semibold">기기 목록</h2>
            <ul className="space-y-2 text-sm">
              {devices.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                >
                  <span>
                    <span
                      className={`badge mr-2 ${
                        d.status === "CURRENT"
                          ? "bg-slate-200 text-slate-700"
                          : "bg-teal-100 text-teal-800"
                      }`}
                    >
                      {d.status === "CURRENT" ? "현재" : "추가예정"}
                    </span>
                    {d.name} · {d.powerW}W × {d.quantity}
                  </span>
                  <button
                    type="button"
                    className="text-red-600 text-xs"
                    onClick={() => removeDevice(i)}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="기기명"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className="input"
                type="number"
                placeholder="소비전력 W"
                value={newPower}
                onChange={(e) => setNewPower(e.target.value)}
              />
            </div>
            <div className="flex gap-2 items-center">
              <select
                className="input w-auto"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as any)}
              >
                <option value="CURRENT">현재 사용</option>
                <option value="PLANNED">추가 예정</option>
              </select>
              <button type="button" className="btn-secondary" onClick={addDevice}>
                기기 추가
              </button>
            </div>

            <div className="pt-2">
              <p className="text-xs text-slate-500 mb-1">빠른 추가 (참고값 — 명판·실측 우선)</p>
              <div className="flex flex-wrap gap-1">
                {SAMPLE_DEVICES.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className="text-xs rounded border border-slate-200 px-2 py-1 hover:bg-slate-50"
                    onClick={() => addSample(s)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button type="button" className="btn-primary w-full py-3" onClick={run}>
            진단 실행
          </button>
        </div>

        {/* 결과 */}
        <div className="space-y-4">
          {!result && (
            <div className="card p-8 text-center text-slate-500 text-sm">
              왼쪽에서 정보를 입력하고 「진단 실행」을 누르세요.
            </div>
          )}

          {result && (
            <>
              <div className="card p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-lg">진단 결과</h2>
                  <span className={`badge status-${result.status}`}>
                    {result.statusLabel}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-slate-500 text-xs">현재 계약전력</div>
                    <div className="font-semibold text-lg">
                      {result.contractPowerKw != null
                        ? `${result.contractPowerKw} kW`
                        : "미입력"}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-slate-500 text-xs">추가 후 예상 최대 동시</div>
                    <div className="font-semibold text-lg">{result.plannedPeakKw} kW</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-slate-500 text-xs">현재 예상 최대 동시</div>
                    <div className="font-semibold">{result.currentPeakKw} kW</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-slate-500 text-xs">기술적 필요용량 (여유 포함)</div>
                    <div className="font-semibold">{result.technicalNeedKw} kW</div>
                  </div>
                </div>

                {result.additionalIncreaseKw != null && (
                  <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                    추가 증설 검토량(기술): 약 {result.additionalIncreaseKw} kW
                    <br />
                    <span className="text-xs">
                      이 값은 기술적 검토값입니다. 한전 약관상 계약전력 결정값과 다를 수 있습니다.
                    </span>
                  </p>
                )}

                <div className="text-sm space-y-1">
                  <p className="font-medium">주차단기 검토</p>
                  <p className="text-slate-600">{result.mainBreakerCheck.note}</p>
                  {result.mainBreakerCheck.utilization != null && (
                    <p className="text-xs text-slate-500">
                      예상 전류 {result.mainBreakerCheck.estimatedCurrentA} A /
                      설정 {result.mainBreakerCheck.settingA ?? result.mainBreakerCheck.ratedA} A
                      (부하율 약 {result.mainBreakerCheck.utilization}%)
                    </p>
                  )}
                </div>
              </div>

              <div className="card p-4 space-y-2">
                <h3 className="font-semibold text-sm">시나리오별 예상 전력</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 text-xs">
                      <th className="py-1">시나리오</th>
                      <th>전력</th>
                      <th>전류(추정)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.scenarios.map((s) => (
                      <tr key={s.key} className="border-t border-slate-100">
                        <td className="py-1.5">{s.name}</td>
                        <td>{s.powerKw} kW</td>
                        <td>{s.currentA} A</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.circuitLoads.length > 0 && (
                <div className="card p-4 space-y-2">
                  <h3 className="font-semibold text-sm">회로별 주의</h3>
                  {result.circuitLoads.map((c) => (
                    <div
                      key={c.circuitId}
                      className={`text-sm rounded-lg px-3 py-2 ${
                        c.overload ? "bg-red-50 text-red-900" : "bg-slate-50"
                      }`}
                    >
                      <div className="font-medium">
                        {c.circuitName}
                        {c.overload && " — 과부하 가능성"}
                      </div>
                      <div className="text-xs text-slate-600">
                        {c.powerW} W · {c.currentA} A
                        {c.breakerA != null && ` / 차단기 ${c.breakerA} A`}
                        {c.utilization != null && ` (부하율 ${c.utilization}%)`}
                      </div>
                      {c.devices.length > 0 && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          연결: {c.devices.join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {kepco && (
                <div className="card p-4 space-y-1">
                  <h3 className="font-semibold text-sm">한전 예상 납부금 (예시)</h3>
                  <p className="text-lg font-semibold">
                    {kepco.amount != null
                      ? `${kepco.amount.toLocaleString()} 원`
                      : "계산 불가"}
                  </p>
                  <p className="text-xs text-slate-600">{kepco.detail}</p>
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">
                    {kepco.note}
                  </p>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="card p-4 space-y-1">
                  <h3 className="font-semibold text-sm text-amber-800">주의 사항</h3>
                  <ul className="text-sm text-slate-700 list-disc pl-4 space-y-1">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.missingItems.length > 0 && (
                <div className="card p-4 space-y-1">
                  <h3 className="font-semibold text-sm">부족한 정보</h3>
                  <p className="text-sm text-slate-600">
                    {result.missingItems.join(", ")}
                  </p>
                </div>
              )}

              <div className="card p-4 space-y-1">
                <h3 className="font-semibold text-sm">다음으로 확인할 것</h3>
                <ul className="text-sm text-slate-700 list-disc pl-4 space-y-1">
                  {result.nextActions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                <p className="text-xs text-slate-400 pt-2">
                  계산 규칙 버전: {result.calculationVersion}
                </p>
              </div>

              <div className="card p-4 bg-slate-50 text-xs text-slate-600 space-y-1">
                <p>
                  <strong>구분 안내</strong>
                </p>
                <p>· 계약전력: 한전/관리주체와 계약·배정된 값</p>
                <p>· 예상 사용전력: 기기와 동시사용 조건으로 계산한 값</p>
                <p>· 설비 수용능력: 차단기·배선 등이 감당할 수 있는 범위</p>
                <p className="pt-1">
                  “승압”은 계약전력 증설, 공급전압 변경, 단상/삼상 변경, 간선·분전반 개선을
                  각각 구분하여 검토해야 합니다.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
