/**
 * 이음전력 진단 - 독립 계산 엔진
 * AI와 완전히 분리된 수학/규칙 기반 계산
 * 모든 가정은 사용자 확인 가능해야 함
 */

export type Phase = "SINGLE" | "THREE";
export type DeviceStatus = "CURRENT" | "PLANNED";
export type SourceType = "NAMEPLATE" | "MANUAL" | "MEASURED" | "REFERENCE";

export interface DeviceInput {
  id: string;
  name: string;
  powerW: number; // 전기 입력 소비전력 (W). 이미 입력이면 효율로 나누지 않음
  quantity: number;
  powerFactor: number; // 0~1
  voltage: number; // V
  phase: Phase;
  /** 시나리오별 동시사용 계수 (0~1). 중복 적용 금지 */
  simultaneousFactor: number;
  status: DeviceStatus;
  isMotor?: boolean;
  startingCurrentA?: number;
  circuitId?: string | null;
  source: SourceType;
}

export interface CircuitInput {
  id: string;
  name: string;
  breakerRatedA: number | null;
  breakerSettingA: number | null; // 조정형 실제 설정값
  phaseAssignment?: string | null; // R / S / T / unknown
}

export interface PanelInput {
  id: string;
  mainBreakerRatedA: number | null;
  mainBreakerSettingA: number | null;
  circuits: CircuitInput[];
}

export interface PlaceContract {
  contractPowerKw: number | null;
  supplyVoltage: number; // 기본 220
  phase: Phase;
  isDirectKepco: boolean; // false면 건물 관리주체 배정
  contractKind?: string;
}

export type ResultStatus =
  | "SUFFICIENT"
  | "CONTRACT_INCREASE_REVIEW"
  | "WIRING_BREAKER_REVIEW"
  | "BOTH_REVIEW"
  | "INSUFFICIENT_INFO"
  | "EXPERT_REQUIRED";

export const RESULT_STATUS_LABEL: Record<ResultStatus, string> = {
  SUFFICIENT: "입력 조건상 여유 있음",
  CONTRACT_INCREASE_REVIEW: "계약전력 증설 검토",
  WIRING_BREAKER_REVIEW: "배선·차단기·회로 개선 검토",
  BOTH_REVIEW: "계약전력 및 설비 개선 동시 검토",
  INSUFFICIENT_INFO: "정보 부족으로 판단 보류",
  EXPERT_REQUIRED: "현장 전문가 확인 필요",
};

export interface ScenarioResult {
  name: string;
  key: string;
  powerW: number;
  powerKw: number;
  currentA: number;
}

export interface CircuitLoad {
  circuitId: string;
  circuitName: string;
  powerW: number;
  currentA: number;
  breakerA: number | null;
  utilization: number | null; // 사용률
  overload: boolean;
  devices: string[];
}

export interface DiagnosisResult {
  status: ResultStatus;
  statusLabel: string;
  currentPeakKw: number;
  plannedPeakKw: number;
  technicalNeedKw: number;
  contractPowerKw: number | null;
  additionalIncreaseKw: number | null;
  scenarios: ScenarioResult[];
  circuitLoads: CircuitLoad[];
  mainBreakerCheck: {
    ratedA: number | null;
    settingA: number | null;
    estimatedCurrentA: number;
    utilization: number | null;
    note: string;
  };
  warnings: string[];
  missingItems: string[];
  assumptions: Record<string, number | string | boolean>;
  nextActions: string[];
  calculationVersion: string;
}

const CALC_VERSION = "1.0.0-2026-11";

/** 단상 전류 */
export function singlePhaseCurrentA(powerW: number, voltage: number, pf: number): number {
  if (voltage <= 0 || pf <= 0) return 0;
  return powerW / (voltage * pf);
}

/** 평형 삼상 전류 */
export function threePhaseCurrentA(powerW: number, lineVoltage: number, pf: number): number {
  if (lineVoltage <= 0 || pf <= 0) return 0;
  return powerW / (Math.SQRT2 * Math.sqrt(2) * lineVoltage * pf); // √3 ≈ 1.732
  // 정확한 √3
  // return powerW / (Math.sqrt(3) * lineVoltage * pf);
}

