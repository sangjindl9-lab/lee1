using System.Collections.Generic;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>부재 메시에 붙여 두는 식별표. 화면에서 고른 물체가 어느 건물의 어느 부재인지 알려 준다.</summary>
    public sealed class PartRef : MonoBehaviour
    {
        public int BuildingId;
        public int PartId = -1;
    }

    /// <summary>공용 재질. 모든 모델은 정점 색상을 쓰므로 재질은 세 개면 된다.</summary>
    public static class Gfx
    {
        static Material lit, unlit, fade;
        static readonly int ColorId = Shader.PropertyToID("_Color");
        static MaterialPropertyBlock block;

        static Material Load(string resource, string shader)
        {
            var m = Resources.Load<Material>(resource);
            if (m != null) return m;
            var s = Shader.Find(shader);
            if (s == null) s = Shader.Find("Standard");
            return new Material(s);
        }

        public static Material Lit { get { if (lit == null) lit = Load("RC_Lit", "RebuildCity/Lit"); return lit; } }
        public static Material Unlit { get { if (unlit == null) unlit = Load("RC_Unlit", "RebuildCity/Unlit"); return unlit; } }
        public static Material Fade { get { if (fade == null) fade = Load("RC_Fade", "RebuildCity/Fade"); return fade; } }

        /// <summary>물체 하나의 색조만 바꾼다(재질을 새로 만들지 않는다).</summary>
        public static void Tint(Renderer r, Color c)
        {
            if (block == null) block = new MaterialPropertyBlock();
            r.GetPropertyBlock(block);
            block.SetColor(ColorId, QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c);
            r.SetPropertyBlock(block);
        }

        public static Vector3 P(double x, double z, float y = 0) { return new Vector3((float)x, y, (float)z); }

        public static Color Hex(int rgb) { return new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, 1f); }
        public static Color Mul(Color c, float k) { return new Color(c.r * k, c.g * k, c.b * k, c.a); }

        /// <summary>위치로 정해지는 고정 난수(0~1). 같은 자리는 항상 같은 값이 나온다.</summary>
        public static float Hash(float x, float y)
        {
            float h = Mathf.Sin(x * 12.9898f + y * 78.233f) * 43758.5453f;
            return h - Mathf.Floor(h);
        }
    }

    /// <summary>
    /// 코드로 저폴리 모델을 만드는 도구. 면마다 정점을 따로 두어 각진 음영이 나오고,
    /// 면의 방향은 바깥쪽 기준점으로 자동으로 맞춘다.
    /// </summary>
    public sealed class MB
    {
        readonly List<Vector3> verts = new List<Vector3>();
        readonly List<Color> colors = new List<Color>();
        readonly List<int> tris = new List<int>();
        public Matrix4x4 M = Matrix4x4.identity;
        static readonly bool linear = QualitySettings.activeColorSpace == ColorSpace.Linear;

        public int VertexCount { get { return verts.Count; } }

        public void Push(Vector3 pos, Quaternion rot) { M = M * Matrix4x4.TRS(pos, rot, Vector3.one); }
        public void Reset() { M = Matrix4x4.identity; }

        int V(Vector3 p, Color c)
        {
            verts.Add(M.MultiplyPoint3x4(p));
            colors.Add(linear ? c.linear : c);
            return verts.Count - 1;
        }

        /// <summary>삼각형. outward 쪽에서 보이도록 방향을 맞춘다.</summary>
        public void Tri(Vector3 a, Vector3 b, Vector3 c, Color col, Vector3 outward)
        {
            if (Vector3.Dot(Vector3.Cross(b - a, c - a), outward) < 0) { var t = b; b = c; c = t; }
            int i = V(a, col); V(b, col); V(c, col);
            tris.Add(i); tris.Add(i + 1); tris.Add(i + 2);
        }

        /// <summary>사각형(a-b-c-d 순서로 둘레). 정점마다 색을 줄 수 있다.</summary>
        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color ca, Color cb, Color cc, Color cd, Vector3 outward)
        {
            bool flip = Vector3.Dot(Vector3.Cross(b - a, c - a), outward) < 0;
            int i = V(a, ca); V(b, cb); V(c, cc); V(d, cd);
            if (!flip) { tris.Add(i); tris.Add(i + 1); tris.Add(i + 2); tris.Add(i); tris.Add(i + 2); tris.Add(i + 3); }
            else { tris.Add(i); tris.Add(i + 2); tris.Add(i + 1); tris.Add(i); tris.Add(i + 3); tris.Add(i + 2); }
        }

        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color col, Vector3 outward) { Quad(a, b, c, d, col, col, col, col, outward); }

        /// <summary>상자. bottomShade &lt; 1 이면 아래쪽이 조금 어두워져 땅에 닿은 느낌이 난다.</summary>
        public void Box(Vector3 c, Vector3 size, Color col, float bottomShade = 1f)
        {
            Vector3 h = size * 0.5f;
            Color lo = Gfx.Mul(col, bottomShade);
            Vector3 p000 = c + new Vector3(-h.x, -h.y, -h.z), p100 = c + new Vector3(h.x, -h.y, -h.z);
            Vector3 p010 = c + new Vector3(-h.x, h.y, -h.z), p110 = c + new Vector3(h.x, h.y, -h.z);
            Vector3 p001 = c + new Vector3(-h.x, -h.y, h.z), p101 = c + new Vector3(h.x, -h.y, h.z);
            Vector3 p011 = c + new Vector3(-h.x, h.y, h.z), p111 = c + new Vector3(h.x, h.y, h.z);
            Quad(p000, p010, p110, p100, lo, col, col, lo, Vector3.back);
            Quad(p001, p011, p111, p101, lo, col, col, lo, Vector3.forward);
            Quad(p000, p010, p011, p001, lo, col, col, lo, Vector3.left);
            Quad(p100, p110, p111, p101, lo, col, col, lo, Vector3.right);
            Quad(p010, p110, p111, p011, col, Vector3.up);
            Quad(p000, p100, p101, p001, lo, Vector3.down);
        }

        /// <summary>회전한 상자.</summary>
        public void Box(Vector3 c, Vector3 size, Quaternion rot, Color col, float bottomShade = 1f)
        {
            var saved = M;
            M = M * Matrix4x4.TRS(c, rot, Vector3.one);
            Box(Vector3.zero, size, col, bottomShade);
            M = saved;
        }

        /// <summary>세로 원기둥·원뿔대(r1 = 0 이면 원뿔). baseCenter 에서 위로 h.</summary>
        public void Cyl(Vector3 baseCenter, float r0, float r1, float h, int n, Color col, float bottomShade = 1f, bool caps = true)
        {
            Color lo = Gfx.Mul(col, bottomShade);
            Vector3 top = baseCenter + Vector3.up * h;
            for (int i = 0; i < n; i++)
            {
                float a0 = i * Mathf.PI * 2 / n, a1 = (i + 1) * Mathf.PI * 2 / n;
                Vector3 d0 = new Vector3(Mathf.Cos(a0), 0, Mathf.Sin(a0)), d1 = new Vector3(Mathf.Cos(a1), 0, Mathf.Sin(a1));
                Vector3 outward = d0 + d1;
                if (r1 <= 0.0001f) Tri(baseCenter + d0 * r0, baseCenter + d1 * r0, top, col, outward + Vector3.up * 0.3f);
                else Quad(baseCenter + d0 * r0, top + d0 * r1, top + d1 * r1, baseCenter + d1 * r0, lo, col, col, lo, outward);
                if (!caps) continue;
                if (r1 > 0.0001f) Tri(top, top + d0 * r1, top + d1 * r1, col, Vector3.up);
                Tri(baseCenter, baseCenter + d0 * r0, baseCenter + d1 * r0, lo, Vector3.down);
            }
        }

        /// <summary>임의 축을 따라 놓는 막대(전선, 비계 파이프).</summary>
        public void Beam(Vector3 a, Vector3 b, float thickness, Color col)
        {
            Vector3 d = b - a;
            float len = d.magnitude;
            if (len < 0.0001f) return;
            Box((a + b) * 0.5f, new Vector3(thickness, thickness, len), Quaternion.LookRotation(d / len), col);
        }

        /// <summary>둥근 덩어리(나무 잎, 구름, 바위). 팔면체를 한 번 나눈 저폴리 공.</summary>
        public void Blob(Vector3 c, Vector3 radius, Color col, float topLight = 1.12f, float bottomShade = 0.78f, float jitter = 0f)
        {
            Vector3[] p = { Vector3.up, Vector3.down, Vector3.left, Vector3.right, Vector3.forward, Vector3.back };
            int[] f = { 0, 4, 3, 0, 3, 5, 0, 5, 2, 0, 2, 4, 1, 3, 4, 1, 5, 3, 1, 2, 5, 1, 4, 2 };
            for (int i = 0; i < f.Length; i += 3)
            {
                Vector3 a = p[f[i]], b = p[f[i + 1]], d = p[f[i + 2]];
                Vector3 ab = (a + b).normalized, bd = (b + d).normalized, da = (d + a).normalized;
                BlobTri(c, radius, a, ab, da, col, topLight, bottomShade, jitter);
                BlobTri(c, radius, ab, b, bd, col, topLight, bottomShade, jitter);
                BlobTri(c, radius, da, bd, d, col, topLight, bottomShade, jitter);
                BlobTri(c, radius, ab, bd, da, col, topLight, bottomShade, jitter);
            }
        }

        void BlobTri(Vector3 c, Vector3 r, Vector3 a, Vector3 b, Vector3 d, Color col, float topLight, float bottomShade, float jitter)
        {
            Vector3 mid = (a + b + d) / 3f;
            float k = Mathf.Lerp(bottomShade, topLight, mid.y * 0.5f + 0.5f);
            Tri(c + Warp(a, r, jitter), c + Warp(b, r, jitter), c + Warp(d, r, jitter), Gfx.Mul(col, k), mid);
        }

        static Vector3 Warp(Vector3 n, Vector3 r, float jitter)
        {
            float j = 1f + (Gfx.Hash(n.x * 3.1f + n.y * 7.7f, n.z * 5.3f + n.y) - 0.5f) * jitter;
            return new Vector3(n.x * r.x, n.y * r.y, n.z * r.z) * j;
        }

        public Mesh Build(string name)
        {
            var mesh = new Mesh();
            mesh.name = name;
            if (verts.Count > 65000) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.SetVertices(verts);
            mesh.SetColors(colors);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>지금까지 쌓은 면으로 물체를 만들고, 도구를 비운다.</summary>
        public GameObject Make(Transform parent, string name, Material material = null, bool shadows = true)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = Build(name);
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = material != null ? material : Gfx.Lit;
            if (!shadows)
            {
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            verts.Clear(); colors.Clear(); tris.Clear();
            M = Matrix4x4.identity;
            return go;
        }
    }
}
