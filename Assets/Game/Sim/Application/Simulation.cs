namespace RebuildCity.Sim
{
    /// <summary>
    /// 고정 틱 시뮬레이션과 명령 창구. 화면(Unity)은 여기의 명령만 호출하고 상태를 읽어 그린다.
    /// 틱 순서: 재해 → 작업 배정·이동·자재·공정(작업자) → 플레이어 직접 작업 → 물류 → 급여 → 시간 증가.
    /// </summary>
    public sealed class Simulation
    {
        public WorldState World;
        public Result LastPlayerWork = Result.Success();

        public Simulation(WorldState world) { World = world; }

        public static Simulation NewGame(ulong seed) { return new Simulation(WorldFactory.NewGame(seed)); }

        public void Step()
        {
            var w = World;
            DisasterSystem.Tick(w);
            WorkforceSystem.Tick(w);
            PlayerWorkTick(w);
            LogisticsSystem.Tick(w);
            if (w.Tick % SimTime.TicksPerDay == SimTime.WorkEndHour * SimTime.TicksPerHour) WorkforceSystem.Payroll(w);
            w.Tick++;
        }

        public void Step(int ticks) { for (int i = 0; i < ticks; i++) Step(); }

        void PlayerWorkTick(WorldState w)
        {
            if (w.PlayerWorkOrderId < 0) return;
            var o = w.OrderById(w.PlayerWorkOrderId);
            Result r;
            if (o == null) r = Result.Fail("NoOrder", "작업이 없습니다.");
            else if (o.ClaimedBy > 0) r = Result.Fail("Claimed", "다른 작업자가 하고 있는 작업입니다.");
            else
            {
                var b = w.BuildingById(o.BuildingId);
                if (Mathx.Dist(w.PlayerX, w.PlayerZ, b.X, b.Z) > ConstructionSystem.WorkRange)
                    r = Result.Fail("TooFar", "현장에서 벗어났습니다.");
                else
                {
                    o.ClaimedBy = 0;
                    o.PlayerTick = w.Tick;
                    r = ConstructionSystem.AdvanceWork(w, o, null);
                }
            }
            LastPlayerWork = r;
            if (!r.Ok || (o != null && o.IsDone)) StopPlayerWork();
        }

        // ---- 명령 (모두 성공 여부와 실패 코드를 반환) ----

        public void SetPlayerPosition(double x, double z, double yaw)
        {
            World.PlayerX = x; World.PlayerZ = z; World.PlayerYaw = yaw;
        }

        public Result InspectBuilding(int buildingId) { return ConstructionSystem.Survey(World, buildingId); }
        public Result SignContract(int buildingId, int grade, int tier) { return ConstructionSystem.SignContract(World, buildingId, grade, tier); }
        public Result OrderShortage(int buildingId) { return LogisticsSystem.OrderShortage(World, buildingId); }
        public Result OrderMaterial(int buildingId, int itemId, double qty) { return LogisticsSystem.OrderMaterial(World, buildingId, itemId, qty); }
        public Result SettleContract(int contractId) { return ConstructionSystem.Settle(World, contractId); }
        public Result HireWorker() { return WorkforceSystem.Hire(World); }

        public Result StartPlayerWork(int orderId)
        {
            var w = World;
            var o = w.OrderById(orderId);
            if (o == null || o.IsDone) return Result.Fail("NoOrder", "할 수 있는 작업이 아닙니다.");
            if (!ConstructionSystem.PrereqsDone(w, o)) return Result.Fail("Blocked", "선행 작업이 끝나지 않았습니다.");
            if (o.ClaimedBy > 0) return Result.Fail("Claimed", "다른 작업자가 하고 있는 작업입니다.");
            var b = w.BuildingById(o.BuildingId);
            if (Mathx.Dist(w.PlayerX, w.PlayerZ, b.X, b.Z) > ConstructionSystem.WorkRange) return Result.Fail("TooFar", "현장에 가까이 가야 합니다.");
            StopPlayerWork();
            w.PlayerWorkOrderId = orderId;
            return Result.Success();
        }

        public void StopPlayerWork()
        {
            var w = World;
            var o = w.OrderById(w.PlayerWorkOrderId);
            if (o != null && o.ClaimedBy == 0) o.ClaimedBy = -1;
            w.PlayerWorkOrderId = -1;
        }
    }
}
