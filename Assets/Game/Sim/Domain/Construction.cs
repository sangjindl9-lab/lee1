using System;
using System.Collections.Generic;

namespace RebuildCity.Sim
{
    /// <summary>현장 조사 → 견적 → 계약 → 공정 → 검측 → 정산.</summary>
    public static class ConstructionSystem
    {
        public const double SurveyRange = 10;
        public const double WorkRange = 10;
        public const long LaborPerHour = 30000;
        public const long DeliveryFee = 100000;
        public static readonly double[] Margin = { 1.2, 1.4, 1.65 };
        public static readonly string[] MarginName = { "저가", "표준", "고가" };

        // PlanLine.Stage 값: 어떤 작업 뒤에 할 수 있는가
        const int AfterNone = 0, AfterSafety = 1, AfterDebris = 2, AfterRoofDemolish = 3, AfterRoofInstall = 4, AfterAll = 5;

        public static double RoofDamagedArea(Part roof)
        {
            if (roof.Hp >= 90) return 0;
            double d = Math.Round(roof.Quantity * (1 - roof.Hp / 100.0) / 2.0) * 2.0;
            return Math.Max(2, d);
        }

        /// <summary>현재 피해 상태로부터 공정 계획(물량 산출)을 만든다.</summary>
        public static List<PlanLine> Plan(Building b)
        {
            var plan = new List<PlanLine>();
            plan.Add(new PlanLine { Type = WorkType.SafetyZone, Name = "안전구역 설정", Total = 1, Unit = "식", BaseRate = 2, Stage = AfterNone });
            if (b.DebrisM3 > 0.001)
                plan.Add(new PlanLine { Type = WorkType.ClearDebris, Name = "잔해 제거", Total = Math.Ceiling(b.DebrisM3 * 10) / 10, Unit = "m3", BaseRate = 1, Stage = AfterSafety });

            for (int i = 0; i < b.Parts.Count; i++)
            {
                var p = b.Parts[i];
                if (p.Hp >= 90) continue;
                double lost = 1 - p.Hp / 100.0;
                switch (p.Type)
                {
                    case PartType.Roof:
                        double area = RoofDamagedArea(p);
                        plan.Add(new PlanLine { Type = WorkType.Demolish, PartId = p.Id, Name = "지붕 철거", Total = area, Unit = "m2", BaseRate = 4, Stage = AfterDebris });
                        plan.Add(new PlanLine { Type = WorkType.Install, PartId = p.Id, Name = "지붕 설치", Total = area, Unit = "m2", BaseRate = 2, MaterialId = Items.Roofing, MaterialPerUnit = 1.1, Stage = AfterRoofDemolish });
                        break;
                    case PartType.Window:
                        if (p.Hp < 60)
                            plan.Add(new PlanLine { Type = WorkType.Replace, PartId = p.Id, Name = p.Name + " 교체", Total = 1, Unit = "개", BaseRate = 0.5, MaterialId = Items.Window, MaterialPerUnit = 1, Stage = AfterSafety });
                        else
                            plan.Add(new PlanLine { Type = WorkType.Repair, PartId = p.Id, Name = p.Name + " 보수", Total = 1, Unit = "개", BaseRate = 1, MaterialId = Items.RepairKit, MaterialPerUnit = 0.25, Stage = AfterSafety });
                        break;
                    case PartType.Wall:
                        plan.Add(new PlanLine { Type = WorkType.Repair, PartId = p.Id, Name = p.Name + " 보수", Total = Math.Max(1, Math.Round(p.Quantity * lost)), Unit = "m2", BaseRate = 3, MaterialId = Items.Siding, MaterialPerUnit = 1.1, Stage = AfterDebris });
                        break;
                    case PartType.Finish:
                        plan.Add(new PlanLine { Type = WorkType.Repair, PartId = p.Id, Name = p.Name + " 보수", Total = Math.Max(1, Math.Round(p.Quantity * lost)), Unit = "m2", BaseRate = 4, MaterialId = Items.RepairKit, MaterialPerUnit = 0.05, Stage = AfterRoofInstall });
                        break;
                    default:
                        plan.Add(new PlanLine { Type = WorkType.Repair, PartId = p.Id, Name = p.Name + " 보수", Total = 1, Unit = p.Unit, BaseRate = 0.5, MaterialId = Items.RepairKit, MaterialPerUnit = 0.5, Stage = AfterRoofInstall });
                        break;
                }
            }
            plan.Add(new PlanLine { Type = WorkType.QualityCheck, Name = "검측", Total = 1, Unit = "식", BaseRate = 2, Stage = AfterAll });
            return plan;
        }

