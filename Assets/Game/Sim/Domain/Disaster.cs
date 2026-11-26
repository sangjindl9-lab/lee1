using System;

namespace RebuildCity.Sim
{
    /// <summary>토네이도 재난. 경로·강도는 시드로 정해지고, 피해는 부재별로 누적된다.</summary>
    public static class DisasterSystem
    {
        public const int WarnLeadTicks = 30;

        public static void Tick(WorldState w)
        {
            if ((w.Disaster == null || w.Disaster.Finished) && w.Tick >= w.NextDisasterTick - WarnLeadTicks)
            {
                w.Disaster = Create(w, w.Rng.NextU64(), Math.Max(w.Tick, w.NextDisasterTick - WarnLeadTicks), w.NextDisasterTick);
                w.DisasterCount++;
                w.Emit("Warn", "토네이도 예보! 30분 뒤 마을을 지나갑니다. 작업자를 대피시킵니다.");
            }

            var ev = w.Disaster;
            if (ev == null || ev.Finished || w.Tick < ev.StartTick) return;

            if (w.Tick > ev.EndTick)
            {
                ev.Finished = true;
                w.NextDisasterTick = w.Tick + SimTime.TicksPerDay * 2 + w.Rng.Range(0, SimTime.TicksPerDay * 2);
                w.Emit("Clear", "토네이도가 지나갔습니다. 피해 주택을 조사하세요.");
                ConstructionSystem.ReplanAfterDisaster(w);
                return;
            }

            double tx, tz;
            Position(ev, w.Tick, out tx, out tz);
            var local = new Rng(ev.Seed ^ ((ulong)w.Tick * 0x9E3779B97F4A7C15UL));
            for (int i = 0; i < w.Buildings.Count; i++)
                ApplyDamage(w.Buildings[i], ev, w.Tick, tx, tz, local);
        }

        public static DisasterEvent Create(WorldState w, ulong seed, long warnTick, long startTick)
        {
            var r = new Rng(seed);
            var ev = new DisasterEvent();
            ev.Id = w.NewId();
            ev.Seed = seed;
            ev.WarnTick = warnTick;
            ev.StartTick = startTick;
            ev.Radius = 16;
            ev.Speed = 3;
            ev.Intensity = 0.09 * r.Range(0.85, 1.2);
            double dir = r.NextDouble() < 0.5 ? 1 : -1;
            ev.Path = new double[]
            {
                -80 * dir, r.Range(-14, 14),
                0, r.Range(-14, 14),
                80 * dir, r.Range(-14, 14)
            };
            ev.EndTick = startTick + (long)Math.Ceiling(PathLength(ev) / ev.Speed);
            return ev;
        }

        public static double PathLength(DisasterEvent ev)
        {
            double len = 0;
            for (int i = 0; i + 3 < ev.Path.Length; i += 2)
                len += Mathx.Dist(ev.Path[i], ev.Path[i + 1], ev.Path[i + 2], ev.Path[i + 3]);
            return len;
        }

        public static void Position(DisasterEvent ev, long tick, out double x, out double z)
        {
            double d = Math.Max(0, (tick - ev.StartTick) * ev.Speed);
            for (int i = 0; i + 3 < ev.Path.Length; i += 2)
            {
                double seg = Mathx.Dist(ev.Path[i], ev.Path[i + 1], ev.Path[i + 2], ev.Path[i + 3]);
                if (d <= seg)
                {
                    double t = seg <= 0 ? 0 : d / seg;
                    x = ev.Path[i] + (ev.Path[i + 2] - ev.Path[i]) * t;
                    z = ev.Path[i + 1] + (ev.Path[i + 3] - ev.Path[i + 1]) * t;
                    return;
                }
                d -= seg;
            }
            x = ev.Path[ev.Path.Length - 2];
            z = ev.Path[ev.Path.Length - 1];
        }

        /// <summary>damage = clamp(강도 × 노출도 × 취약도 × 100, 0, 100). 같은 재난·같은 틱은 한 번만 적용한다.</summary>
        public static bool ApplyDamage(Building b, DisasterEvent ev, long tick, double tx, double tz, Rng local)
        {
            if (b.LastEventId == ev.Id && b.LastDamageTick == tick) return false;
            b.LastEventId = ev.Id;
            b.LastDamageTick = tick;

            double dist = Mathx.Dist(b.X, b.Z, tx, tz);
            if (dist >= ev.Radius) return false;
            double exposure = 1.0 - dist / ev.Radius;

            for (int i = 0; i < b.Parts.Count; i++)
            {
                var p = b.Parts[i];
                double jitter = local.Range(0.6, 1.4);
                double vuln = p.Vulnerability * (1.0 - p.WindResist) * jitter;
                double damage = Mathx.Clamp(ev.Intensity * exposure * vuln * 100.0, 0, 100);
                if (damage <= 0) continue;
                double before = p.Hp;
                p.Hp = Math.Max(0, p.Hp - damage);
                if (p.Type == PartType.Roof) b.DebrisM3 += p.Quantity * (before - p.Hp) / 100.0 * 0.1;
            }
            return true;
        }
    }
}
