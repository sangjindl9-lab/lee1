/**
 * 간단한 파일 기반 저장소 (데모용)
 * 실제 운영에서는 Prisma + PostgreSQL 사용
 */

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

function ensureDir() {
  if (typeof window !== "undefined") return; // 클라이언트 방지
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson<T>(file: string, fallback: T): T {
  if (typeof window !== "undefined") return fallback;
  ensureDir();
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  if (typeof window !== "undefined") return;
  ensureDir();
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf-8");
}

function uid() {
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

export type Role = "USER" | "CONTRACTOR" | "REVIEWER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  role: Role;
  companyName?: string;
}

export interface Place {
  id: string;
  userId: string;
  name: string;
  address: string;
  buildingUse: string;
  areaM2?: number;
  isDirectKepco: boolean;
  contractKind: string;
  contractPowerKw: number | null;
  supplyVoltage: number;
  phase: "SINGLE" | "THREE";
  isRental: boolean;
  needsManagerConsult: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  placeId: string;
  name: string;
  manufacturer?: string;
  model?: string;
  quantity: number;
  powerW: number;
  ratedCurrentA?: number;
  voltage: number;
  phase: "SINGLE" | "THREE";
  powerFactor: number;
  status: "CURRENT" | "PLANNED";
  source: "NAMEPLATE" | "MANUAL" | "MEASURED" | "REFERENCE";
  circuitId?: string | null;
  simultaneousFactor: number;
  isMotor?: boolean;
  startingCurrentA?: number;
  notes?: string;
}

export interface Panel {
  id: string;
  placeId: string;
  name: string;
  mainBreakerRatedA: number | null;
  mainBreakerSettingA: number | null;
  mainBreakerModel?: string;
  circuits: {
    id: string;
    name: string;
    breakerRatedA: number | null;
    breakerSettingA: number | null;
  }[];
}

export interface DiagnosisRecord {
  id: string;
  placeId: string;
  result: any;
  createdAt: string;
}

export function getUsers(): User[] {
  return readJson<User[]>("users.json", [
    {
      id: "u-admin",
      email: "admin@ieum.power",
      password: "admin1234",
      name: "관리자",
      role: "ADMIN",
    },
    {
      id: "u-user",
      email: "user@ieum.power",
      password: "user1234",
      name: "일반 사용자",
      role: "USER",
    },
    {
      id: "u-contractor",
      email: "pro@ieum.power",
      password: "pro1234",
      name: "전기공사업체",
      role: "CONTRACTOR",
      companyName: "이음전기",
    },
  ]);
}

export function findUserByEmail(email: string): User | undefined {
  return getUsers().find((u) => u.email === email);
}

export function getPlaces(userId?: string): Place[] {
  const all = readJson<Place[]>("places.json", []);
  if (!userId) return all;
  return all.filter((p) => p.userId === userId);
}

export function getPlace(id: string): Place | undefined {
  return getPlaces().find((p) => p.id === id);
}

export function savePlace(place: Place): Place {
  const all = getPlaces();
  const idx = all.findIndex((p) => p.id === place.id);
  if (idx >= 0) all[idx] = place;
  else all.push(place);
  writeJson("places.json", all);
  return place;
}

export function createPlace(
  data: Omit<Place, "id" | "createdAt" | "updatedAt">
): Place {
  const now = new Date().toISOString();
  const place: Place = {
    ...data,
    id: uid(),
    createdAt: now,
    updatedAt: now,
  };
  return savePlace(place);
}

export function getDevices(placeId: string): Device[] {
  const all = readJson<Device[]>("devices.json", []);
  return all.filter((d) => d.placeId === placeId);
}

export function saveDevice(device: Device): Device {
  const all = readJson<Device[]>("devices.json", []);
  const idx = all.findIndex((d) => d.id === device.id);
  if (idx >= 0) all[idx] = device;
  else all.push(device);
  writeJson("devices.json", all);
  return device;
}

export function createDevice(data: Omit<Device, "id">): Device {
  const device: Device = { ...data, id: uid() };
  return saveDevice(device);
}

export function deleteDevice(id: string) {
  const all = readJson<Device[]>("devices.json", []);
  writeJson(
    "devices.json",
    all.filter((d) => d.id !== id)
  );
}

export function getPanel(placeId: string): Panel | undefined {
  const all = readJson<Panel[]>("panels.json", []);
  return all.find((p) => p.placeId === placeId);
}

export function savePanel(panel: Panel): Panel {
  const all = readJson<Panel[]>("panels.json", []);
  const idx = all.findIndex((p) => p.id === panel.id);
  if (idx >= 0) all[idx] = panel;
  else all.push(panel);
  writeJson("panels.json", all);
  return panel;
}

export function createPanel(data: Omit<Panel, "id">): Panel {
  const panel: Panel = { ...data, id: uid() };
  return savePanel(panel);
}

export function saveDiagnosis(placeId: string, result: any): DiagnosisRecord {
  const all = readJson<DiagnosisRecord[]>("diagnoses.json", []);
  const rec: DiagnosisRecord = {
    id: uid(),
    placeId,
    result,
    createdAt: new Date().toISOString(),
  };
  all.unshift(rec);
  writeJson("diagnoses.json", all.slice(0, 50));
  return rec;
}

export function getDiagnoses(placeId: string): DiagnosisRecord[] {
  return readJson<DiagnosisRecord[]>("diagnoses.json", []).filter(
    (d) => d.placeId === placeId
  );
}

export function getServiceConfig() {
  return readJson("config.json", {
    serviceName: "이음전력 진단",
    companyName: "이음전력",
    logoText: "이음전력",
    contact: "문의: contact@ieum.power",
  });
}

export function saveServiceConfig(cfg: Record<string, string>) {
  writeJson("config.json", cfg);
  return cfg;
}
