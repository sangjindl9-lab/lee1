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

    /// <summary>코드로 3D 물체를 만드는 도우미. 재질은 색상별로 하나씩만 만들어 함께 쓴다.</summary>
    public static class Vis
    {
        static Material baseMat;
        static readonly Dictionary<int, Material> cache = new Dictionary<int, Material>();

        public static Material Mat(Color c)
        {
            Color32 c32 = c;
            int key = (c32.r << 24) | (c32.g << 16) | (c32.b << 8) | c32.a;
            Material m;
            if (cache.TryGetValue(key, out m) && m != null) return m;
            if (baseMat == null)
            {
                baseMat = Resources.Load<Material>("RC_Lit");
                if (baseMat == null) baseMat = new Material(Shader.Find("Standard"));
            }
            m = new Material(baseMat);
            m.color = c;
            cache[key] = m;
            return m;
        }

        public static GameObject Prim(PrimitiveType type, Transform parent, string name, Vector3 localPos, Vector3 scale, Color color, bool collider)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = Mat(color);
            if (!collider)
            {
                var col = go.GetComponent<Collider>();
                if (col != null) Object.Destroy(col);
            }
            return go;
        }

        public static GameObject Box(Transform parent, string name, Vector3 localPos, Vector3 scale, Color color, bool collider = true)
        {
            return Prim(PrimitiveType.Cube, parent, name, localPos, scale, color, collider);
        }

        public static void Tint(GameObject go, Color c)
        {
            go.GetComponent<Renderer>().sharedMaterial = Mat(c);
        }

        public static Vector3 P(double x, double z, float y = 0) { return new Vector3((float)x, y, (float)z); }
    }
}
