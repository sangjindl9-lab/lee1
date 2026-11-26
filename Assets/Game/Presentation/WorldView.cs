using System.Collections.Generic;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>시뮬레이션 상태를 읽어 3D 마을을 그린다. 상태는 바꾸지 않는다.</summary>
    public sealed class WorldView
    {
        public readonly GameObject Root;
        readonly List<BuildingView> buildings = new List<BuildingView>();
        readonly List<ActorView> workers = new List<ActorView>();
        readonly Transform workerRoot;
        TruckView truck;
        GameObject tornado;

        public WorldView(WorldState w)
        {
            Root = new GameObject("World");
            var t = Root.transform;

            Vis.Box(t, "Ground", new Vector3(0, -0.25f, 0), new Vector3(220, 0.5f, 140), new Color(0.40f, 0.58f, 0.33f));
            Vis.Box(t, "Road", new Vector3(0, 0.02f, 0), new Vector3(200, 0.06f, 6), new Color(0.25f, 0.26f, 0.28f), false);
            for (int i = -9; i <= 9; i++)
                Vis.Box(t, "Lane", new Vector3(i * 10, 0.06f, 0), new Vector3(4, 0.02f, 0.18f), new Color(0.9f, 0.9f, 0.8f), false);

            // 사무소(차고)와 대피소
            var office = Vis.Box(t, "Office", Vis.P(WorldState.DepotX - 2, WorldState.DepotZ + 7, 1.75f), new Vector3(9, 3.5f, 6), new Color(0.85f, 0.82f, 0.74f));
            Vis.Box(office.transform, "OfficeRoof", new Vector3(0, 0.56f, 0), new Vector3(1.08f, 0.12f, 1.1f), new Color(0.16f, 0.38f, 0.42f), false);
            Vis.Box(t, "Yard", Vis.P(WorldState.DepotX, WorldState.DepotZ, 0.03f), new Vector3(10, 0.06f, 7), new Color(0.55f, 0.55f, 0.52f), false);
            var shelter = Vis.Box(t, "Shelter", Vis.P(WorldState.ShelterX + 2, WorldState.ShelterZ - 5, 1.5f), new Vector3(10, 3, 5), new Color(0.75f, 0.78f, 0.80f));
            Vis.Box(shelter.transform, "ShelterSign", new Vector3(0, 0.62f, 0), new Vector3(0.5f, 0.25f, 0.2f), new Color(0.1f, 0.6f, 0.3f), false);

            for (int i = 0; i < 14; i++)
            {
                float x = -95 + i * 15 + (i % 2) * 4;
                float z = (i % 2 == 0) ? 30 + (i % 3) * 4 : -30 - (i % 3) * 4;
                var trunk = Vis.Prim(PrimitiveType.Cylinder, t, "Tree", new Vector3(x, 1.2f, z), new Vector3(0.4f, 1.2f, 0.4f), new Color(0.40f, 0.28f, 0.18f), true);
                Vis.Prim(PrimitiveType.Sphere, trunk.transform, "Leaves", new Vector3(0, 1.3f, 0), new Vector3(6f, 2.2f, 6f), new Color(0.22f, 0.45f, 0.24f), false);
            }

            for (int i = 0; i < w.Buildings.Count; i++) buildings.Add(new BuildingView(t, w.Buildings[i]));
            workerRoot = new GameObject("Workers").transform;
            workerRoot.SetParent(t, false);
            truck = new TruckView(t);

            tornado = new GameObject("Tornado");
            tornado.transform.SetParent(t, false);
            for (int i = 0; i < 9; i++)
            {
                float r = 1.5f + i * 1.3f;
                Vis.Prim(PrimitiveType.Cylinder, tornado.transform, "Ring", new Vector3(Mathf.Sin(i) * 0.6f, 1.5f + i * 3f, Mathf.Cos(i) * 0.6f),
                    new Vector3(r, 1.5f, r), new Color(0.42f, 0.43f, 0.45f), false);
            }
            tornado.SetActive(false);
        }

        public void Sync(WorldState w, int selectedBuilding, int selectedPart, float dt)
        {
            for (int i = 0; i < buildings.Count; i++)
            {
                var b = w.BuildingById(buildings[i].BuildingId);
                if (b != null) buildings[i].Refresh(w, b, selectedBuilding == b.Id ? selectedPart : -2);
            }

            while (workers.Count < w.Workers.Count) workers.Add(new ActorView(workerRoot, new Color(0.95f, 0.75f, 0.1f), new Color(0.2f, 0.35f, 0.6f)));
            for (int i = 0; i < workers.Count; i++)
            {
                bool on = i < w.Workers.Count;
                workers[i].Root.SetActive(on);
                if (!on) continue;
                var k = w.Workers[i];
                workers[i].Sync(Vis.P(k.X, k.Z), k.State == WorkerState.Work, k.Carry > 0.01, dt);
            }

            truck.Sync(w.Truck, dt);

            bool active = w.DisasterActive;
            tornado.SetActive(active);
            if (active)
            {
                double x, z;
                DisasterSystem.Position(w.Disaster, w.Tick, out x, out z);
                tornado.transform.position = Vector3.Lerp(tornado.transform.position, Vis.P(x, z), 0.2f);
                tornado.transform.Rotate(0, 420 * dt, 0);
            }
            else if (w.Disaster != null && !w.Disaster.Finished)
            {
                tornado.transform.position = Vis.P(w.Disaster.Path[0], w.Disaster.Path[1]);
            }
        }

        public void Destroy() { Object.Destroy(Root); }
    }

    /// <summary>건물 한 채. 부재마다 물체가 따로 있어서 지붕만 부서지고 벽과 창은 남을 수 있다.</summary>
    public sealed class BuildingView
    {
        public readonly int BuildingId;
        readonly Transform root;
        readonly Dictionary<int, GameObject> partObjects = new Dictionary<int, GameObject>();
        readonly GameObject[] tiles = new GameObject[20];
        readonly int[] tileOrder = new int[20];
        readonly Vector3[] tilePos = new Vector3[20];
        readonly Quaternion[] tileRot = new Quaternion[20];
        readonly List<GameObject> debris = new List<GameObject>();
        readonly List<GameObject> stock = new List<GameObject>();
        readonly GameObject safetyZone;
        long lastHash = long.MinValue;

        static readonly Color WallOk = new Color(0.93f, 0.89f, 0.80f), WallBad = new Color(0.52f, 0.45f, 0.38f);
        static readonly Color RoofOld = new Color(0.62f, 0.27f, 0.20f), RoofBroken = new Color(0.28f, 0.20f, 0.17f), RoofNew = new Color(0.20f, 0.42f, 0.52f);
        static readonly Color Glass = new Color(0.55f, 0.78f, 0.90f), GlassBroken = new Color(0.18f, 0.20f, 0.22f);
        static readonly Color Selected = new Color(1.0f, 0.85f, 0.2f);
        static readonly Color[] ItemColor = { new Color(0.20f, 0.42f, 0.52f), new Color(0.55f, 0.78f, 0.90f), new Color(0.93f, 0.89f, 0.80f), new Color(0.8f, 0.5f, 0.2f) };

        public BuildingView(Transform parent, Building b)
        {
            BuildingId = b.Id;
            var go = new GameObject(b.Name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = Vis.P(b.X, b.Z);
            root = go.transform;
            float front = -b.Side;   // 도로 쪽 방향(z)

            Bind(b, PartType.Foundation, 0, Vis.Box(root, "기초", new Vector3(0, 0.15f, 0), new Vector3(8.4f, 0.3f, 5.4f), new Color(0.6f, 0.6f, 0.6f)));
            var frame = Vis.Box(root, "골조", new Vector3(0, 3.3f, 0), new Vector3(8.2f, 0.16f, 0.2f), new Color(0.50f, 0.36f, 0.22f), false);
            for (int i = 0; i < 4; i++)
                Vis.Box(root, "기둥", new Vector3(i < 2 ? -3.95f : 3.95f, 1.8f, i % 2 == 0 ? -2.45f : 2.45f), new Vector3(0.22f, 3f, 0.22f), new Color(0.50f, 0.36f, 0.22f), false);
            for (int i = 0; i < 5; i++)
                Vis.Box(root, "서까래", new Vector3(-3.2f + i * 1.6f, 3.38f, 0), new Vector3(0.12f, 0.12f, 5.2f), new Color(0.50f, 0.36f, 0.22f), false);
            Bind(b, PartType.Frame, 0, frame);

            Bind(b, PartType.Wall, 0, Vis.Box(root, "외벽(북)", new Vector3(0, 1.8f, 2.5f), new Vector3(8, 3, 0.2f), WallOk));
            Bind(b, PartType.Wall, 1, Vis.Box(root, "외벽(동)", new Vector3(4, 1.8f, 0), new Vector3(0.2f, 3, 5), WallOk));
            Bind(b, PartType.Wall, 2, Vis.Box(root, "외벽(남)", new Vector3(0, 1.8f, -2.5f), new Vector3(8, 3, 0.2f), WallOk));
            Bind(b, PartType.Wall, 3, Vis.Box(root, "외벽(서)", new Vector3(-4, 1.8f, 0), new Vector3(0.2f, 3, 5), WallOk));

            Bind(b, PartType.Window, 0, Vis.Box(root, "창호1", new Vector3(-2.4f, 2.0f, front * 2.62f), new Vector3(1.3f, 1.1f, 0.1f), Glass));
            Bind(b, PartType.Window, 1, Vis.Box(root, "창호2", new Vector3(2.4f, 2.0f, front * 2.62f), new Vector3(1.3f, 1.1f, 0.1f), Glass));
            Bind(b, PartType.Window, 2, Vis.Box(root, "창호3", new Vector3(-2.0f, 2.0f, -front * 2.62f), new Vector3(1.3f, 1.1f, 0.1f), Glass));
            Bind(b, PartType.Window, 3, Vis.Box(root, "창호4", new Vector3(2.0f, 2.0f, -front * 2.62f), new Vector3(1.3f, 1.1f, 0.1f), Glass));
            Bind(b, PartType.Door, 0, Vis.Box(root, "현관문", new Vector3(0, 1.35f, front * 2.62f), new Vector3(1.0f, 2.1f, 0.1f), new Color(0.42f, 0.26f, 0.16f)));
            Bind(b, PartType.Electric, 0, Vis.Box(root, "전기", new Vector3(4.18f, 1.6f, 1.2f), new Vector3(0.16f, 0.6f, 0.45f), new Color(0.75f, 0.75f, 0.78f)));
            Bind(b, PartType.Plumbing, 0, Vis.Box(root, "배관", new Vector3(-4.18f, 1.0f, -1.2f), new Vector3(0.14f, 1.6f, 0.14f), new Color(0.35f, 0.45f, 0.55f)));
            Bind(b, PartType.Finish, 0, Vis.Box(root, "내부 마감", new Vector3(0, 0.33f, 0), new Vector3(7.7f, 0.06f, 4.7f), new Color(0.78f, 0.66f, 0.48f), false));

            // 지붕: 2m2 타일 20장(5열 × 4행), 박공 형태
            var roof = b.Find(PartType.Roof, 0);
            const float pitch = 25f;
            float tan = Mathf.Tan(pitch * Mathf.Deg2Rad);
            for (int i = 0; i < 20; i++)
            {
                int col = i % 5, row = i / 5;
                float x = -3.2f + col * 1.6f;
                float z = -1.875f + row * 1.25f;
                float y = 3.48f + (2.5f - Mathf.Abs(z)) * tan;
                tilePos[i] = new Vector3(x, y, z);
                tileRot[i] = Quaternion.Euler(z < 0 ? -pitch : pitch, 0, 0);
                var tile = Vis.Box(root, "지붕 타일", tilePos[i], new Vector3(1.58f, 0.12f, 1.40f), RoofOld);
                var pr = tile.AddComponent<PartRef>();
                pr.BuildingId = b.Id; pr.PartId = roof.Id;
                tiles[i] = tile;
                tileOrder[i] = i;
            }
            uint seed = (uint)(b.Id * 7919 + 13);
            for (int i = 19; i > 0; i--)
            {
                seed = seed * 1664525u + 1013904223u;
                int j = (int)((seed >> 8) % (uint)(i + 1));
                int tmp = tileOrder[i]; tileOrder[i] = tileOrder[j]; tileOrder[j] = tmp;
            }

            safetyZone = new GameObject("안전구역");
            safetyZone.transform.SetParent(root, false);
            for (int i = 0; i < 8; i++)
            {
                float a = i * Mathf.PI / 4f;
                Vis.Prim(PrimitiveType.Cylinder, safetyZone.transform, "Cone", new Vector3(Mathf.Cos(a) * 6.3f, 0.35f, Mathf.Sin(a) * 4.6f),
                    new Vector3(0.3f, 0.35f, 0.3f), new Color(1.0f, 0.45f, 0.1f), false);
            }
            safetyZone.SetActive(false);
        }

        void Bind(Building b, PartType type, int slot, GameObject go)
        {
            var p = b.Find(type, slot);
            var pr = go.GetComponent<PartRef>();
            if (pr == null) pr = go.AddComponent<PartRef>();
            pr.BuildingId = b.Id;
            pr.PartId = p.Id;
            partObjects[p.Id] = go;
        }

        public void Refresh(WorldState w, Building b, int selectedPart)
        {
            // 지붕 타일 상태: 파손 수, 철거된 수, 새로 설치된 수
            int broken = Mathf.RoundToInt((float)(ConstructionSystem.RoofDamagedArea(b.Find(PartType.Roof, 0)) / 2.0));
            int removed = 0, installed = 0;
            bool safety = false;
            var c = w.ContractById(b.ContractId);
            if (c != null)
            {
                double demolishTotal = 0, demolishDone = 0, installDone = 0;
                for (int i = 0; i < c.OrderIds.Count; i++)
                {
                    var o = w.OrderById(c.OrderIds[i]);
                    if (o == null) continue;
                    if (o.Type == WorkType.Demolish) { demolishTotal += o.Total; demolishDone += o.Done; }
                    else if (o.Type == WorkType.Install) installDone += o.Done;
                    else if (o.Type == WorkType.SafetyZone && o.IsDone) safety = true;
                }
                if (demolishTotal > 0)
                {
                    broken = Mathf.RoundToInt((float)(demolishTotal / 2.0));
                    removed = Mathf.FloorToInt((float)(demolishDone / 2.0 + 1e-6));
                    installed = Mathf.FloorToInt((float)(installDone / 2.0 + 1e-6));
                }
            }
            broken = Mathf.Clamp(broken, 0, 20);

            int debrisCount = Mathf.Min(14, Mathf.CeilToInt((float)b.DebrisM3 * 3f));
            int stockCount = 0;
            long hash = broken * 31L + removed * 961L + installed * 29791L + debrisCount * 7L + (safety ? 3 : 0) + (selectedPart + 5) * 1000003L;
            for (int i = 0; i < b.Parts.Count; i++) hash = hash * 131 + (long)b.Parts[i].Hp;
            for (int i = 0; i < b.Stock.Count; i++) { int n = Mathf.CeilToInt((float)b.Stock[i].OnSite / 2f); stockCount += n; hash = hash * 131 + n; }
            if (hash == lastHash) return;
            lastHash = hash;

            safetyZone.SetActive(safety);
            int roofId = b.Find(PartType.Roof, 0).Id;
            for (int n = 0; n < 20; n++)
            {
                int i = tileOrder[n];
                var tile = tiles[i];
                bool isNew = n < installed, isGone = !isNew && n < removed, isBroken = !isNew && !isGone && n < broken;
                tile.SetActive(!isGone);
                tile.transform.localPosition = tilePos[i] + (isBroken ? new Vector3(0, -0.22f, 0) : Vector3.zero);
                tile.transform.localRotation = tileRot[i] * (isBroken ? Quaternion.Euler(0, 9, 14) : Quaternion.identity);
                Color col = isNew ? RoofNew : (isBroken ? RoofBroken : RoofOld);
                Vis.Tint(tile, selectedPart == roofId ? Color.Lerp(col, Selected, 0.45f) : col);
            }

            for (int i = 0; i < b.Parts.Count; i++)
            {
                var p = b.Parts[i];
                GameObject go;
                if (p.Type == PartType.Roof || !partObjects.TryGetValue(p.Id, out go)) continue;
                var r = go.GetComponent<Renderer>();
                Color baseColor;
                float bad = 1f - Mathf.Clamp01((float)p.Hp / 100f);
                if (p.Type == PartType.Wall) baseColor = Color.Lerp(WallOk, WallBad, bad * 1.5f);
                else if (p.Type == PartType.Window) baseColor = p.Hp < 60 ? GlassBroken : Color.Lerp(Glass, GlassBroken, bad);
                else baseColor = Color.Lerp(OriginalColor(p.Type), new Color(0.2f, 0.18f, 0.16f), bad * 0.8f);
                r.sharedMaterial = Vis.Mat(selectedPart == p.Id ? Color.Lerp(baseColor, Selected, 0.5f) : baseColor);
                if (p.Type == PartType.Window) go.transform.localRotation = p.Hp < 25 ? Quaternion.Euler(0, 0, 18) : Quaternion.identity;
            }

            Pool(debris, debrisCount, "잔해", RoofBroken, i => new Vector3(-5.2f + (i % 7) * 0.9f, 0.18f, -b.Side * (3.6f + (i / 7) * 0.8f)), new Vector3(0.7f, 0.3f, 0.5f));
            Pool(stock, Mathf.Min(16, stockCount), "자재", Color.white, i => new Vector3(5.5f + (i % 2) * 0.9f - 0.45f, 0.2f + (i / 4) * 0.36f, -b.Side * (5.0f + ((i / 2) % 2) * 0.9f - 0.45f)), new Vector3(0.8f, 0.32f, 0.8f));
            int si = 0;
            for (int i = 0; i < b.Stock.Count && si < stock.Count; i++)
            {
                int n = Mathf.CeilToInt((float)b.Stock[i].OnSite / 2f);
                for (int k = 0; k < n && si < stock.Count; k++) Vis.Tint(stock[si++], ItemColor[b.Stock[i].ItemId % ItemColor.Length]);
            }
        }

        static Color OriginalColor(PartType t)
        {
            switch (t)
            {
                case PartType.Foundation: return new Color(0.6f, 0.6f, 0.6f);
                case PartType.Frame: return new Color(0.50f, 0.36f, 0.22f);
                case PartType.Door: return new Color(0.42f, 0.26f, 0.16f);
                case PartType.Electric: return new Color(0.75f, 0.75f, 0.78f);
                case PartType.Plumbing: return new Color(0.35f, 0.45f, 0.55f);
                default: return new Color(0.78f, 0.66f, 0.48f);
            }
        }

        void Pool(List<GameObject> list, int count, string name, Color color, System.Func<int, Vector3> pos, Vector3 scale)
        {
            while (list.Count < count)
            {
                int i = list.Count;
                var go = Vis.Box(root, name, pos(i), scale, color, false);
                go.transform.localRotation = Quaternion.Euler(0, (i * 37) % 90, 0);
                list.Add(go);
            }
            for (int i = 0; i < list.Count; i++) list[i].SetActive(i < count);
        }
    }

    /// <summary>사람 모양(작업자·대표). 걷기·작업·운반 동작을 단순한 움직임으로 표현한다.</summary>
    public sealed class ActorView
    {
        public readonly GameObject Root;
        readonly Transform body, arm, load;
        float phase;

        public ActorView(Transform parent, Color helmet, Color clothes)
        {
            Root = new GameObject("Actor");
            Root.transform.SetParent(parent, false);
            body = Vis.Prim(PrimitiveType.Capsule, Root.transform, "Body", new Vector3(0, 0.75f, 0), new Vector3(0.5f, 0.75f, 0.4f), clothes, false).transform;
            Vis.Prim(PrimitiveType.Sphere, body, "Head", new Vector3(0, 1.25f, 0), new Vector3(0.6f, 0.4f, 0.75f), new Color(0.95f, 0.8f, 0.68f), false);
            Vis.Prim(PrimitiveType.Sphere, body, "Helmet", new Vector3(0, 1.4f, 0), new Vector3(0.7f, 0.3f, 0.86f), helmet, false);
            var pivot = new GameObject("ArmPivot");
            pivot.transform.SetParent(body, false);
            pivot.transform.localPosition = new Vector3(0.6f, 0.45f, 0);
            arm = pivot.transform;
            Vis.Box(arm, "Arm", new Vector3(0, -0.35f, 0.15f), new Vector3(0.26f, 0.7f, 0.3f), clothes, false);
            Vis.Box(arm, "Tool", new Vector3(0, -0.8f, 0.5f), new Vector3(0.16f, 0.12f, 1.0f), new Color(0.3f, 0.3f, 0.32f), false);
            load = Vis.Box(body, "Load", new Vector3(0, 0.25f, 0.95f), new Vector3(1.2f, 0.35f, 0.9f), new Color(0.20f, 0.42f, 0.52f), false).transform;
            load.gameObject.SetActive(false);
        }

        public void Sync(Vector3 target, bool working, bool carrying, float dt)
        {
            var tr = Root.transform;
            Vector3 delta = target - tr.position;
            delta.y = 0;
            bool moving = delta.sqrMagnitude > 0.0004f;
            if (delta.sqrMagnitude > 400f) tr.position = target;
            else tr.position = Vector3.Lerp(tr.position, target, Mathf.Clamp01(dt * 8f));
            if (moving) tr.rotation = Quaternion.RotateTowards(tr.rotation, Quaternion.LookRotation(delta.normalized), 540f * dt);
            Animate(moving, working, carrying, dt);
        }

        public void Animate(bool moving, bool working, bool carrying, float dt)
        {
            phase += dt * (working ? 9f : 11f);
            float bob = moving ? Mathf.Abs(Mathf.Sin(phase)) * 0.07f : 0f;
            body.localPosition = new Vector3(0, 0.75f + bob, 0);
            arm.localRotation = working ? Quaternion.Euler(-55f + Mathf.Sin(phase) * 45f, 0, 0)
                : (moving ? Quaternion.Euler(Mathf.Sin(phase) * 30f, 0, 0) : Quaternion.identity);
            load.gameObject.SetActive(carrying);
        }
    }

    public sealed class TruckView
    {
        readonly Transform root;
        readonly GameObject cargo;

        public TruckView(Transform parent)
        {
            var go = new GameObject("Truck");
            go.transform.SetParent(parent, false);
            root = go.transform;
            Vis.Box(root, "Cab", new Vector3(0, 1.25f, 1.6f), new Vector3(2.0f, 1.7f, 1.5f), new Color(0.90f, 0.55f, 0.12f), false);
            Vis.Box(root, "Bed", new Vector3(0, 0.8f, -0.8f), new Vector3(2.0f, 0.3f, 3.4f), new Color(0.30f, 0.32f, 0.35f), false);
            cargo = Vis.Box(root, "Cargo", new Vector3(0, 1.35f, -0.8f), new Vector3(1.7f, 0.8f, 3.0f), new Color(0.20f, 0.42f, 0.52f), false);
            for (int i = 0; i < 4; i++)
            {
                var wheel = Vis.Prim(PrimitiveType.Cylinder, root, "Wheel", new Vector3(i < 2 ? -1.05f : 1.05f, 0.4f, i % 2 == 0 ? 1.4f : -1.6f),
                    new Vector3(0.8f, 0.12f, 0.8f), new Color(0.1f, 0.1f, 0.1f), false);
                wheel.transform.localRotation = Quaternion.Euler(0, 0, 90);
            }
        }

        public void Sync(Truck t, float dt)
        {
            Vector3 target = Vis.P(t.X, t.Z);
            Vector3 delta = target - root.position;
            if (delta.sqrMagnitude > 900f) root.position = target;
            else root.position = Vector3.Lerp(root.position, target, Mathf.Clamp01(dt * 8f));
            delta.y = 0;
            if (delta.sqrMagnitude > 0.0025f) root.rotation = Quaternion.RotateTowards(root.rotation, Quaternion.LookRotation(delta.normalized), 240f * dt);
            cargo.SetActive(t.State == TruckState.ToSite || t.State == TruckState.Unloading);
        }
    }
}
