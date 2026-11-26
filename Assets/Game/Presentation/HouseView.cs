using System.Collections.Generic;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>
    /// 주택 한 채. 기초·골조·외벽·지붕 타일·창호·현관·전기·배관·마감이 각각 따로 있는 물체라서
    /// 지붕만 부서지고 벽과 창은 남는 모습, 철거·설치가 진행되는 모습을 그대로 보여 준다.
    /// 집은 현관이 도로를 보도록 놓는다(기준 방향: 현관이 -z).
    /// </summary>
    public sealed class HouseView
    {
        public readonly int BuildingId;
        readonly Transform root;
        readonly int side;
        readonly Dictionary<int, List<Renderer>> partRenderers = new Dictionary<int, List<Renderer>>();
        readonly Dictionary<int, Transform> partRoots = new Dictionary<int, Transform>();

        const float Plinth = 0.4f, Eave = 3.3f, Pitch = 28f;
        static readonly float Tan = Mathf.Tan(Pitch * Mathf.Deg2Rad), Cos = Mathf.Cos(Pitch * Mathf.Deg2Rad), Sin = Mathf.Sin(Pitch * Mathf.Deg2Rad);
        static readonly float RidgeY = Eave + 2.5f * Tan;

        static readonly Color[] WallPalette = { Gfx.Hex(0xEFE3C8), Gfx.Hex(0xC8DCE6), Gfx.Hex(0xD3E2C2), Gfx.Hex(0xF0CDB8), Gfx.Hex(0xE2DED6), Gfx.Hex(0xF2E6A6) };
        static readonly Color[] RoofPalette = { Gfx.Hex(0xA4523C), Gfx.Hex(0x52626E), Gfx.Hex(0x3F7058), Gfx.Hex(0x7A4E3C), Gfx.Hex(0x474C54), Gfx.Hex(0xB06644) };
        static readonly Color[] AccentPalette = { Gfx.Hex(0x2F6E7A), Gfx.Hex(0x8A3B32), Gfx.Hex(0x3B5C8A), Gfx.Hex(0x4E7A46), Gfx.Hex(0xB5552E), Gfx.Hex(0x5A4A8A) };
        static readonly Color White = Gfx.Hex(0xF4F1EA), Concrete = Gfx.Hex(0x9C9A94), Wood = Gfx.Hex(0x8A6A48), DarkWood = Gfx.Hex(0x5A4230);
        static readonly Color SelectTint = new Color(1.25f, 1.12f, 0.55f);

        readonly Color wallColor, roofColor, accent;

        // 지붕 타일
        readonly Renderer[] tiles = new Renderer[20];
        readonly int[] tileOrder = new int[20];
        readonly Vector3[] tilePos = new Vector3[20];
        readonly Quaternion[] tileRot = new Quaternion[20];
        readonly Vector3[] tileSlope = new Vector3[20];

        // 창
        readonly Renderer[] glass = new Renderer[4];
        readonly GameObject[] brokenWindow = new GameObject[4];
        readonly GameObject[] crackedWindow = new GameObject[4];
        readonly Transform[] shutter = new Transform[4];

        // 벽 손상 자국
        readonly GameObject[][] wallDamage = new GameObject[4][];

        // 현장 표시
        readonly GameObject scaffold, safetyZone, siteBoard;
        readonly List<GameObject> debris = new List<GameObject>();
        readonly List<GameObject>[] stockStacks = new List<GameObject>[4];
        readonly Renderer doorLamp;
        Transform doorLeaf, downpipe, meterBox;

        long lastHash = long.MinValue;

        public HouseView(Transform parent, Building b, int index)
        {
            BuildingId = b.Id;
            side = b.Side;
            wallColor = WallPalette[index % WallPalette.Length];
            roofColor = RoofPalette[(index * 5 + 1) % RoofPalette.Length];
            accent = AccentPalette[(index * 3 + 2) % AccentPalette.Length];

            var go = new GameObject(b.Name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = Gfx.P(b.X, b.Z);
            go.transform.localRotation = Quaternion.Euler(0, side == 1 ? 0 : 180, 0);
            root = go.transform;

            BuildYard(b, index);
            BuildFoundation(b);
            BuildFrame(b);
            BuildWalls(b);
            BuildRoof(b);
            BuildWindows(b);
            BuildDoor(b);
            doorLamp = BuildServices(b);
            BuildInterior(b);
            scaffold = BuildScaffold();
            safetyZone = BuildSafetyZone(out siteBoard);
            BuildDebris(b);
            BuildStock();
        }

        // ---------- 부재 등록 ----------

        GameObject Register(Building b, PartType type, int slot, GameObject go, Vector3 colliderCenter, Vector3 colliderSize)
        {
            var p = b.Find(type, slot);
            var pr = go.AddComponent<PartRef>();
            pr.BuildingId = b.Id; pr.PartId = p.Id;
            if (colliderSize.x > 0)
            {
                var bc = go.AddComponent<BoxCollider>();
                bc.center = colliderCenter; bc.size = colliderSize;
            }
            partRoots[p.Id] = go.transform;
            Track(p.Id, go);
            return go;
        }

        void Track(int partId, GameObject go)
        {
            List<Renderer> list;
            if (!partRenderers.TryGetValue(partId, out list)) { list = new List<Renderer>(); partRenderers[partId] = list; }
            list.AddRange(go.GetComponentsInChildren<Renderer>(true));
        }

        // ---------- 마당 ----------

        void BuildYard(Building b, int index)
        {
            var mb = new MB();
            float padX = side == 1 ? 5.5f : -5.5f;
            mb.Box(new Vector3(0, 0.02f, -0.35f), new Vector3(19, 0.04f, 11.7f), Gfx.Hex(0x7FB862));
            // 현관 길과 자재 적치용 진입 마당
            for (int i = 0; i < 4; i++)
                mb.Box(new Vector3(0, 0.05f, -3.75f - i * 0.72f), new Vector3(1.25f, 0.06f, 0.62f), Gfx.Mul(Gfx.Hex(0xC9C3B5), 0.94f + Gfx.Hash(index, i) * 0.1f));
            mb.Box(new Vector3(padX, 0.045f, -4.6f), new Vector3(4.2f, 0.07f, 3.2f), Gfx.Hex(0xB4B0A6));
            mb.Box(new Vector3(padX, 0.05f, -4.6f), new Vector3(0.05f, 0.075f, 3.2f), Gfx.Hex(0x9A968C));

            // 울타리(뒤·양옆)
            Color fence = Gfx.Hex(0xF1EEE6);
            for (float x = -9.4f; x <= 9.41f; x += 0.34f)
                mb.Box(new Vector3(x, 0.5f, 5.45f), new Vector3(0.11f, 0.9f, 0.04f), fence, 0.85f);
            mb.Box(new Vector3(0, 0.72f, 5.48f), new Vector3(18.9f, 0.07f, 0.04f), fence);
            mb.Box(new Vector3(0, 0.3f, 5.48f), new Vector3(18.9f, 0.07f, 0.04f), fence);
            for (int s = -1; s <= 1; s += 2)
            {
                for (float z = -6.0f; z <= 5.4f; z += 0.34f)
                    mb.Box(new Vector3(s * 9.45f, 0.5f, z), new Vector3(0.04f, 0.9f, 0.11f), fence, 0.85f);
                mb.Box(new Vector3(s * 9.48f, 0.72f, -0.3f), new Vector3(0.04f, 0.07f, 11.5f), fence);
                mb.Box(new Vector3(s * 9.48f, 0.3f, -0.3f), new Vector3(0.04f, 0.07f, 11.5f), fence);
            }
            // 앞 생울타리(길과 진입 마당은 비운다)
            for (float x = -8.9f; x <= 8.9f; x += 0.95f)
            {
                if (Mathf.Abs(x) < 1.3f || Mathf.Abs(x - padX) < 2.5f) continue;
                mb.Blob(new Vector3(x, 0.42f, -6.0f), new Vector3(0.62f, 0.5f, 0.42f), Color.Lerp(Gfx.Hex(0x3F8A4A), Gfx.Hex(0x57A056), Gfx.Hash(index, x)), 1.15f, 0.7f, 0.25f);
            }
            // 우편함
            mb.Cyl(new Vector3(-1.15f, 0, -5.75f), 0.045f, 0.045f, 1.0f, 5, DarkWood);
            mb.Box(new Vector3(-1.15f, 1.08f, -5.75f), new Vector3(0.24f, 0.2f, 0.42f), accent);
            mb.Box(new Vector3(-1.01f, 1.16f, -5.6f), new Vector3(0.02f, 0.16f, 0.1f), Gfx.Hex(0xD23B2E));
            // 화단
            for (int s = -1; s <= 1; s += 2)
            {
                mb.Box(new Vector3(s * 2.5f, 0.1f, -3.05f), new Vector3(2.6f, 0.2f, 0.6f), Gfx.Hex(0x6B4A32), 0.8f);
                for (int k = 0; k < 6; k++)
                {
                    Color flower = k % 3 == 0 ? Gfx.Hex(0xE8627A) : (k % 3 == 1 ? Gfx.Hex(0xF2C14E) : Gfx.Hex(0xFFFFFF));
                    Vector3 p = new Vector3(s * (1.45f + k * 0.42f), 0.3f, -3.05f + (Gfx.Hash(index + k, s) - 0.5f) * 0.3f);
                    mb.Blob(p, new Vector3(0.2f, 0.16f, 0.2f), Gfx.Hex(0x4C9A4E), 1.1f, 0.8f, 0.3f);
                    mb.Blob(p + new Vector3(0, 0.16f, 0), new Vector3(0.11f, 0.09f, 0.11f), flower, 1.05f, 0.9f, 0f);
                }
            }
            // 마당 나무와 덤불
            float treeX = (index % 2 == 0 ? -1 : 1) * 7.0f;
            if (Mathf.Abs(treeX - padX) < 3f) treeX = -treeX;
            Scenery.Tree(mb, new Vector3(treeX, 0, 2.6f), 0.95f + Gfx.Hash(index, 7) * 0.35f, index % 3 == 0 ? 1 : 0, index * 13 + 5);
            mb.Blob(new Vector3(-treeX * 0.9f, 0.45f, 4.2f), new Vector3(1.0f, 0.75f, 0.9f), Gfx.Hex(0x4C9A4E), 1.15f, 0.7f, 0.35f);
            mb.Make(root, "Yard");
        }

        // ---------- 기초·골조 ----------

        void BuildFoundation(Building b)
        {
            var mb = new MB();
            mb.Box(new Vector3(0, Plinth * 0.5f, 0), new Vector3(8.5f, Plinth, 5.5f), Concrete, 0.8f);
            mb.Box(new Vector3(0, 0.14f, -3.05f), new Vector3(1.8f, 0.28f, 0.7f), Gfx.Mul(Concrete, 1.05f), 0.85f);
            mb.Box(new Vector3(0, 0.07f, -3.5f), new Vector3(2.0f, 0.14f, 0.4f), Gfx.Mul(Concrete, 1.05f), 0.85f);
            Register(b, PartType.Foundation, 0, mb.Make(root, "기초"), new Vector3(0, Plinth * 0.5f, 0), new Vector3(8.5f, Plinth, 5.5f));
        }

        void BuildFrame(Building b)
        {
            var mb = new MB();
            for (int s = -1; s <= 1; s += 2)
            {
                mb.Box(new Vector3(0, Eave - 0.06f, s * 2.4f), new Vector3(8.0f, 0.14f, 0.16f), Wood);
                for (int i = 0; i < 7; i++)
                {
                    float x = -3.75f + i * 1.25f;
                    mb.Beam(new Vector3(x, Eave - 0.02f - 0.42f * Tan, s * 2.92f), new Vector3(x, RidgeY - 0.06f, 0), 0.1f, Wood);
                }
                for (int k = 1; k <= 2; k++)
                    mb.Box(new Vector3(0, Eave + (2.5f - k * 0.95f) * Tan - 0.02f, s * k * 0.95f), new Vector3(8.6f, 0.07f, 0.07f), Gfx.Mul(Wood, 0.9f));
            }
            mb.Box(new Vector3(0, RidgeY - 0.1f, 0), new Vector3(8.6f, 0.16f, 0.12f), Wood);
            for (int i = 0; i < 4; i++)
                mb.Box(new Vector3(i < 2 ? -4.03f : 4.03f, Plinth + 1.45f, i % 2 == 0 ? -2.53f : 2.53f), new Vector3(0.2f, 2.9f, 0.2f), White, 0.92f);
            // 굴뚝
            mb.Box(new Vector3(2.7f, RidgeY + 0.15f, 0.95f), new Vector3(0.75f, 1.9f, 0.75f), Gfx.Hex(0x9A5A48), 0.85f);
            mb.Box(new Vector3(2.7f, RidgeY + 1.14f, 0.95f), new Vector3(0.9f, 0.12f, 0.9f), Gfx.Hex(0x6E4034));
            Register(b, PartType.Frame, 0, mb.Make(root, "골조"), Vector3.zero, Vector3.zero);
        }

        // ---------- 외벽 ----------

        void BuildWalls(Building b)
        {
            Color baseBand = Gfx.Mul(wallColor, 0.78f);
            for (int slot = 0; slot < 4; slot++)
            {
                var mb = new MB();
                bool gable = slot == 1 || slot == 3;
                float length = gable ? 5f : 8f;
                // 벽 기준 좌표: x 길이 방향, y 위, z 바깥쪽
                Vector3 pos; Quaternion rot;
                if (slot == 0) { pos = new Vector3(0, 0, 2.5f); rot = Quaternion.identity; }
                else if (slot == 2) { pos = new Vector3(0, 0, -2.5f); rot = Quaternion.Euler(0, 180, 0); }
                else if (slot == 1) { pos = new Vector3(4f, 0, 0); rot = Quaternion.Euler(0, 90, 0); }
                else { pos = new Vector3(-4f, 0, 0); rot = Quaternion.Euler(0, -90, 0); }
                mb.Push(pos, rot);
                mb.Box(new Vector3(0, Plinth + 0.2f, 0), new Vector3(length, 0.4f, 0.24f), baseBand);
                for (int i = 0; i < 7; i++)
                {
                    float y = Plinth + 0.4f + i * 0.357f + 0.178f;
                    mb.Box(new Vector3(0, y, 0.01f - (i % 2) * 0.012f), new Vector3(length, 0.357f, 0.2f), Gfx.Mul(wallColor, 0.97f + (i % 2) * 0.05f), 0.93f);
                }
                if (gable)
                {
                    mb.Tri(new Vector3(-2.5f, Eave, 0.1f), new Vector3(2.5f, Eave, 0.1f), new Vector3(0, RidgeY, 0.1f), Gfx.Mul(wallColor, 1.03f), Vector3.forward);
                    mb.Tri(new Vector3(-2.5f, Eave, -0.1f), new Vector3(2.5f, Eave, -0.1f), new Vector3(0, RidgeY, -0.1f), Gfx.Mul(wallColor, 0.8f), Vector3.back);
                    mb.Box(new Vector3(0, Eave + 0.5f, 0.12f), new Vector3(0.55f, 0.55f, 0.06f), White);
                    mb.Box(new Vector3(0, Eave + 0.5f, 0.16f), new Vector3(0.4f, 0.4f, 0.04f), Gfx.Hex(0x3A4046));
                }
                mb.Reset();
                var go = mb.Make(root, b.Find(PartType.Wall, slot).Name);
                Vector3 size = gable ? new Vector3(0.24f, 2.9f, 5f) : new Vector3(8f, 2.9f, 0.24f);
                Register(b, PartType.Wall, slot, go, pos + new Vector3(0, Plinth + 1.45f, 0), size);

                // 손상 자국(벗겨진 판자, 얼룩): 상태가 나쁠수록 많이 보인다
                wallDamage[slot] = new GameObject[8];
                for (int k = 0; k < 8; k++)
                {
                    var dm = new MB();
                    dm.Push(pos, rot);
                    float x = (Gfx.Hash(b.Id + slot * 7, k) - 0.5f) * (length - 1.4f);
                    float y = Plinth + 0.7f + Gfx.Hash(b.Id + slot * 11, k + 3) * 2.0f;
                    float w = 0.5f + Gfx.Hash(b.Id, k * 5 + slot) * 0.9f;
                    dm.Box(new Vector3(x, y, 0.115f), new Vector3(w, 0.3f, 0.03f), Gfx.Hex(0x4A3A30));
                    dm.Box(new Vector3(x + 0.1f, y - 0.32f, 0.115f), new Vector3(w * 0.7f, 0.22f, 0.03f), Gfx.Hex(0x5E4A3C));
                    dm.Box(new Vector3(x - 0.2f, y + 0.05f, 0.16f), new Vector3(w * 0.8f, 0.09f, 0.03f), Quaternion.Euler(0, 0, 14 - k * 5), Gfx.Mul(wallColor, 0.7f));
                    dm.Reset();
                    wallDamage[slot][k] = dm.Make(root, "벽 손상");
                    wallDamage[slot][k].SetActive(false);
                }
            }
        }

        // ---------- 지붕 ----------

        void BuildRoof(Building b)
        {
            var roof = b.Find(PartType.Roof, 0);
            const float tileW = 1.78f, tileD = 1.67f;
            var mb = new MB();
            // 타일 한 장: 세 겹으로 겹친 기와 모양(색은 물체별 색조로 준다)
            mb.Box(new Vector3(0, 0, 0), new Vector3(tileW - 0.03f, 0.07f, tileD), Gfx.Mul(Color.white, 0.86f));
            for (int k = 0; k < 3; k++)
                mb.Box(new Vector3(0, 0.05f + k * 0.006f, -tileD * 0.5f + 0.28f + k * 0.555f), new Vector3(tileW - 0.05f, 0.06f, 0.56f), Gfx.Mul(Color.white, 0.93f + k * 0.035f));
            for (int k = 0; k < 3; k++)
                for (int c = 0; c < 4; c++)
                    mb.Box(new Vector3(-tileW * 0.5f + 0.22f + c * 0.445f + (k % 2) * 0.1f, 0.085f + k * 0.006f, -tileD * 0.5f + 0.28f + k * 0.555f), new Vector3(0.02f, 0.012f, 0.5f), Gfx.Mul(Color.white, 0.74f));
            Mesh tileMesh = mb.Build("지붕 타일");

            for (int i = 0; i < 20; i++)
            {
                int col = i % 5, row = i / 5;          // row 0: 앞 처마, 1: 앞 용마루, 2: 뒤 용마루, 3: 뒤 처마
                int s = row < 2 ? -1 : 1;
                float d = (row == 1 || row == 2) ? tileD * 0.5f : tileD * 1.5f;   // 용마루에서 경사 따라 내려온 거리
                tilePos[i] = new Vector3(-3.56f + col * tileW, RidgeY - d * Sin + 0.07f, s * d * Cos);
                tileRot[i] = Quaternion.Euler(-Pitch, s < 0 ? 0 : 180, 0);   // 타일의 +z가 용마루 쪽
                tileSlope[i] = new Vector3(0, -Sin, s * Cos);

                var go = new GameObject("지붕 타일");
                go.transform.SetParent(root, false);
                go.transform.localPosition = tilePos[i];
                go.transform.localRotation = tileRot[i];
                go.AddComponent<MeshFilter>().sharedMesh = tileMesh;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = Gfx.Lit;
                var bc = go.AddComponent<BoxCollider>();
                bc.size = new Vector3(tileW, 0.2f, tileD);
                var pr = go.AddComponent<PartRef>();
                pr.BuildingId = b.Id; pr.PartId = roof.Id;
                tiles[i] = r;
                tileOrder[i] = i;
            }
            uint seed = (uint)(b.Id * 7919 + 13);
            for (int i = 19; i > 0; i--)
            {
                seed = seed * 1664525u + 1013904223u;
                int j = (int)((seed >> 8) % (uint)(i + 1));
                int tmp = tileOrder[i]; tileOrder[i] = tileOrder[j]; tileOrder[j] = tmp;
            }
        }

        // ---------- 창호·현관 ----------

        void BuildWindows(Building b)
        {
            float[] xs = { -2.45f, 2.45f, -2.0f, 2.0f };
            for (int slot = 0; slot < 4; slot++)
            {
                bool front = slot < 2;
                Vector3 pos = new Vector3(xs[slot], Plinth + 1.65f, front ? -2.62f : 2.62f);
                Quaternion rot = front ? Quaternion.Euler(0, 180, 0) : Quaternion.identity;   // 창 기준 좌표의 +z가 바깥
                var holder = new GameObject(b.Find(PartType.Window, slot).Name);
                holder.transform.SetParent(root, false);
                holder.transform.localPosition = pos;
                holder.transform.localRotation = rot;

                var mb = new MB();
                const float w = 1.3f, h = 1.25f;
                mb.Box(new Vector3(0, h * 0.5f + 0.05f, 0.02f), new Vector3(w + 0.22f, 0.11f, 0.14f), White);
                mb.Box(new Vector3(0, -h * 0.5f - 0.05f, 0.02f), new Vector3(w + 0.22f, 0.11f, 0.14f), White);
                mb.Box(new Vector3(-w * 0.5f - 0.05f, 0, 0.02f), new Vector3(0.11f, h, 0.14f), White);
                mb.Box(new Vector3(w * 0.5f + 0.05f, 0, 0.02f), new Vector3(0.11f, h, 0.14f), White);
                mb.Box(new Vector3(0, -h * 0.5f - 0.13f, 0.1f), new Vector3(w + 0.4f, 0.07f, 0.28f), White);
                mb.Make(holder.transform, "창틀");

                var gb = new MB();
                gb.Box(new Vector3(0, 0, 0.02f), new Vector3(w, h, 0.05f), Color.white);
                var glassGo = gb.Make(holder.transform, "유리");
                glass[slot] = glassGo.GetComponent<Renderer>();

                var bars = new MB();
                bars.Box(new Vector3(0, 0, 0.055f), new Vector3(0.06f, h, 0.03f), White);
                bars.Box(new Vector3(0, 0, 0.055f), new Vector3(w, 0.06f, 0.03f), White);
                bars.Make(holder.transform, "창살");

                // 덧문(양쪽)
                var sh = new MB();
                for (int s = -1; s <= 1; s += 2)
                {
                    sh.Box(new Vector3(s * (w * 0.5f + 0.42f), 0, 0.03f), new Vector3(0.5f, h + 0.1f, 0.06f), accent, 0.9f);
                    for (int k = 0; k < 5; k++)
                        sh.Box(new Vector3(s * (w * 0.5f + 0.42f), -h * 0.4f + k * 0.25f, 0.065f), new Vector3(0.4f, 0.03f, 0.02f), Gfx.Mul(accent, 0.75f));
                }
                shutter[slot] = sh.Make(holder.transform, "덧문").transform;

                var cr = new MB();
                cr.Beam(new Vector3(-0.5f, 0.45f, 0.06f), new Vector3(0.1f, -0.1f, 0.06f), 0.025f, Gfx.Hex(0xEAF2F6));
                cr.Beam(new Vector3(0.1f, -0.1f, 0.06f), new Vector3(0.45f, -0.5f, 0.06f), 0.025f, Gfx.Hex(0xEAF2F6));
                cr.Beam(new Vector3(0.1f, -0.1f, 0.06f), new Vector3(0.5f, 0.2f, 0.06f), 0.02f, Gfx.Hex(0xEAF2F6));
                crackedWindow[slot] = cr.Make(holder.transform, "금");
                crackedWindow[slot].SetActive(false);

                var br = new MB();
                br.Box(new Vector3(0, 0, 0.0f), new Vector3(w, h, 0.04f), Gfx.Hex(0x1C2126));
                br.Tri(new Vector3(-0.65f, -0.62f, 0.05f), new Vector3(-0.2f, -0.62f, 0.05f), new Vector3(-0.5f, 0.1f, 0.05f), Gfx.Hex(0xA9CFE0), Vector3.forward);
                br.Tri(new Vector3(0.65f, 0.62f, 0.05f), new Vector3(0.1f, 0.62f, 0.05f), new Vector3(0.45f, 0.05f, 0.05f), Gfx.Hex(0xA9CFE0), Vector3.forward);
                br.Tri(new Vector3(0.65f, -0.62f, 0.05f), new Vector3(0.3f, -0.62f, 0.05f), new Vector3(0.6f, -0.2f, 0.05f), Gfx.Hex(0xC4DEEA), Vector3.forward);
                br.Box(new Vector3(0.1f, -0.9f, 0.3f), new Vector3(0.5f, 0.03f, 0.3f), Quaternion.Euler(0, 25, 0), Gfx.Hex(0xA9CFE0));
                brokenWindow[slot] = br.Make(holder.transform, "깨진 창");
                brokenWindow[slot].SetActive(false);

                Register(b, PartType.Window, slot, holder, new Vector3(0, 0, 0.05f), new Vector3(w + 0.3f, h + 0.3f, 0.3f));
            }
        }

        void BuildDoor(Building b)
        {
            var holder = new GameObject("현관문");
            holder.transform.SetParent(root, false);
            holder.transform.localPosition = new Vector3(0, Plinth, -2.62f);

            var mb = new MB();
            mb.Box(new Vector3(-0.62f, 1.1f, 0), new Vector3(0.12f, 2.2f, 0.16f), White);
            mb.Box(new Vector3(0.62f, 1.1f, 0), new Vector3(0.12f, 2.2f, 0.16f), White);
            mb.Box(new Vector3(0, 2.26f, 0), new Vector3(1.36f, 0.12f, 0.16f), White);
            // 현관 지붕과 기둥
            mb.Box(new Vector3(0, 2.62f, -0.55f), new Vector3(2.3f, 0.1f, 1.3f), Quaternion.Euler(-12, 0, 0), Gfx.Mul(roofColor, 0.95f));
            mb.Box(new Vector3(0, 2.52f, -0.55f), new Vector3(2.2f, 0.07f, 1.2f), Quaternion.Euler(-12, 0, 0), Wood);
            mb.Box(new Vector3(-1.0f, 1.2f, -1.05f), new Vector3(0.12f, 2.5f, 0.12f), White, 0.92f);
            mb.Box(new Vector3(1.0f, 1.2f, -1.05f), new Vector3(0.12f, 2.5f, 0.12f), White, 0.92f);
            mb.Box(new Vector3(0, -0.1f, -0.75f), new Vector3(0.9f, 0.03f, 0.5f), Gfx.Hex(0x6B5A48));
            mb.Make(holder.transform, "문틀");

            var leaf = new GameObject("문짝");
            leaf.transform.SetParent(holder.transform, false);
            leaf.transform.localPosition = new Vector3(-0.56f, 0, -0.02f);
            var lm = new MB();
            lm.Box(new Vector3(0.56f, 1.08f, 0), new Vector3(1.12f, 2.16f, 0.08f), accent, 0.9f);
            lm.Box(new Vector3(0.56f, 1.5f, -0.045f), new Vector3(0.7f, 0.7f, 0.02f), Gfx.Mul(accent, 0.8f));
            lm.Box(new Vector3(0.56f, 0.55f, -0.045f), new Vector3(0.7f, 0.6f, 0.02f), Gfx.Mul(accent, 0.8f));
            lm.Box(new Vector3(1.0f, 1.05f, -0.07f), new Vector3(0.07f, 0.07f, 0.07f), Gfx.Hex(0xD9B84A));
            lm.Make(leaf.transform, "문");
            doorLeaf = leaf.transform;

            Register(b, PartType.Door, 0, holder, new Vector3(0, 1.1f, -0.05f), new Vector3(1.4f, 2.3f, 0.3f));
        }

        // ---------- 전기·배관·내부 ----------

        Renderer BuildServices(Building b)
        {
            // 전기: 계량기함, 인입 전선관, 현관등
            var eHolder = new GameObject("전기");
            eHolder.transform.SetParent(root, false);
            var box = new GameObject("계량기함");
            box.transform.SetParent(eHolder.transform, false);
            box.transform.localPosition = new Vector3(4.16f, Plinth + 1.35f, -1.2f);
            var em = new MB();
            em.Box(Vector3.zero, new Vector3(0.16f, 0.62f, 0.46f), Gfx.Hex(0xB9C0C6), 0.9f);
            em.Box(new Vector3(0.085f, 0.08f, 0), new Vector3(0.02f, 0.22f, 0.26f), Gfx.Hex(0x2B3238));
            em.Make(box.transform, "함");
            meterBox = box.transform;
            var cm = new MB();
            cm.Cyl(new Vector3(4.14f, Plinth + 1.66f, -1.2f), 0.035f, 0.035f, 1.75f, 5, Gfx.Hex(0x7C868C));
            cm.Box(new Vector3(4.14f, 3.5f, -1.2f), new Vector3(0.14f, 0.14f, 0.14f), Gfx.Hex(0x4A545A));
            cm.Box(new Vector3(0.95f, Plinth + 2.2f, -2.66f), new Vector3(0.16f, 0.1f, 0.12f), Gfx.Hex(0x2B3238));
            cm.Make(eHolder.transform, "전선관");
            var lm = new MB();
            lm.Box(new Vector3(0.95f, Plinth + 2.08f, -2.7f), new Vector3(0.18f, 0.2f, 0.16f), Color.white);
            var lamp = lm.Make(eHolder.transform, "현관등", Gfx.Unlit, false).GetComponent<Renderer>();
            Register(b, PartType.Electric, 0, eHolder, new Vector3(4.2f, Plinth + 1.5f, -1.2f), new Vector3(0.4f, 1.2f, 0.7f));
            partRenderers[b.Find(PartType.Electric, 0).Id].Remove(lamp);

            // 배관: 처마 홈통, 선홈통, 수도꼭지
            var pHolder = new GameObject("배관");
            pHolder.transform.SetParent(root, false);
            var gm = new MB();
            Color pipe = Gfx.Hex(0xDADFE2);
            for (int s = -1; s <= 1; s += 2)
                gm.Box(new Vector3(0, Eave - 0.47f * Tan - 0.12f, s * 3.0f), new Vector3(8.9f, 0.1f, 0.14f), pipe);
            gm.Cyl(new Vector3(-4.12f, 0.35f, -2.1f), 0.03f, 0.03f, 0.5f, 5, Gfx.Hex(0x8A9399));
            gm.Box(new Vector3(-4.2f, 0.85f, -2.1f), new Vector3(0.16f, 0.06f, 0.06f), Gfx.Hex(0xC9A84A));
            gm.Make(pHolder.transform, "홈통");
            var dp = new GameObject("선홈통");
            dp.transform.SetParent(pHolder.transform, false);
            dp.transform.localPosition = new Vector3(-4.2f, Eave - 0.4f, -2.85f);
            var dm = new MB();
            dm.Box(new Vector3(0, -1.45f, 0), new Vector3(0.1f, 2.9f, 0.1f), pipe, 0.9f);
            dm.Box(new Vector3(0, -2.9f, -0.12f), new Vector3(0.1f, 0.1f, 0.3f), pipe);
            dm.Make(dp.transform, "관");
            downpipe = dp.transform;
            Register(b, PartType.Plumbing, 0, pHolder, new Vector3(-4.25f, 1.7f, -2.6f), new Vector3(0.4f, 3.2f, 0.9f));
            return lamp;
        }

        void BuildInterior(Building b)
        {
            var mb = new MB();
            for (int i = 0; i < 12; i++)
                mb.Box(new Vector3(-3.55f + i * 0.645f, Plinth + 0.03f, 0), new Vector3(0.63f, 0.06f, 4.7f), Gfx.Mul(Gfx.Hex(0xC79A66), 0.94f + (i % 3) * 0.05f));
            mb.Box(new Vector3(-1.6f, Plinth + 0.07f, 0.3f), new Vector3(2.6f, 0.03f, 1.8f), Gfx.Hex(0x9C4A46));
            mb.Box(new Vector3(-1.6f, Plinth + 0.5f, 0.3f), new Vector3(1.3f, 0.08f, 0.8f), DarkWood);
            for (int k = 0; k < 4; k++) mb.Box(new Vector3(-1.6f + (k < 2 ? -0.55f : 0.55f), Plinth + 0.27f, 0.3f + (k % 2 == 0 ? -0.3f : 0.3f)), new Vector3(0.07f, 0.46f, 0.07f), DarkWood);
            mb.Box(new Vector3(2.4f, Plinth + 0.4f, 1.3f), new Vector3(2.0f, 0.5f, 1.4f), Gfx.Hex(0x5E7FA3), 0.9f);
            mb.Box(new Vector3(2.4f, Plinth + 0.72f, 1.85f), new Vector3(2.0f, 0.25f, 0.3f), Gfx.Hex(0xE9E4DA));
            mb.Box(new Vector3(0.8f, Plinth + 1.4f, 0.2f), new Vector3(0.12f, 2.6f, 4.4f), Gfx.Mul(wallColor, 1.05f), 0.92f);
            mb.Box(new Vector3(-3.3f, Plinth + 0.9f, -1.9f), new Vector3(0.9f, 1.7f, 0.5f), DarkWood, 0.9f);
            Register(b, PartType.Finish, 0, mb.Make(root, "내부 마감"), Vector3.zero, Vector3.zero);
        }

        // ---------- 현장 표시 ----------

        GameObject BuildScaffold()
        {
            var mb = new MB();
            Color pipe = Gfx.Hex(0x8C969C), plank = Gfx.Hex(0xB58A56);
            for (int i = 0; i < 5; i++)
            {
                float x = -4.2f + i * 2.1f;
                for (int k = 0; k < 2; k++)
                    mb.Cyl(new Vector3(x, 0, -3.25f - k * 0.9f), 0.04f, 0.04f, 4.1f, 5, pipe);
                mb.Beam(new Vector3(x, 1.95f, -3.25f), new Vector3(x, 1.95f, -4.15f), 0.06f, pipe);
                mb.Beam(new Vector3(x, 3.75f, -3.25f), new Vector3(x, 3.75f, -4.15f), 0.06f, pipe);
                if (i < 4)
                {
                    mb.Beam(new Vector3(x, 0.3f, -4.15f), new Vector3(x + 2.1f, 1.95f, -4.15f), 0.045f, pipe);
                    mb.Beam(new Vector3(x, 1.95f, -4.15f), new Vector3(x + 2.1f, 3.75f, -4.15f), 0.045f, pipe);
                }
            }
            for (int level = 0; level < 2; level++)
            {
                float y = 2.0f + level * 1.8f;
                for (int k = 0; k < 3; k++)
                    mb.Box(new Vector3(0, y, -3.4f - k * 0.3f), new Vector3(8.6f, 0.05f, 0.27f), Gfx.Mul(plank, 0.94f + k * 0.05f));
                mb.Beam(new Vector3(-4.2f, y + 1.0f, -4.15f), new Vector3(4.2f, y + 1.0f, -4.15f), 0.045f, Gfx.Hex(0xE2B93B));
            }
            var go = mb.Make(root, "비계");
            go.SetActive(false);
            return go;
        }

        GameObject BuildSafetyZone(out GameObject board)
        {
            var mb = new MB();
            Color cone = Gfx.Hex(0xF2652A);
            Vector3[] pts = { new Vector3(-8.6f, 0, -5.6f), new Vector3(-3.0f, 0, -5.6f), new Vector3(-1.4f, 0, -5.6f), new Vector3(1.4f, 0, -5.6f), new Vector3(3.0f, 0, -5.6f), new Vector3(8.6f, 0, -5.6f), new Vector3(-8.6f, 0, -2.6f), new Vector3(8.6f, 0, -2.6f) };
            foreach (var p in pts)
            {
                mb.Box(p + new Vector3(0, 0.03f, 0), new Vector3(0.42f, 0.06f, 0.42f), Gfx.Hex(0x2B3238));
                mb.Cyl(p + new Vector3(0, 0.06f, 0), 0.16f, 0.04f, 0.62f, 8, cone, 0.9f);
                mb.Cyl(p + new Vector3(0, 0.3f, 0), 0.105f, 0.085f, 0.1f, 8, Color.white, 1f, false);
            }
            Color tape = Gfx.Hex(0xF2C230);
            mb.Beam(pts[0] + Vector3.up * 0.62f, pts[1] + Vector3.up * 0.62f, 0.05f, tape);
            mb.Beam(pts[4] + Vector3.up * 0.62f, pts[5] + Vector3.up * 0.62f, 0.05f, tape);
            mb.Beam(pts[0] + Vector3.up * 0.62f, pts[6] + Vector3.up * 0.62f, 0.05f, tape);
            mb.Beam(pts[5] + Vector3.up * 0.62f, pts[7] + Vector3.up * 0.62f, 0.05f, tape);
            var go = mb.Make(root, "안전구역");
            go.SetActive(false);

            var bm = new MB();
            bm.Cyl(new Vector3(-3.6f, 0, -6.1f), 0.04f, 0.04f, 1.5f, 5, Gfx.Hex(0x6E7880));
            bm.Cyl(new Vector3(-2.4f, 0, -6.1f), 0.04f, 0.04f, 1.5f, 5, Gfx.Hex(0x6E7880));
            bm.Box(new Vector3(-3.0f, 1.25f, -6.1f), new Vector3(1.5f, 0.8f, 0.05f), Gfx.Hex(0xF2C230));
            for (int k = 0; k < 4; k++)
                bm.Box(new Vector3(-3.55f + k * 0.37f, 0.95f, -6.13f), new Vector3(0.16f, 0.16f, 0.02f), Quaternion.Euler(0, 0, 45), Gfx.Hex(0x22262A));
            bm.Box(new Vector3(-3.0f, 1.4f, -6.13f), new Vector3(1.2f, 0.26f, 0.02f), Gfx.Hex(0x22262A));
            board = bm.Make(root, "공사 안내판");
            board.SetActive(false);
            return go;
        }

        void BuildDebris(Building b)
        {
            for (int i = 0; i < 18; i++)
            {
                var mb = new MB();
                float h1 = Gfx.Hash(b.Id, i * 3 + 1), h2 = Gfx.Hash(b.Id, i * 3 + 2), h3 = Gfx.Hash(b.Id, i * 3 + 3);
                Vector3 p = new Vector3(-8.0f + h1 * 16f, 0.08f, -5.2f + h2 * 2.0f);
                if (Mathf.Abs(p.x) < 1.0f) p.x += 2.2f;
                if (i % 3 == 0)
                {
                    mb.Box(Vector3.zero, new Vector3(1.6f + h3, 0.07f, 0.16f), Quaternion.Euler(h2 * 12, h1 * 180, h3 * 10), Wood);
                    mb.Box(new Vector3(0.2f, 0.07f, 0.1f), new Vector3(1.2f, 0.07f, 0.14f), Quaternion.Euler(0, h3 * 180, 8), DarkWood);
                }
                else if (i % 3 == 1)
                {
                    mb.Box(Vector3.zero, new Vector3(0.9f, 0.08f, 0.7f), Quaternion.Euler(h1 * 25, h2 * 180, h3 * 20), Gfx.Mul(roofColor, 0.7f));
                    mb.Box(new Vector3(0.3f, 0.06f, 0.3f), new Vector3(0.5f, 0.07f, 0.4f), Quaternion.Euler(10, h3 * 180, 0), Gfx.Mul(roofColor, 0.55f));
                }
                else
                {
                    mb.Blob(Vector3.zero, new Vector3(0.45f, 0.2f, 0.4f), Gfx.Hex(0x7A746C), 1.05f, 0.75f, 0.5f);
                    mb.Box(new Vector3(0.1f, 0.12f, 0), new Vector3(0.7f, 0.04f, 0.5f), Quaternion.Euler(18, h1 * 180, 6), Gfx.Hex(0xB9B4A8));
                }
                var go = mb.Make(root, "잔해");
                go.transform.localPosition = p;
                go.SetActive(false);
                debris.Add(go);
            }
        }

        void BuildStock()
        {
            float padX = side == 1 ? 5.5f : -5.5f;
            Color[] item = { Gfx.Mul(roofColor, 1.2f), Gfx.Hex(0xBFE0EE), Gfx.Mul(wallColor, 1.02f), Gfx.Hex(0xD98A3A) };
            for (int it = 0; it < 4; it++)
            {
                stockStacks[it] = new List<GameObject>();
                Vector3 slot = new Vector3(padX - 0.95f + (it % 2) * 1.9f, 0.09f, -5.3f + (it / 2) * 1.5f);
                for (int level = 0; level < 7; level++)
                {
                    var mb = new MB();
                    if (level == 0)
                    {
                        mb.Box(new Vector3(0, 0.02f, 0), new Vector3(1.5f, 0.04f, 1.15f), Wood);
                        for (int k = -1; k <= 1; k++) mb.Box(new Vector3(k * 0.6f, 0.08f, 0), new Vector3(0.14f, 0.08f, 1.15f), DarkWood);
                        mb.Box(new Vector3(0, 0.14f, 0), new Vector3(1.5f, 0.04f, 1.15f), Wood);
                    }
                    else
                    {
                        float y = 0.16f + (level - 1) * 0.2f;
                        if (it == Items.Window)
                        {
                            mb.Box(new Vector3(-0.5f + (level - 1) * 0.2f, 0.16f + 0.62f, 0), new Vector3(0.12f, 1.24f, 1.0f), Quaternion.Euler(0, 0, -8), Gfx.Hex(0xF4F1EA));
                            mb.Box(new Vector3(-0.47f + (level - 1) * 0.2f, 0.16f + 0.62f, 0), new Vector3(0.05f, 1.0f, 0.8f), Quaternion.Euler(0, 0, -8), item[it]);
                        }
                        else if (it == Items.RepairKit)
                        {
                            mb.Box(new Vector3(((level - 1) % 2) * 0.7f - 0.35f, 0.16f + 0.22f + ((level - 1) / 2) * 0.44f, 0), new Vector3(0.6f, 0.42f, 0.8f), item[it], 0.9f);
                            mb.Box(new Vector3(((level - 1) % 2) * 0.7f - 0.35f, 0.16f + 0.44f + ((level - 1) / 2) * 0.44f, 0), new Vector3(0.62f, 0.03f, 0.12f), Gfx.Hex(0x3A2E22));
                        }
                        else
                        {
                            mb.Box(new Vector3(0, y + 0.09f, 0), new Vector3(1.4f, 0.18f, 1.05f), Gfx.Mul(item[it], 0.95f + (level % 2) * 0.08f), 0.92f);
                            mb.Box(new Vector3(-0.45f, y + 0.09f, 0), new Vector3(0.06f, 0.19f, 1.07f), Gfx.Hex(0x2B3238));
                            mb.Box(new Vector3(0.45f, y + 0.09f, 0), new Vector3(0.06f, 0.19f, 1.07f), Gfx.Hex(0x2B3238));
                        }
                    }
                    var go = mb.Make(root, "자재");
                    go.transform.localPosition = slot;
                    go.SetActive(false);
                    stockStacks[it].Add(go);
                }
            }
        }

        // ---------- 상태 반영 ----------

        public void Refresh(WorldState w, Building b, int selectedPart, float night)
        {
            var roof = b.Find(PartType.Roof, 0);
            int broken = Mathf.RoundToInt((float)(ConstructionSystem.RoofDamagedArea(roof) / 2.0));
            int removed = 0, installed = 0;
            bool safety = false, working = false;
            var c = w.ContractById(b.ContractId);
            if (c != null)
            {
                working = true;
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
            int debrisCount = Mathf.Min(debris.Count, Mathf.CeilToInt((float)b.DebrisM3 * 4f));
            int nightBucket = night > 0.45f ? 1 : 0;

            long hash = broken * 31L + removed * 961L + installed * 29791L + debrisCount * 7L + (safety ? 3 : 0) + (working ? 5 : 0) + nightBucket * 11 + (selectedPart + 5) * 1000003L;
            for (int i = 0; i < b.Parts.Count; i++) hash = hash * 131 + (long)b.Parts[i].Hp;
            for (int i = 0; i < b.Stock.Count; i++) hash = hash * 131 + (long)(b.Stock[i].OnSite * 2);
            if (hash == lastHash) return;
            lastHash = hash;

            scaffold.SetActive(working);
            siteBoard.SetActive(working);
            safetyZone.SetActive(working && safety);

            // 지붕 타일
            Color newColor = Color.Lerp(roofColor, Gfx.Hex(0xE9EEF2), 0.22f) * 1.12f;
            Color brokenColor = Gfx.Mul(roofColor, 0.42f);
            bool roofSelected = selectedPart == roof.Id;
            for (int n = 0; n < 20; n++)
            {
                int i = tileOrder[n];
                var tr = tiles[i].transform;
                bool isNew = n < installed, isGone = !isNew && n < removed, isBroken = !isNew && !isGone && n < broken;
                tr.gameObject.SetActive(!isGone);
                float j1 = Gfx.Hash(BuildingId, i * 2.3f), j2 = Gfx.Hash(BuildingId, i * 5.1f);
                if (isBroken)
                {
                    tr.localPosition = tilePos[i] + tileSlope[i] * (0.15f + j1 * 0.45f) + new Vector3(0, -0.1f - j2 * 0.12f, 0);
                    tr.localRotation = tileRot[i] * Quaternion.Euler(-6 + j1 * 16, (j2 - 0.5f) * 26, (j1 - 0.5f) * 34);
                }
                else { tr.localPosition = tilePos[i]; tr.localRotation = tileRot[i]; }
                Color col = isNew ? newColor : (isBroken ? brokenColor : Gfx.Mul(roofColor, 0.96f + j1 * 0.08f));
                Gfx.Tint(tiles[i], roofSelected ? col * SelectTint : col);
            }

            for (int i = 0; i < b.Parts.Count; i++)
            {
                var p = b.Parts[i];
                if (p.Type == PartType.Roof) continue;
                List<Renderer> list;
                if (!partRenderers.TryGetValue(p.Id, out list)) continue;
                float bad = 1f - Mathf.Clamp01((float)p.Hp / 100f);
                Color tint = Color.Lerp(Color.white, new Color(0.62f, 0.56f, 0.52f), Mathf.Clamp01(bad * 1.6f));
                if (selectedPart == p.Id) tint *= SelectTint;
                for (int k = 0; k < list.Count; k++)
                {
                    if (p.Type == PartType.Window && list[k] == glass[p.Slot]) continue;
                    Gfx.Tint(list[k], tint);
                }

                if (p.Type == PartType.Wall)
                {
                    int marks = p.Hp >= 90 ? 0 : Mathf.Clamp(Mathf.CeilToInt((100f - (float)p.Hp) / 7f), 1, 8);
                    for (int k = 0; k < 8; k++) wallDamage[p.Slot][k].SetActive(k < marks);
                }
                else if (p.Type == PartType.Window)
                {
                    bool smashed = p.Hp < 60;
                    brokenWindow[p.Slot].SetActive(smashed);
                    crackedWindow[p.Slot].SetActive(!smashed && p.Hp < 90);
                    glass[p.Slot].gameObject.SetActive(!smashed);
                    shutter[p.Slot].localRotation = smashed ? Quaternion.Euler(0, 0, p.Slot % 2 == 0 ? 7 : -9) : Quaternion.identity;
                    bool lit = nightBucket == 1 && !working && roof.Hp >= 60 && (p.Slot + BuildingId) % 3 != 0;
                    glass[p.Slot].sharedMaterial = lit ? Gfx.Unlit : Gfx.Lit;
                    Color g = lit ? new Color(1f, 0.82f, 0.48f) : (nightBucket == 1 ? Gfx.Hex(0x2A3644) : Gfx.Hex(0x7FB4D2));
                    Gfx.Tint(glass[p.Slot], selectedPart == p.Id ? g * SelectTint : g);
                }
                else if (p.Type == PartType.Door) doorLeaf.localRotation = p.Hp < 60 ? Quaternion.Euler(4, -38, 6) : Quaternion.identity;
                else if (p.Type == PartType.Plumbing) downpipe.localRotation = p.Hp < 90 ? Quaternion.Euler(0, 0, -16) : Quaternion.identity;
                else if (p.Type == PartType.Electric) meterBox.localRotation = p.Hp < 90 ? Quaternion.Euler(14, 0, 9) : Quaternion.identity;
            }

            var electric = b.Find(PartType.Electric, 0);
            bool lampOn = nightBucket == 1 && electric.Hp >= 60;
            Gfx.Tint(doorLamp, lampOn ? new Color(1f, 0.9f, 0.6f) : Gfx.Hex(0x8C9096));

            for (int i = 0; i < debris.Count; i++) debris[i].SetActive(i < debrisCount);

            for (int it = 0; it < 4; it++)
            {
                double onSite = 0;
                for (int k = 0; k < b.Stock.Count; k++) if (b.Stock[k].ItemId == it) onSite = b.Stock[k].OnSite;
                double perLevel = it == Items.Window || it == Items.RepairKit ? 1.0 : 4.0;
                int levels = onSite <= 0.01 ? 0 : Mathf.Clamp(Mathf.CeilToInt((float)(onSite / perLevel)), 1, 6);
                for (int level = 0; level < stockStacks[it].Count; level++)
                    stockStacks[it][level].SetActive(levels > 0 && level <= levels);
            }
        }
    }
}
