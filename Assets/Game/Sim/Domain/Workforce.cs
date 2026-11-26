using System;

namespace RebuildCity.Sim
{
    /// <summary>작업자 상태 머신과 작업 배정. 한 작업 슬롯에는 한 명만 들어간다.</summary>
    public static class WorkforceSystem
    {
        public const double WalkStep = 2.2 * SimTime.TickSeconds;   // 걷기 2.2m/s
        public const double CarryCapacity = 6;
        public const int MaxWorkers = 4;
        public const long HireFee = 500000;

        public static void Tick(WorldState w)
        {
            for (int i = 0; i < w.Workers.Count; i++) TickWorker(w, w.Workers[i], i);
        }

        static void TickWorker(WorldState w, Worker k, int index)
        {
            if (w.Alert)
            {
                if (k.State != WorkerState.Evacuate && k.State != WorkerState.Safe)
                {
                    Release(w, k);
                    k.State = WorkerState.Evacuate;
                    k.TargetX = WorldState.ShelterX + index * 1.5;
                    k.TargetZ = WorldState.ShelterZ;
                }
                if (k.State == WorkerState.Evacuate && Move(k, WalkStep * 2)) k.State = WorkerState.Safe;
                return;
            }
            if (k.State == WorkerState.Evacuate || k.State == WorkerState.Safe) k.State = WorkerState.Idle;

            bool workHour = SimTime.IsWorkHour(w.Tick);
            if (k.State == WorkerState.Rest)
            {
                if (Move(k, WalkStep)) k.Fatigue = Math.Max(0, k.Fatigue - 0.2);
                if (workHour && k.Fatigue < 30) k.State = WorkerState.Idle;
                return;
            }
            if (!workHour || k.Fatigue >= 90)
            {
                Release(w, k);
                k.State = WorkerState.Rest;
                k.TargetX = WorldState.DepotX + 2 + index * 1.5;
                k.TargetZ = WorldState.DepotZ - 4;
                return;
            }

            switch (k.State)
            {
                case WorkerState.Idle:
                    var job = ChooseJob(w, k);
                    if (job != null) Claim(w, k, job);
                    break;
                case WorkerState.MoveToStorage:
                    if (Move(k, WalkStep)) k.State = WorkerState.Pickup;
                    break;
                case WorkerState.Pickup:
                    Pickup(w, k);
                    break;
                case WorkerState.MoveToSite:
                    if (Move(k, WalkStep)) k.State = WorkerState.Work;
                    break;
                case WorkerState.Work:
                    Work(w, k);
                    break;
            }
        }

        /// <summary>우선순위 점수 = 긴급도×40 + 공정 중요도×30 + 숙련도×20 − 이동비용×10. 동점은 작업 ID 순.</summary>
        public static WorkOrder ChooseJob(WorldState w, Worker k)
        {
            WorkOrder best = null;
            double bestScore = double.MinValue;
            for (int i = 0; i < w.Orders.Count; i++)
            {
                var o = w.Orders[i];
                if (o.IsDone || !IsFree(w, o) || !ConstructionSystem.PrereqsDone(w, o)) continue;
                var c = w.ContractById(o.ContractId);
                if (c == null || c.State != ContractState.Active) continue;
                var b = w.BuildingById(o.BuildingId);
                if (o.MaterialId >= 0 && b.StockOf(o.MaterialId).Free <= 1e-6) continue;

                double urgency = Mathx.Clamp(1.0 - (c.DeadlineTick - w.Tick) / (double)(SimTime.TicksPerDay * 3), 0, 1);
                double critical = (o.Type == WorkType.Repair || o.Type == WorkType.Replace) ? 0.5 : 1.0;
                double travel = Mathx.Dist(k.X, k.Z, b.WorkX, b.WorkZ) / 100.0;
                double score = urgency * 40 + critical * 30 + k.Skill * 20 - travel * 10;
                if (score > bestScore || (score == bestScore && best != null && o.Id < best.Id)) { best = o; bestScore = score; }
            }
            return best;
        }

        public static bool IsFree(WorldState w, WorkOrder o)
        {
            if (o.ClaimedBy == -1) return true;
            return o.ClaimedBy == 0 && o.PlayerTick < w.Tick - 1;
        }

        static void Claim(WorldState w, Worker k, WorkOrder o)
        {
            o.ClaimedBy = k.Id;
            k.JobId = o.Id;
            var b = w.BuildingById(o.BuildingId);
            if (o.MaterialId >= 0 && Reserve(k, o, b)) return;
            GoToSite(k, o, b);
        }