export function calcCurrentA(
  powerW: number,
  voltage: number,
  pf: number,
  phase: Phase
): number {
  if (phase === "THREE") {
    return powerW / (Math.sqrt(3) * voltage * pf);
  }
  return singlePhaseCurrentA(powerW, voltage, pf);
}

export function calcDevicePowerW(d: DeviceInput): number {
  return Math.max(0, d.powerW) * Math.max(1, d.quantity);
}

/**
 * 시나리오 전력 합산
 * simultaneousFactor는 이미 시나리오에 맞게 설정된 값만 사용 (중복 적용 금지)
 */
export function calcScenarioPowerW(devices: DeviceInput[]): number {
  return devices.reduce((sum, d) => sum + calcDevicePowerW(d) * clamp01(d.simultaneousFactor), 0);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 결과 상태 판정
 * - 계약전력과 설비 수용능력을 명확히 구분
 * - 건물 관리 전기는 한전 증설과 다른 경로
 */
export function determineResultStatus(params: {
  contractPowerKw: number | null;
  plannedPeakKw: number;
  hasCircuitOverload: boolean;
  mainBreakerOverloaded: boolean;
  missingCritical: boolean;
  isDirectKepco: boolean;
  hasAnyDevice: boolean;
}): ResultStatus {
  if (!params.hasAnyDevice) return "INSUFFICIENT_INFO";
  if (params.missingCritical) return "INSUFFICIENT_INFO";

  // 건물 관리주체 배정인 경우 계약전력 정보가 없으면 전문가 확인
  if (!params.isDirectKepco && params.contractPowerKw == null) {
    return "EXPERT_REQUIRED";
  }

  const margin = 0.95; // 95% 이상이면 검토
  const needContract =
    params.contractPowerKw != null &&
    params.plannedPeakKw > params.contractPowerKw * margin;

  const needWiring = params.hasCircuitOverload || params.mainBreakerOverloaded;

  if (needContract && needWiring) return "BOTH_REVIEW";
  if (needContract) return "CONTRACT_INCREASE_REVIEW";
  if (needWiring) return "WIRING_BREAKER_REVIEW";
  return "SUFFICIENT";
}

/**
 * 메인 진단 함수
 */
export function runDiagnosis(input: {
  contract: PlaceContract;
  devices: DeviceInput[];
  panel?: PanelInput | null;
  /** 사용자가 확인한 가정 */
  assumptions?: {
    diversityFactor?: number; // 전체 여유 계수 (기본 1.0 = 적용 안 함)
    safetyMargin?: number; // 기술적 필요용량 여유 (기본 1.1)
  };
}): DiagnosisResult {
  const { contract, devices, panel } = input;
  const assumptions = {
    diversityFactor: input.assumptions?.diversityFactor ?? 1.0,
    safetyMargin: input.assumptions?.safetyMargin ?? 1.1,
  };

  const warnings: string[] = [];
  const missingItems: string[] = [];
  const nextActions: string[] = [];

  const currentDevices = devices.filter((d) => d.status === "CURRENT");
  const plannedDevices = devices; // CURRENT + PLANNED

  // 시나리오별 동시사용 계수 설정 예시 (실제로는 UI에서 사용자가 조정)
  // 여기서는 단순화: CURRENT는 0.85, PLANNED 포함 max는 1.0 가정
  const makeScenarioDevices = (
    list: DeviceInput[],
    factor: number
  ): DeviceInput[] =>
    list.map((d) => ({ ...d, simultaneousFactor: factor }));

  const scenarios: ScenarioResult[] = [
    {
      name: "현재 일반 사용",
      key: "current_normal",
      ...calcScenario(makeScenarioDevices(currentDevices, 0.7), contract),
    },
    {
      name: "현재 최대 동시 사용",
      key: "current_max",
      ...calcScenario(makeScenarioDevices(currentDevices, 0.95), contract),
    },
    {
      name: "추가 기기 설치 후 일반 사용",
      key: "planned_normal",
      ...calcScenario(makeScenarioDevices(plannedDevices, 0.7), contract),
    },
    {
      name: "추가 기기 설치 후 최대 동시 사용",
      key: "planned_max",
      ...calcScenario(makeScenarioDevices(plannedDevices, 0.95), contract),
    },
    {
      name: "시간대 분산 시 (피크 완화)",
      key: "dispersed",
      ...calcScenario(makeScenarioDevices(plannedDevices, 0.55), contract),
    },
  ];

  const currentPeakKw = scenarios.find((s) => s.key === "current_max")?.powerKw ?? 0;
  const plannedPeakKw = scenarios.find((s) => s.key === "planned_max")?.powerKw ?? 0;
  const technicalNeedKw = plannedPeakKw * assumptions.safetyMargin;

  // 회로별 부하
  const circuitLoads = buildCircuitLoads(plannedDevices, panel, contract);

  const hasCircuitOverload = circuitLoads.some((c) => c.overload);

  // 주차단기 검토
  const mainRated = panel?.mainBreakerSettingA ?? panel?.mainBreakerRatedA ?? null;
  const estCurrent = calcCurrentA(
    plannedPeakKw * 1000,
    contract.supplyVoltage,
    0.9,
    contract.phase
  );
  const mainUtil =
    mainRated && mainRated > 0 ? estCurrent / mainRated : null;
  const mainOverloaded = mainUtil != null && mainUtil > 0.9;

  if (mainOverloaded) {
    warnings.push(
      "주차단기 예상 부하율이 90%를 초과합니다. 차단기만 교체하지 말고 간선·상위 설비와 함께 검토하세요."
    );
  }

  if (hasCircuitOverload) {
    warnings.push(
      "특정 분기회로에 부하가 집중되어 있습니다. 전체 용량에 여유가 있어도 해당 회로 개선 또는 전용회로 신설이 필요할 수 있습니다."
    );
  }

  // 정보 부족 체크
  if (contract.contractPowerKw == null && contract.isDirectKepco) {
    missingItems.push("계약전력(kW)");
  }
  if (!panel || (panel.mainBreakerRatedA == null && panel.mainBreakerSettingA == null)) {
    missingItems.push("주차단기 정격/설정값");
  }
  if (devices.length === 0) {
    missingItems.push("사용 기기 정보");
  }
  const unknownSource = devices.filter((d) => d.source === "REFERENCE");
  if (unknownSource.length > 0) {
    warnings.push(
      `참고값으로 입력된 기기가 ${unknownSource.length}대 있습니다. 명판 또는 실측값을 우선 반영하세요.`
    );
  }

  const missingCritical =
    devices.length === 0 ||
    (contract.isDirectKepco && contract.contractPowerKw == null && plannedPeakKw > 0);

  const status = determineResultStatus({
    contractPowerKw: contract.contractPowerKw,
    plannedPeakKw,
    hasCircuitOverload,
    mainBreakerOverloaded: mainOverloaded,
    missingCritical,
    isDirectKepco: contract.isDirectKepco,
    hasAnyDevice: devices.length > 0,
  });

  // 추가 증설 검토량 (기술적 필요 - 현재 계약). 약관 결정값이 아님
  let additionalIncreaseKw: number | null = null;
  if (contract.contractPowerKw != null && technicalNeedKw > contract.contractPowerKw) {
    additionalIncreaseKw = Math.ceil((technicalNeedKw - contract.contractPowerKw) * 10) / 10;
  }

  // 다음 행동
  if (status === "SUFFICIENT") {
    nextActions.push("현재 입력 조건에서는 여유 있는 것으로 보입니다. 실제 동시 사용 패턴을 확인해 주세요.");
  }
  if (status === "CONTRACT_INCREASE_REVIEW" || status === "BOTH_REVIEW") {
    if (contract.isDirectKepco) {
      nextActions.push("한전 계약전력 증설 가능 여부 및 표준시설부담금을 확인하세요.");
    } else {
      nextActions.push("건물 관리주체(또는 소유주)에 배정 용량 증설 가능 여부를 문의하세요. 한전 직접 신청과 절차가 다릅니다.");
    }
  }
  if (status === "WIRING_BREAKER_REVIEW" || status === "BOTH_REVIEW") {
    nextActions.push("분전반·간선·분기회로에 대한 현장 전문가 검토를 권장합니다.");
  }
  if (status === "INSUFFICIENT_INFO" || status === "EXPERT_REQUIRED") {
    nextActions.push("부족한 정보를 보완하거나 현장 계측·전문가 확인 후 다시 진단하세요.");
  }
  nextActions.push("기동전류가 큰 모터·에어컨 등은 정상 운전전력과 별도로 검토하세요.");
  nextActions.push("이 결과는 입력 조건에 따른 기술적 검토이며, 한전 약관상 최종 계약전력 결정값이나 법적 적합성을 확정하지 않습니다.");

  return {
    status,
    statusLabel: RESULT_STATUS_LABEL[status],
    currentPeakKw: round1(currentPeakKw),
    plannedPeakKw: round1(plannedPeakKw),
    technicalNeedKw: round1(technicalNeedKw),
    contractPowerKw: contract.contractPowerKw,
    additionalIncreaseKw,
    scenarios,
    circuitLoads,
    mainBreakerCheck: {
      ratedA: panel?.mainBreakerRatedA ?? null,
      settingA: panel?.mainBreakerSettingA ?? null,
      estimatedCurrentA: round1(estCurrent),
      utilization: mainUtil != null ? round1(mainUtil * 100) : null,
      note:
        mainRated == null
          ? "주차단기 정보가 없어 설비 수용능력 판정을 보류합니다."
          : mainOverloaded
          ? "주차단기 여유 부족 가능성. 차단기 단독 교체 권고 금지."
          : "주차단기 입력 조건상 여유 있음 (추정).",
    },
    warnings,
    missingItems,
    assumptions: {
      ...assumptions,
      note: "운전계수·동시사용률은 사용자가 수정할 수 있습니다. 중복 적용하지 않습니다.",
    },
    nextActions,
    calculationVersion: CALC_VERSION,
  };
}

function calcScenario(
  devices: DeviceInput[],
  contract: PlaceContract
): { powerW: number; powerKw: number; currentA: number } {
  const powerW = calcScenarioPowerW(devices);
  const powerKw = powerW / 1000;
  const avgPf =
    devices.length > 0
      ? devices.reduce((s, d) => s + d.powerFactor, 0) / devices.length
      : 0.9;
  const currentA = calcCurrentA(powerW, contract.supplyVoltage, avgPf, contract.phase);
  return {
    powerW: Math.round(powerW),
    powerKw: round1(powerKw),
    currentA: round1(currentA),
  };
}

function buildCircuitLoads(
  devices: DeviceInput[],
  panel: PanelInput | null | undefined,
  contract: PlaceContract
): CircuitLoad[] {
  if (!panel || !panel.circuits.length) {
    // 미확인 회로로 전체 묶음
    const powerW = calcScenarioPowerW(
      devices.map((d) => ({ ...d, simultaneousFactor: 0.95 }))
    );
    return [
      {
        circuitId: "unknown",
        circuitName: "미확인 회로",
        powerW: Math.round(powerW),
        currentA: round1(
          calcCurrentA(powerW, contract.supplyVoltage, 0.9, contract.phase)
        ),
        breakerA: null,
        utilization: null,
        overload: false,
        devices: devices.map((d) => d.name),
      },
    ];
  }

  const map = new Map<string, DeviceInput[]>();
  for (const d of devices) {
    const cid = d.circuitId || "unknown";
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid)!.push(d);
  }

  const loads: CircuitLoad[] = [];
  for (const circuit of panel.circuits) {
    const list = map.get(circuit.id) || [];
    const powerW = calcScenarioPowerW(
      list.map((d) => ({ ...d, simultaneousFactor: 0.95 }))
    );
    const currentA = calcCurrentA(
      powerW,
      contract.supplyVoltage,
      0.9,
      contract.phase
    );
    const breakerA = circuit.breakerSettingA ?? circuit.breakerRatedA;
    const util = breakerA && breakerA > 0 ? currentA / breakerA : null;
    loads.push({
      circuitId: circuit.id,
      circuitName: circuit.name || "이름 없음",
      powerW: Math.round(powerW),
      currentA: round1(currentA),
      breakerA,
      utilization: util != null ? round1(util * 100) : null,
      overload: util != null && util > 0.9,
      devices: list.map((d) => d.name),
    });
  }

  // 미할당 기기
  const unknownList = map.get("unknown") || [];
  if (unknownList.length > 0) {
    const powerW = calcScenarioPowerW(
      unknownList.map((d) => ({ ...d, simultaneousFactor: 0.95 }))
    );
    loads.push({
      circuitId: "unknown",
      circuitName: "미확인 회로",
      powerW: Math.round(powerW),
      currentA: round1(
        calcCurrentA(powerW, contract.supplyVoltage, 0.9, contract.phase)
      ),
      breakerA: null,
      utilization: null,
      overload: false,
      devices: unknownList.map((d) => d.name),
    });
  }

  return loads;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 한전 표준시설부담금 개략 계산 (예시)
 * 실제 적용 전 반드시 최신 약관·단가표 확인 필요
 * 관리자가 RateVersion으로 관리해야 함
 */
export function estimateKepcoFacilityCharge(params: {
  existingKw: number;
  newKw: number;
  isUnderground: boolean;
  isLowVoltage: boolean;
}): {
  amount: number | null;
  detail: string;
  status: "example" | "needs_confirm";
  note: string;
} {
  const increase = Math.max(0, params.newKw - params.existingKw);
  if (increase <= 0) {
    return {
      amount: 0,
      detail: "증설분 없음",
      status: "example",
      note: "예시 계산입니다. 한전 최종 산정 전입니다.",
    };
  }

  // 2023~ 공개된 예시 단가 (부가세 별도). 실제 적용일·단가는 변동됨
  // 저압 공중: 5kW까지 기본 + 초과 1kW
  // 이 값은 참고용이며 관리자 확인 필요
  const rates = params.isUnderground
    ? { base5: 588000, perKw: 141000 } // 지중 예시
    : { base5: 306000, perKw: 121000 }; // 공중 예시

  let amount = 0;
  let detail = "";

  if (params.isLowVoltage) {
    // 단순화: 증설분만 초과 단가 적용 (실제는 기존 계약 구조에 따라 다름)
    if (params.existingKw < 5) {
      const to5 = Math.min(increase, 5 - params.existingKw);
      // 기본 구간 처리는 복잡하므로 여기서는 초과 단가만 개략
      amount = increase * rates.perKw;
      detail = `저압 ${params.isUnderground ? "지중" : "공중"} 증설 ${increase}kW × 예시단가 ${rates.perKw.toLocaleString()}원 (단순 개략)`;
    } else {
      amount = increase * rates.perKw;
      detail = `저압 증설 ${increase}kW × 예시단가 ${rates.perKw.toLocaleString()}원`;
    }
  } else {
    amount = increase * (params.isUnderground ? 50000 : 24000);
    detail = `고압/특고 증설 ${increase}kW × 예시단가`;
  }

  return {
    amount: Math.round(amount),
    detail,
    status: "needs_confirm",
    note: "이 금액은 공개된 과거 단가표를 참고한 예시입니다. 실제 표준시설부담금은 한전 약관·거리·공급방식·신청 시점에 따라 달라지며, 한전 최종 산정 전입니다. 관리자 요율 버전을 확인하세요.",
  };
}
