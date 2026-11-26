using System;

namespace RebuildCity.Sim
{
    /// <summary>자재 발주와 트럭 배송. 발주 → 운송 중 → 현장 재고 → 예약 → 소비 순서로만 흐른다.</summary>
    public static class LogisticsSystem
    {
        public const double TruckStep = 8.0 * SimTime.TickSeconds;  // 8m/s
        public const double TruckCapacity = 60;
        public const int LoadTicks = 20;
        public const int UnloadTicks = 6;

        public static Result OrderMaterial(WorldState w, int buildingId, int itemId, double qty)
        {
            var b = w.BuildingById(buildingId);
            if (b == null) return Result.Fail("NoBuilding", "건물이 없습니다.");
            var c = w.ContractById(b.ContractId);
            if (c == null) return Result.Fail("NoContract", "계약된 현장이 아닙니다.");
            if (itemId < 0 || itemId >= Items.All.Length || qty <= 0 || qty != Math.Floor(qty)) return Result.Fail("BadArg", "수량이 잘못되었습니다.");
            long cost = (long)qty * Items.UnitPrice(itemId, c.Grade);
            if (w.Cash - w.UnpaidWages < cost) return Result.Fail("NoCash", "자금이 부족합니다.");

            var po = new PurchaseOrder { Id = w.NewId(), BuildingId = b.Id, ItemId = itemId, Qty = qty, Cost = cost, State = PurchaseState.Ordered };
            w.Purchases.Add(po);
            w.Post("Material", -cost, po.Id, Items.All[itemId].Name + " " + qty + Items.All[itemId].Unit);
            c.MaterialCost += cost;
            return Result.Success();
        }

        /// <summary>남은 공정에 부족한 자재를 한 번에 발주한다. 돈이 모자라면 아무것도 발주하지 않는다.</summary>
        public static Result OrderShortage(WorldState w, int buildingId)
        {
            var b = w.BuildingById(buildingId);
            if (b == null) return Result.Fail("NoBuilding", "건물이 없습니다.");
            var c = w.ContractById(b.ContractId);
            if (c == null) return Result.Fail("NoContract", "계약된 현장이 아닙니다.");
            var need = ConstructionSystem.MaterialShortage(w, c);
            long total = 0;
            for (int i = 0; i < need.Length; i++) total += (long)need[i] * Items.UnitPrice(i, c.Grade);
            if (total == 0) return Result.Fail("Nothing", "더 발주할 자재가 없습니다.");
            if (w.Cash - w.UnpaidWages < total + ConstructionSystem.DeliveryFee) return Result.Fail("NoCash", "자금이 부족합니다.");
            for (int i = 0; i < need.Length; i++)
                if (need[i] > 0) OrderMaterial(w, buildingId, i, need[i]);
            w.Emit("Order", b.Name + " 자재 발주 " + total.ToString("N0") + "원. 트럭이 실어 옵니다.");
            return Result.Success();
        }

        public static void Tick(WorldState w)
        {
            var t = w.Truck;
            if (w.Alert) return; // 경보 중에는 그 자리에서 대기

            switch (t.State)
            {
                case TruckState.Idle:
                    Dispatch(w, t);
                    break;
                case TruckState.ToSupplier:
                    if (Move(t)) { t.State = TruckState.Loading; t.Wait = LoadTicks; }
                    break;
                case TruckState.Loading:
                    if (--t.Wait <= 0)
                    {
                        var b = w.BuildingById(t.BuildingId);
                        SetPath(t, b.X, 0, b.X, b.Side * 5.5);
                        t.State = TruckState.ToSite;
                    }
                    break;
                case TruckState.ToSite:
                    if (Move(t)) { t.State = TruckState.Unloading; t.Wait = UnloadTicks; }
                    break;
                case TruckState.Unloading:
                    if (--t.Wait <= 0) Unload(w, t);
                    break;
                case TruckState.ToDepot:
                    if (Move(t)) { t.State = TruckState.Idle; t.BuildingId = -1; }
                    break;
            }
        }

        static void Dispatch(WorldState w, Truck t)
        {
            int target = -1;
            double load = 0;
            for (int i = 0; i < w.Purchases.Count; i++)
            {
                var po = w.Purchases[i];
                if (po.State != PurchaseState.Ordered) continue;
                if (target == -1)
                {
                    if (w.Cash - w.UnpaidWages < ConstructionSystem.DeliveryFee) return;
                    target = po.BuildingId;
                }
                if (po.BuildingId != target) continue;
                if (load > 0 && load + po.Qty > TruckCapacity) continue;
                load += po.Qty;
                po.State = PurchaseState.InTransit;
            }
            if (target == -1) return;
            t.BuildingId = target;
            w.Post("Delivery", -ConstructionSystem.DeliveryFee, target, "자재 운반비");
            var c = w.ContractById(w.BuildingById(target).ContractId);
            if (c != null) c.MaterialCost += ConstructionSystem.DeliveryFee;
            SetPath(t, WorldState.DepotX, 0, WorldState.ExitX, WorldState.ExitZ);
            t.State = TruckState.ToSupplier;
        }

        static void Unload(WorldState w, Truck t)
        {
            var b = w.BuildingById(t.BuildingId);
            for (int i = 0; i < w.Purchases.Count; i++)
            {
                var po = w.Purchases[i];
                if (po.State != PurchaseState.InTransit || po.BuildingId != b.Id) continue;
                po.State = PurchaseState.Delivered;
                b.StockOf(po.ItemId).OnSite += po.Qty;
            }
            w.Emit("Delivered", b.Name + " 현장에 자재가 도착했습니다.");
            t.Path.Clear();
            t.Path.Add(b.X); t.Path.Add(0);
            t.Path.Add(WorldState.DepotX); t.Path.Add(0);
            t.Path.Add(WorldState.DepotX); t.Path.Add(WorldState.DepotZ);
            t.State = TruckState.ToDepot;
        }

        static void SetPath(Truck t, double x1, double z1, double x2, double z2)
        {
            t.Path.Clear();
            t.Path.Add(x1); t.Path.Add(z1); t.Path.Add(x2); t.Path.Add(z2);
        }

        /// <summary>경로를 따라 한 틱 이동. 마지막 지점에 도착하면 true.</summary>
        static bool Move(Truck t)
        {
            double step = TruckStep;
            while (t.Path.Count >= 2)
            {
                double d = Mathx.Dist(t.X, t.Z, t.Path[0], t.Path[1]);
                if (d > step)
                {
                    t.X += (t.Path[0] - t.X) / d * step;
                    t.Z += (t.Path[1] - t.Z) / d * step;
                    return false;
                }
                t.X = t.Path[0]; t.Z = t.Path[1];
                step -= d;
                t.Path.RemoveRange(0, 2);
            }
            return true;
        }
    }
}
