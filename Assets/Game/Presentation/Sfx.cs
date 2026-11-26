using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>효과음. 음원 파일 없이 코드로 파형을 만들어 쓴다.</summary>
    public sealed class Sfx
    {
        const int Rate = 22050;
        AudioSource wind, shots;
        public AudioClip Hammer, Click, Coin, Siren, Thud;
        float hammerCooldown;

        readonly bool enabled;

        public Sfx(GameObject host, bool on)
        {
            enabled = on;
            if (!on) return;
            wind = host.AddComponent<AudioSource>();
            wind.loop = true; wind.volume = 0; wind.spatialBlend = 0;
            wind.clip = Make("wind", 3f, WindSamples);
            wind.Play();
            shots = host.AddComponent<AudioSource>();
            shots.spatialBlend = 0;

            Hammer = Make("hammer", 0.16f, (data) =>
            {
                uint seed = 7;
                for (int i = 0; i < data.Length; i++)
                {
                    float t = i / (float)Rate;
                    seed = seed * 1664525u + 1013904223u;
                    float noise = ((seed >> 9) & 0xFFFF) / 32768f - 1f;
                    data[i] = (noise * 0.5f * Mathf.Exp(-t * 60f) + Mathf.Sin(t * 2f * Mathf.PI * 190f) * Mathf.Exp(-t * 28f) * 0.8f) * 0.7f;
                }
            });
            Click = Make("click", 0.06f, (data) =>
            {
                for (int i = 0; i < data.Length; i++)
                {
                    float t = i / (float)Rate;
                    data[i] = Mathf.Sin(t * 2f * Mathf.PI * 880f) * Mathf.Exp(-t * 70f) * 0.35f;
                }
            });
            Coin = Make("coin", 0.5f, (data) =>
            {
                for (int i = 0; i < data.Length; i++)
                {
                    float t = i / (float)Rate;
                    float f = t < 0.09f ? 988f : 1319f;
                    data[i] = (Mathf.Sin(t * 2f * Mathf.PI * f) + Mathf.Sin(t * 2f * Mathf.PI * f * 2f) * 0.3f) * Mathf.Exp(-(t < 0.09f ? t : t - 0.09f) * 9f) * 0.3f;
                }
            });
            Siren = Make("siren", 1.6f, (data) =>
            {
                float phase = 0;
                for (int i = 0; i < data.Length; i++)
                {
                    float t = i / (float)Rate;
                    float f = 620f + Mathf.Sin(t * 2f * Mathf.PI * 1.25f) * 180f;
                    phase += 2f * Mathf.PI * f / Rate;
                    float env = Mathf.Min(1f, t * 8f) * Mathf.Min(1f, (1.6f - t) * 6f);
                    data[i] = Mathf.Sin(phase) * 0.22f * env;
                }
            });
            Thud = Make("thud", 0.3f, (data) =>
            {
                for (int i = 0; i < data.Length; i++)
                {
                    float t = i / (float)Rate;
                    data[i] = Mathf.Sin(t * 2f * Mathf.PI * (110f - t * 160f)) * Mathf.Exp(-t * 14f) * 0.7f;
                }
            });
        }

        static void WindSamples(float[] data)
        {
            uint seed = 12345;
            float low = 0, lower = 0;
            for (int i = 0; i < data.Length; i++)
            {
                seed = seed * 1664525u + 1013904223u;
                float noise = ((seed >> 9) & 0xFFFF) / 32768f - 1f;
                low += (noise - low) * 0.045f;
                lower += (low - lower) * 0.02f;
                float t = i / (float)data.Length;
                float gust = 0.65f + 0.35f * Mathf.Sin(t * 2f * Mathf.PI * 2f);
                data[i] = (low * 1.6f + lower * 3f) * gust;
            }
            // 이어 붙는 자리가 튀지 않게 끝을 처음과 섞는다
            int fade = Rate / 4;
            for (int i = 0; i < fade; i++)
            {
                float k = i / (float)fade;
                data[data.Length - fade + i] = Mathf.Lerp(data[data.Length - fade + i], data[i], k);
            }
        }

        static AudioClip Make(string name, float seconds, System.Action<float[]> fill)
        {
            var data = new float[(int)(Rate * seconds)];
            fill(data);
            var clip = AudioClip.Create(name, data.Length, 1, Rate, false);
            clip.SetData(data, 0);
            return clip;
        }

        public void Play(AudioClip clip, float volume = 1f) { if (enabled) shots.PlayOneShot(clip, volume); }

        public void Tick(float windVolume, bool hammerPulse, float hammerDistance, float dt)
        {
            if (!enabled) return;
            wind.volume = Mathf.MoveTowards(wind.volume, Mathf.Clamp01(windVolume), dt * 0.6f);
            wind.pitch = 0.8f + wind.volume * 0.6f;
            hammerCooldown -= dt;
            if (hammerPulse && hammerCooldown <= 0)
            {
                hammerCooldown = 0.3f;
                float v = Mathf.Clamp01(1f - hammerDistance / 45f);
                if (v > 0.02f) shots.PlayOneShot(Hammer, v * 0.6f);
            }
        }
    }
}
