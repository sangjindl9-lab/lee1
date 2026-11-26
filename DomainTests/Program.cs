using System;
using System.Collections.Generic;
using System.IO;
using RebuildCity.Sim;

static class Program
{
    static int failed, passed;

    static void Check(bool cond, string what)
    {
        if (!cond) throw new Exception("검증 실패: " + what);
    }

    static void Run(string name, Action test)
    {
        try { test(); passed++; Console.WriteLine("PASS  " + name); }
        catch (Exception e) { failed++; Console.WriteLine("FAIL  " + name + "\n      " + e.Message); }
    }

    static bool Same(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    /// <summary>매 틱 지켜져야 하는 규칙: 현금=원장, 음수 금지, 재고·예약, 작업자 중복 배치.</summary>
    static void Invariants(WorldState w)
    {
        Check(w.Cash == w.LedgerSum(), "현금과 원장 합계 일치 (tick " + w.Tick + ")");
        Check(w.Cash >= 0, "현금 음수 금지 (tick " + w.Tick + ")");
        foreach (var b in w.Buildings)
        {
            Check(b.DebrisM3 >= 0, "잔해 음수 금지");
            foreach (var p in b.Parts) Check(p.Hp >= 0 && p.Hp <= 100, "부재 hp 범위 0~100: " + p.Name + "=" + p.Hp);
            foreach (var s in b.Stock)
            {
                Check(s.OnSite >= -1e-9, "재고 음수 금지");
                Check(s.Reserved >= -1e-9 && s.Reserved <= s.OnSite + 1e-9, "예약은 재고를 넘지 못함");
            }
        }
        var claimed = new HashSet<int>();
        foreach (var k in w.Workers)
        {
            Check(k.Carry >= -1e-9, "운반량 음수 금지");
            if (k.JobId < 0) continue;
            Check(claimed.Add(k.JobId), "한 작업에 작업자 한 명만");
            var o = w.OrderById(k.JobId);
            Check(o != null && o.ClaimedBy == k.Id, "작업 예약과 작업자 상태 일치");
        }
        foreach (var o in w.Orders) Check(o.Done >= 0 && o.Done <= o.Total + 1e-9, "작업량 범위");
    }

    static void StepChecked(Simulation s, int ticks)
    {
        for (int i = 0; i < ticks; i++) { s.Step(); Invariants(s.World); }
    }

    static Building MostDamaged(WorldState w)
    {
        Building best = null;
        foreach (var b in w.Buildings)
            if (best == null || b.Find(PartType.Roof, 0).Hp < best.Find(PartType.Roof, 0).Hp) best = b;
        return best;
    }

    /// <summary>첫 토네이도가 지나간 직후의 게임.</summary>
    static Simulation AfterFirstTornado(ulong seed)
    {
        var s = Simulation.NewGame(seed);
        int guard = 0;
        while ((s.World.Disaster == null || !s.World.Disaster.Finished) && guard++ < 2000) { s.Step(); Invariants(s.World); }
        Check(s.World.Disaster != null && s.World.Disaster.Finished, "첫 토네이도 종료");
        return s;
    }

    static Contract StartJob(Simulation s, int grade)
    {
        var w = s.World;
        var b = MostDamaged(w);
        s.SetPlayerPosition(b.WorkX, b.WorkZ, 0);
        Check(s.InspectBuilding(b.Id).Ok, "현장 조사");
        Result r = Result.Fail("x", "x");
        for (int tier = 2; tier >= 0 && !r.Ok; tier--) r = s.SignContract(b.Id, grade, tier);
        Check(r.Ok, "계약 체결: " + r);
        return w.ContractById(b.ContractId);
    }

    static void Report(ulong seed)
    {
        var s = AfterFirstTornado(seed);
        var w = s.World;
        Console.Write("시드 " + seed + " | 지붕 hp:");
        foreach (var b0 in w.Buildings) Console.Write(" " + b0.Find(PartType.Roof, 0).Hp.ToString("0"));
        var c = StartJob(s, 1);
        var b = w.BuildingById(c.BuildingId);
        long start = w.Tick;
        s.OrderShortage(b.Id);
        int guard = 0;
        while (c.State != ContractState.Completed && guard++ < SimTime.TicksPerDay * 12)
        {
            s.Step();
            if (guard % 240 == 0 && b.ContractId == c.Id) s.OrderShortage(b.Id);
        }
        Console.WriteLine(" | 공정 " + c.OrderIds.Count + "개, 계약 " + c.Price.ToString("N0") + ", 자재 " + c.MaterialCost.ToString("N0")
            + ", 노무 " + c.LaborCost.ToString("N0") + ", 이익 " + (c.Price - c.MaterialCost - c.LaborCost).ToString("N0")
            + ", 소요 " + ((w.Tick - start) / 60.0).ToString("0.0") + "게임시간, 품질 " + c.Quality.ToString("0") + ", 현금 " + w.Cash.ToString("N0"));
    }

    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "report") { for (ulong i = 1; i <= 6; i++) Report(i); return 0; }
        Run("재난 시드 재현: 같은 시드는 같은 결과, 다른 시드는 다른 결과", () =>
        {
            var a = Simulation.NewGame(7); var b = Simulation.NewGame(7); var c = Simulation.NewGame(8);
            a.Step(400); b.Step(400); c.Step(400);
            Check(Same(SaveCodec.Serialize(a.World), SaveCodec.Serialize(b.World)), "같은 시드 동일");
            Check(!Same(SaveCodec.Serialize(a.World), SaveCodec.Serialize(c.World)), "다른 시드 상이");
        });