        public static double[] MaterialNeed(List<PlanLine> plan)
        {
            var need = new double[Items.All.Length];
            for (int i = 0; i < plan.Count; i++)
                if (plan[i].MaterialId >= 0) need[plan[i].MaterialId] += plan[i].Total * plan[i].MaterialPerUnit;
            return need;
        }

        /// <summary>예상 원가 = 자재(정수 단위 구매) + 노무 + 운반 + 간접비 5%.</summary>
        public static long EstimateCost(List<PlanLine> plan, int grade)
        {
            double cost = 0;
            var need = MaterialNeed(plan);
            bool anyMaterial = false;
            for (int i = 0; i < need.Length; i++)
            {
                if (need[i] <= 0) continue;
                anyMaterial = true;
                cost += Math.Ceiling(need[i] - 1e-9) * Items.UnitPrice(i, grade);
            }
            for (int i = 0; i < plan.Count; i++) cost += plan[i].Total / plan[i].BaseRate * LaborPerHour;
            if (anyMaterial) cost += DeliveryFee;
            return (long)Math.Round(cost * 1.05);
        }

        public static long QuotePrice(Building b, int grade, int tier)
        {
            long cost = EstimateCost(Plan(b), grade);
            return (long)Math.Round(cost * Margin[tier] / 10000.0) * 10000;
        }

        public static Result Survey(WorldState w, int buildingId)
        {
            var b = w.BuildingById(buildingId);
            if (b == null) return Result.Fail("NoBuilding", "건물이 없습니다.");
            if (w.DisasterActive) return Result.Fail("Disaster", "재난 중에는 조사할 수 없습니다.");
            if (b.ContractId >= 0) return Result.Fail("HasContract", "이미 계약된 현장입니다.");
            if (!b.IsDamaged) return Result.Fail("NoDamage", "피해가 없습니다.");
            if (Mathx.Dist(w.PlayerX, w.PlayerZ, b.X, b.Z) > SurveyRange) return Result.Fail("TooFar", "현장에 가까이 가야 조사할 수 있습니다.");
            if (!b.Surveyed)
            {
                b.Surveyed = true;
                b.Budget = (long)(EstimateCost(Plan(b), 1) * w.Rng.Range(1.45, 1.8));
                w.Emit("Survey", b.Name + " 현장 조사 완료.");
            }
            return Result.Success();
        }

        public static Result SignContract(WorldState w, int buildingId, int grade, int tier)
        {
            var b = w.BuildingById(buildingId);
            if (b == null) return Result.Fail("NoBuilding", "건물이 없습니다.");
            if (grade < 0 || grade > 2 || tier < 0 || tier > 2) return Result.Fail("BadArg", "잘못된 선택입니다.");
            if (!b.Surveyed) return Result.Fail("NotSurveyed", "먼저 현장을 조사해야 합니다.");
            if (b.ContractId >= 0) return Result.Fail("HasContract", "이미 계약된 현장입니다.");
            var plan = Plan(b);
            long cost = EstimateCost(plan, grade);
            long price = QuotePrice(b, grade, tier);
            if (price > b.Budget) return Result.Fail("OverBudget", "고객 예산을 넘는 견적입니다. 견적을 낮추세요.");

            var c = new Contract();
            c.Id = w.NewId();
            c.BuildingId = b.Id;
            c.Price = price;
            c.EstimatedCost = cost;
            c.Grade = grade;
            c.State = ContractState.Active;
            c.DeadlineTick = w.Tick + SimTime.TicksPerDay * 3;
            w.Contracts.Add(c);
            b.ContractId = c.Id;
            Instantiate(w, c, b, plan);

            c.AdvancePaid = price * 30 / 100;
            c.Paid = c.AdvancePaid;
            w.Post("Advance", c.AdvancePaid, c.Id, b.Name + " 선급금");
            w.Emit("Contract", b.Name + " 계약 체결. 선급금 " + c.AdvancePaid.ToString("N0") + "원 입금.");
            return Result.Success();
        }

