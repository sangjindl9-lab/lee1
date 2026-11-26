using System.Collections.Generic;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>시뮬레이션 상태를 읽어 3D 마을을 그린다. 상태는 바꾸지 않는다.</summary>
    public sealed class WorldView
    {
        public readonly GameObject Root;
        readonly Scenery scenery;
        readonly List<HouseView> houses = new List<HouseView>();
        readonly List<HumanView> workers = new List<HumanView>();
        readonly Transform actorRoot;
        readonly TruckView truck;
        readonly TornadoView tornado;
        readonly DustFx dust;
        float dustTimer;

        public bool HammerPulse;            // 이번 프레임에 망치 소리를 낼 때
        public Vector3 HammerPosition;
        public bool TornadoActive;
        public Vector3 TornadoPosition;

        static readonly Color[] Helmets = { Gfx.Hex(0xF2C230), Gfx.Hex(0x3F8AD6), Gfx.Hex(0xE5533D), Gfx.Hex(0x4CC38A) };

        public WorldView(WorldState w)
        {
            Root = new GameObject("World");
            scenery = new Scenery(Root.transform);
            for (int i = 0; i < w.Buildings.Count; i++) houses.Add(new HouseView(Root.transform, w.Buildings[i], i));
            actorRoot = new GameObject("Actors").transform;
            actorRoot.SetParent(Root.transform, false);
            truck = new TruckView(Root.transform);
            tornado = new TornadoView(Root.transform);
            dust = new DustFx(Root.transform);
        }

        public void Sync(WorldState w, int selectedBuilding, int selectedPart, float night, float storm, float dt)
        {
            scenery.Sync(night, storm, dt);
            for (int i = 0; i < houses.Count; i++)
            {
                var b = w.BuildingById(houses[i].BuildingId);
                if (b != null) houses[i].Refresh(w, b, selectedBuilding == b.Id ? selectedPart : -2, night);
            }

            HammerPulse = false;
            dustTimer -= dt;
            bool puff = dustTimer <= 0;
            if (puff) dustTimer = 0.42f;

            while (workers.Count < w.Workers.Count)
                workers.Add(new HumanView(actorRoot, Helmets[workers.Count % Helmets.Length], Gfx.Hex(0x4A6FA5), Gfx.Hex(0x3A4250), true));
            for (int i = 0; i < workers.Count; i++)
            {
                bool on = i < w.Workers.Count;
                workers[i].Root.SetActive(on);
                if (!on) continue;
                var k = w.Workers[i];
                bool working = k.State == WorkerState.Work;
                Vector3 face = Vector3.zero;
                var o = w.OrderById(k.JobId);
                if (o != null) { var b = w.BuildingById(o.BuildingId); if (b != null) face = Gfx.P(b.X, b.Z); }
                workers[i].Follow(Gfx.P(k.X, k.Z), working, k.Carry > 0.01, dt, face);
                if (working && puff) EmitWork(workers[i].Root.transform.position, face);
            }

            if (w.PlayerWorkOrderId >= 0 && puff)
            {
                var o = w.OrderById(w.PlayerWorkOrderId);
                if (o != null) { var b = w.BuildingById(o.BuildingId); EmitWork(Gfx.P(w.PlayerX, w.PlayerZ), Gfx.P(b.X, b.Z)); }
            }

            truck.Sync(w.Truck, night, dt);

            TornadoActive = w.DisasterActive;
            if (TornadoActive)
            {
                double x, z;
                DisasterSystem.Position(w.Disaster, w.Tick, out x, out z);
                TornadoPosition = Gfx.P(x, z);
            }
            tornado.Sync(TornadoActive, TornadoPosition, dt);
            dust.Tick(dt);
        }

        void EmitWork(Vector3 from, Vector3 toward)
        {
            Vector3 dir = toward - from;
            dir.y = 0;
            Vector3 p = from + dir.normalized * 0.9f + Vector3.up * 1.1f;
            dust.Emit(p, new Color(0.78f, 0.72f, 0.62f, 0.5f));
            HammerPulse = true;
            HammerPosition = p;
        }

        public void Destroy() { Object.Destroy(Root); }
    }
}
