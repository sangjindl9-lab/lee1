using System.Collections.Generic;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>마을 배경: 지형, 도로, 인도, 가로등, 전신주, 사무소, 대피소, 이웃집, 나무, 연못, 산, 구름.</summary>
    public sealed class Scenery
    {
        public readonly Transform Root;
        readonly Renderer lampGlow;
        readonly List<Light> lampLights = new List<Light>();
        readonly Transform clouds;
        readonly Renderer cloudRenderer;
        readonly Renderer sceneryWindows;

        static readonly Color Asphalt = Gfx.Hex(0x3B3F45), Sidewalk = Gfx.Hex(0xA9A69E), Curb = Gfx.Hex(0x8F8C86), Paint = Gfx.Hex(0xEDE7D3);
        static readonly Color Wood = Gfx.Hex(0x7A5A3C), DarkWood = Gfx.Hex(0x4E3A28), Metal = Gfx.Hex(0x6E7880), White = Gfx.Hex(0xF2EFE8);
        static readonly Color Leaf1 = Gfx.Hex(0x3F8A4A), Leaf2 = Gfx.Hex(0x5BA35A), Leaf3 = Gfx.Hex(0x2F6E48), Trunk = Gfx.Hex(0x6B4A32);

        public Scenery(Transform parent)
        {
            var go = new GameObject("Scenery");
            go.transform.SetParent(parent, false);
            Root = go.transform;

            BuildGround();
            BuildRoad();
            BuildOffice();
            BuildShelter();
            BuildNeighbors(out sceneryWindows);
            BuildNature();
            lampGlow = BuildLampsAndPoles();
            clouds = BuildClouds(out cloudRenderer);
            AddBounds();
        }

        // ---------- 지형 ----------

        static float Height(float x, float z)
        {
            float dx = Mathf.Max(0, Mathf.Abs(x) - 112f), dz = Mathf.Max(0, Mathf.Abs(z) - 46f);
            float d = Mathf.Sqrt(dx * dx + dz * dz);
            if (d <= 0) return 0;
            float rise = Mathf.SmoothStep(0, 1, d / 70f);
            float n = Mathf.PerlinNoise(x * 0.018f + 31.7f, z * 0.018f + 9.3f);
            float n2 = Mathf.PerlinNoise(x * 0.06f + 3.1f, z * 0.06f + 77.7f);
            return rise * (5f + n * 22f + n2 * 4f);
        }

        static Color GroundColor(float x, float z, float h)
        {
            float n = Mathf.PerlinNoise(x * 0.05f + 12.3f, z * 0.05f + 45.6f);
            float n2 = Gfx.Hash(Mathf.Floor(x / 5f), Mathf.Floor(z / 5f));
            Color grass = Color.Lerp(Gfx.Hex(0x5C9450), Gfx.Hex(0x7CAE60), n);
            grass = Gfx.Mul(grass, 0.95f + n2 * 0.1f);
            Color hill = Color.Lerp(Gfx.Hex(0x4E8552), Gfx.Hex(0x6E8F7A), Mathf.Clamp01(h / 26f));
            return Color.Lerp(grass, hill, Mathf.Clamp01(h / 10f));
        }

        void BuildGround()
        {
            var mb = new MB();
            const float cell = 6f;
            for (float x = -300; x < 300; x += cell)
                for (float z = -252; z < 252; z += cell)
                {
                    Vector3 a = new Vector3(x, Height(x, z), z), b = new Vector3(x, Height(x, z + cell), z + cell);
                    Vector3 c = new Vector3(x + cell, Height(x + cell, z + cell), z + cell), d = new Vector3(x + cell, Height(x + cell, z), z);
                    Color col = GroundColor(x + cell * 0.5f, z + cell * 0.5f, (a.y + c.y) * 0.5f);
                    mb.Tri(a, b, c, col, Vector3.up);
                    mb.Tri(a, c, d, Gfx.Mul(col, 0.985f), Vector3.up);
                }

            // 밭(집 뒤쪽)
            for (int f = 0; f < 6; f++)
            {
                float fx = -60 + (f % 3) * 44, fz = (f < 3 ? 1 : -1) * 31f;
                Color soil = Gfx.Hex(0x7C5E42), crop = f % 2 == 0 ? Gfx.Hex(0x9CC06A) : Gfx.Hex(0xD9C46A);
                mb.Box(new Vector3(fx, 0.03f, fz), new Vector3(34, 0.06f, 11), soil);
                for (int r = 0; r < 8; r++)
                    mb.Box(new Vector3(fx, 0.16f, fz - 4.4f + r * 1.26f), new Vector3(32.5f, 0.26f, 0.5f), Gfx.Mul(crop, 0.92f + Gfx.Hash(f, r) * 0.16f), 0.8f);
            }
            var ground = mb.Make(Root, "Ground");
            var col2 = ground.AddComponent<BoxCollider>();
            col2.center = new Vector3(0, -0.5f, 0);
            col2.size = new Vector3(600, 1, 500);

            // 먼 산
            for (int i = 0; i < 26; i++)
            {
                float a = i * Mathf.PI * 2 / 26f + Gfx.Hash(i, 3) * 0.2f;
                float dist = 250 + Gfx.Hash(i, 7) * 70;
                float hgt = 45 + Gfx.Hash(i, 11) * 55, rad = 60 + Gfx.Hash(i, 13) * 50;
                Color rock = Color.Lerp(Gfx.Hex(0x5E7F86), Gfx.Hex(0x7F9AA6), Gfx.Hash(i, 17));
                mb.Cyl(new Vector3(Mathf.Cos(a) * dist, -4, Mathf.Sin(a) * dist), rad, 0, hgt, 7, rock, 0.8f, false);
                if (hgt > 78) mb.Cyl(new Vector3(Mathf.Cos(a) * dist, -4 + hgt * 0.72f, Mathf.Sin(a) * dist), rad * 0.285f, 0, hgt * 0.285f, 7, Gfx.Hex(0xE9EEF2), 0.95f, false);
            }
            mb.Make(Root, "Mountains", null, false);

            // 연못
            var water = new MB();
            water.Cyl(new Vector3(78, 0.05f, -31), 10.5f, 10.5f, 0.02f, 18, new Color(0.30f, 0.56f, 0.72f, 0.82f), 1f, true);
            water.Make(Root, "Pond", Gfx.Fade, false);
        }

        // ---------- 도로 ----------

        void BuildRoad()
        {
            var mb = new MB();
            mb.Box(new Vector3(0, 0.03f, 0), new Vector3(232, 0.06f, 8), Asphalt);
            for (int s = -1; s <= 1; s += 2)
            {
                mb.Box(new Vector3(0, 0.09f, s * 4.1f), new Vector3(232, 0.18f, 0.2f), Curb, 0.85f);
                mb.Box(new Vector3(0, 0.08f, s * 5.0f), new Vector3(232, 0.16f, 1.6f), Sidewalk);
                for (float x = -114; x < 116; x += 2f)
                    mb.Box(new Vector3(x, 0.165f, s * 5.0f), new Vector3(0.04f, 0.01f, 1.6f), Gfx.Mul(Sidewalk, 0.86f));
                mb.Box(new Vector3(0, 0.065f, s * 3.75f), new Vector3(232, 0.01f, 0.12f), Paint);
            }
            for (float x = -112; x < 114; x += 6f)
                mb.Box(new Vector3(x, 0.065f, 0), new Vector3(2.6f, 0.01f, 0.14f), Gfx.Hex(0xE7C44A));
            for (int k = -1; k <= 1; k += 2)
                for (int i = 0; i < 6; i++)
                    mb.Box(new Vector3(k * 11f, 0.066f, -3.0f + i * 1.2f), new Vector3(2.4f, 0.01f, 0.6f), Paint);

            // 사무소 진입로, 대피소 광장
            mb.Box(Gfx.P(WorldState.DepotX, 6.3, 0.05f), new Vector3(7, 0.1f, 4.6f), Gfx.Hex(0x565A60));
            mb.Box(Gfx.P(WorldState.DepotX - 1, WorldState.DepotZ + 1.5, 0.05f), new Vector3(16, 0.1f, 9), Gfx.Hex(0x4A4E54));
            mb.Box(Gfx.P(WorldState.ShelterX + 2, WorldState.ShelterZ + 0.5, 0.05f), new Vector3(15, 0.1f, 7.5f), Gfx.Hex(0xC8C2B4));
            for (int i = 0; i < 5; i++)
                mb.Box(Gfx.P(WorldState.DepotX - 5.5 + i * 2.6, WorldState.DepotZ + 1.5, 0.105f), new Vector3(0.12f, 0.01f, 4.2f), Paint);
            mb.Make(Root, "Road", null, false);

            var cars = new MB();
            Car(cars, new Vector3(-58, 0.06f, 2.9f), 90, Gfx.Hex(0xC4463A));
            Car(cars, new Vector3(34, 0.06f, -2.9f), -90, Gfx.Hex(0x3F6FA8));
            Car(cars, new Vector3(70, 0.06f, 2.9f), 90, Gfx.Hex(0xE2E0DA));
            Car(cars, Gfx.P(WorldState.ShelterX + 7.5, WorldState.ShelterZ + 1.5, 0.1f), 0, Gfx.Hex(0x4E7A46));
            cars.Make(Root, "ParkedCars");
        }

        static void Car(MB mb, Vector3 pos, float yaw, Color body)
        {
            mb.Push(pos, Quaternion.Euler(0, yaw, 0));
            Color glass = Gfx.Hex(0x2F4656), dark = Gfx.Hex(0x1E2124);
            mb.Box(new Vector3(0, 0.62f, 0), new Vector3(1.8f, 0.55f, 4.2f), body, 0.85f);
            mb.Box(new Vector3(0, 1.12f, -0.2f), new Vector3(1.62f, 0.5f, 2.2f), Gfx.Mul(body, 0.94f));
            mb.Box(new Vector3(0, 1.12f, 0.92f), new Vector3(1.5f, 0.42f, 0.06f), glass);
            mb.Box(new Vector3(0, 1.12f, -1.32f), new Vector3(1.5f, 0.42f, 0.06f), glass);
            mb.Box(new Vector3(0.82f, 1.12f, -0.2f), new Vector3(0.04f, 0.38f, 1.9f), glass);
            mb.Box(new Vector3(-0.82f, 1.12f, -0.2f), new Vector3(0.04f, 0.38f, 1.9f), glass);
            mb.Box(new Vector3(0, 0.42f, 2.12f), new Vector3(1.84f, 0.2f, 0.12f), dark);
            mb.Box(new Vector3(0, 0.42f, -2.12f), new Vector3(1.84f, 0.2f, 0.12f), dark);
            mb.Box(new Vector3(0.6f, 0.7f, 2.11f), new Vector3(0.36f, 0.16f, 0.04f), Gfx.Hex(0xF2EDD2));
            mb.Box(new Vector3(-0.6f, 0.7f, 2.11f), new Vector3(0.36f, 0.16f, 0.04f), Gfx.Hex(0xF2EDD2));
            mb.Box(new Vector3(0.6f, 0.7f, -2.11f), new Vector3(0.36f, 0.14f, 0.04f), Gfx.Hex(0xB02A22));
            mb.Box(new Vector3(-0.6f, 0.7f, -2.11f), new Vector3(0.36f, 0.14f, 0.04f), Gfx.Hex(0xB02A22));
            for (int i = 0; i < 4; i++)
            {
                var saved = mb.M;
                mb.Push(new Vector3(i < 2 ? -0.92f : 0.92f, 0.34f, i % 2 == 0 ? 1.3f : -1.3f), Quaternion.Euler(0, 0, 90));
                mb.Cyl(new Vector3(0, -0.11f, 0), 0.34f, 0.34f, 0.22f, 10, dark);
                mb.M = saved;
            }
            mb.Reset();
        }

        // ---------- 건물 ----------

        static void Windows(MB mb, MB glass, Vector3 origin, Vector3 right, Vector3 normal, int cols, int rows, float w, float h, float gapX, float gapY)
        {
            float totalW = cols * w + (cols - 1) * gapX;
            for (int r = 0; r < rows; r++)
                for (int c = 0; c < cols; c++)
                {
                    Vector3 p = origin + right * (-totalW * 0.5f + w * 0.5f + c * (w + gapX)) + Vector3.up * (r * (h + gapY));
                    Quaternion rot = Quaternion.LookRotation(normal);
                    mb.Box(p + normal * 0.03f, new Vector3(w + 0.2f, h + 0.2f, 0.1f), rot, White);
                    glass.Box(p + normal * 0.07f, new Vector3(w, h, 0.06f), rot, Color.white);
                    mb.Box(p + normal * 0.09f, new Vector3(0.07f, h, 0.05f), rot, White);
                    mb.Box(p - Vector3.up * (h * 0.5f + 0.12f) + normal * 0.1f, new Vector3(w + 0.3f, 0.08f, 0.22f), rot, White);
                }
        }

        void BuildOffice()
        {
            var mb = new MB();
            var glass = new MB();
            Vector3 c = Gfx.P(WorldState.DepotX - 2, WorldState.DepotZ + 10);
            Color wall = Gfx.Hex(0xE6E1D6), accent = Gfx.Hex(0x12777A), dark = Gfx.Hex(0x2D3A40);
            mb.Box(c + new Vector3(0, 0.2f, 0), new Vector3(12.6f, 0.4f, 7.6f), Gfx.Hex(0x8E8E8A), 0.85f);
            mb.Box(c + new Vector3(0, 3.9f, 0), new Vector3(12, 7.0f, 7), wall, 0.9f);
            mb.Box(c + new Vector3(0, 7.55f, 0), new Vector3(12.5f, 0.3f, 7.5f), dark);
            mb.Box(c + new Vector3(0, 4.05f, -3.56f), new Vector3(12.1f, 0.9f, 0.14f), accent);
            mb.Box(c + new Vector3(-3.6f, 4.05f, -3.66f), new Vector3(3.2f, 0.42f, 0.06f), White);
            // 차고 문과 출입문
            mb.Box(c + new Vector3(3.2f, 1.75f, -3.53f), new Vector3(4.2f, 2.9f, 0.1f), Gfx.Hex(0x9AA3A8));
            for (int i = 0; i < 6; i++) mb.Box(c + new Vector3(3.2f, 0.6f + i * 0.47f, -3.6f), new Vector3(4.1f, 0.04f, 0.04f), Gfx.Hex(0x7C868C));
            mb.Box(c + new Vector3(-3.4f, 1.5f, -3.53f), new Vector3(1.3f, 2.4f, 0.1f), dark);
            mb.Box(c + new Vector3(-3.4f, 2.95f, -3.9f), new Vector3(2.4f, 0.12f, 1.0f), accent);
            Windows(mb, glass, c + new Vector3(-0.4f, 5.6f, -3.5f), Vector3.right, Vector3.back, 5, 1, 1.5f, 1.3f, 0.7f, 0);
            Windows(mb, glass, c + new Vector3(-0.3f, 1.9f, -3.5f), Vector3.right, Vector3.back, 1, 1, 1.6f, 1.3f, 0, 0);
            Windows(mb, glass, c + new Vector3(6.0f, 2.0f, 0), Vector3.forward, Vector3.right, 2, 2, 1.4f, 1.3f, 1.2f, 2.3f);
            // 옥상 설비, 깃대
            mb.Box(c + new Vector3(-3, 8.1f, 1), new Vector3(2.2f, 0.9f, 1.6f), Metal, 0.85f);
            mb.Cyl(c + new Vector3(3.5f, 7.7f, 1.5f), 0.5f, 0.5f, 0.9f, 10, Gfx.Hex(0xB9C2C7), 0.85f);
            mb.Cyl(c + new Vector3(-7.4f, 0, -4.4f), 0.07f, 0.05f, 8.5f, 6, Metal);
            mb.Box(c + new Vector3(-6.6f, 7.9f, -4.4f), new Vector3(1.5f, 0.9f, 0.04f), accent);
            // 야적장: 팔레트, 자재, 울타리
            for (int i = 0; i < 4; i++)
            {
                Vector3 p = Gfx.P(WorldState.DepotX - 8.2 + (i % 2) * 2.0, WorldState.DepotZ + 3.6 + (i / 2) * 2.0);
                mb.Box(p + new Vector3(0, 0.08f, 0), new Vector3(1.4f, 0.14f, 1.2f), Wood);
                mb.Box(p + new Vector3(0, 0.15f + 0.3f * (1 + i % 3) * 0.5f, 0), new Vector3(1.25f, 0.3f * (1 + i % 3), 1.05f), i % 2 == 0 ? Gfx.Hex(0x356E86) : Gfx.Hex(0xC9B48A), 0.9f);
            }
            for (float x = -9.5f; x <= 7.6f; x += 1.9f)
            {
                Vector3 p = Gfx.P(WorldState.DepotX + x, WorldState.DepotZ + 14.2);
                mb.Cyl(p, 0.05f, 0.05f, 1.8f, 5, Metal);
            }
            mb.Box(Gfx.P(WorldState.DepotX - 1, WorldState.DepotZ + 14.2, 1.7f), new Vector3(17.2f, 0.05f, 0.05f), Metal);
            mb.Box(Gfx.P(WorldState.DepotX - 1, WorldState.DepotZ + 14.2, 0.9f), new Vector3(17.2f, 0.05f, 0.05f), Metal);
            var office = mb.Make(Root, "Office");
            var bc = office.AddComponent<BoxCollider>();
            bc.center = c + new Vector3(0, 3.8f, 0); bc.size = new Vector3(12, 7.6f, 7);
            glassOffice = glass.Make(Root, "OfficeGlass").GetComponent<Renderer>();
        }

        Renderer glassOffice, glassShelter;

        void BuildShelter()
        {
            var mb = new MB();
            var glass = new MB();
            Vector3 c = Gfx.P(WorldState.ShelterX + 2, WorldState.ShelterZ - 7);
            Color wall = Gfx.Hex(0xD9DEE0), roof = Gfx.Hex(0x2F7D5B), sign = Gfx.Hex(0x1E9E5A);
            mb.Box(c + new Vector3(0, 0.2f, 0), new Vector3(14.6f, 0.4f, 7.6f), Gfx.Hex(0x8E8E8A), 0.85f);
            mb.Box(c + new Vector3(0, 2.4f, 0), new Vector3(14, 4.0f, 7), wall, 0.9f);
            Gable(mb, c + new Vector3(0, 4.4f, 0), 14.8f, 7.8f, 2.0f, roof, wall);
            mb.Box(c + new Vector3(0, 3.5f, 3.56f), new Vector3(5.2f, 1.0f, 0.12f), sign);
            mb.Box(c + new Vector3(0, 3.5f, 3.64f), new Vector3(0.9f, 0.24f, 0.05f), White);
            mb.Box(c + new Vector3(0, 3.5f, 3.64f), new Vector3(0.24f, 0.9f, 0.05f), White);
            mb.Box(c + new Vector3(0, 1.55f, 3.53f), new Vector3(2.6f, 2.3f, 0.1f), Gfx.Hex(0x2D3A40));
            Windows(mb, glass, c + new Vector3(-4.6f, 2.1f, 3.5f), Vector3.right, Vector3.forward, 2, 1, 1.4f, 1.3f, 0.6f, 0);
            Windows(mb, glass, c + new Vector3(4.6f, 2.1f, 3.5f), Vector3.right, Vector3.forward, 2, 1, 1.4f, 1.3f, 0.6f, 0);
            for (int i = -1; i <= 1; i += 2)
            {
                Vector3 b = Gfx.P(WorldState.ShelterX + 2 + i * 5.2, WorldState.ShelterZ + 2.6);
                mb.Box(b + new Vector3(0, 0.45f, 0), new Vector3(2.2f, 0.08f, 0.5f), Wood);
                mb.Box(b + new Vector3(0, 0.75f, 0.24f), new Vector3(2.2f, 0.4f, 0.06f), Wood);
                mb.Box(b + new Vector3(-0.9f, 0.22f, 0), new Vector3(0.08f, 0.44f, 0.45f), Metal);
                mb.Box(b + new Vector3(0.9f, 0.22f, 0), new Vector3(0.08f, 0.44f, 0.45f), Metal);
            }
            var hall = mb.Make(Root, "Shelter");
            var bc = hall.AddComponent<BoxCollider>();
            bc.center = c + new Vector3(0, 2.4f, 0); bc.size = new Vector3(14, 4.8f, 7);
            glassShelter = glass.Make(Root, "ShelterGlass").GetComponent<Renderer>();
        }

        /// <summary>박공지붕(양쪽 경사)과 박공벽.</summary>
        static void Gable(MB mb, Vector3 eaveCenter, float length, float depth, float rise, Color roof, Color wall)
        {
            float hx = length * 0.5f, hz = depth * 0.5f;
            Vector3 r0 = eaveCenter + new Vector3(-hx, rise, 0), r1 = eaveCenter + new Vector3(hx, rise, 0);
            for (int s = -1; s <= 1; s += 2)
            {
                Vector3 e0 = eaveCenter + new Vector3(-hx, -0.08f, s * hz), e1 = eaveCenter + new Vector3(hx, -0.08f, s * hz);
                mb.Quad(e0, r0, r1, e1, Gfx.Mul(roof, 0.9f), roof, roof, Gfx.Mul(roof, 0.9f), new Vector3(0, 1, s));
                mb.Quad(e0 - Vector3.up * 0.16f, r0 - Vector3.up * 0.16f, r1 - Vector3.up * 0.16f, e1 - Vector3.up * 0.16f, Gfx.Mul(roof, 0.6f), new Vector3(0, -1, -s));
                mb.Quad(e0, e0 - Vector3.up * 0.16f, e1 - Vector3.up * 0.16f, e1, Gfx.Mul(roof, 0.75f), new Vector3(0, 0, s));
            }
            for (int s = -1; s <= 1; s += 2)
            {
                float x = s * (hx - 0.4f);
                mb.Tri(eaveCenter + new Vector3(x, 0, -hz + 0.4f), eaveCenter + new Vector3(x, 0, hz - 0.4f), eaveCenter + new Vector3(x, rise - 0.2f, 0), wall, new Vector3(s, 0, 0));
            }
            mb.Box(eaveCenter + new Vector3(0, rise + 0.03f, 0), new Vector3(length + 0.1f, 0.14f, 0.3f), Gfx.Mul(roof, 0.8f));
        }

        void BuildNeighbors(out Renderer windows)
        {
            var mb = new MB();
            var glass = new MB();
            Color[] walls = { Gfx.Hex(0xE9D8B8), Gfx.Hex(0xC9D8DF), Gfx.Hex(0xD7E0C4), Gfx.Hex(0xE8C9B8), Gfx.Hex(0xDAD6CF), Gfx.Hex(0xF0E3A8) };
            Color[] roofs = { Gfx.Hex(0x8A4B3A), Gfx.Hex(0x4D5A66), Gfx.Hex(0x3F6B55), Gfx.Hex(0x6B4A3A), Gfx.Hex(0x3C4046), Gfx.Hex(0x9A5A44) };
            float[] xs = { -100, -80, -62, 62, 82, 102 };
            int n = 0;
            for (int side = -1; side <= 1; side += 2)
                for (int i = 0; i < xs.Length; i++)
                {
                    if (side == 1 && xs[i] < -40 && xs[i] > -62.5f) continue;   // 사무소 자리
                    if (side == -1 && xs[i] > 40 && xs[i] < 62.5f) continue;    // 대피소 자리
                    Vector3 c = new Vector3(xs[i], 0, side * (13f + Gfx.Hash(i, side) * 3f));
                    float w = 8 + Gfx.Hash(i, 5 + side) * 3, d = 6 + Gfx.Hash(i, 9 + side) * 1.5f;
                    bool two = Gfx.Hash(i, 21 + side) > 0.55f;
                    float h = two ? 5.6f : 3.0f;
                    Color wall = walls[(n + 2) % walls.Length], roof = roofs[(n + 3) % roofs.Length];
                    mb.Box(c + new Vector3(0, 0.2f, 0), new Vector3(w + 0.5f, 0.4f, d + 0.5f), Gfx.Hex(0x8E8E8A), 0.85f);
                    mb.Box(c + new Vector3(0, 0.4f + h * 0.5f, 0), new Vector3(w, h, d), wall, 0.9f);
                    Gable(mb, c + new Vector3(0, 0.4f + h, 0), w + 0.9f, d + 0.9f, d * 0.27f, roof, wall);
                    Vector3 front = new Vector3(0, 0, -side);
                    mb.Box(c + front * (d * 0.5f + 0.03f) + new Vector3(w * 0.25f, 1.45f, 0), new Vector3(1.0f, 2.1f, 0.1f), Gfx.Hex(0x5A3A28));
                    Windows(mb, glass, c + front * (d * 0.5f) + new Vector3(-w * 0.2f, 1.9f, 0), Vector3.right, front, 2, two ? 2 : 1, 1.2f, 1.1f, 0.8f, 1.5f);
                    mb.Box(c + new Vector3(w * 0.28f, 0.4f + h + d * 0.2f, 0.8f), new Vector3(0.7f, 1.6f, 0.7f), Gfx.Hex(0x8C5A48), 0.85f);
                    var col = new GameObject("NeighborCollider");
                    col.transform.SetParent(Root, false);
                    var bc = col.AddComponent<BoxCollider>();
                    bc.center = c + new Vector3(0, 2.5f, 0); bc.size = new Vector3(w, 5, d);
                    n++;
                }
            mb.Make(Root, "Neighbors");
            windows = glass.Make(Root, "NeighborGlass").GetComponent<Renderer>();
        }

        // ---------- 자연물 ----------

        public static void Tree(MB mb, Vector3 p, float scale, int kind, float seed)
        {
            float h = (2.2f + Gfx.Hash(seed, 1) * 1.2f) * scale;
            mb.Cyl(p, 0.22f * scale, 0.14f * scale, h, 6, Trunk, 0.75f, false);
            if (kind == 0)
            {
                Color c = Color.Lerp(Leaf1, Leaf2, Gfx.Hash(seed, 2));
                mb.Blob(p + new Vector3(0, h + 0.9f * scale, 0), new Vector3(1.9f, 1.6f, 1.9f) * scale, c, 1.15f, 0.72f, 0.3f);
                mb.Blob(p + new Vector3(0.9f * scale, h + 0.2f * scale, 0.3f * scale), new Vector3(1.2f, 1.0f, 1.2f) * scale, Gfx.Mul(c, 0.92f), 1.12f, 0.72f, 0.3f);
                mb.Blob(p + new Vector3(-0.8f * scale, h + 0.4f * scale, -0.5f * scale), new Vector3(1.3f, 1.05f, 1.3f) * scale, Gfx.Mul(c, 1.05f), 1.12f, 0.72f, 0.3f);
            }
            else
            {
                Color c = Color.Lerp(Leaf3, Leaf1, Gfx.Hash(seed, 3) * 0.6f);
                for (int i = 0; i < 4; i++)
                    mb.Cyl(p + new Vector3(0, h * 0.45f + i * 1.05f * scale, 0), (1.7f - i * 0.36f) * scale, 0, 1.9f * scale, 7, Gfx.Mul(c, 0.9f + i * 0.06f), 0.75f, false);
            }
        }

        void BuildNature()
        {
            var mb = new MB();
            int count = 0;
            for (int i = 0; i < 260 && count < 120; i++)
            {
                float x = Gfx.Hash(i, 1.3f) * 330 - 165, z = Gfx.Hash(i, 2.7f) * 220 - 110;
                if (Mathf.Abs(z) < 21 && Mathf.Abs(x) < 118) continue;                       // 마을 구역
                if (Mathf.Abs(z) < 40 && Mathf.Abs(z) > 23 && Mathf.Abs(x) < 80) continue;   // 밭
                if (Vector2.Distance(new Vector2(x, z), new Vector2(78, -31)) < 13) continue; // 연못
                float y = Height(x, z);
                Tree(mb, new Vector3(x, y - 0.1f, z), 0.9f + Gfx.Hash(i, 4.1f) * 0.9f, Gfx.Hash(i, 5.9f) > 0.45f ? 0 : 1, i);
                count++;
            }
            // 덤불, 바위, 연못가
            for (int i = 0; i < 70; i++)
            {
                float x = Gfx.Hash(i, 8.3f) * 230 - 115, z = (Gfx.Hash(i, 9.1f) > 0.5f ? 1 : -1) * (19f + Gfx.Hash(i, 6.6f) * 4f);
                if (i % 3 == 0) mb.Blob(new Vector3(x, 0.25f, z), new Vector3(0.7f, 0.45f, 0.6f), Gfx.Hex(0x8C8F8A), 1.1f, 0.7f, 0.5f);
                else mb.Blob(new Vector3(x, 0.4f, z), new Vector3(0.9f, 0.7f, 0.9f), Color.Lerp(Leaf2, Leaf1, Gfx.Hash(i, 3.3f)), 1.15f, 0.7f, 0.4f);
            }
            for (int i = 0; i < 14; i++)
            {
                float a = i * Mathf.PI * 2 / 14f;
                Vector3 p = new Vector3(78 + Mathf.Cos(a) * 11f, 0.2f, -31 + Mathf.Sin(a) * 11f);
                if (i % 2 == 0) mb.Blob(p, new Vector3(0.9f, 0.5f, 0.8f), Gfx.Hex(0x9A9C96), 1.1f, 0.7f, 0.5f);
                else for (int k = 0; k < 3; k++) mb.Cyl(p + new Vector3(k * 0.2f, -0.2f, k * 0.15f), 0.05f, 0.02f, 1.3f + k * 0.2f, 4, Gfx.Hex(0x7FA058), 0.8f, false);
            }
            mb.Make(Root, "Nature");
        }

        // ---------- 가로등·전신주 ----------

        Renderer BuildLampsAndPoles()
        {
            var mb = new MB();
            var glow = new MB();
            for (int i = 0; i < 10; i++)
            {
                float x = -99 + i * 22;
                int side = i % 2 == 0 ? 1 : -1;
                Vector3 p = new Vector3(x, 0.16f, side * 4.55f);
                mb.Cyl(p, 0.11f, 0.07f, 5.4f, 6, Gfx.Hex(0x39424A), 0.8f);
                mb.Box(p + new Vector3(0, 5.35f, -side * 0.7f), new Vector3(0.1f, 0.1f, 1.5f), Gfx.Hex(0x39424A));
                mb.Box(p + new Vector3(0, 5.3f, -side * 1.35f), new Vector3(0.34f, 0.12f, 0.6f), Gfx.Hex(0x2B3238));
                glow.Box(p + new Vector3(0, 5.22f, -side * 1.35f), new Vector3(0.26f, 0.05f, 0.5f), Color.white);
                if (Mathf.Abs(x) < 60)
                {
                    var lgo = new GameObject("LampLight");
                    lgo.transform.SetParent(Root, false);
                    lgo.transform.localPosition = p + new Vector3(0, 4.9f, -side * 1.35f);
                    var l = lgo.AddComponent<Light>();
                    l.type = LightType.Point; l.range = 17; l.intensity = 0; l.color = new Color(1f, 0.82f, 0.55f);
                    l.shadows = LightShadows.None;
                    lampLights.Add(l);
                }
            }

            // 전신주와 전선(남쪽 인도 뒤), 각 주택으로 가는 인입선
            Color pole = Gfx.Hex(0x6B5846), wire = Gfx.Hex(0x1E2226);
            Vector3 prev = Vector3.zero;
            for (int i = 0; i < 9; i++)
            {
                float x = -87 + i * 24.75f;
                Vector3 p = new Vector3(x, 0, -6.2f);
                mb.Cyl(p, 0.16f, 0.11f, 8.2f, 6, pole, 0.8f);
                mb.Box(p + new Vector3(0, 7.6f, 0), new Vector3(0.12f, 0.12f, 2.0f), pole);
                mb.Box(p + new Vector3(0, 6.9f, 0), new Vector3(0.1f, 0.1f, 1.4f), pole);
                for (int k = -1; k <= 1; k++) mb.Cyl(p + new Vector3(0, 7.66f, k * 0.85f), 0.06f, 0.04f, 0.16f, 5, Gfx.Hex(0xD8DCE0));
                if (i % 3 == 1) mb.Cyl(p + new Vector3(0.35f, 6.0f, 0), 0.28f, 0.28f, 0.8f, 8, Gfx.Hex(0x8A9399), 0.85f);
                if (i > 0)
                    for (int k = -1; k <= 1; k++)
                    {
                        Vector3 a = prev + new Vector3(0, 7.8f, k * 0.85f), b = p + new Vector3(0, 7.8f, k * 0.85f);
                        Vector3 last = a;
                        for (int s = 1; s <= 6; s++)
                        {
                            float t = s / 6f;
                            Vector3 q = Vector3.Lerp(a, b, t) - Vector3.up * (Mathf.Sin(t * Mathf.PI) * 0.7f);
                            mb.Beam(last, q, 0.035f, wire);
                            last = q;
                        }
                    }
                prev = p;
            }
            for (int side = -1; side <= 1; side += 2)
                for (int ix = -1; ix <= 1; ix++)
                {
                    Vector3 from = new Vector3(Mathf.Round((ix * 22f + 87f) / 24.75f) * 24.75f - 87f, 6.9f, -6.2f);
                    Vector3 to = new Vector3(ix * 22f + side * 4.1f, 3.5f, side * 10.8f);
                    Vector3 last = from;
                    for (int s = 1; s <= 5; s++)
                    {
                        float t = s / 5f;
                        Vector3 q = Vector3.Lerp(from, to, t) - Vector3.up * (Mathf.Sin(t * Mathf.PI) * 0.5f);
                        mb.Beam(last, q, 0.03f, wire);
                        last = q;
                    }
                }
            mb.Make(Root, "LampsAndPoles");
            return glow.Make(Root, "LampGlow", Gfx.Unlit, false).GetComponent<Renderer>();
        }

        Transform BuildClouds(out Renderer renderer)
        {
            var mb = new MB();
            for (int i = 0; i < 16; i++)
            {
                Vector3 c = new Vector3(Gfx.Hash(i, 1) * 560 - 280, 62 + Gfx.Hash(i, 2) * 30, Gfx.Hash(i, 3) * 420 - 210);
                float s = 7 + Gfx.Hash(i, 4) * 9;
                for (int k = 0; k < 5; k++)
                    mb.Blob(c + new Vector3((k - 2) * s * 0.75f, Gfx.Hash(i, k + 9) * s * 0.3f, Gfx.Hash(i, k + 5) * s * 0.6f),
                        new Vector3(s, s * 0.42f, s * 0.75f) * (0.7f + Gfx.Hash(i, k + 20) * 0.6f), Color.white, 1.0f, 0.86f, 0.25f);
            }
            var go = mb.Make(Root, "Clouds", Gfx.Unlit, false);
            renderer = go.GetComponent<Renderer>();
            return go.transform;
        }

        void AddBounds()
        {
            float[] xs = { -112, 112, 0, 0 }, zs = { 0, 0, -46, 46 };
            for (int i = 0; i < 4; i++)
            {
                var go = new GameObject("Bound");
                go.transform.SetParent(Root, false);
                var bc = go.AddComponent<BoxCollider>();
                bc.center = new Vector3(xs[i], 5, zs[i]);
                bc.size = i < 2 ? new Vector3(1, 10, 94) : new Vector3(226, 10, 1);
            }
        }

        /// <summary>밤이면 가로등과 창문이 켜지고, 구름은 천천히 흐른다.</summary>
        public void Sync(float night, float storm, float dt)
        {
            float on = Mathf.SmoothStep(0, 1, Mathf.Clamp01((night - 0.35f) * 3f));
            Gfx.Tint(lampGlow, Color.Lerp(Gfx.Hex(0x8C9096), new Color(1f, 0.90f, 0.62f), on));
            for (int i = 0; i < lampLights.Count; i++)
            {
                lampLights[i].intensity = on * 2.4f;
                lampLights[i].enabled = on > 0.02f;
            }
            Color glassDay = Color.Lerp(Gfx.Hex(0x6FA6C4), Gfx.Hex(0x53606A), storm);
            Color glassNight = new Color(1f, 0.80f, 0.45f);
            Color g = Color.Lerp(glassDay, glassNight, on);
            Gfx.Tint(sceneryWindows, g);
            Gfx.Tint(glassOffice, Color.Lerp(glassDay, Gfx.Hex(0x2B3A48), on));
            Gfx.Tint(glassShelter, Color.Lerp(glassDay, glassNight, Mathf.Max(on, storm)));

            clouds.localPosition += new Vector3(dt * (1.2f + storm * 9f), 0, 0);
            if (clouds.localPosition.x > 120) clouds.localPosition -= new Vector3(240, 0, 0);
            Color cloudDay = Color.Lerp(Color.white, Gfx.Hex(0x5E6468), storm);
            Gfx.Tint(cloudRenderer, Color.Lerp(cloudDay, Gfx.Hex(0x2A3040), night));
        }
    }

    /// <summary>하늘·햇빛·안개. 게임 시각에 따라 낮과 밤이 바뀌고, 토네이도가 오면 어두워진다.</summary>
    public sealed class Sky
    {
        readonly Light sun;
        readonly Material skyMaterial;
        public float Night;     // 0 낮, 1 밤
        public Color Fog;

        public Sky()
        {
            var go = new GameObject("Sun");
            sun = go.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.72f;
            sun.shadowBias = 0.06f;
            sun.shadowNormalBias = 0.5f;

            var loaded = Resources.Load<Material>("RC_Sky");
            if (loaded != null)
            {
                skyMaterial = new Material(loaded);
                RenderSettings.skybox = skyMaterial;
            }
            RenderSettings.sun = sun;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
        }

        public void Sync(float hour, float storm)
        {
            float angle = (hour - 6f) / 12f * 180f;
            float elevation = Mathf.Sin(angle * Mathf.Deg2Rad);
            float day = Mathf.SmoothStep(0, 1, Mathf.Clamp01((elevation + 0.08f) / 0.33f));
            Night = 1f - day;

            if (elevation > -0.05f) sun.transform.rotation = Quaternion.Euler(Mathf.Clamp(angle, 4f, 176f), -38f, 0);
            else sun.transform.rotation = Quaternion.Euler(52f, 140f, 0);

            Color warm = new Color(1f, 0.66f, 0.42f), noon = new Color(1f, 0.96f, 0.88f), moon = new Color(0.52f, 0.62f, 0.95f);
            Color sunColor = Color.Lerp(warm, noon, Mathf.SmoothStep(0, 1, Mathf.Clamp01(elevation / 0.45f)));
            sun.color = Color.Lerp(moon, sunColor, day);
            sun.intensity = Mathf.Lerp(0.30f, 1.02f, day) * (1f - storm * 0.6f);

            Color skyDay = new Color(0.62f, 0.74f, 0.90f), skyNight = new Color(0.10f, 0.13f, 0.24f), stormSky = new Color(0.30f, 0.33f, 0.33f);
            Color sky = Color.Lerp(Color.Lerp(skyNight, skyDay, day), stormSky, storm);
            RenderSettings.ambientSkyColor = sky * 0.62f;
            RenderSettings.ambientEquatorColor = Color.Lerp(Color.Lerp(new Color(0.09f, 0.11f, 0.18f), new Color(0.36f, 0.38f, 0.39f), day), new Color(0.20f, 0.22f, 0.22f), storm);
            RenderSettings.ambientGroundColor = Color.Lerp(new Color(0.05f, 0.06f, 0.08f), new Color(0.20f, 0.20f, 0.17f), day);

            Color dusk = new Color(0.95f, 0.66f, 0.48f);
            float duskAmount = day * (1f - Mathf.SmoothStep(0, 1, Mathf.Clamp01(elevation / 0.35f)));
            Fog = Color.Lerp(Color.Lerp(new Color(0.06f, 0.08f, 0.14f), new Color(0.74f, 0.84f, 0.92f), day), dusk, duskAmount * 0.7f);
            Fog = Color.Lerp(Fog, new Color(0.36f, 0.39f, 0.37f) * Mathf.Lerp(0.35f, 1f, day), storm);
            RenderSettings.fogColor = Fog;
            RenderSettings.fogStartDistance = Mathf.Lerp(90f, 18f, storm);
            RenderSettings.fogEndDistance = Mathf.Lerp(420f, 140f, storm);

            if (skyMaterial != null)
            {
                skyMaterial.SetFloat("_Exposure", Mathf.Lerp(0.28f, 1.25f, day) * (1f - storm * 0.5f));
                skyMaterial.SetFloat("_AtmosphereThickness", Mathf.Lerp(1.0f, 1.9f, Mathf.Max(storm, duskAmount * 0.5f)));
                skyMaterial.SetColor("_SkyTint", Color.Lerp(new Color(0.45f, 0.55f, 0.75f), new Color(0.5f, 0.5f, 0.5f), storm));
            }
        }
    }
}