        static void Instantiate(WorldState w, Contract c, Building b, List<PlanLine> plan)
        {
            int safety = -1, debris = -1, roofDemolish = -1, roofInstall = -1;
            var created = new List<WorkOrder>();
            for (int i = 0; i < plan.Count; i++)
            {
                var l = plan[i];
                var o = new WorkOrder();
                o.Id = w.NewId();
                o.ContractId = c.Id;
                o.BuildingId = b.Id;
                o.PartId = l.PartId;
                o.Type = l.Type;
                o.Name = l.Name;
                o.Total = l.Total;
                o.Unit = l.Unit;
                o.BaseRate = l.BaseRate;
                o.MaterialId = l.MaterialId;
                o.MaterialPerUnit = l.MaterialPerUnit;
                if (l.PartId >= 0) o.HpStart = b.PartById(l.PartId).Hp;

                switch (l.Stage)
                {
                    case AfterSafety: Need(o, safety); break;
                    case AfterDebris: Need(o, safety); Need(o, debris); break;
                    case AfterRoofDemolish: Need(o, roofDemolish); break;
                    case AfterRoofInstall: Need(o, safety); Need(o, roofInstall); break;
                    case AfterAll: for (int k = 0; k < created.Count; k++) o.Prereqs.Add(created[k].Id); break;
                }
                if (l.Type == WorkType.SafetyZone) safety = o.Id;
                else if (l.Type == WorkType.ClearDebris) debris = o.Id;
                else if (l.Type == WorkType.Demolish) roofDemolish = o.Id;
                else if (l.Type == WorkType.Install) roofInstall = o.Id;

                created.Add(o);
                w.Orders.Add(o);
                c.OrderIds.Add(o.Id);
            }
            RefreshStates(w);
        }

        static void Need(WorkOrder o, int prereqId) { if (prereqId >= 0) o.Prereqs.Add(prereqId); }

        public static bool PrereqsDone(WorldState w, WorkOrder o)
        {
            for (int i = 0; i < o.Prereqs.Count; i++)
            {
                var p = w.OrderById(o.Prereqs[i]);
                if (p != null && !p.IsDone) return false;
            }
            return true;
        }

        public static void RefreshStates(WorldState w)
        {
            for (int i = 0; i < w.Orders.Count; i++)
            {
                var o = w.Orders[i];
                if (o.State == WorkState.Blocked && PrereqsDone(w, o)) o.State = WorkState.Ready;
            }
        }

        public static double WeatherFactor(WorldState w)
        {
            ulong h = (w.Seed + 77) * 6364136223846793005UL + (ulong)SimTime.Day(w.Tick) * 1442695040888963407UL;
            return ((h >> 33) % 4) == 0 ? 0.8 : 1.0;
        }

        /// <summary>
        /// deltaWork = min(잔여, 기본생산성 × 숙련도 × 날씨 × 피로 × 시간). 자재가 부족하면 가능한 물량까지만 진행한다.
        /// 작업량·재고·노무비를 한 번에 반영하고, 같은 틱·같은 작업자의 중복 호출은 거부한다.
        /// </summary>
        public static Result AdvanceWork(WorldState w, WorkOrder o, Worker worker)
        {
            int actor = worker == null ? 0 : worker.Id;
            if (o.IsDone) return Result.Fail("Done", "이미 끝난 작업입니다.");
            if (!PrereqsDone(w, o)) return Result.Fail("Blocked", "선행 작업이 끝나지 않았습니다.");
            if (w.DisasterActive) return Result.Fail("Disaster", "재난 중에는 작업할 수 없습니다.");
            if (o.LastCommitTick == w.Tick && o.LastCommitActor == actor) return Result.Fail("Duplicate", "같은 틱에 이미 반영된 작업입니다.");

            long wage = worker == null ? 0 : worker.WagePerHour / SimTime.TicksPerHour;
            if (worker != null && w.Cash - w.UnpaidWages < wage) return Result.Fail("NoCash", "자금이 부족해 작업자가 일할 수 없습니다.");

            double skill = worker == null ? 1.0 : worker.Skill;
            double fatigue = worker == null ? 1.0 : 1.0 - worker.Fatigue / 200.0;
            double qty = Math.Min(o.Remaining, o.BaseRate * skill * WeatherFactor(w) * fatigue / SimTime.TicksPerHour);

            var b = w.BuildingById(o.BuildingId);
            SiteStock stock = null;
            if (o.MaterialId >= 0)
            {
                stock = b.StockOf(o.MaterialId);
                double available = worker == null ? stock.Free : worker.Carry;
                qty = Math.Min(qty, available / o.MaterialPerUnit);
            }
            if (qty <= 1e-9)
            {
                o.State = WorkState.WaitMaterial;
                return Result.Fail("WaitMaterial", "자재가 현장에 없습니다.");
            }

            // 여기서부터는 실패하지 않는다: 작업량·재고·노무비를 함께 반영
            double material = o.MaterialId >= 0 ? qty * o.MaterialPerUnit : 0;
            if (o.MaterialId >= 0)
            {
                if (worker == null) stock.OnSite = Math.Max(0, stock.OnSite - material);
                else worker.Carry = Math.Max(0, worker.Carry - material);
                o.MaterialUsed += material;
            }
            o.Done += qty;
            o.SkillWork += skill * qty;
            o.LastCommitTick = w.Tick;
            o.LastCommitActor = actor;
            o.State = WorkState.InProgress;
            var c = w.ContractById(o.ContractId);
            if (worker != null)
            {
                worker.UnpaidWage += wage;
                worker.Fatigue = Math.Min(100, worker.Fatigue + 0.08);
                c.LaborCost += wage;
            }

            if (o.Remaining <= 1e-6) { o.Done = o.Total; o.State = WorkState.Done; }
            ApplyProgress(w, b, o);
            if (o.IsDone)
            {
                RefreshStates(w);
                if (o.Type == WorkType.QualityCheck) FinishInspection(w, c, b);
                else w.Emit("Work", b.Name + " " + o.Name + " 완료.");
            }
            return Result.Success();
        }

