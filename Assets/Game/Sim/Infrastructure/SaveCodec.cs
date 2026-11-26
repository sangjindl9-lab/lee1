using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace RebuildCity.Sim
{
    /// <summary>
    /// 틱 경계 스냅샷 저장. 형식: "RBCS" + 버전 + 본문 길이 + FNV-1a 체크섬 + 본문.
    /// 파일은 임시 파일에 쓴 뒤 교체하고, 이전 저장은 .bak으로 남긴다.
    /// </summary>
    public static class SaveCodec
    {
        public const int Version = 1;
        static readonly byte[] Magic = { (byte)'R', (byte)'B', (byte)'C', (byte)'S' };

        public static byte[] Serialize(WorldState w)
        {
            var body = new MemoryStream();
            var bw = new BinaryWriter(body, Encoding.UTF8);
            WriteWorld(bw, w);
            bw.Flush();
            byte[] payload = body.ToArray();

            var ms = new MemoryStream();
            var hw = new BinaryWriter(ms, Encoding.UTF8);
            hw.Write(Magic);
            hw.Write(Version);
            hw.Write(payload.Length);
            hw.Write(Checksum(payload));
            hw.Write(payload);
            hw.Flush();
            return ms.ToArray();
        }

        public static WorldState Deserialize(byte[] data)
        {
            var br = new BinaryReader(new MemoryStream(data), Encoding.UTF8);
            byte[] magic = br.ReadBytes(4);
            if (magic.Length != 4 || magic[0] != Magic[0] || magic[1] != Magic[1] || magic[2] != Magic[2] || magic[3] != Magic[3])
                throw new InvalidDataException("저장 파일이 아닙니다.");
            int version = br.ReadInt32();
            if (version < 1 || version > Version) throw new InvalidDataException("지원하지 않는 저장 버전: " + version);
            int length = br.ReadInt32();
            ulong sum = br.ReadUInt64();
            byte[] payload = br.ReadBytes(length);
            if (payload.Length != length || Checksum(payload) != sum) throw new InvalidDataException("저장 파일이 손상되었습니다.");
            return ReadWorld(new BinaryReader(new MemoryStream(payload), Encoding.UTF8), version);
        }

        public static ulong Checksum(byte[] data)
        {
            ulong h = 14695981039346656037UL;
            for (int i = 0; i < data.Length; i++) { h ^= data[i]; h *= 1099511628211UL; }
            return h;
        }

        public static void SaveFile(WorldState w, string path)
        {
            byte[] data = Serialize(w);
            string tmp = path + ".tmp";
            File.WriteAllBytes(tmp, data);
            Deserialize(File.ReadAllBytes(tmp)); // 쓴 내용이 읽히는지 확인한 뒤 교체
            if (File.Exists(path))
            {
                string bak = path + ".bak";
                if (File.Exists(bak)) File.Delete(bak);
                File.Move(path, bak);
            }
            File.Move(tmp, path);
        }

        /// <summary>본 파일이 손상되었으면 백업에서 복구한다.</summary>
        public static WorldState LoadFile(string path)
        {
            try { return Deserialize(File.ReadAllBytes(path)); }
            catch (Exception)
            {
                string bak = path + ".bak";
                if (!File.Exists(bak)) throw;
                return Deserialize(File.ReadAllBytes(bak));
            }
        }

        static void WriteWorld(BinaryWriter b, WorldState w)
        {
            b.Write(w.Seed); b.Write(w.Rng.State); b.Write(w.Tick); b.Write(w.Cash);
            b.Write(w.Reputation); b.Write(w.CompletedContracts); b.Write(w.NextId); b.Write(w.LedgerSeq);
            b.Write(w.NextDisasterTick); b.Write(w.DisasterCount);
            b.Write(w.PlayerX); b.Write(w.PlayerZ); b.Write(w.PlayerYaw); b.Write(w.PlayerWorkOrderId);

            b.Write(w.Buildings.Count);
            foreach (var x in w.Buildings)
            {
                b.Write(x.Id); b.Write(x.Name); b.Write(x.Owner); b.Write(x.X); b.Write(x.Z); b.Write(x.Side);
                b.Write(x.DebrisM3); b.Write(x.Surveyed); b.Write(x.Budget); b.Write(x.ContractId);
                b.Write(x.LastEventId); b.Write(x.LastDamageTick);
                b.Write(x.Parts.Count);
                foreach (var p in x.Parts)
                {
                    b.Write(p.Id); b.Write((int)p.Type); b.Write(p.Slot); b.Write(p.Name); b.Write(p.Hp);
                    b.Write(p.Quantity); b.Write(p.Unit); b.Write(p.Vulnerability); b.Write(p.WindResist);
                }
                b.Write(x.Stock.Count);
                foreach (var s in x.Stock) { b.Write(s.ItemId); b.Write(s.OnSite); b.Write(s.Reserved); }
            }

            b.Write(w.Workers.Count);
            foreach (var k in w.Workers)
            {
                b.Write(k.Id); b.Write(k.Name); b.Write(k.Skill); b.Write(k.Fatigue); b.Write(k.WagePerHour); b.Write(k.UnpaidWage);
                b.Write((int)k.State); b.Write(k.X); b.Write(k.Z); b.Write(k.TargetX); b.Write(k.TargetZ);
                b.Write(k.JobId); b.Write(k.Carry); b.Write(k.CarryItem); b.Write(k.ReservedQty);
            }

            b.Write(w.Contracts.Count);
            foreach (var c in w.Contracts)
            {
                b.Write(c.Id); b.Write(c.BuildingId); b.Write(c.Price); b.Write(c.EstimatedCost); b.Write(c.AdvancePaid); b.Write(c.Paid);
                b.Write(c.Grade); b.Write((int)c.State); WriteInts(b, c.OrderIds); b.Write(c.Quality); b.Write(c.ReworkDone);
                b.Write(c.Settled); b.Write(c.MaterialCost); b.Write(c.LaborCost); b.Write(c.DeadlineTick);
            }

            b.Write(w.Orders.Count);
            foreach (var o in w.Orders)
            {
                b.Write(o.Id); b.Write(o.ContractId); b.Write(o.BuildingId); b.Write(o.PartId); b.Write((int)o.Type); b.Write(o.Name);
                b.Write(o.Total); b.Write(o.Done); b.Write(o.Unit); b.Write(o.BaseRate); b.Write(o.MaterialId); b.Write(o.MaterialPerUnit);
                b.Write(o.MaterialUsed); b.Write(o.HpStart); WriteInts(b, o.Prereqs); b.Write(o.ClaimedBy); b.Write((int)o.State);
                b.Write(o.LastCommitTick); b.Write(o.LastCommitActor); b.Write(o.PlayerTick); b.Write(o.SkillWork);
            }

            b.Write(w.Purchases.Count);
            foreach (var p in w.Purchases)
            {
                b.Write(p.Id); b.Write(p.BuildingId); b.Write(p.ItemId); b.Write(p.Qty); b.Write(p.Cost); b.Write((int)p.State);
            }

            b.Write(w.Ledger.Count);
            foreach (var l in w.Ledger)
            {
                b.Write(l.Seq); b.Write(l.Tick); b.Write(l.Kind); b.Write(l.Amount); b.Write(l.RefId); b.Write(l.Memo);
            }

            var t = w.Truck;
            b.Write((int)t.State); b.Write(t.X); b.Write(t.Z); b.Write(t.BuildingId); b.Write(t.Wait);
            b.Write(t.Path.Count);
            foreach (double d in t.Path) b.Write(d);

            b.Write(w.Disaster != null);
            if (w.Disaster != null)
            {
                var e = w.Disaster;
                b.Write(e.Id); b.Write(e.Seed); b.Write(e.WarnTick); b.Write(e.StartTick); b.Write(e.EndTick);
                b.Write(e.Radius); b.Write(e.Intensity); b.Write(e.Speed); b.Write(e.Finished);
                b.Write(e.Path.Length);
                foreach (double d in e.Path) b.Write(d);
            }
        }

        static WorldState ReadWorld(BinaryReader r, int version)
        {
            var w = new WorldState();
            w.Seed = r.ReadUInt64(); w.Rng = new Rng(1); w.Rng.State = r.ReadUInt64(); w.Tick = r.ReadInt64(); w.Cash = r.ReadInt64();
            w.Reputation = r.ReadInt32(); w.CompletedContracts = r.ReadInt32(); w.NextId = r.ReadInt32(); w.LedgerSeq = r.ReadInt64();
            w.NextDisasterTick = r.ReadInt64(); w.DisasterCount = r.ReadInt32();
            w.PlayerX = r.ReadDouble(); w.PlayerZ = r.ReadDouble(); w.PlayerYaw = r.ReadDouble(); w.PlayerWorkOrderId = r.ReadInt32();

            int n = r.ReadInt32();
            for (int i = 0; i < n; i++)
            {
                var x = new Building();
                x.Id = r.ReadInt32(); x.Name = r.ReadString(); x.Owner = r.ReadString(); x.X = r.ReadDouble(); x.Z = r.ReadDouble(); x.Side = r.ReadInt32();
                x.DebrisM3 = r.ReadDouble(); x.Surveyed = r.ReadBoolean(); x.Budget = r.ReadInt64(); x.ContractId = r.ReadInt32();
                x.LastEventId = r.ReadInt32(); x.LastDamageTick = r.ReadInt64();
                int pn = r.ReadInt32();
                for (int j = 0; j < pn; j++)
                {
                    var p = new Part();
                    p.Id = r.ReadInt32(); p.Type = (PartType)r.ReadInt32(); p.Slot = r.ReadInt32(); p.Name = r.ReadString(); p.Hp = r.ReadDouble();
                    p.Quantity = r.ReadDouble(); p.Unit = r.ReadString(); p.Vulnerability = r.ReadDouble(); p.WindResist = r.ReadDouble();
                    x.Parts.Add(p);
                }
                int sn = r.ReadInt32();
                for (int j = 0; j < sn; j++)
                    x.Stock.Add(new SiteStock { ItemId = r.ReadInt32(), OnSite = r.ReadDouble(), Reserved = r.ReadDouble() });
                w.Buildings.Add(x);
            }

            n = r.ReadInt32();
            for (int i = 0; i < n; i++)
            {
                var k = new Worker();
                k.Id = r.ReadInt32(); k.Name = r.ReadString(); k.Skill = r.ReadDouble(); k.Fatigue = r.ReadDouble(); k.WagePerHour = r.ReadInt64(); k.UnpaidWage = r.ReadInt64();
                k.State = (WorkerState)r.ReadInt32(); k.X = r.ReadDouble(); k.Z = r.ReadDouble(); k.TargetX = r.ReadDouble(); k.TargetZ = r.ReadDouble();
                k.JobId = r.ReadInt32(); k.Carry = r.ReadDouble(); k.CarryItem = r.ReadInt32(); k.ReservedQty = r.ReadDouble();
                w.Workers.Add(k);
            }

            n = r.ReadInt32();
            for (int i = 0; i < n; i++)
            {
                var c = new Contract();
                c.Id = r.ReadInt32(); c.BuildingId = r.ReadInt32(); c.Price = r.ReadInt64(); c.EstimatedCost = r.ReadInt64(); c.AdvancePaid = r.ReadInt64(); c.Paid = r.ReadInt64();
                c.Grade = r.ReadInt32(); c.State = (ContractState)r.ReadInt32(); c.OrderIds = ReadInts(r); c.Quality = r.ReadDouble(); c.ReworkDone = r.ReadBoolean();
                c.Settled = r.ReadBoolean(); c.MaterialCost = r.ReadInt64(); c.LaborCost = r.ReadInt64(); c.DeadlineTick = r.ReadInt64();
                w.Contracts.Add(c);
            }

            n = r.ReadInt32();
            for (int i = 0; i < n; i++)
            {
                var o = new WorkOrder();
                o.Id = r.ReadInt32(); o.ContractId = r.ReadInt32(); o.BuildingId = r.ReadInt32(); o.PartId = r.ReadInt32(); o.Type = (WorkType)r.ReadInt32(); o.Name = r.ReadString();
                o.Total = r.ReadDouble(); o.Done = r.ReadDouble(); o.Unit = r.ReadString(); o.BaseRate = r.ReadDouble(); o.MaterialId = r.ReadInt32(); o.MaterialPerUnit = r.ReadDouble();
                o.MaterialUsed = r.ReadDouble(); o.HpStart = r.ReadDouble(); o.Prereqs = ReadInts(r); o.ClaimedBy = r.ReadInt32(); o.State = (WorkState)r.ReadInt32();
                o.LastCommitTick = r.ReadInt64(); o.LastCommitActor = r.ReadInt32(); o.PlayerTick = r.ReadInt64(); o.SkillWork = r.ReadDouble();
                w.Orders.Add(o);
            }

            n = r.ReadInt32();
            for (int i = 0; i < n; i++)
                w.Purchases.Add(new PurchaseOrder { Id = r.ReadInt32(), BuildingId = r.ReadInt32(), ItemId = r.ReadInt32(), Qty = r.ReadDouble(), Cost = r.ReadInt64(), State = (PurchaseState)r.ReadInt32() });

            n = r.ReadInt32();
            for (int i = 0; i < n; i++)
                w.Ledger.Add(new LedgerEntry { Seq = r.ReadInt64(), Tick = r.ReadInt64(), Kind = r.ReadString(), Amount = r.ReadInt64(), RefId = r.ReadInt32(), Memo = r.ReadString() });

            var t = w.Truck;
            t.State = (TruckState)r.ReadInt32(); t.X = r.ReadDouble(); t.Z = r.ReadDouble(); t.BuildingId = r.ReadInt32(); t.Wait = r.ReadInt32();
            n = r.ReadInt32();
            for (int i = 0; i < n; i++) t.Path.Add(r.ReadDouble());

            if (r.ReadBoolean())
            {
                var e = new DisasterEvent();
                e.Id = r.ReadInt32(); e.Seed = r.ReadUInt64(); e.WarnTick = r.ReadInt64(); e.StartTick = r.ReadInt64(); e.EndTick = r.ReadInt64();
                e.Radius = r.ReadDouble(); e.Intensity = r.ReadDouble(); e.Speed = r.ReadDouble(); e.Finished = r.ReadBoolean();
                e.Path = new double[r.ReadInt32()];
                for (int i = 0; i < e.Path.Length; i++) e.Path[i] = r.ReadDouble();
                w.Disaster = e;
            }
            return w;
        }

        static void WriteInts(BinaryWriter b, List<int> list)
        {
            b.Write(list.Count);
            for (int i = 0; i < list.Count; i++) b.Write(list[i]);
        }

        static List<int> ReadInts(BinaryReader r)
        {
            int n = r.ReadInt32();
            var list = new List<int>(n);
            for (int i = 0; i < n; i++) list.Add(r.ReadInt32());
            return list;
        }
    }
}