        Run("피해도 범위와 실제 파손: 여러 시드에서 지붕이 파손되고 hp는 0~100", () =>
        {
            for (ulong seed = 1; seed <= 20; seed++)
            {
                var s = AfterFirstTornado(seed);
                var roof = MostDamaged(s.World).Find(PartType.Roof, 0);
                Check(roof.Hp < 90, "시드 " + seed + " 지붕 피해 발생 (hp " + roof.Hp.ToString("0.0") + ")");
                Check(MostDamaged(s.World).Find(PartType.Foundation, 0).Hp == 100, "기초는 토네이도에 손상되지 않음");
            }
        });

        Run("같은 재난·같은 틱의 피해는 한 번만 적용", () =>
        {
            var w = WorldFactory.NewGame(3);
            var ev = DisasterSystem.Create(w, 99, 0, 0);
            var b = w.Buildings[0];
            Check(DisasterSystem.ApplyDamage(b, ev, 5, b.X + 2, b.Z, new Rng(1)), "첫 적용");
            double hp = b.Find(PartType.Roof, 0).Hp;
            Check(hp < 100, "피해 발생");
            Check(!DisasterSystem.ApplyDamage(b, ev, 5, b.X + 2, b.Z, new Rng(1)), "중복 적용 거부");
            Check(b.Find(PartType.Roof, 0).Hp == hp, "hp 불변");
        });

        Run("지붕만 파손된 집은 벽·창 상태가 유지되고 저장 후에도 재현", () =>
        {
            var w = WorldFactory.NewGame(3);
            var b = w.Buildings[0];
            b.Find(PartType.Roof, 0).Hp = 50; b.DebrisM3 = 2;
            var w2 = SaveCodec.Deserialize(SaveCodec.Serialize(w));
            var b2 = w2.BuildingById(b.Id);
            Check(b2.Find(PartType.Roof, 0).Hp == 50 && b2.DebrisM3 == 2, "지붕 파손·잔해 재현");
            Check(b2.Parts.Count >= 12, "독립 부재 12개 이상");
            foreach (var p in b2.Parts) if (p.Type != PartType.Roof) Check(p.Hp == 100, p.Name + " 유지");
            Check(ConstructionSystem.RoofDamagedArea(b2.Find(PartType.Roof, 0)) == 20, "지붕 40m2 중 20m2 파손");
        });