        static void ApplyProgress(WorldState w, Building b, WorkOrder o)
        {
            if (o.Type == WorkType.ClearDebris) { b.DebrisM3 = Math.Max(0, o.Total - o.Done); return; }
            if (o.PartId < 0) return;
            if (o.Type == WorkType.Install || o.Type == WorkType.Repair || o.Type == WorkType.Replace)
            {
                var p = b.PartById(o.PartId);
                p.Hp = Math.Max(p.Hp, o.HpStart + (100 - o.HpStart) * (o.Done / o.Total));
            }
        }

        /// <summary>quality = clamp(자재등급×0.35 + 숙련도×0.35 + 공법적합도×0.2 + 검사점수×0.1, 0, 100)</summary>
        public static double ComputeQuality(WorldState w, Contract c)
        {
            double work = 0, skillWork = 0;
            for (int i = 0; i < c.OrderIds.Count; i++)
            {
                var o = w.OrderById(c.OrderIds[i]);
                if (o == null || o.Type == WorkType.QualityCheck) continue;
                work += o.Done; skillWork += o.SkillWork;
            }
            double skillScore = Mathx.Clamp((work > 0 ? skillWork / work : 1.0) * 80.0, 0, 100);
            double q = Items.GradeScore[c.Grade] * 0.35 + skillScore * 0.35 + 100 * 0.2 + 100 * 0.1;
            if (c.ReworkDone) q += 10;
            return Mathx.Clamp(q, 0, 100);
        }

        static void FinishInspection(WorldState w, Contract c, Building b)
        {
            c.Quality = ComputeQuality(w, c);
            if (c.Quality < 75 && !c.ReworkDone)
            {
                c.ReworkDone = true;
                var plan = new List<PlanLine>();
                WorkOrder roof = null;
                for (int i = 0; i < c.OrderIds.Count; i++)
                {
                    var o = w.OrderById(c.OrderIds[i]);
                    if (o != null && o.Type == WorkType.Install) roof = o;
                }
                if (roof != null)
                    plan.Add(new PlanLine { Type = WorkType.Rework, Name = "하자 재시공(지붕)", Total = Math.Max(1, Math.Round(roof.Total * 0.25)), Unit = "m2", BaseRate = 2, MaterialId = Items.Roofing, MaterialPerUnit = 1.1, Stage = AfterNone });
                else
                    plan.Add(new PlanLine { Type = WorkType.Rework, Name = "하자 재시공", Total = 1, Unit = "식", BaseRate = 0.5, MaterialId = Items.RepairKit, MaterialPerUnit = 0.5, Stage = AfterNone });
                plan.Add(new PlanLine { Type = WorkType.QualityCheck, Name = "재검측", Total = 1, Unit = "식", BaseRate = 2, Stage = AfterAll });
                Instantiate(w, c, b, plan);
                w.Emit("Defect", b.Name + " 검측 불합격(품질 " + c.Quality.ToString("0") + "점). 재시공이 필요합니다.");
                return;
            }
            Settle(w, c.Id);
        }

