using System.Collections.Generic;

namespace RebuildCity.Sim
{
    public enum PartType { Foundation, Frame, Wall, Roof, Window, Door, Electric, Plumbing, Finish }
    public enum DamageState { Healthy, Light, Heavy, Destroyed }

    /// <summary>건물의 독립 부재. hp 0~100.</summary>
    public sealed class Part
    {
        public int Id;
        public PartType Type;
        public int Slot;            // 같은 종류 안에서의 위치(벽 0~3, 창 0~3)
        public string Name;
        public double Hp = 100;
        public double Quantity;     // 물량
        public string Unit;         // m2, 개, 식
        public double Vulnerability;
        public double WindResist;   // 0~1, 복구 후 올라가며 다음 피해를 줄인다

        public DamageState State
        {
            get
            {
                if (Hp >= 90) return DamageState.Healthy;
                if (Hp >= 60) return DamageState.Light;
                if (Hp >= 25) return DamageState.Heavy;
                return DamageState.Destroyed;
            }
        }
    }

    public sealed class SiteStock
    {
        public int ItemId;
        public double OnSite;
        public double Reserved;
        public double Free { get { return OnSite - Reserved; } }
    }

    public sealed class PlanLine
    {
        public WorkType Type;
        public int PartId = -1;
        public string Name;
        public double Total;
        public string Unit;
        public double BaseRate;
        public int MaterialId = -1;
        public double MaterialPerUnit;
        public int Stage;           // 선행 단계 계산용
    }

    public sealed class Building
    {
        public int Id;
        public string Name;
        public string Owner;
        public double X, Z;
        public int Side;            // +1: 도로 북쪽, -1: 도로 남쪽
        public List<Part> Parts = new List<Part>();
        public double DebrisM3;
        public bool Surveyed;
        public long Budget;         // 조사 때 정해지는 고객 예산
        public int ContractId = -1;
        public int LastEventId = -1;
        public long LastDamageTick = -1;
        public List<SiteStock> Stock = new List<SiteStock>();

        public Part Find(PartType type, int slot)
        {
            for (int i = 0; i < Parts.Count; i++)
                if (Parts[i].Type == type && Parts[i].Slot == slot) return Parts[i];
            return null;
        }

        public Part PartById(int id)
        {
            for (int i = 0; i < Parts.Count; i++) if (Parts[i].Id == id) return Parts[i];
            return null;
        }

        public SiteStock StockOf(int itemId)
        {
            for (int i = 0; i < Stock.Count; i++) if (Stock[i].ItemId == itemId) return Stock[i];
            var s = new SiteStock { ItemId = itemId };
            Stock.Add(s);
            return s;
        }

        public bool IsDamaged
        {
            get
            {
                if (DebrisM3 > 0.001) return true;
                for (int i = 0; i < Parts.Count; i++) if (Parts[i].Hp < 90) return true;
                return false;
            }
        }

        public double StructuralSafety
        {
            get
            {
                double s = 100;
                for (int i = 0; i < Parts.Count; i++)
                    if ((Parts[i].Type == PartType.Frame || Parts[i].Type == PartType.Foundation) && Parts[i].Hp < s) s = Parts[i].Hp;
                return s;
            }
        }

        // 작업점·적치점: 건물 앞(도로 쪽)
        public double WorkX { get { return X; } }
        public double WorkZ { get { return Z - Side * 4.5; } }
        public double StockX { get { return X + 5.5; } }
        public double StockZ { get { return Z - Side * 5.0; } }
    }

    public enum WorkType { SafetyZone, ClearDebris, Demolish, Repair, Replace, Install, Rework, QualityCheck }
    public enum WorkState { Blocked, Ready, WaitMaterial, InProgress, Done }