        Run("공정 선행조건: 철거 전 지붕 설치 불가, 조사 전 계약 불가", () =>
        {
            var s = AfterFirstTornado(5);
            var w = s.World;
            var b = MostDamaged(w);
            Check(s.SignContract(b.Id, 1, 1).Code == "NotSurveyed", "조사 전 계약 거부");
            Check(s.InspectBuilding(b.Id).Code == "TooFar", "멀리서 조사 거부");
            var c = StartJob(s, 1);
            WorkOrder install = null, qc = null;
            foreach (int id in c.OrderIds)
            {
                var o = w.OrderById(id);
                if (o.Type == WorkType.Install) install = o;
                if (o.Type == WorkType.QualityCheck) qc = o;
            }
            Check(install != null && qc != null, "지붕 설치·검측 공정 존재");
            Check(ConstructionSystem.AdvanceWork(w, install, null).Code == "Blocked", "선행 미완료 설치 거부");
            Check(ConstructionSystem.AdvanceWork(w, qc, null).Code == "Blocked", "공정 전 검측 거부");
            Check(s.SettleContract(c.Id).Code == "NotInspected", "검측 전 정산 거부");
        });

        Run("자재 도착 전 설치 불가, 자재 부족 시 가능한 물량까지만", () =>
        {
            var w = WorldFactory.NewGame(3);
            var b = w.Buildings[0];
            b.Find(PartType.Roof, 0).Hp = 50;
            b.Surveyed = true; b.Budget = long.MaxValue / 4;
            Check(ConstructionSystem.SignContract(w, b.Id, 1, 1).Ok, "계약");
            var c = w.ContractById(b.ContractId);
            WorkOrder install = null;
            foreach (int id in c.OrderIds)
            {
                var o = w.OrderById(id);
                if (o.Type == WorkType.Install) install = o; else if (o.Type != WorkType.QualityCheck) { o.Done = o.Total; o.State = WorkState.Done; }
            }
            ConstructionSystem.RefreshStates(w);
            Check(ConstructionSystem.AdvanceWork(w, install, null).Code == "WaitMaterial", "자재 없이 설치 거부");
            Check(install.Done == 0, "작업량 불변");
            b.StockOf(Items.Roofing).OnSite = 1.1;   // 1m2 분량만 도착
            for (int i = 0; i < 200; i++) { w.Tick++; ConstructionSystem.AdvanceWork(w, install, null); }
            Check(Math.Abs(install.Done - 1.0) < 1e-6, "자재만큼만 진행: " + install.Done);
            Check(b.StockOf(Items.Roofing).OnSite >= 0 && b.StockOf(Items.Roofing).OnSite < 1e-6, "재고 0, 음수 아님");
        });

        Run("같은 틱 중복 작업 반영 거부", () =>
        {
            var w = WorldFactory.NewGame(3);
            var b = w.Buildings[0];
            b.Find(PartType.Roof, 0).Hp = 50; b.Surveyed = true; b.Budget = long.MaxValue / 4;
            ConstructionSystem.SignContract(w, b.Id, 1, 1);
            var safety = w.Orders[0];
            Check(ConstructionSystem.AdvanceWork(w, safety, null).Ok, "첫 반영");
            double done = safety.Done;
            Check(ConstructionSystem.AdvanceWork(w, safety, null).Code == "Duplicate", "중복 거부");
            Check(safety.Done == done, "작업량 불변");
        });

