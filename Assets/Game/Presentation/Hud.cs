using System.Collections.Generic;
using System.Text;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>
    /// 화면 UI. 높이 720 기준 가상 좌표로 그리고 화면 크기에 맞춰 확대한다.
    /// 둥근 카드·막대·알약 모양은 직접 그리고, 글꼴은 한글 전용 글꼴(Pretendard)을 쓴다.
    /// 버튼은 터치 여러 개를 동시에 받도록 탭을 직접 판정한다. 모든 버튼은 시뮬레이션 명령에 연결되어 있다.
    /// </summary>
    public sealed class Hud
    {
        enum Tab { None, Staff, Materials, Ledger }

        readonly GameController g;
        public float Scale = 1f;
        float W;
        const float H = 720f;

        List<Rect> rects = new List<Rect>(), pending = new List<Rect>();
        Font regular, bold;
        GUIStyle text;
        Tab tab = Tab.None;
        int grade = 1, tier = 1, orderPage;
        string toast = "";
        float toastUntil;
        readonly List<string> feed = new List<string>();
        readonly List<float> feedTime = new List<float>();
        bool confirmNew;
        float confirmUntil;
        long lastCash = long.MinValue;
        long flyAmount;
        float flyUntil;
        Vector2 mouseUi;

        // 색
        static readonly Color Ink = new Color(0.047f, 0.090f, 0.118f, 0.90f), Card = new Color(0.086f, 0.149f, 0.192f, 0.96f), CardHi = new Color(0.125f, 0.204f, 0.259f, 1f);
        static readonly Color Line = new Color(1f, 1f, 1f, 0.09f), TextSub = new Color(0.63f, 0.72f, 0.77f);
        static readonly Color Teal = new Color(0.10f, 0.72f, 0.65f), TealDark = new Color(0.07f, 0.47f, 0.45f), Amber = new Color(0.96f, 0.71f, 0.24f);
        static readonly Color Red = new Color(0.90f, 0.33f, 0.25f), Green = new Color(0.31f, 0.78f, 0.55f), Blue = new Color(0.30f, 0.64f, 0.88f), Mute = new Color(0.27f, 0.33f, 0.37f);

        public Hud(GameController controller) { g = controller; }

        public void UpdateScale()
        {
            Scale = Mathf.Max(0.5f, Screen.height / H);
            W = Screen.width / Scale;
            Vector3 m = UnityEngine.Input.mousePosition;
            mouseUi = new Vector2(m.x / Scale, (Screen.height - m.y) / Scale);
        }

        public bool IsOver(Vector2 ui)
        {
            for (int i = 0; i < rects.Count; i++) if (rects[i].Contains(ui)) return true;
            return false;
        }

        public void Toast(string message) { toast = message; toastUntil = Time.unscaledTime + 3.6f; }

        public void Feed(string message)
        {
            feed.Add(message); feedTime.Add(Time.unscaledTime);
            if (feed.Count > 4) { feed.RemoveAt(0); feedTime.RemoveAt(0); }
        }

        public void SetTab(int index) { tab = (Tab)index; }
        public void ResetCash() { lastCash = long.MinValue; }

        // ---------- 그리기 도구 ----------

        void Ensure()
        {
            if (text != null) return;
            regular = Resources.Load<Font>("Fonts/Pretendard-Regular");
            bold = Resources.Load<Font>("Fonts/Pretendard-Bold");
            text = new GUIStyle();
            text.wordWrap = true;
            text.clipping = TextClipping.Clip;
            text.richText = false;
        }

        static void Fill(Rect r, Color c, float radius)
        {
            GUI.DrawTexture(r, Texture2D.whiteTexture, ScaleMode.StretchToFill, true, 0, c, 0, radius);
        }

        static void Stroke(Rect r, Color c, float width, float radius)
        {
            GUI.DrawTexture(r, Texture2D.whiteTexture, ScaleMode.StretchToFill, true, 0, c, width, radius);
        }

        void Label(Rect r, string s, int size, Color c, TextAnchor anchor = TextAnchor.MiddleLeft, bool strong = false)
        {
            text.font = strong ? bold : regular;
            text.fontSize = size;
            text.alignment = anchor;
            text.normal.textColor = c;
            GUI.Label(r, s, text);
        }

        void Panel(Rect r, float radius = 16f, float alpha = 0.90f)
        {
            pending.Add(r);
            Fill(new Rect(r.x, r.y + 3, r.width, r.height), new Color(0, 0, 0, 0.22f), radius);
            Fill(r, new Color(Ink.r, Ink.g, Ink.b, alpha), radius);
            Stroke(r, Line, 1f, radius);
        }

        void Bar(Rect r, float value, Color fill)
        {
            Fill(r, new Color(1, 1, 1, 0.10f), r.height * 0.5f);
            float w = Mathf.Max(r.height, r.width * Mathf.Clamp01(value));
            if (value > 0.001f) Fill(new Rect(r.x, r.y, w, r.height), fill, r.height * 0.5f);
        }

        void Pill(Rect r, string s, Color back, Color fore, int size = 14)
        {
            Fill(r, back, r.height * 0.5f);
            Label(r, s, size, fore, TextAnchor.MiddleCenter, true);
        }

        bool Btn(Rect r, string s, bool enabled = true, bool on = false, int size = 17, bool primary = false)
        {
            pending.Add(r);
            bool hover = enabled && !GameInput.Mobile && r.Contains(mouseUi);
            Color back = !enabled ? new Color(0.20f, 0.24f, 0.27f, 0.85f) : (on ? Amber : (primary ? Teal : CardHi));
            if (hover) back = Color.Lerp(back, Color.white, 0.14f);
            Fill(r, back, Mathf.Min(12f, r.height * 0.5f));
            if (enabled && !on && !primary) Stroke(r, Line, 1f, Mathf.Min(12f, r.height * 0.5f));
            Color fore = !enabled ? new Color(0.5f, 0.56f, 0.6f) : (on ? new Color(0.12f, 0.10f, 0.04f) : Color.white);
            Label(r, s, size, fore, TextAnchor.MiddleCenter, true);
            bool tapped = TakeTap(r);
            if (tapped && enabled) g.Audio.Play(g.Audio.Click, 0.7f);
            return tapped && enabled;
        }

        bool TakeTap(Rect r)
        {
            var taps = g.Input.UiTaps;
            for (int i = 0; i < taps.Count; i++)
                if (r.Contains(taps[i])) { taps.RemoveAt(i); return true; }
            return false;
        }

        /// <summary>현장 패널에 가려지지 않는 화면 영역의 가운데.</summary>
        float FreeCenter()
        {
            float right = g.Started && g.SelectedBuilding >= 0 ? W - 456 - SafeRight : W;
            return right * 0.5f;
        }

        static string Won(long v) { return v.ToString("N0") + "원"; }
        static string Num(double v) { return v.ToString("0.#"); }
        float SafeLeft { get { return Screen.safeArea.xMin / Scale; } }
        float SafeRight { get { return (Screen.width - Screen.safeArea.xMax) / Scale; } }

        // ---------- 화면 ----------

        public void Draw()
        {
            if (Event.current.type != EventType.Repaint) return;
            Ensure();
            GUI.matrix = Matrix4x4.Scale(new Vector3(Scale, Scale, 1));
            pending.Clear();

            if (!g.Started) DrawMenu();
            else
            {
                DrawPins();
                DrawTop();
                DrawBottom();
                if (g.SelectedBuilding >= 0) DrawBuilding();
                if (tab == Tab.Staff) DrawStaff();
                else if (tab == Tab.Materials) DrawMaterials();
                else if (tab == Tab.Ledger) DrawLedger();
                DrawWorkCard();
                DrawTouchControls();
            }

            if (Time.unscaledTime < toastUntil)
            {
                float a = Mathf.Clamp01((toastUntil - Time.unscaledTime) * 2f);
                float free = FreeCenter();
                float tw = Mathf.Min(660, (g.Started && g.SelectedBuilding >= 0 ? W - 456 : W) - 48);
                var r = new Rect(free - tw / 2, H - 250, tw, 46);
                Fill(r, new Color(0.04f, 0.07f, 0.09f, 0.92f * a), 23);
                Label(r, toast, 17, new Color(1, 1, 1, a), TextAnchor.MiddleCenter);
            }

            var swap = rects; rects = pending; pending = swap;
        }

        void DrawMenu()
        {
            Fill(new Rect(0, 0, W, H), new Color(0.03f, 0.06f, 0.09f, 0.28f), 0);
            Fill(new Rect(0, 0, 560 + SafeLeft, H), new Color(0.03f, 0.06f, 0.09f, 0.62f), 0);
            pending.Add(new Rect(0, 0, W, H));
            float x = 64 + SafeLeft;
            Fill(new Rect(x, 150, 56, 6), Teal, 3);
            Label(new Rect(x, 166, 520, 72), "REBUILD CITY", 62, Color.white, TextAnchor.MiddleLeft, true);
            Label(new Rect(x + 2, 240, 520, 40), "리빌드시티", 30, new Color(0.80f, 0.90f, 0.93f), TextAnchor.MiddleLeft, true);
            Label(new Rect(x + 2, 288, 440, 56), "무너진 도시를 재건하고, 건설 제국을 세워라.", 19, TextSub);
            if (Btn(new Rect(x, 372, 340, 64), "새 게임", true, false, 21, true)) g.NewGame();
            if (Btn(new Rect(x, 448, 340, 64), "이어하기", g.HasSave, false, 21)) g.Continue();
            Label(new Rect(x + 2, 540, 440, 60), GameInput.Mobile
                ? "왼쪽 조이스틱 이동 · 오른쪽 드래그 시점\n건물을 눌러 선택"
                : "WASD 이동 · Shift 달리기 · E 상호작용\nTab 경영 모드 · 우클릭 드래그 시점 · 휠 확대", 15, TextSub, TextAnchor.UpperLeft);
            Label(new Rect(x + 2, H - 44, 440, 24), "수직 슬라이스 0.2 · 토네이도 피해 주택 복구", 13, new Color(1, 1, 1, 0.45f));
        }

        int Stage(WorldState w)
        {
            bool anyContract = false, anyDamaged = false, anySurveyed = false;
            foreach (var b in w.Buildings)
            {
                if (b.ContractId >= 0) anyContract = true;
                else if (b.IsDamaged) { anyDamaged = true; if (b.Surveyed) anySurveyed = true; }
            }
            if (anyContract)
            {
                foreach (var c in w.Contracts)
                {
                    if (c.State != ContractState.Active) continue;
                    var need = ConstructionSystem.MaterialShortage(w, c);
                    foreach (double n in need) if (n > 0) return 2;
                }
                return 3;
            }
            if (anySurveyed) return 1;
            if (anyDamaged) return 0;
            return w.CompletedContracts > 0 ? 4 : -1;
        }

        static readonly string[] StageName = { "조사", "계약", "발주", "시공", "준공" };

        string Objective(int stage)
        {
            switch (stage)
            {
                case 0: return GameInput.Mobile ? "피해 주택 앞으로 가서 [상호작용]으로 현장을 조사하세요" : "피해 주택 앞으로 가서 E 키로 현장을 조사하세요";
                case 1: return "자재 등급과 이윤을 정하고 계약을 체결하세요";
                case 2: return "현장을 선택해 부족 자재를 발주하세요. 트럭이 실어 옵니다";
                case 3: return "공정 진행 중. 현장에서 직접 작업하면 더 빨라집니다";
                case 4: return "준공 완료! 직원을 채용하고 다음 재난에 대비하세요";
                default: return "토네이도 예보를 기다리는 중. 배속을 올려도 됩니다";
            }
        }

        void DrawTop()
        {
            var w = g.Sim.World;
            float x = 16 + SafeLeft;

            // 자금
            var money = new Rect(x, 14, 252, 66);
            Panel(money);
            Label(new Rect(money.x + 16, money.y + 8, 200, 20), "보유 자금", 13, TextSub);
            Label(new Rect(money.x + 16, money.y + 27, 230, 32), Won(w.Cash), 25, Color.white, TextAnchor.MiddleLeft, true);
            if (lastCash == long.MinValue) lastCash = w.Cash;
            if (w.Cash != lastCash) { flyAmount = w.Cash - lastCash; flyUntil = Time.unscaledTime + 2.6f; lastCash = w.Cash; }

            // 날짜·시각·날씨
            var date = new Rect(money.xMax + 10, 14, 226, 66);
            Panel(date);
            int hour = SimTime.Hour(w.Tick);
            bool night = hour < 6 || hour >= 19;
            var icon = new Rect(date.x + 14, date.y + 17, 32, 32);
            if (!night) Fill(icon, new Color(1f, 0.80f, 0.30f), 16);
            else { Fill(icon, new Color(0.80f, 0.86f, 1f), 16); Fill(new Rect(icon.x + 9, icon.y - 3, 28, 28), new Color(Ink.r, Ink.g, Ink.b, 1f), 14); }
            Label(new Rect(date.x + 56, date.y + 8, 160, 20), SimTime.Day(w.Tick) + "일차 · " + (ConstructionSystem.WeatherFactor(w) < 1.0 ? "강풍" : "맑음"), 13, TextSub);
            Label(new Rect(date.x + 56, date.y + 27, 100, 32), hour.ToString("00") + ":" + SimTime.Minute(w.Tick).ToString("00"), 25, Color.white, TextAnchor.MiddleLeft, true);
            bool work = SimTime.IsWorkHour(w.Tick);
            Pill(new Rect(date.xMax - 70, date.y + 33, 58, 22), work ? "근무" : "휴식", work ? new Color(0.10f, 0.72f, 0.65f, 0.25f) : new Color(1, 1, 1, 0.10f), work ? Teal : TextSub, 12);

            // 실적
            var stat = new Rect(date.xMax + 10, 14, 150, 66);
            Panel(stat);
            Label(new Rect(stat.x + 16, stat.y + 8, 120, 20), "준공 · 평판", 13, TextSub);
            Label(new Rect(stat.x + 16, stat.y + 27, 130, 32), w.CompletedContracts + "건 · " + w.Reputation, 23, Color.white, TextAnchor.MiddleLeft, true);

            // 배속
            float sw = GameController.Speeds.Length * 58 + 12;
            var speed = new Rect(W - 16 - SafeRight - sw, 14, sw, 54);
            Panel(speed);
            for (int i = 0; i < GameController.Speeds.Length; i++)
            {
                int s = GameController.Speeds[i];
                if (Btn(new Rect(speed.x + 7 + i * 58, speed.y + 7, 54, 40), s == 0 ? "정지" : "×" + s, true, g.Speed == s, 16)) g.Speed = s;
            }

            // 단계 표시와 목표(둘째 줄)
            int stage = Stage(w);
            float rowY = 90, rowW = Mathf.Min(660, W - 32 - SafeLeft - SafeRight - (g.SelectedBuilding >= 0 ? 456 : 0));
            if (w.Alert)
            {
                var banner = new Rect(x, rowY, rowW, 66);
                pending.Add(banner);
                float pulse = 0.82f + Mathf.Sin(Time.unscaledTime * 5f) * 0.12f;
                Fill(banner, new Color(0.78f * pulse, 0.16f, 0.12f, 0.95f), 16);
                string head = w.DisasterActive ? "토네이도 통과 중" : "토네이도 예보";
                string tail = w.DisasterActive ? "작업 중지 · 작업자 대피" : (w.Disaster.StartTick - w.Tick) + "분 뒤 도착 · 작업자 대피 중";
                Label(new Rect(banner.x + 20, banner.y + 8, banner.width - 40, 28), head, 21, Color.white, TextAnchor.MiddleLeft, true);
                Label(new Rect(banner.x + 20, banner.y + 34, banner.width - 40, 22), tail, 15, new Color(1, 1, 1, 0.88f));
                float p = w.DisasterActive ? (float)(w.Tick - w.Disaster.StartTick) / Mathf.Max(1, w.Disaster.EndTick - w.Disaster.StartTick)
                    : (float)(w.Tick - w.Disaster.WarnTick) / Mathf.Max(1, w.Disaster.StartTick - w.Disaster.WarnTick);
                Bar(new Rect(banner.x + 20, banner.yMax - 9, banner.width - 40, 4), p, Color.white);
            }
            else
            {
                var track = new Rect(x, rowY, rowW, 66);
                Panel(track);
                float step = (track.width - 28) / 5f;
                for (int i = 0; i < 5; i++)
                {
                    bool done = stage > i || stage == 4, current = stage == i && stage != 4;
                    var dot = new Rect(track.x + 16 + i * step, track.y + 10, 22, 22);
                    Fill(dot, done ? Teal : (current ? Amber : Mute), 11);
                    Label(dot, (i + 1).ToString(), 12, done || current ? new Color(0.06f, 0.10f, 0.12f) : TextSub, TextAnchor.MiddleCenter, true);
                    Label(new Rect(dot.xMax + 6, dot.y - 1, 60, 24), StageName[i], 15, current ? Color.white : (done ? Teal : TextSub), TextAnchor.MiddleLeft, current);
                    if (i < 4) Fill(new Rect(dot.xMax + 48, dot.y + 10, step - 78, 2), done ? TealDark : Mute, 1);
                }
                Label(new Rect(track.x + 16, track.y + 36, track.width - 32, 24), Objective(stage), 15, new Color(0.86f, 0.92f, 0.94f));
            }

            // 자금 변동 표시
            if (Time.unscaledTime < flyUntil && tab == Tab.None)
            {
                float t = 1f - (flyUntil - Time.unscaledTime) / 2.6f;
                Color c = flyAmount >= 0 ? Green : Red;
                var r = new Rect(x, 164 + t * 10f, 230, 34);
                float a = Mathf.Clamp01((1f - t) * 2.2f);
                Fill(r, new Color(0.047f, 0.090f, 0.118f, 0.85f * a), 17);
                c.a = a;
                Label(new Rect(r.x + 16, r.y, r.width - 24, 34), (flyAmount >= 0 ? "+" : "") + flyAmount.ToString("N0") + "원", 18, c, TextAnchor.MiddleLeft, true);
            }

            // 소식
            float fy = 206;
            for (int i = 0; i < feed.Count && tab == Tab.None; i++)
            {
                float age = Time.unscaledTime - feedTime[i];
                if (age > 11f) continue;
                float a = Mathf.Clamp01((11f - age) * 1.5f) * Mathf.Clamp01(age * 5f);
                var r = new Rect(x, fy, 470, 32);
                Fill(r, new Color(0.047f, 0.090f, 0.118f, 0.78f * a), 10);
                Fill(new Rect(r.x, r.y + 6, 4, 20), new Color(Teal.r, Teal.g, Teal.b, a), 2);
                Label(new Rect(r.x + 14, r.y, r.width - 20, 32), feed[i], 14, new Color(1, 1, 1, a));
                fy += 36;
            }
        }

        void DrawBottom()
        {
            float bw = 92, gap = 6, total = bw * 6 + gap * 5 + 16;
            var bar = new Rect(W - 16 - SafeRight - total, H - 76, total, 62);
            Panel(bar);
            float bx = bar.x + 8, by = bar.y + 7;
            if (Btn(new Rect(bx, by, bw, 48), g.Management ? "경영 모드" : "직접 모드", true, g.Management, 15)) g.ToggleMode();
            if (Btn(new Rect(bx + (bw + gap), by, bw, 48), "직원", true, tab == Tab.Staff, 16)) tab = tab == Tab.Staff ? Tab.None : Tab.Staff;
            if (Btn(new Rect(bx + (bw + gap) * 2, by, bw, 48), "자재", true, tab == Tab.Materials, 16)) tab = tab == Tab.Materials ? Tab.None : Tab.Materials;
            if (Btn(new Rect(bx + (bw + gap) * 3, by, bw, 48), "원장", true, tab == Tab.Ledger, 16)) tab = tab == Tab.Ledger ? Tab.None : Tab.Ledger;
            if (Btn(new Rect(bx + (bw + gap) * 4, by, bw, 48), "저장", true, false, 16)) g.Save(false);
            if (confirmNew && Time.unscaledTime > confirmUntil) confirmNew = false;
            if (Btn(new Rect(bx + (bw + gap) * 5, by, bw, 48), confirmNew ? "정말 새로?" : "새 게임", true, confirmNew, 15))
            {
                if (confirmNew) { confirmNew = false; g.NewGame(); }
                else { confirmNew = true; confirmUntil = Time.unscaledTime + 4f; Toast("한 번 더 누르면 새 게임을 시작합니다."); }
            }

            // 가까운 건물 안내(직접 모드)
            if (!g.Management && g.SelectedBuilding < 0 && g.Sim.World.PlayerWorkOrderId < 0)
            {
                var near = g.NearestBuilding();
                if (near != null)
                {
                    var r = new Rect(W / 2 - 170, H - 196, 340, 44);
                    Fill(r, new Color(0.047f, 0.090f, 0.118f, 0.86f), 22);
                    float tx = r.x + 20;
                    if (!GameInput.Mobile)
                    {
                        Fill(new Rect(r.x + 8, r.y + 7, 30, 30), Amber, 8);
                        Label(new Rect(r.x + 8, r.y + 7, 30, 30), "E", 17, new Color(0.1f, 0.08f, 0.03f), TextAnchor.MiddleCenter, true);
                        tx = r.x + 48;
                    }
                    string act = near.ContractId >= 0 ? "현장 보기" : (near.IsDamaged ? (near.Surveyed ? "견적 내기" : "현장 조사") : "살펴보기");
                    Label(new Rect(tx, r.y, r.xMax - tx - 8, 44), near.Name + " · " + act, 17, Color.white, TextAnchor.MiddleLeft, true);
                }
            }
        }

        void DrawWorkCard()
        {
            var w = g.Sim.World;
            if (w.PlayerWorkOrderId < 0) return;
            var o = w.OrderById(w.PlayerWorkOrderId);
            if (o == null) return;
            var r = new Rect(W / 2 - 230, H - 206, 460, 60);
            Panel(r);
            Label(new Rect(r.x + 18, r.y + 8, 280, 22), "직접 작업 · " + o.Name, 16, Color.white, TextAnchor.MiddleLeft, true);
            Label(new Rect(r.x + 18, r.y + 30, 130, 20), Num(o.Done) + " / " + Num(o.Total) + " " + o.Unit, 14, TextSub);
            Bar(new Rect(r.x + 150, r.y + 37, 190, 8), (float)(o.Done / o.Total), Amber);
            if (Btn(new Rect(r.xMax - 106, r.y + 10, 94, 40), "중단", true, false, 16)) g.Sim.StopPlayerWork();
        }

        void DrawTouchControls()
        {
            if (!GameInput.Mobile) return;
            var input = g.Input;
            var c = input.StickCenter;
            Fill(new Rect(c.x - 92, c.y - 92, 184, 184), new Color(0.047f, 0.090f, 0.118f, 0.42f), 92);
            Stroke(new Rect(c.x - 92, c.y - 92, 184, 184), new Color(1, 1, 1, 0.22f), 2, 92);
            Vector2 knob = input.StickActive ? input.StickKnob : c;
            Fill(new Rect(knob.x - 36, knob.y - 36, 72, 72), new Color(1, 1, 1, input.StickActive ? 0.85f : 0.5f), 36);

            float right = W - 16 - SafeRight - (g.SelectedBuilding >= 0 ? 456 : 0);
            float y = H - 76 - 12 - 76;
            if (!g.Management)
            {
                if (Btn(new Rect(right - 132, y, 132, 72), "상호작용", true, false, 18, true)) g.Interact();
                if (Btn(new Rect(right - 132 - 112, y, 104, 72), "달리기", true, input.RunToggle, 17)) input.RunToggle = !input.RunToggle;
            }
            if (Btn(new Rect(right - 62, y - 82, 62, 70), "+", true, false, 24)) input.PendingZoom += 2;
            if (Btn(new Rect(right - 132, y - 82, 62, 70), "-", true, false, 24)) input.PendingZoom -= 2;
        }

        void DrawPins()
        {
            var w = g.Sim.World;
            var cam = g.Cam;
            foreach (var b in w.Buildings)
            {
                string label = null; float progress = -1; Color dot = Amber;
                var c = w.ContractById(b.ContractId);
                if (c != null)
                {
                    double sum = 0; int n = 0;
                    foreach (int id in c.OrderIds) { var o = w.OrderById(id); if (o != null) { sum += o.Done / o.Total; n++; } }
                    progress = n > 0 ? (float)(sum / n) : 0;
                    label = b.Name + "  " + (progress * 100).ToString("0") + "%"; dot = Teal;
                }
                else if (b.IsDamaged) { label = b.Name + (b.Surveyed ? "  견적 대기" : "  피해"); dot = b.Surveyed ? Amber : Red; }
                if (label == null) continue;
                Vector3 sp = cam.WorldToScreenPoint(Gfx.P(b.X, b.Z, 7.4f));
                if (sp.z <= 0) continue;
                float a = Mathf.Clamp01(1.6f - sp.z / 90f);
                if (a <= 0.05f) continue;
                var r = new Rect(sp.x / Scale - 82, (Screen.height - sp.y) / Scale - 17, 164, 34);
                if (r.y < 86 || (r.y < 162 && r.x < 700) || r.yMax > H - 84) continue;
                if (g.SelectedBuilding >= 0 && r.xMax > W - 456 - SafeRight) continue;
                Fill(r, new Color(0.047f, 0.090f, 0.118f, 0.86f * a), 17);
                Fill(new Rect(r.x + 11, r.y + 11, 12, 12), new Color(dot.r, dot.g, dot.b, a), 6);
                Label(new Rect(r.x + 30, r.y, r.width - 36, progress >= 0 ? 27 : 34), label, 14, new Color(1, 1, 1, a), TextAnchor.MiddleLeft, true);
                if (progress >= 0) Bar(new Rect(r.x + 30, r.y + 25, r.width - 46, 4), progress, new Color(Teal.r, Teal.g, Teal.b, a));
            }
        }

        static string StateName(DamageState s)
        {
            switch (s)
            {
                case DamageState.Healthy: return "정상";
                case DamageState.Light: return "경미";
                case DamageState.Heavy: return "중대";
                default: return "붕괴";
            }
        }

        static Color StateColor(DamageState s)
        {
            switch (s)
            {
                case DamageState.Healthy: return Green;
                case DamageState.Light: return Amber;
                case DamageState.Heavy: return new Color(0.95f, 0.50f, 0.22f);
                default: return Red;
            }
        }

        void Row(float x, ref float y, float w, string left, string right, bool strong, Color rightColor)
        {
            Label(new Rect(x, y, w * 0.55f, 26), left, 15, TextSub);
            Label(new Rect(x + w * 0.4f, y, w * 0.6f, 26), right, strong ? 19 : 15, rightColor, TextAnchor.MiddleRight, strong);
            y += strong ? 30 : 26;
        }

        void DrawBuilding()
        {
            var w = g.Sim.World;
            var b = w.BuildingById(g.SelectedBuilding);
            if (b == null) { g.SelectedBuilding = -1; return; }
            float pw = 440, px = W - 16 - SafeRight - pw, py = 80, ph = H - py - 88;
            Panel(new Rect(px, py, pw, ph));
            float x = px + 20, cw = pw - 40, y = py + 16;
            var c = w.ContractById(b.ContractId);

            Label(new Rect(x, y, cw - 150, 30), b.Name, 23, Color.white, TextAnchor.MiddleLeft, true);
            Label(new Rect(x, y + 30, cw - 100, 20), "소유주 " + b.Owner, 14, TextSub);
            string status = c != null ? "공사 중" : (b.IsDamaged ? (b.Surveyed ? "견적 대기" : "피해 발생") : "정상");
            Color sc = c != null ? Teal : (b.IsDamaged ? (b.Surveyed ? Amber : Red) : Green);
            Pill(new Rect(px + pw - 152, y + 5, 84, 24), status, new Color(sc.r, sc.g, sc.b, 0.22f), sc, 13);
            if (Btn(new Rect(px + pw - 60, y, 44, 34), "닫기", true, false, 13)) { g.SelectedBuilding = -1; g.SelectedPart = -1; return; }
            y += 58;
            Fill(new Rect(x, y, cw, 1), Line, 0);
            y += 10;

            var sel = b.PartById(g.SelectedPart);
            if (sel != null)
            {
                var r = new Rect(x, y, cw, 36);
                Fill(r, new Color(1f, 0.85f, 0.3f, 0.12f), 10);
                Label(new Rect(x + 12, y, cw - 150, 36), "선택 · " + sel.Name + "  " + Num(sel.Quantity) + sel.Unit, 15, Color.white, TextAnchor.MiddleLeft, true);
                Label(new Rect(x + cw - 142, y, 130, 36), "상태 " + sel.Hp.ToString("0") + " · " + StateName(sel.State), 14, StateColor(sel.State), TextAnchor.MiddleRight, true);
                y += 44;
            }

            if (c == null) DrawSurvey(w, b, x, ref y, cw);
            else DrawContract(w, b, c, x, ref y, cw, py + ph - 16);
        }

        void DrawSurvey(WorldState w, Building b, float x, ref float y, float cw)
        {
            if (!b.IsDamaged)
            {
                Label(new Rect(x, y, cw, 30), "피해가 없는 주택입니다.", 16, TextSub);
                return;
            }
            Label(new Rect(x, y, cw, 22), "피해 부재", 14, TextSub, TextAnchor.MiddleLeft, true);
            Label(new Rect(x, y, cw, 22), "구조 안전도 " + b.StructuralSafety.ToString("0"), 13, TextSub, TextAnchor.MiddleRight);
            y += 26;
            int limit = b.Surveyed ? 3 : 9, shown = 0, damaged = 0;
            foreach (var p in b.Parts)
            {
                if (p.Hp >= 90) continue;
                damaged++;
                if (shown >= limit) continue;
                Label(new Rect(x, y, 130, 24), p.Name, 15, Color.white);
                Bar(new Rect(x + 136, y + 9, cw - 136 - 96, 7), (float)p.Hp / 100f, StateColor(p.State));
                Label(new Rect(x + cw - 90, y, 90, 24), p.Hp.ToString("0") + " · " + StateName(p.State), 13, StateColor(p.State), TextAnchor.MiddleRight, true);
                y += 25; shown++;
            }
            string extra = damaged > shown ? "외 " + (damaged - shown) + "개 부재" : "";
            if (b.DebrisM3 > 0.001) extra += (extra.Length > 0 ? " · " : "") + "잔해 " + Num(b.DebrisM3) + " m3";
            if (extra.Length > 0) { Label(new Rect(x, y, cw, 20), extra, 13, TextSub); y += 22; }
            y += 8;

            if (!b.Surveyed)
            {
                if (Btn(new Rect(x, y, cw, 54), "현장 조사", true, false, 19, true)) g.Do(g.Sim.InspectBuilding(b.Id), "조사 완료. 견적을 정하세요.");
                y += 62;
                Label(new Rect(x, y, cw, 40), "건물 10m 이내에서 조사할 수 있습니다. 조사하면 물량과 고객 예산이 나옵니다.", 13, TextSub, TextAnchor.UpperLeft);
                return;
            }

            var plan = ConstructionSystem.Plan(b);
            Fill(new Rect(x, y, cw, 1), Line, 0); y += 8;
            Label(new Rect(x, y, cw, 22), "견적", 14, TextSub, TextAnchor.MiddleLeft, true);
            Label(new Rect(x, y, cw, 22), "공정 " + plan.Count + "개 · 고객 예산 " + Won(b.Budget), 13, TextSub, TextAnchor.MiddleRight);
            y += 26;
            float third = (cw - 12) / 3f;
            Label(new Rect(x, y, cw, 18), "자재 등급 · 품질과 내풍 성능", 12, TextSub); y += 20;
            for (int i = 0; i < 3; i++)
                if (Btn(new Rect(x + i * (third + 6), y, third, 40), Items.GradeName[i] + "  " + Items.GradeScore[i].ToString("0"), true, grade == i, 16)) grade = i;
            y += 46;
            Label(new Rect(x, y, cw, 18), "이윤", 12, TextSub); y += 20;
            for (int i = 0; i < 3; i++)
                if (Btn(new Rect(x + i * (third + 6), y, third, 40), ConstructionSystem.MarginName[i] + "  x" + ConstructionSystem.Margin[i].ToString("0.00"), true, tier == i, 16)) tier = i;
            y += 48;

            long cost = ConstructionSystem.EstimateCost(plan, grade);
            long price = ConstructionSystem.QuotePrice(b, grade, tier);
            bool over = price > b.Budget;
            Row(x, ref y, cw, "견적가", Won(price), true, over ? Red : Color.white);
            Row(x, ref y, cw, "예상 원가", Won(cost), false, Color.white);
            Row(x, ref y, cw, "예상 이익", Won(price - cost), false, Green);
            y += 4;
            if (over) { Label(new Rect(x, y, cw, 22), "고객 예산을 넘습니다. 등급이나 이윤을 낮추세요.", 13, Red); y += 24; }
            if (Btn(new Rect(x, y, cw, 52), "계약 체결 · 선급금 30%", !over, false, 19, true)) g.Do(g.Sim.SignContract(b.Id, grade, tier), null);
        }

        void DrawContract(WorldState w, Building b, Contract c, float x, ref float y, float cw, float bottom)
        {
            double sum = 0; int count = 0;
            foreach (int id in c.OrderIds) { var o = w.OrderById(id); if (o != null) { sum += o.Done / o.Total; count++; } }
            float progress = count > 0 ? (float)(sum / count) : 0;
            Label(new Rect(x, y, cw, 26), "전체 공정", 14, TextSub, TextAnchor.MiddleLeft, true);
            Label(new Rect(x, y, cw, 26), (progress * 100).ToString("0") + "%", 20, Teal, TextAnchor.MiddleRight, true);
            y += 28;
            Bar(new Rect(x, y, cw, 10), progress, Teal);
            y += 20;
            Row(x, ref y, cw, "계약금액 · " + Items.GradeName[c.Grade], Won(c.Price), true, Color.white);
            Row(x, ref y, cw, "수금 / 투입 원가", Won(c.Paid) + " / " + Won(c.MaterialCost + c.LaborCost), false, Color.white);

            var need = ConstructionSystem.MaterialShortage(w, c);
            var sb = new StringBuilder();
            long needCost = 0;
            for (int i = 0; i < need.Length; i++)
            {
                if (need[i] <= 0) continue;
                if (sb.Length > 0) sb.Append(", ");
                sb.Append(Items.All[i].Name).Append(' ').Append(Num(need[i])).Append(Items.All[i].Unit);
                needCost += (long)need[i] * Items.UnitPrice(i, c.Grade);
            }
            if (sb.Length > 0)
            {
                var box = new Rect(x, y + 4, cw, 92);
                Fill(box, new Color(0.96f, 0.71f, 0.24f, 0.13f), 12);
                Stroke(box, new Color(0.96f, 0.71f, 0.24f, 0.45f), 1, 12);
                Label(new Rect(x + 12, y + 8, cw - 24, 22), "부족 자재 · " + sb, 14, Amber, TextAnchor.MiddleLeft, true);
                if (Btn(new Rect(x + 10, y + 36, cw - 20, 48), "발주 " + Won(needCost) + " + 운반비", true, false, 17, true)) g.Do(g.Sim.OrderShortage(b.Id), null);
                y += 102;
            }
            else
            {
                sb.Length = 0;
                foreach (var s in b.Stock)
                {
                    if (s.OnSite <= 0.001) continue;
                    if (sb.Length > 0) sb.Append(", ");
                    sb.Append(Items.All[s.ItemId].Name).Append(' ').Append(Num(s.OnSite)).Append(Items.All[s.ItemId].Unit);
                }
                Label(new Rect(x, y, cw, 24), "현장 재고 · " + (sb.Length > 0 ? sb.ToString() : "없음"), 14, TextSub);
                y += 28;
            }
            Fill(new Rect(x, y, cw, 1), Line, 0);
            y += 8;

            const float rowH = 44;
            int rows = Mathf.Max(1, (int)((bottom - y - 46) / rowH));
            int pages = Mathf.Max(1, (c.OrderIds.Count + rows - 1) / rows);
            if (orderPage >= pages) orderPage = pages - 1;
            for (int n = 0; n < rows; n++)
            {
                int idx = orderPage * rows + n;
                if (idx >= c.OrderIds.Count) break;
                var o = w.OrderById(c.OrderIds[idx]);
                if (o == null) continue;
                string state; Color col;
                bool ready = ConstructionSystem.PrereqsDone(w, o);
                if (o.IsDone) { state = "완료"; col = Green; }
                else if (!ready) { state = "선행 대기"; col = TextSub; }
                else if (o.ClaimedBy > 0) { var k = w.WorkerById(o.ClaimedBy); state = k != null ? k.Name : "작업자"; col = Teal; }
                else if (w.PlayerWorkOrderId == o.Id) { state = "대표 작업"; col = Amber; }
                else if (o.State == WorkState.WaitMaterial) { state = "자재 대기"; col = Amber; }
                else { state = "대기"; col = Blue; }

                Fill(new Rect(x, y + 14, 8, 8), col, 4);
                Label(new Rect(x + 16, y, 170, 24), o.Name, 15, o.IsDone ? TextSub : Color.white, TextAnchor.MiddleLeft, !o.IsDone);
                Label(new Rect(x + 16, y + 20, 170, 18), Num(o.Done) + "/" + Num(o.Total) + o.Unit + " · " + state, 12, col);
                Bar(new Rect(x + 190, y + 18, cw - 190 - 92, 6), (float)(o.Done / o.Total), o.IsDone ? Green : col);
                bool can = !o.IsDone && !g.Management && o.ClaimedBy <= 0 && w.PlayerWorkOrderId != o.Id && ready;
                if (!o.IsDone && Btn(new Rect(x + cw - 80, y + 3, 80, 36), "직접", can, false, 15))
                    g.Do(g.Sim.StartPlayerWork(o.Id), o.Name + " 직접 작업을 시작합니다.");
                y += rowH;
            }
            if (pages > 1)
            {
                float by = bottom - 40;
                if (Btn(new Rect(x, by, 84, 38), "이전", orderPage > 0, false, 15)) orderPage--;
                Label(new Rect(x, by, cw, 38), (orderPage + 1) + " / " + pages, 14, TextSub, TextAnchor.MiddleCenter);
                if (Btn(new Rect(x + cw - 84, by, 84, 38), "다음", orderPage < pages - 1, false, 15)) orderPage++;
            }
        }

        Rect Modal(string heading, float height)
        {
            var r = new Rect(16 + SafeLeft, 166, 600, height);
            Panel(r, 16f, 0.98f);
            Label(new Rect(r.x + 20, r.y + 14, 400, 32), heading, 22, Color.white, TextAnchor.MiddleLeft, true);
            if (Btn(new Rect(r.xMax - 62, r.y + 12, 46, 34), "닫기", true, false, 13)) tab = Tab.None;
            Fill(new Rect(r.x + 20, r.y + 56, r.width - 40, 1), Line, 0);
            return r;
        }

        static string WorkerStateName(WorkerState s)
        {
            switch (s)
            {
                case WorkerState.Idle: return "대기";
                case WorkerState.MoveToStorage: return "적치점 이동";
                case WorkerState.Pickup: return "자재 들기";
                case WorkerState.MoveToSite: return "작업점 이동";
                case WorkerState.Work: return "작업 중";
                case WorkerState.Evacuate: return "대피 중";
                case WorkerState.Safe: return "대피 완료";
                default: return "휴식";
            }
        }

        void DrawStaff()
        {
            var w = g.Sim.World;
            var r = Modal("직원", 140 + w.Workers.Count * 72);
            float y = r.y + 66, x = r.x + 20, cw = r.width - 40;
            foreach (var k in w.Workers)
            {
                var o = w.OrderById(k.JobId);
                Fill(new Rect(x, y, cw, 64), Card, 12);
                Fill(new Rect(x + 12, y + 12, 40, 40), k.State == WorkerState.Work ? Teal : Mute, 20);
                Label(new Rect(x + 12, y + 12, 40, 40), k.Name.Substring(0, 1), 18, Color.white, TextAnchor.MiddleCenter, true);
                Label(new Rect(x + 64, y + 8, 220, 24), k.Name + " · 숙련 " + k.Skill.ToString("0.00"), 16, Color.white, TextAnchor.MiddleLeft, true);
                Label(new Rect(x + 64, y + 32, 300, 22), WorkerStateName(k.State) + (o != null ? " · " + o.Name : ""), 14, k.State == WorkerState.Work ? Teal : TextSub);
                Label(new Rect(x + cw - 190, y + 8, 178, 22), "미지급 " + Won(k.UnpaidWage), 13, TextSub, TextAnchor.MiddleRight);
                Label(new Rect(x + cw - 190, y + 28, 60, 22), "피로", 12, TextSub, TextAnchor.MiddleRight);
                Bar(new Rect(x + cw - 122, y + 36, 110, 6), (float)k.Fatigue / 100f, k.Fatigue > 70 ? Red : Amber);
                y += 72;
            }
            bool can = w.CompletedContracts >= 1 && w.Workers.Count < WorkforceSystem.MaxWorkers;
            string why = w.CompletedContracts < 1 ? "채용 · 첫 준공 후 가능" : (w.Workers.Count >= WorkforceSystem.MaxWorkers ? "채용 · 정원이 찼습니다" : "채용 · " + Won(WorkforceSystem.HireFee));
            if (Btn(new Rect(x, y + 4, cw, 52), why, can, false, 17, true)) g.Do(g.Sim.HireWorker(), null);
        }

        static string TruckStateName(TruckState s)
        {
            switch (s)
            {
                case TruckState.Idle: return "차고 대기";
                case TruckState.ToSupplier: return "자재상으로 이동";
                case TruckState.Loading: return "상차 중";
                case TruckState.ToSite: return "현장으로 운반";
                case TruckState.Unloading: return "하역 중";
                default: return "차고 복귀";
            }
        }

        void DrawMaterials()
        {
            var w = g.Sim.World;
            var r = Modal("자재 · 물류", 460);
            float y = r.y + 66, x = r.x + 20, cw = r.width - 40;
            Fill(new Rect(x, y, cw, 46), Card, 12);
            Label(new Rect(x + 14, y, 200, 46), "트럭", 14, TextSub);
            Label(new Rect(x + 14, y, cw - 28, 46), TruckStateName(w.Truck.State) + (w.Alert ? " · 경보 대기" : ""), 17, w.Truck.State == TruckState.Idle ? TextSub : Teal, TextAnchor.MiddleRight, true);
            y += 56;
            float half = (cw - 10) / 2;
            for (int i = 0; i < Items.All.Length; i++)
            {
                var cell = new Rect(x + (i % 2) * (half + 10), y + (i / 2) * 44, half, 38);
                Fill(cell, Card, 10);
                Label(new Rect(cell.x + 12, cell.y, 100, 38), Items.All[i].Name, 15, Color.white, TextAnchor.MiddleLeft, true);
                Label(new Rect(cell.x + 12, cell.y, half - 24, 38), Won(Items.All[i].Price) + " / " + Items.All[i].Unit, 14, TextSub, TextAnchor.MiddleRight);
            }
            y += 96;
            Label(new Rect(x, y, cw, 22), "최근 발주 · 운반비 " + Won(ConstructionSystem.DeliveryFee) + "/회", 14, TextSub, TextAnchor.MiddleLeft, true);
            y += 28;
            if (w.Purchases.Count == 0) Label(new Rect(x, y, cw, 26), "발주 내역이 없습니다. 계약한 현장을 선택해 발주하세요.", 14, TextSub);
            int start = Mathf.Max(0, w.Purchases.Count - 6);
            for (int i = w.Purchases.Count - 1; i >= start; i--)
            {
                var p = w.Purchases[i];
                var b = w.BuildingById(p.BuildingId);
                string st = p.State == PurchaseState.Ordered ? "발주됨" : (p.State == PurchaseState.InTransit ? "운송 중" : "도착");
                Color sc = p.State == PurchaseState.Delivered ? Green : (p.State == PurchaseState.InTransit ? Teal : Amber);
                Label(new Rect(x, y, 300, 26), (b != null ? b.Name : "") + " · " + Items.All[p.ItemId].Name + " " + Num(p.Qty) + Items.All[p.ItemId].Unit, 15, Color.white);
                Label(new Rect(x + 300, y, cw - 300 - 80, 26), Won(p.Cost), 14, TextSub, TextAnchor.MiddleRight);
                Pill(new Rect(x + cw - 70, y + 2, 70, 22), st, new Color(sc.r, sc.g, sc.b, 0.2f), sc, 12);
                y += 30;
            }
        }

        void DrawLedger()
        {
            var w = g.Sim.World;
            var r = Modal("원장", 460);
            float y = r.y + 66, x = r.x + 20, cw = r.width - 40;
            Fill(new Rect(x, y, cw, 56), Card, 12);
            Label(new Rect(x + 14, y + 6, 200, 20), "현금", 13, TextSub);
            Label(new Rect(x + 14, y + 24, 300, 28), Won(w.Cash), 21, Color.white, TextAnchor.MiddleLeft, true);
            Label(new Rect(x + 14, y + 6, cw - 28, 20), "미지급 노무비", 13, TextSub, TextAnchor.MiddleRight);
            Label(new Rect(x + 14, y + 24, cw - 28, 28), Won(w.UnpaidWages), 18, Amber, TextAnchor.MiddleRight, true);
            y += 68;
            int start = Mathf.Max(0, w.Ledger.Count - 10);
            for (int i = w.Ledger.Count - 1; i >= start; i--)
            {
                var l = w.Ledger[i];
                Label(new Rect(x, y, 96, 26), SimTime.Day(l.Tick) + "일 " + SimTime.Hour(l.Tick).ToString("00") + ":" + SimTime.Minute(l.Tick).ToString("00"), 13, TextSub);
                Label(new Rect(x + 100, y, cw - 100 - 170, 26), l.Memo, 15, Color.white);
                Label(new Rect(x + cw - 170, y, 170, 26), (l.Amount >= 0 ? "+" : "") + l.Amount.ToString("N0"), 15, l.Amount >= 0 ? Green : new Color(0.95f, 0.60f, 0.52f), TextAnchor.MiddleRight, true);
                y += 30;
            }
        }
    }
}
