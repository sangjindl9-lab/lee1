"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type LocalPlace = {
  id: string;
  name: string;
  address: string;
  contractPowerKw: number | null;
  isDirectKepco: boolean;
  buildingUse: string;
};

export default function PlacesPage() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [places, setPlaces] = useState<LocalPlace[]>([]);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contractKw, setContractKw] = useState("");
  const [isDirect, setIsDirect] = useState(true);
  const [use, setUse] = useState("HOUSE");

  useEffect(() => {
    const raw = localStorage.getItem("ieum_user");
    if (raw) setUser(JSON.parse(raw));
    const saved = localStorage.getItem("ieum_places");
    if (saved) setPlaces(JSON.parse(saved));
  }, []);

  function savePlaces(list: LocalPlace[]) {
    setPlaces(list);
    localStorage.setItem("ieum_places", JSON.stringify(list));
  }

  function addPlace(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const p: LocalPlace = {
      id: "p-" + Date.now(),
      name: name.trim(),
      address: address.trim(),
      contractPowerKw: contractKw ? parseFloat(contractKw) : null,
      isDirectKepco: isDirect,
      buildingUse: use,
    };
    savePlaces([...places, p]);
    setName("");
    setAddress("");
    setContractKw("");
  }

  function removePlace(id: string) {
    savePlaces(places.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">내 장소</h1>
          <p className="text-sm text-slate-600">
            {user
              ? `${user.name}님의 장소 목록입니다. (브라우저에 저장)`
              : "로그인하지 않아도 브라우저에 임시 저장됩니다. 로그인하면 계정과 연동하는 구조로 확장할 수 있습니다."}
          </p>
        </div>
        <Link href="/quick" className="btn-secondary text-sm">
          간편 계산
        </Link>
      </div>

      <form onSubmit={addPlace} className="card p-4 space-y-3">
        <h2 className="font-semibold">장소 등록</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">장소명 *</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 우리집, ○○카페" />
          </div>
          <div>
            <label className="label">주소</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div>
            <label className="label">건물 용도</label>
            <select className="input" value={use} onChange={(e) => setUse(e.target.value)}>
              <option value="HOUSE">주택</option>
              <option value="APARTMENT">아파트</option>
              <option value="RESTAURANT">음식점</option>
              <option value="CAFE">카페</option>
              <option value="BEAUTY">미용실</option>
              <option value="OFFICE">사무실</option>
              <option value="WAREHOUSE">창고</option>
              <option value="OTHER">기타</option>
            </select>
          </div>
          <div>
            <label className="label">계약전력 (kW, 모르면 비움)</label>
            <input className="input" type="number" step="0.1" value={contractKw} onChange={(e) => setContractKw(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={isDirect} onChange={() => setIsDirect(true)} />
            한전 직접 계약
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={!isDirect} onChange={() => setIsDirect(false)} />
            건물 관리비 납부
          </label>
        </div>
        {!isDirect && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
            아파트·개별 호실 등은 건물 수전설비와 관리주체 배정용량 확인 절차로 진행합니다. 한전 증설 신청을 동일하게 안내하지 않습니다.
          </p>
        )}
        <button type="submit" className="btn-primary">등록</button>
      </form>

      <div className="space-y-2">
        {places.length === 0 && (
          <p className="text-sm text-slate-500">등록된 장소가 없습니다. 위에서 추가하거나 간편 계산을 이용하세요.</p>
        )}
        {places.map((p) => (
          <div key={p.id} className="card p-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-slate-500">
                {p.address || "주소 없음"} · {p.buildingUse} ·{" "}
                {p.isDirectKepco ? "한전 직접" : "건물 관리"} ·{" "}
                계약 {p.contractPowerKw != null ? `${p.contractPowerKw} kW` : "미입력"}
              </div>
            </div>
            <div className="flex gap-2">
              <Link href={`/quick`} className="btn-secondary text-xs">
                진단
              </Link>
              <button type="button" className="text-xs text-red-600" onClick={() => removePlace(p.id)}>
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