        Run("수량 예제: 지붕 20m2, 자재 22m2(할증 10%), 2명 3.2m2/시간", () =>
        {
            var w = WorldFactory.NewGame(3);
            foreach (var k in w.Workers) k.Skill = 1.0;
            var b = w.Buildings[0];
            b.Find(PartType.Roof, 0).Hp = 50; b.Surveyed = true; b.Budget = long.MaxValue / 4;
            ConstructionSystem.SignContract(w, b.Id, 1, 1);
            var c = w.ContractById(b.ContractId);
            var need = ConstructionSystem.MaterialShortage(w, c);
            Check(need[Items.Roofing] == 22, "지붕재 22m2 필요: " + need[Items.Roofing]);
            WorkOrder install = null;
            foreach (int id in c.OrderIds) if (w.OrderById(id).Type == WorkType.Install) install = w.OrderById(id);
            Check(install.Total == 20, "설치 물량 20m2");
            install.Done = 8; install.MaterialUsed = 8.8;
            Check(Math.Abs(install.Remaining - 12) < 1e-9, "8m2 완료 후 잔여 12m2");
            double rate = install.BaseRate * 1.0 * 0.8 * 2;   // 숙련 1.0, 날씨 0.8, 2명
            Check(Math.Abs(rate - 3.2) < 1e-9 && Math.Abs(20 / rate - 6.25) < 1e-9, "3.2m2/시간, 6.25시간");
        });

        Run("예산을 넘는 견적은 거부", () =>
        {
            var s = AfterFirstTornado(5);
            var b = MostDamaged(s.World);
            s.SetPlayerPosition(b.WorkX, b.WorkZ, 0);
            s.InspectBuilding(b.Id);
            b.Budget = 1000;
            Check(s.SignContract(b.Id, 1, 0).Code == "OverBudget", "예산 초과 거부");
            Check(b.ContractId == -1 && s.World.Contracts.Count == 0, "계약 미체결");
        });

        Run("전체 플레이: 조사→계약→발주→운반→시공→검측→정산, 규칙 위반 없음", () =>
        {
            for (ulong seed = 1; seed <= 12; seed++)
            {
                var s = AfterFirstTornado(seed);
                var w = s.World;
                long cashBefore = w.Cash;
                var c = StartJob(s, 1);
                var b = w.BuildingById(c.BuildingId);
                Check(w.Cash == cashBefore + c.AdvancePaid, "선급금 30% 입금");
                Check(s.OrderShortage(b.Id).Ok, "자재 일괄 발주");
                Check(s.OrderShortage(b.Id).Code == "Nothing", "중복 발주 없음");
                int guard = 0;
                while (c.State != ContractState.Completed && guard++ < SimTime.TicksPerDay * 12)
                {
                    s.Step(); Invariants(w);
                    if (guard % 240 == 0 && b.ContractId == c.Id) s.OrderShortage(b.Id);   // 설계변경·재시공으로 늘어난 자재
                }
                Check(c.State == ContractState.Completed, "시드 " + seed + " 준공 (" + guard + "틱)");
                Check(c.Paid == c.Price && c.Settled, "계약금액 전액 수금");
                Check(b.Find(PartType.Roof, 0).Hp == 100, "지붕 복구");
                Check(b.Find(PartType.Roof, 0).WindResist > 0, "복구 부재 내풍 성능 상승");
                Check(c.Quality >= 75, "품질 기준 통과");
                Check(s.SettleContract(c.Id).Code == "AlreadySettled", "기성 중복 지급 거부");
                int settlements = 0;
                foreach (var l in w.Ledger) if (l.Kind == "Settlement" && l.RefId == c.Id) settlements++;
                Check(settlements == 1, "정산 원장 1건");
                Check(w.CompletedContracts == 1, "준공 실적 1건");
            }
        });