        /// <summary>검측 통과 후 준공 정산. 잔액은 원장에 한 번만 기록된다.</summary>
        public static Result Settle(WorldState w, int contractId)
        {
            var c = w.ContractById(contractId);
            if (c == null) return Result.Fail("NoContract", "계약이 없습니다.");
            if (c.Settled || w.HasLedger("Settlement", c.Id)) return Result.Fail("AlreadySettled", "이미 정산된 계약입니다.");
            for (int i = 0; i < c.OrderIds.Count; i++)
            {
                var o = w.OrderById(c.OrderIds[i]);
                if (o != null && !o.IsDone) return Result.Fail("NotInspected", "검측이 끝나지 않았습니다.");
            }
            var b = w.BuildingById(c.BuildingId);
            long balance = c.Price - c.AdvancePaid;
            w.Post("Settlement", balance, c.Id, b.Name + " 준공 정산");
            c.Paid = c.Price;
            c.Settled = true;
            c.State = ContractState.Completed;

            for (int i = 0; i < c.OrderIds.Count; i++)
            {
                var o = w.OrderById(c.OrderIds[i]);
                if (o == null || o.PartId < 0) continue;
                var p = b.PartById(o.PartId);
                p.Hp = 100;
                p.WindResist = Math.Max(p.WindResist, Items.GradeResist[c.Grade]);
            }
            b.DebrisM3 = 0;
            b.Surveyed = false;
            b.ContractId = -1;
            w.CompletedContracts++;
            w.Reputation += c.Quality >= 90 ? 2 : 1;
            w.Emit("Complete", b.Name + " 준공! 잔액 " + balance.ToString("N0") + "원 입금 (품질 " + c.Quality.ToString("0") + "점).");
            return Result.Success();
        }

        /// <summary>재난이 끝난 뒤 진행 중인 현장을 다시 조사해 남은 공정을 재계획한다(설계변경).</summary>
        public static void ReplanAfterDisaster(WorldState w)
        {
            for (int ci = 0; ci < w.Contracts.Count; ci++)
            {
                var c = w.Contracts[ci];
                if (c.State != ContractState.Active) continue;
                var b = w.BuildingById(c.BuildingId);

                var remaining = new List<PlanLine>();
                for (int i = 0; i < c.OrderIds.Count; i++)
                {
                    var o = w.OrderById(c.OrderIds[i]);
                    if (o == null || o.IsDone) continue;
                    remaining.Add(new PlanLine { Type = o.Type, Total = o.Remaining, BaseRate = o.BaseRate, MaterialId = o.MaterialId, MaterialPerUnit = o.MaterialPerUnit });
                }
                var plan = Plan(b);
                long oldCost = EstimateCost(remaining, c.Grade);
                long newCost = EstimateCost(plan, c.Grade);
                if (newCost <= oldCost) continue;

                for (int i = c.OrderIds.Count - 1; i >= 0; i--)
                {
                    var o = w.OrderById(c.OrderIds[i]);
                    if (o == null || o.IsDone) continue;
                    WorkforceSystem.ReleaseOrder(w, o);
                    w.Orders.Remove(o);
                    c.OrderIds.RemoveAt(i);
                }
                if (w.PlayerWorkOrderId >= 0 && w.OrderById(w.PlayerWorkOrderId) == null) w.PlayerWorkOrderId = -1;
                Instantiate(w, c, b, plan);
                long extra = (long)Math.Round((newCost - oldCost) * 1.3 / 10000.0) * 10000;
                c.Price += extra;
                c.EstimatedCost += newCost - oldCost;
                c.DeadlineTick += SimTime.TicksPerDay;
                w.Emit("Change", b.Name + " 추가 피해로 설계변경. 계약금액 +" + extra.ToString("N0") + "원.");
            }
        }

        /// <summary>계약의 남은 공정에 필요한 자재 중 아직 확보되지 않은 수량.</summary>
        public static double[] MaterialShortage(WorldState w, Contract c)
        {
            var need = new double[Items.All.Length];
            for (int i = 0; i < c.OrderIds.Count; i++)
            {
                var o = w.OrderById(c.OrderIds[i]);
                if (o == null || o.IsDone || o.MaterialId < 0) continue;
                need[o.MaterialId] += o.Remaining * o.MaterialPerUnit;
            }
            var b = w.BuildingById(c.BuildingId);
            for (int i = 0; i < b.Stock.Count; i++) need[b.Stock[i].ItemId] -= b.Stock[i].OnSite;
            for (int i = 0; i < w.Purchases.Count; i++)
                if (w.Purchases[i].BuildingId == b.Id && w.Purchases[i].State != PurchaseState.Delivered)
                    need[w.Purchases[i].ItemId] -= w.Purchases[i].Qty;
            for (int i = 0; i < w.Workers.Count; i++)
            {
                var k = w.Workers[i];
                if (k.Carry <= 0 || k.CarryItem < 0 || k.JobId < 0) continue;
                var o = w.OrderById(k.JobId);
                if (o != null && o.BuildingId == b.Id) need[k.CarryItem] -= k.Carry;
            }
            for (int i = 0; i < need.Length; i++) need[i] = need[i] <= 1e-6 ? 0 : Math.Ceiling(need[i] - 1e-9);
            return need;
        }
    }
}
