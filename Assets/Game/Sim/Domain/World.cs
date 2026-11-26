using System.Collections.Generic;

namespace RebuildCity.Sim
{
    /// <summary>게임 전체 상태. Unity 객체를 참조하지 않는 순수 데이터.</summary>
    public sealed class WorldState
    {
        public const double DepotX = -45, DepotZ = 8;
        public const double ShelterX = 45, ShelterZ = -9;
        public const double ExitX = -72, ExitZ = 0;
        public const long StartCash = 50000000;

        public ulong Seed;
        public Rng Rng;
        public long Tick;
        public long Cash;
        public int Reputation;
        public int CompletedContracts;
        public int NextId = 1;
        public long LedgerSeq;
        public long NextDisasterTick;
        public int DisasterCount;
        public double PlayerX, PlayerZ, PlayerYaw;
        public int PlayerWorkOrderId = -1;

        public List<Building> Buildings = new List<Building>();
        public List<Worker> Workers = new List<Worker>();
        public List<Contract> Contracts = new List<Contract>();
        public List<WorkOrder> Orders = new List<WorkOrder>();
        public List<PurchaseOrder> Purchases = new List<PurchaseOrder>();
        public List<LedgerEntry> Ledger = new List<LedgerEntry>();
        public Truck Truck = new Truck();
        public DisasterEvent Disaster;

        // 화면 알림용(저장하지 않음)
        public List<SimEvent> Events = new List<SimEvent>();

        public int NewId() { return NextId++; }

        public bool Alert
        {
            get { return Disaster != null && !Disaster.Finished && Tick >= Disaster.WarnTick; }
        }

        public bool DisasterActive
        {
            get { return Disaster != null && !Disaster.Finished && Tick >= Disaster.StartTick; }
        }

        public Building BuildingById(int id)
        {
            for (int i = 0; i < Buildings.Count; i++) if (Buildings[i].Id == id) return Buildings[i];
            return null;
        }

        public Contract ContractById(int id)
        {
            for (int i = 0; i < Contracts.Count; i++) if (Contracts[i].Id == id) return Contracts[i];
            return null;
        }

        public WorkOrder OrderById(int id)
        {
            for (int i = 0; i < Orders.Count; i++) if (Orders[i].Id == id) return Orders[i];
            return null;
        }

        public Worker WorkerById(int id)
        {
            for (int i = 0; i < Workers.Count; i++) if (Workers[i].Id == id) return Workers[i];
            return null;
        }

        public long UnpaidWages
        {
            get
            {
                long s = 0;
                for (int i = 0; i < Workers.Count; i++) s += Workers[i].UnpaidWage;
                return s;
            }
        }

        public void Emit(string kind, string text)
        {
            Events.Add(new SimEvent { Tick = Tick, Kind = kind, Text = text });
            if (Events.Count > 60) Events.RemoveAt(0);
        }

        /// <summary>원장에 기록하고 현금을 바꾼다. 현금은 항상 원장 합계와 같다.</summary>
        public void Post(string kind, long amount, int refId, string memo)
        {
            Ledger.Add(new LedgerEntry { Seq = LedgerSeq++, Tick = Tick, Kind = kind, Amount = amount, RefId = refId, Memo = memo });
            Cash += amount;
        }

        public bool HasLedger(string kind, int refId)
        {
            for (int i = 0; i < Ledger.Count; i++)
                if (Ledger[i].RefId == refId && Ledger[i].Kind == kind) return true;
            return false;
        }

        public long LedgerSum()
        {
            long s = 0;
            for (int i = 0; i < Ledger.Count; i++) s += Ledger[i].Amount;
            return s;
        }
    }

    public static class WorldFactory
    {
        static readonly string[] Owners = { "김영수", "이정민", "박서연", "최동현", "정하윤", "한지호" };
        static readonly string[] WorkerNames = { "오반장", "강기사", "문기사", "서기사" };

        public static WorldState NewGame(ulong seed)
        {
            var w = new WorldState();
            w.Seed = seed;
            w.Rng = new Rng(seed * 2654435761UL + 12345);
            w.Tick = SimTime.WorkStartHour * SimTime.TicksPerHour;
            w.PlayerX = WorldState.DepotX + 6;
            w.PlayerZ = 3;
            w.Post("Initial", WorldState.StartCash, 0, "초기 자금");

            int n = 0;
            for (int side = 1; side >= -1; side -= 2)
                for (int ix = -1; ix <= 1; ix++)
                    w.Buildings.Add(MakeHouse(w, n, ix * 22.0, side * 12.0, side, Owners[n++]));

            for (int i = 0; i < 2; i++) w.Workers.Add(MakeWorker(w));

            w.Truck.X = WorldState.DepotX;
            w.Truck.Z = WorldState.DepotZ;
            // 첫 재난: 시작 30분 뒤 예보, 1시간 뒤 통과
            w.NextDisasterTick = w.Tick + 60;
            return w;
        }

        public static Worker MakeWorker(WorldState w)
        {
            int idx = w.Workers.Count;
            var k = new Worker();
            k.Id = w.NewId();
            k.Name = WorkerNames[idx % WorkerNames.Length];
            k.Skill = idx == 0 ? 1.0 : System.Math.Round(w.Rng.Range(0.8, 1.2), 2);
            k.X = WorldState.DepotX + 2 + idx * 1.5;
            k.Z = WorldState.DepotZ - 4;
            k.State = WorkerState.Idle;
            return k;
        }

        static Building MakeHouse(WorldState w, int index, double x, double z, int side, string owner)
        {
            var b = new Building();
            b.Id = w.NewId();
            b.Name = "주택 " + (index + 1) + "호";
            b.Owner = owner;
            b.X = x; b.Z = z; b.Side = side;

            Add(w, b, PartType.Foundation, 0, "기초", 40, "m2", 0.0);
            Add(w, b, PartType.Frame, 0, "골조", 1, "식", 0.05);
            Add(w, b, PartType.Wall, 0, "외벽(북)", 24, "m2", 0.35);
            Add(w, b, PartType.Wall, 1, "외벽(동)", 15, "m2", 0.35);
            Add(w, b, PartType.Wall, 2, "외벽(남)", 24, "m2", 0.35);
            Add(w, b, PartType.Wall, 3, "외벽(서)", 15, "m2", 0.35);
            Add(w, b, PartType.Roof, 0, "지붕", 40, "m2", 1.0);
            for (int i = 0; i < 4; i++) Add(w, b, PartType.Window, i, "창호 " + (i + 1), 1, "개", 0.9);
            Add(w, b, PartType.Door, 0, "현관문", 1, "개", 0.5);
            Add(w, b, PartType.Electric, 0, "전기", 1, "식", 0.15);
            Add(w, b, PartType.Plumbing, 0, "배관", 1, "식", 0.05);
            Add(w, b, PartType.Finish, 0, "내부 마감", 40, "m2", 0.2);
            return b;
        }

        static void Add(WorldState w, Building b, PartType type, int slot, string name, double qty, string unit, double vuln)
        {
            b.Parts.Add(new Part { Id = w.NewId(), Type = type, Slot = slot, Name = name, Quantity = qty, Unit = unit, Vulnerability = vuln });
        }
    }
}