        Run("재난 중 대피와 작업 중단 후 재개: 진행량·자재 보존", () =>
        {
            var s = AfterFirstTornado(4);
            var w = s.World;
            var c = StartJob(s, 1);
            var b = w.BuildingById(c.BuildingId);
            s.OrderShortage(b.Id);
            int guard = 0;
            while (guard++ < 3000) { s.Step(); Invariants(w); bool any = false; foreach (var k in w.Workers) if (k.State == WorkerState.Work) any = true; if (any) break; }
            StepChecked(s, 30);
            double doneBefore = 0, stockBefore = 0;
            foreach (var o in w.Orders) doneBefore += o.Done;
            foreach (var st in b.Stock) stockBefore += st.OnSite;
            foreach (var k in w.Workers) stockBefore += k.Carry;
            double usedBefore = 0;
            foreach (var o in w.Orders) usedBefore += o.MaterialUsed;

            // 30분 뒤 도착하는 재난을 지금 예보
            w.Disaster = DisasterSystem.Create(w, 1234, w.Tick, w.Tick + 30);
            w.Disaster.Intensity = 0;   // 대피 동작만 검증(추가 피해 없음)
            StepChecked(s, 25);
            foreach (var k in w.Workers)
            {
                Check(k.State == WorkerState.Evacuate || k.State == WorkerState.Safe, k.Name + " 대피");
                Check(k.JobId == -1 && k.Carry == 0, "작업 예약 해제·자재 반환");
            }
            foreach (var o in w.Orders) Check(o.ClaimedBy == -1, "모든 작업 슬롯 해제");
            double doneMid = 0, stockMid = 0, usedMid = 0;
            foreach (var o in w.Orders) { doneMid += o.Done; usedMid += o.MaterialUsed; }
            foreach (var st in b.Stock) { stockMid += st.OnSite; Check(st.Reserved < 1e-9, "예약분 반환"); }
            Check(doneMid >= doneBefore - 1e-9, "진행량 보존");
            Check(Math.Abs((stockBefore - stockMid) - (usedMid - usedBefore)) < 1e-6, "자재 물량 보존(사용분만 감소)");

            guard = 0;
            while (c.State != ContractState.Completed && guard++ < SimTime.TicksPerDay * 12)
            {
                s.Step(); Invariants(w);
                if (guard % 240 == 0 && b.ContractId == c.Id) s.OrderShortage(b.Id);
            }
            Check(c.State == ContractState.Completed, "재난 후 재개하여 준공");
        });

        Run("저가 자재 + 미숙련 시공은 검측 불합격 → 재시공 비용 발생", () =>
        {
            var s = AfterFirstTornado(2);
            var w = s.World;
            foreach (var k in w.Workers) k.Skill = 0.8;
            var c = StartJob(s, 0);
            var b = w.BuildingById(c.BuildingId);
            s.OrderShortage(b.Id);
            int guard = 0;
            while (c.State != ContractState.Completed && guard++ < SimTime.TicksPerDay * 12)
            {
                s.Step(); Invariants(w);
                if (guard % 120 == 0 && b.ContractId == c.Id) s.OrderShortage(b.Id);
            }
            Check(c.ReworkDone, "재시공 발생");
            bool rework = false;
            foreach (int id in c.OrderIds) if (w.OrderById(id).Type == WorkType.Rework) rework = true;
            Check(rework && c.State == ContractState.Completed, "재시공 후 준공");
        });

        Run("플레이어 직접 수리: 현장에서만 가능, 중단 시 완료량 보존, 작업자와 슬롯 충돌 없음", () =>
        {
            var s = AfterFirstTornado(6);
            var w = s.World;
            w.Workers.Clear();
            var c = StartJob(s, 1);
            var b = w.BuildingById(c.BuildingId);
            var safety = w.OrderById(c.OrderIds[0]);
            s.SetPlayerPosition(b.X + 40, b.Z, 0);
            Check(s.StartPlayerWork(safety.Id).Code == "TooFar", "멀리서 작업 거부");
            s.SetPlayerPosition(b.WorkX, b.WorkZ, 0);
            Check(s.StartPlayerWork(safety.Id).Ok, "작업 시작");
            StepChecked(s, 10);
            double done = safety.Done;
            Check(done > 0 && !safety.IsDone, "진행 중");
            s.StopPlayerWork();
            StepChecked(s, 10);
            Check(safety.Done == done && safety.ClaimedBy == -1, "중단 시 완료량 보존");
            s.StartPlayerWork(safety.Id);
            StepChecked(s, 60);
            Check(safety.IsDone && w.PlayerWorkOrderId == -1, "재개하여 완료");

            s.OrderShortage(b.Id);
            int guard = 0;
            while (c.State != ContractState.Completed && guard++ < SimTime.TicksPerDay * 12)
            {
                if (w.PlayerWorkOrderId < 0 && !w.DisasterActive)
                    foreach (int id in c.OrderIds) { if (s.StartPlayerWork(id).Ok) break; }
                s.Step(); Invariants(w);
                if (guard % 240 == 0 && b.ContractId == c.Id) s.OrderShortage(b.Id);
            }
            Check(c.State == ContractState.Completed, "대표 혼자 준공 (" + guard + "틱)");
            Check(c.LaborCost == 0, "직접 작업은 노무비 없음");
        });