    public sealed class WorkOrder
    {
        public int Id;
        public int ContractId;
        public int BuildingId;
        public int PartId = -1;
        public WorkType Type;
        public string Name;
        public double Total;
        public double Done;
        public string Unit;
        public double BaseRate;         // 단위/인·시간
        public int MaterialId = -1;
        public double MaterialPerUnit;  // 할증 포함
        public double MaterialUsed;
        public double HpStart;
        public List<int> Prereqs = new List<int>();
        public int ClaimedBy = -1;      // -1 없음, 0 플레이어, 그 외 작업자 ID
        public WorkState State = WorkState.Blocked;
        public long LastCommitTick = -1;
        public int LastCommitActor = -1;
        public long PlayerTick = -1;
        public double SkillWork;        // 숙련도 × 작업량 누계(품질 계산용)

        public double Remaining { get { return Total - Done; } }
        public bool IsDone { get { return State == WorkState.Done; } }
    }

    public enum ContractState { Active, Completed }

    public sealed class Contract
    {
        public int Id;
        public int BuildingId;
        public long Price;
        public long EstimatedCost;
        public long AdvancePaid;
        public long Paid;
        public int Grade;               // 0 보급, 1 표준, 2 고급
        public ContractState State;
        public List<int> OrderIds = new List<int>();
        public double Quality;
        public bool ReworkDone;
        public bool Settled;
        public long MaterialCost;
        public long LaborCost;
        public long DeadlineTick;
    }

    public enum WorkerState { Idle, MoveToStorage, Pickup, MoveToSite, Work, Evacuate, Safe, Rest }

    public sealed class Worker
    {
        public int Id;
        public string Name;
        public double Skill = 1.0;
        public double Fatigue;
        public long WagePerHour = 30000;
        public long UnpaidWage;
        public WorkerState State;
        public double X, Z, TargetX, TargetZ;
        public int JobId = -1;
        public double Carry;
        public int CarryItem = -1;
        public double ReservedQty;      // 적치점에 예약해 둔 수량
    }

    public enum PurchaseState { Ordered, InTransit, Delivered }

    public sealed class PurchaseOrder
    {
        public int Id;
        public int BuildingId;
        public int ItemId;
        public double Qty;
        public long Cost;
        public PurchaseState State;
    }

    public enum TruckState { Idle, ToSupplier, Loading, ToSite, Unloading, ToDepot }

    public sealed class Truck
    {
        public TruckState State;
        public double X, Z;
        public int BuildingId = -1;
        public int Wait;
        public List<double> Path = new List<double>(); // x,z 쌍
    }

    public sealed class DisasterEvent
    {
        public int Id;
        public ulong Seed;
        public long WarnTick, StartTick, EndTick;
        public double Radius;
        public double Intensity;        // 틱당 강도
        public double Speed;            // m/틱
        public double[] Path;           // x,z 쌍(경로 노드)
        public bool Finished;
    }

    public sealed class LedgerEntry
    {
        public long Seq;
        public long Tick;
        public string Kind;
        public long Amount;
        public int RefId;
        public string Memo;
    }

    public sealed class ItemDef
    {
        public int Id;
        public string Name;
        public string Unit;
        public long Price;
    }

    public static class Items
    {
        public const int Roofing = 0, Window = 1, Siding = 2, RepairKit = 3;

        public static readonly ItemDef[] All =
        {
            new ItemDef { Id = Roofing,   Name = "지붕재",   Unit = "m2", Price = 300000 },
            new ItemDef { Id = Window,    Name = "창호",     Unit = "개", Price = 600000 },
            new ItemDef { Id = Siding,    Name = "외벽재",   Unit = "m2", Price = 120000 },
            new ItemDef { Id = RepairKit, Name = "보수자재", Unit = "식", Price = 200000 },
        };

        public static readonly double[] GradePrice = { 0.8, 1.0, 1.3 };
        public static readonly double[] GradeScore = { 60, 80, 95 };
        public static readonly double[] GradeResist = { 0.10, 0.25, 0.40 };
        public static readonly string[] GradeName = { "보급", "표준", "고급" };

        public static long UnitPrice(int itemId, int grade) { return (long)(All[itemId].Price * GradePrice[grade]); }
    }

    public sealed class SimEvent
    {
        public long Tick;
        public string Kind;
        public string Text;
    }
}
