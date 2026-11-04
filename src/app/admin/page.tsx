"use client";

import { useEffect, useState } from "react";

export default function AdminPage() {
  const [cfg, setCfg] = useState({
    serviceName: "이음전력 진단",
    companyName: "이음전력",
    logoText: "이음전력",
    contact: "문의: contact@ieum.power",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("ieum_config");
    if (raw) setCfg(JSON.parse(raw));
  }, []);

  function save(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem("ieum_config", JSON.stringify(cfg));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">관리자 설정</h1>
      <p className="text-sm text-slate-600">
        서비스명·로고·운영업체 정보를 변경할 수 있습니다. (데모: 브라우저 저장)
      </p>
      <form onSubmit={save} className="card p-6 space-y-4">
        <div>
          <label className="label">서비스명</label>
          <input
            className="input"
            value={cfg.serviceName}
            onChange={(e) => setCfg({ ...cfg, serviceName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">운영업체명</label>
          <input
            className="input"
            value={cfg.companyName}
            onChange={(e) => setCfg({ ...cfg, companyName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">로고 텍스트</label>
          <input
            className="input"
            value={cfg.logoText}
            onChange={(e) => setCfg({ ...cfg, logoText: e.target.value })}
          />
        </div>
        <div>
          <label className="label">연락처</label>
          <input
            className="input"
            value={cfg.contact}
            onChange={(e) => setCfg({ ...cfg, contact: e.target.value })}
          />
        </div>
        <button type="submit" className="btn-primary">저장</button>
        {saved && <p className="text-sm text-teal-700">저장되었습니다.</p>}
      </form>

      <div className="card p-4 text-sm space-y-2">
        <h2 className="font-semibold">요율·단가 관리 (안내)</h2>
        <p className="text-slate-600">
          한전 표준시설부담금·공사 단가는 공식 출처 URL, 적용 시작·종료일, 검토자·검토일을 함께 저장해야 합니다.
          현재 유효한 요율을 확인하지 못하면 「한전 확인 필요」로 표시하며, 미확정 금액을 0원으로 처리하거나 가상 요율을 실제처럼 보여주지 않습니다.
        </p>
        <p className="text-xs text-slate-500">
          실제 운영 시 RateVersion 테이블과 관리자 UI를 연결하세요.
        </p>
      </div>
    </div>
  );
}