        Run("저장 복원: 진행 중 저장 후 불러와도 이후 결과가 동일", () =>
        {
            var a = AfterFirstTornado(9);
            var c = StartJob(a, 1);
            a.OrderShortage(c.BuildingId);
            a.Step(700);
            byte[] snap = SaveCodec.Serialize(a.World);
            var b = new Simulation(SaveCodec.Deserialize(snap));
            Check(Same(snap, SaveCodec.Serialize(b.World)), "직렬화 왕복 동일");
            a.Step(3000); b.Step(3000);
            Invariants(b.World);
            Check(Same(SaveCodec.Serialize(a.World), SaveCodec.Serialize(b.World)), "불러온 뒤 3000틱 진행 결과 동일");
        });

        Run("저장 파일: 원자적 교체, 백업 보존, 손상 감지와 백업 복구", () =>
        {
            string dir = Path.Combine(Path.GetTempPath(), "rbc-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "save1.rbc");
            var s = Simulation.NewGame(11);
            s.Step(100);
            SaveCodec.SaveFile(s.World, path);
            s.Step(100);
            SaveCodec.SaveFile(s.World, path);
            Check(File.Exists(path) && File.Exists(path + ".bak") && !File.Exists(path + ".tmp"), "본 파일·백업 존재, 임시 파일 없음");
            Check(SaveCodec.LoadFile(path).Tick == s.World.Tick, "최신 저장 불러오기");
            byte[] raw = File.ReadAllBytes(path);
            raw[raw.Length / 2] ^= 0xFF;
            File.WriteAllBytes(path, raw);
            bool threw = false;
            try { SaveCodec.Deserialize(raw); } catch (InvalidDataException) { threw = true; }
            Check(threw, "손상 감지");
            Check(SaveCodec.LoadFile(path).Tick == s.World.Tick - 100, "백업에서 복구");
            Directory.Delete(dir, true);
        });

        Run("직원 채용: 첫 준공 전 잠금, 준공 후 채용비 원장 기록", () =>
        {
            var s = AfterFirstTornado(1);
            var w = s.World;
            Check(s.HireWorker().Code == "Locked", "첫 준공 전 채용 잠금");
            w.CompletedContracts = 1;
            long cash = w.Cash;
            Check(s.HireWorker().Ok && w.Workers.Count == 3 && w.Cash == cash - WorkforceSystem.HireFee, "채용과 비용");
            Invariants(w);
        });

        Run("자금 부족: 발주 거부, 현금 불변", () =>
        {
            var s = AfterFirstTornado(1);
            var w = s.World;
            var c = StartJob(s, 1);
            w.Post("Test", -(w.Cash - 1000), 0, "테스트용 지출");
            long cash = w.Cash;
            Check(s.OrderShortage(c.BuildingId).Code == "NoCash", "발주 거부");
            Check(w.Cash == cash && w.Purchases.Count == 0, "현금·발주 불변");
        });

        Console.WriteLine();
        Console.WriteLine("결과: " + passed + " 통과, " + failed + " 실패");
        return failed == 0 ? 0 : 1;
    }
}
