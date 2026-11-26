using System.Collections.Generic;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>사람(작업자·대표). 몸통·머리·팔·다리가 따로 움직여 걷기·달리기·망치질·운반 동작을 한다.</summary>
    public sealed class HumanView
    {
        public readonly GameObject Root;
        readonly Transform body, armL, armR, legL, legR, head;
        readonly GameObject tool, load;
        float phase;
        Vector3 lastPos;
        bool hasLast;

        public HumanView(Transform parent, Color helmet, Color top, Color pants, bool vest)
        {
            Root = new GameObject("Human");
            Root.transform.SetParent(parent, false);
            Color skin = Gfx.Hex(0xE8B894), boot = Gfx.Hex(0x2E2A28);

            body = Pivot(Root.transform, "Body", new Vector3(0, 0.92f, 0));
            var mb = new MB();
            mb.Box(new Vector3(0, 0.32f, 0), new Vector3(0.46f, 0.62f, 0.27f), top, 0.9f);
            mb.Box(new Vector3(0, 0.02f, 0), new Vector3(0.44f, 0.12f, 0.26f), pants);
            if (vest)
            {
                mb.Box(new Vector3(0, 0.34f, 0), new Vector3(0.48f, 0.44f, 0.29f), Gfx.Hex(0xF2762A));
                mb.Box(new Vector3(0, 0.26f, 0), new Vector3(0.49f, 0.06f, 0.3f), Gfx.Hex(0xE9EDC8));
                mb.Box(new Vector3(0, 0.44f, 0), new Vector3(0.49f, 0.06f, 0.3f), Gfx.Hex(0xE9EDC8));
            }
            else
            {
                mb.Box(new Vector3(0, 0.4f, 0.136f), new Vector3(0.1f, 0.4f, 0.02f), Gfx.Hex(0xF4F1EA));
                mb.Box(new Vector3(0, 0.36f, 0.148f), new Vector3(0.05f, 0.3f, 0.01f), Gfx.Hex(0xC23B2E));
            }
            mb.Box(new Vector3(0, 0.66f, 0), new Vector3(0.14f, 0.1f, 0.14f), skin);
            mb.Make(body, "Torso");

            head = Pivot(body, "Head", new Vector3(0, 0.72f, 0));
            mb.Blob(new Vector3(0, 0.14f, 0), new Vector3(0.155f, 0.18f, 0.165f), skin, 1.05f, 0.85f, 0f);
            mb.Blob(new Vector3(0, 0.25f, -0.01f), new Vector3(0.185f, 0.13f, 0.2f), helmet, 1.1f, 0.85f, 0f);
            mb.Box(new Vector3(0, 0.2f, 0.12f), new Vector3(0.3f, 0.03f, 0.2f), helmet);
            mb.Box(new Vector3(0.06f, 0.15f, 0.158f), new Vector3(0.035f, 0.035f, 0.02f), Gfx.Hex(0x2B2622));
            mb.Box(new Vector3(-0.06f, 0.15f, 0.158f), new Vector3(0.035f, 0.035f, 0.02f), Gfx.Hex(0x2B2622));
            mb.Make(head, "HeadMesh");

            armL = Limb(body, "ArmL", new Vector3(-0.3f, 0.56f, 0), 0.13f, 0.6f, top, skin, 0.12f);
            armR = Limb(body, "ArmR", new Vector3(0.3f, 0.56f, 0), 0.13f, 0.6f, top, skin, 0.12f);
            legL = Limb(Root.transform, "LegL", new Vector3(-0.12f, 0.92f, 0), 0.17f, 0.92f, pants, boot, 0.2f);
            legR = Limb(Root.transform, "LegR", new Vector3(0.12f, 0.92f, 0), 0.17f, 0.92f, pants, boot, 0.2f);

            mb.Box(new Vector3(0, -0.62f, 0.16f), new Vector3(0.045f, 0.045f, 0.5f), Gfx.Hex(0x8A6A48));
            mb.Box(new Vector3(0, -0.62f, 0.42f), new Vector3(0.09f, 0.22f, 0.1f), Gfx.Hex(0x565E66));
            tool = mb.Make(armR, "Hammer");
            tool.SetActive(false);

            mb.Box(new Vector3(0, 0.22f, 0.42f), new Vector3(0.7f, 0.2f, 0.5f), Gfx.Hex(0x3F7A96), 0.9f);
            mb.Box(new Vector3(0, 0.34f, 0.42f), new Vector3(0.7f, 0.05f, 0.5f), Gfx.Hex(0x356A84));
            mb.Box(new Vector3(-0.2f, 0.28f, 0.42f), new Vector3(0.04f, 0.19f, 0.52f), Gfx.Hex(0x2B3238));
            mb.Box(new Vector3(0.2f, 0.28f, 0.42f), new Vector3(0.04f, 0.19f, 0.52f), Gfx.Hex(0x2B3238));
            load = mb.Make(body, "Load");
            load.SetActive(false);
        }

        static Transform Pivot(Transform parent, string name, Vector3 pos)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            return go.transform;
        }

        static Transform Limb(Transform parent, string name, Vector3 pos, float thick, float length, Color upper, Color end, float endLength)
        {
            var t = Pivot(parent, name, pos);
            var mb = new MB();
            mb.Box(new Vector3(0, -(length - endLength) * 0.5f, 0), new Vector3(thick, length - endLength, thick), upper, 0.92f);
            mb.Box(new Vector3(0, -length + endLength * 0.5f, endLength > 0.15f ? 0.04f : 0), new Vector3(thick * 1.05f, endLength, endLength > 0.15f ? thick * 1.5f : thick * 1.05f), end);
            mb.Make(t, name + "Mesh");
            return t;
        }

        /// <summary>시뮬레이션 위치를 따라가며 방향과 동작을 맞춘다.</summary>
        public void Follow(Vector3 target, bool working, bool carrying, float dt, Vector3 faceWhenWorking)
        {
            var tr = Root.transform;
            Vector3 delta = target - tr.position;
            delta.y = 0;
            float dist = delta.magnitude;
            if (dist > 20f || !hasLast) tr.position = target;
            else tr.position = Vector3.MoveTowards(tr.position, target, Mathf.Max(dist * 8f, 1.5f) * dt);
            hasLast = true;
            float speed = dt > 0 ? (tr.position - lastPos).magnitude / dt : 0;
            lastPos = tr.position;
            bool moving = speed > 0.25f;
            Vector3 look = moving ? delta : (working ? faceWhenWorking - tr.position : Vector3.zero);
            look.y = 0;
            if (look.sqrMagnitude > 0.0004f) tr.rotation = Quaternion.RotateTowards(tr.rotation, Quaternion.LookRotation(look.normalized), 540f * dt);
            Animate(moving ? Mathf.Clamp(speed / 2.2f, 0.6f, 2.2f) : 0, working && !moving, carrying, dt);
        }

        /// <summary>gait: 0 서 있음, 1 걷기, 2 달리기.</summary>
        public void Animate(float gait, bool working, bool carrying, float dt)
        {
            tool.SetActive(working);
            load.SetActive(carrying);
            if (gait > 0.01f)
            {
                phase += dt * (5.5f + gait * 3.2f);
                float swing = Mathf.Sin(phase) * (26f + gait * 12f);
                legL.localRotation = Quaternion.Euler(swing, 0, 0);
                legR.localRotation = Quaternion.Euler(-swing, 0, 0);
                if (carrying) { armL.localRotation = Quaternion.Euler(-62, 0, 8); armR.localRotation = Quaternion.Euler(-62, 0, -8); }
                else { armL.localRotation = Quaternion.Euler(-swing * 0.8f, 0, 0); armR.localRotation = Quaternion.Euler(swing * 0.8f, 0, 0); }
                body.localPosition = new Vector3(0, 0.92f + Mathf.Abs(Mathf.Cos(phase)) * 0.045f, 0);
                body.localRotation = Quaternion.Euler(4f + gait * 4f, Mathf.Sin(phase) * 5f, 0);
                head.localRotation = Quaternion.identity;
            }
            else if (working)
            {
                phase += dt * 7.5f;
                float hit = Mathf.Pow(Mathf.Max(0, Mathf.Sin(phase)), 0.6f);
                legL.localRotation = Quaternion.Euler(-10, 0, 0);
                legR.localRotation = Quaternion.Euler(14, 0, 0);
                armR.localRotation = Quaternion.Euler(-150f + hit * 95f, 0, -6);
                armL.localRotation = Quaternion.Euler(-48, 0, 14);
                body.localPosition = new Vector3(0, 0.9f, 0);
                body.localRotation = Quaternion.Euler(12f + hit * 7f, 0, 0);
                head.localRotation = Quaternion.Euler(8, 0, 0);
            }
            else
            {
                phase += dt * 1.6f;
                legL.localRotation = legR.localRotation = Quaternion.identity;
                float breathe = Mathf.Sin(phase) * 2f;
                armL.localRotation = carrying ? Quaternion.Euler(-62, 0, 8) : Quaternion.Euler(breathe, 0, 4);
                armR.localRotation = carrying ? Quaternion.Euler(-62, 0, -8) : Quaternion.Euler(-breathe, 0, -4);
                body.localPosition = new Vector3(0, 0.92f + Mathf.Sin(phase) * 0.006f, 0);
                body.localRotation = Quaternion.identity;
                head.localRotation = Quaternion.Euler(0, Mathf.Sin(phase * 0.4f) * 14f, 0);
            }
        }
    }

    /// <summary>자재 운반 트럭.</summary>
    public sealed class TruckView
    {
        readonly Transform root;
        readonly GameObject cargo;
        readonly Renderer lights;
        readonly Transform[] wheels = new Transform[6];
        bool placed;

        public TruckView(Transform parent)
        {
            var go = new GameObject("Truck");
            go.transform.SetParent(parent, false);
            root = go.transform;
            Color cab = Gfx.Hex(0xF2F0EA), accent = Gfx.Hex(0x12777A), dark = Gfx.Hex(0x2B3238), bed = Gfx.Hex(0x59636B);

            var mb = new MB();
            mb.Box(new Vector3(0, 0.62f, 0), new Vector3(1.9f, 0.22f, 5.9f), dark);
            mb.Box(new Vector3(0, 1.45f, 2.05f), new Vector3(2.1f, 1.5f, 1.7f), cab, 0.92f);
            mb.Box(new Vector3(0, 1.0f, 2.05f), new Vector3(2.12f, 0.3f, 1.72f), accent);
            mb.Box(new Vector3(0, 2.24f, 1.95f), new Vector3(2.0f, 0.1f, 1.4f), Gfx.Mul(cab, 0.9f));
            mb.Box(new Vector3(0, 1.75f, 2.91f), new Vector3(1.8f, 0.7f, 0.04f), Gfx.Hex(0x3A566A));
            for (int s = -1; s <= 1; s += 2)
            {
                mb.Box(new Vector3(s * 1.06f, 1.72f, 2.25f), new Vector3(0.03f, 0.6f, 0.9f), Gfx.Hex(0x3A566A));
                mb.Box(new Vector3(s * 1.2f, 1.75f, 2.8f), new Vector3(0.22f, 0.3f, 0.06f), dark);
                mb.Box(new Vector3(s * 1.03f, 1.05f, -1.0f), new Vector3(0.06f, 0.5f, 3.9f), bed);
                for (int k = 0; k < 4; k++) mb.Box(new Vector3(s * 1.06f, 1.05f, -2.8f + k * 1.2f), new Vector3(0.04f, 0.56f, 0.08f), dark);
            }
            mb.Box(new Vector3(0, 0.78f, -1.0f), new Vector3(2.1f, 0.1f, 3.95f), bed);
            mb.Box(new Vector3(0, 1.05f, -2.95f), new Vector3(2.1f, 0.5f, 0.06f), bed);
            mb.Box(new Vector3(0, 1.3f, 1.12f), new Vector3(2.1f, 1.1f, 0.08f), bed);
            mb.Box(new Vector3(0, 0.55f, 3.0f), new Vector3(2.15f, 0.22f, 0.16f), dark);
            mb.Box(new Vector3(0, 0.92f, 2.93f), new Vector3(1.2f, 0.24f, 0.04f), dark);
            mb.Make(root, "TruckBody");

            mb.Box(new Vector3(0.75f, 0.95f, 2.93f), new Vector3(0.3f, 0.16f, 0.05f), Color.white);
            mb.Box(new Vector3(-0.75f, 0.95f, 2.93f), new Vector3(0.3f, 0.16f, 0.05f), Color.white);
            lights = mb.Make(root, "Headlights", Gfx.Unlit, false).GetComponent<Renderer>();

            float[] wz = { 2.0f, -1.2f, -2.2f };
            for (int i = 0; i < 6; i++)
            {
                var w = new GameObject("Wheel");
                w.transform.SetParent(root, false);
                w.transform.localPosition = new Vector3(i % 2 == 0 ? -0.98f : 0.98f, 0.42f, wz[i / 2]);
                var wm = new MB();
                wm.Push(Vector3.zero, Quaternion.Euler(0, 0, 90));
                wm.Cyl(new Vector3(0, -0.14f, 0), 0.42f, 0.42f, 0.28f, 12, Gfx.Hex(0x1C1E20));
                wm.Cyl(new Vector3(0, -0.15f, 0), 0.2f, 0.2f, 0.3f, 8, Gfx.Hex(0xA9B0B6));
                wm.Reset();
                wm.Make(w.transform, "WheelMesh");
                wheels[i] = w.transform;
            }

            mb.Box(new Vector3(0, 1.02f, -0.2f), new Vector3(1.7f, 0.36f, 1.3f), Gfx.Hex(0x3F7A96), 0.92f);
            mb.Box(new Vector3(0, 1.38f, -0.2f), new Vector3(1.7f, 0.36f, 1.3f), Gfx.Hex(0x4A8AA8), 0.92f);
            mb.Box(new Vector3(-0.3f, 1.2f, -1.9f), new Vector3(0.14f, 1.3f, 1.1f), Quaternion.Euler(0, 0, -8), Gfx.Hex(0xF4F1EA));
            mb.Box(new Vector3(0.4f, 1.0f, -1.9f), new Vector3(0.7f, 0.4f, 0.9f), Gfx.Hex(0xD98A3A), 0.92f);
            mb.Box(new Vector3(0, 0.86f, -1.0f), new Vector3(1.9f, 0.06f, 3.6f), Gfx.Hex(0x8A6A48));
            cargo = mb.Make(root, "Cargo");
        }

        public void Sync(Truck t, float night, float dt)
        {
            Vector3 target = Gfx.P(t.X, t.Z);
            // 현장 앞에서는 차도 가장자리에 세운다
            if (t.State == TruckState.ToSite || t.State == TruckState.Unloading) target.z = Mathf.Clamp(target.z, -2.3f, 2.3f);
            Vector3 delta = target - root.position;
            delta.y = 0;
            float dist = delta.magnitude;
            if (dist > 40f || !placed) { root.position = target; placed = true; }
            else
            {
                Vector3 before = root.position;
                root.position = Vector3.MoveTowards(root.position, target, Mathf.Max(dist * 6f, 2f) * dt);
                float moved = (root.position - before).magnitude;
                for (int i = 0; i < 6; i++) wheels[i].Rotate(moved / 0.42f * Mathf.Rad2Deg, 0, 0, Space.Self);
            }
            if (dist > 0.3f) root.rotation = Quaternion.RotateTowards(root.rotation, Quaternion.LookRotation(delta.normalized), 200f * dt);
            cargo.SetActive(t.State == TruckState.ToSite || t.State == TruckState.Unloading);
            Gfx.Tint(lights, night > 0.4f ? new Color(1f, 0.95f, 0.75f) : Gfx.Hex(0xD9DEE2));
        }
    }

    /// <summary>토네이도: 뒤틀린 깔때기 두 겹, 도는 잔해, 지면 먼지.</summary>
    public sealed class TornadoView
    {
        public readonly GameObject Root;
        readonly Transform funnelA, funnelB, dust;
        readonly Transform[] bits = new Transform[70];
        readonly float[] bitRadius = new float[70], bitHeight = new float[70], bitSpeed = new float[70], bitPhase = new float[70];
        float time;

        public TornadoView(Transform parent)
        {
            Root = new GameObject("Tornado");
            Root.transform.SetParent(parent, false);
            funnelA = Funnel(new Color(0.26f, 0.27f, 0.29f, 0.94f), 1.0f, 0.9f).transform;
            funnelB = Funnel(new Color(0.17f, 0.18f, 0.20f, 0.62f), 1.3f, -0.6f).transform;

            var dm = new MB();
            for (int i = 0; i < 9; i++)
            {
                float a = i * Mathf.PI * 2 / 9f;
                dm.Blob(new Vector3(Mathf.Cos(a) * 7f, 1.6f, Mathf.Sin(a) * 7f), new Vector3(4.2f, 2.2f, 4.2f), new Color(0.42f, 0.38f, 0.33f, 0.46f), 1.05f, 0.9f, 0.3f);
            }
            dust = dm.Make(Root.transform, "Dust", Gfx.Fade, false).transform;

            var bm = new MB();
            bm.Box(Vector3.zero, new Vector3(0.9f, 0.08f, 0.5f), Gfx.Hex(0x6B5846));
            Mesh plank = bm.Build("Bit");
            for (int i = 0; i < bits.Length; i++)
            {
                var go = new GameObject("Bit");
                go.transform.SetParent(Root.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = plank;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = Gfx.Lit;
                Gfx.Tint(r, i % 3 == 0 ? Gfx.Hex(0xC8A27A) : (i % 3 == 1 ? Gfx.Hex(0x9A5A48) : Gfx.Hex(0xB9BEC2)));
                float s = 0.5f + Gfx.Hash(i, 1) * 1.1f;
                go.transform.localScale = new Vector3(s, s, s);
                bitHeight[i] = 1f + Gfx.Hash(i, 2) * 24f;
                bitRadius[i] = 2.2f + bitHeight[i] * 0.42f + Gfx.Hash(i, 3) * 3f;
                bitSpeed[i] = 2.6f - bitHeight[i] * 0.05f + Gfx.Hash(i, 4);
                bitPhase[i] = Gfx.Hash(i, 5) * 6.28f;
                bits[i] = go.transform;
            }
            Root.SetActive(false);
        }

        GameObject Funnel(Color col, float widen, float twist)
        {
            var mb = new MB();
            const int rings = 16, seg = 18;
            const float height = 46f;
            for (int r = 0; r < rings; r++)
            {
                float t0 = r / (float)rings, t1 = (r + 1) / (float)rings;
                for (int s = 0; s < seg; s++)
                {
                    Vector3 a = FunnelPoint(t0, s, seg, height, widen, twist), b = FunnelPoint(t0, s + 1, seg, height, widen, twist);
                    Vector3 c = FunnelPoint(t1, s + 1, seg, height, widen, twist), d = FunnelPoint(t1, s, seg, height, widen, twist);
                    float shade = 0.82f + Gfx.Hash(r, s) * 0.3f;
                    Color c0 = new Color(col.r * shade, col.g * shade, col.b * shade, col.a * Mathf.Lerp(1f, 0.7f, t0));
                    Color c1 = new Color(col.r * shade, col.g * shade, col.b * shade, col.a * Mathf.Lerp(1f, 0.7f, t1));
                    mb.Quad(a, b, c, d, c0, c0, c1, c1, new Vector3(a.x, 0, a.z));
                }
            }
            return mb.Make(Root.transform, "Funnel", Gfx.Fade, false);
        }

        static Vector3 FunnelPoint(float t, int s, int seg, float height, float widen, float twist)
        {
            float radius = (3.2f + Mathf.Pow(t, 1.7f) * 15f) * widen;
            float a = s * Mathf.PI * 2 / seg + t * twist * 6f;
            float sway = Mathf.Sin(t * 5.2f) * 1.6f * t;
            return new Vector3(Mathf.Cos(a) * radius + sway, t * height, Mathf.Sin(a) * radius + sway * 0.6f);
        }

        public void Sync(bool active, Vector3 pos, float dt)
        {
            if (Root.activeSelf != active) { Root.SetActive(active); if (active) Root.transform.position = pos; }
            if (!active) return;
            time += dt;
            Root.transform.position = Vector3.Lerp(Root.transform.position, pos, Mathf.Clamp01(dt * 4f));
            funnelA.Rotate(0, 300f * dt, 0);
            funnelB.Rotate(0, -190f * dt, 0);
            dust.Rotate(0, 120f * dt, 0);
            float pulse = 1f + Mathf.Sin(time * 3f) * 0.08f;
            dust.localScale = new Vector3(pulse, 1f, pulse);
            for (int i = 0; i < bits.Length; i++)
            {
                float a = bitPhase[i] + time * bitSpeed[i];
                float h = bitHeight[i] + Mathf.Sin(time * 1.3f + i) * 1.5f;
                bits[i].localPosition = new Vector3(Mathf.Cos(a) * bitRadius[i], h, Mathf.Sin(a) * bitRadius[i]);
                bits[i].localRotation = Quaternion.Euler(a * 140f, a * 90f, i * 20f);
            }
        }
    }

    /// <summary>작업할 때 이는 먼지.</summary>
    public sealed class DustFx
    {
        readonly Renderer[] puffs = new Renderer[28];
        readonly float[] life = new float[28];
        readonly Vector3[] velocity = new Vector3[28];
        int next;

        public DustFx(Transform parent)
        {
            var mb = new MB();
            mb.Blob(Vector3.zero, new Vector3(0.5f, 0.42f, 0.5f), Color.white, 1.05f, 0.85f, 0.35f);
            Mesh mesh = mb.Build("Puff");
            for (int i = 0; i < puffs.Length; i++)
            {
                var go = new GameObject("Puff");
                go.transform.SetParent(parent, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = Gfx.Fade;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
                go.SetActive(false);
                puffs[i] = r;
            }
        }

        public void Emit(Vector3 pos, Color color)
        {
            int i = next;
            next = (next + 1) % puffs.Length;
            life[i] = 1f;
            float a = Gfx.Hash(pos.x + i, pos.z) * 6.28f;
            velocity[i] = new Vector3(Mathf.Cos(a) * 0.5f, 0.9f, Mathf.Sin(a) * 0.5f);
            puffs[i].transform.position = pos;
            puffs[i].gameObject.SetActive(true);
            baseColor[i] = color;
        }

        readonly Color[] baseColor = new Color[28];

        public void Tick(float dt)
        {
            for (int i = 0; i < puffs.Length; i++)
            {
                if (life[i] <= 0) continue;
                life[i] -= dt * 0.9f;
                var tr = puffs[i].transform;
                if (life[i] <= 0) { tr.gameObject.SetActive(false); continue; }
                tr.position += velocity[i] * dt;
                float s = 0.5f + (1f - life[i]) * 1.5f;
                tr.localScale = new Vector3(s, s, s);
                Color c = baseColor[i];
                c.a = life[i] * 0.5f;
                Gfx.Tint(puffs[i], c);
            }
        }
    }
}