        static bool Reserve(Worker k, WorkOrder o, Building b)
        {
            var stock = b.StockOf(o.MaterialId);
            double qty = Math.Min(CarryCapacity, Math.Min(o.Remaining * o.MaterialPerUnit, stock.Free));
            if (qty <= 1e-6) return false;
            stock.Reserved += qty;
            k.ReservedQty = qty;
            k.CarryItem = o.MaterialId;
            k.TargetX = b.StockX;
            k.TargetZ = b.StockZ;
            k.State = WorkerState.MoveToStorage;
            return true;
        }

        static void GoToSite(Worker k, WorkOrder o, Building b)
        {
            k.TargetX = b.WorkX + ((o.Id % 3) - 1) * 2.0;
            k.TargetZ = b.WorkZ;
            k.State = WorkerState.MoveToSite;
        }

        static void Pickup(WorldState w, Worker k)
        {
            var o = w.OrderById(k.JobId);
            if (o == null || o.IsDone) { Release(w, k); k.State = WorkerState.Idle; return; }
            var b = w.BuildingById(o.BuildingId);
            var stock = b.StockOf(k.CarryItem);
            double qty = Math.Min(k.ReservedQty, stock.OnSite);
            stock.OnSite -= qty;
            stock.Reserved = Math.Max(0, stock.Reserved - k.ReservedQty);
            k.ReservedQty = 0;
            k.Carry += qty;
            GoToSite(k, o, b);
        }

        static void Work(WorldState w, Worker k)
        {
            var o = w.OrderById(k.JobId);
            if (o == null || o.IsDone) { Release(w, k); k.State = WorkerState.Idle; return; }
            var r = ConstructionSystem.AdvanceWork(w, o, k);
            if (r.Ok)
            {
                if (o.IsDone) { Release(w, k); k.State = WorkerState.Idle; }
                return;
            }
            if (r.Code == "WaitMaterial" && Reserve(k, o, w.BuildingById(o.BuildingId))) return;
            if (r.Code == "NoCash") w.Emit("NoCash", "자금 부족으로 " + k.Name + " 작업 중단.");
            Release(w, k);
            k.State = WorkerState.Idle;
        }

        /// <summary>작업 예약을 풀고, 들고 있던 자재와 예약분을 현장 재고로 되돌린다.</summary>
        public static void Release(WorldState w, Worker k)
        {
            var o = w.OrderById(k.JobId);
            if (o != null)
            {
                if (o.ClaimedBy == k.Id) o.ClaimedBy = -1;
                var b = w.BuildingById(o.BuildingId);
                if (k.CarryItem >= 0)
                {
                    var stock = b.StockOf(k.CarryItem);
                    stock.Reserved = Math.Max(0, stock.Reserved - k.ReservedQty);
                    stock.OnSite += k.Carry;
                }
            }
            k.ReservedQty = 0;
            k.Carry = 0;
            k.CarryItem = -1;
            k.JobId = -1;
        }

        public static void ReleaseOrder(WorldState w, WorkOrder o)
        {
            if (o.ClaimedBy > 0)
            {
                var k = w.WorkerById(o.ClaimedBy);
                if (k != null) { Release(w, k); k.State = WorkerState.Idle; }
            }
            o.ClaimedBy = -1;
        }

        static bool Move(Worker k, double step)
        {
            double d = Mathx.Dist(k.X, k.Z, k.TargetX, k.TargetZ);
            if (d <= step) { k.X = k.TargetX; k.Z = k.TargetZ; return true; }
            k.X += (k.TargetX - k.X) / d * step;
            k.Z += (k.TargetZ - k.Z) / d * step;
            return false;
        }

        public static Result Hire(WorldState w)
        {
            if (w.CompletedContracts < 1) return Result.Fail("Locked", "첫 준공 후에 채용할 수 있습니다.");
            if (w.Workers.Count >= MaxWorkers) return Result.Fail("Full", "더 채용할 수 없습니다.");
            if (w.Cash - w.UnpaidWages < HireFee) return Result.Fail("NoCash", "자금이 부족합니다.");
            var k = WorldFactory.MakeWorker(w);
            w.Workers.Add(k);
            w.Post("Hire", -HireFee, k.Id, k.Name + " 채용");
            w.Emit("Hire", k.Name + " 채용 (숙련도 " + k.Skill.ToString("0.00") + ").");
            return Result.Success();
        }

        public static void Payroll(WorldState w)
        {
            for (int i = 0; i < w.Workers.Count; i++)
            {
                var k = w.Workers[i];
                if (k.UnpaidWage <= 0) continue;
                w.Post("Wage", -k.UnpaidWage, k.Id, k.Name + " 노무비");
                k.UnpaidWage = 0;
            }
        }
    }
}
