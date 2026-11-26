using System.Collections.Generic;
using System.Text;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>
    /// 화면 UI(IMGUI). 높이 720 기준 가상 좌표로 그리고 화면 크기에 맞춰 확대한다.
    /// 버튼은 터치 여러 개를 동시에 받을 수 있도록 직접 탭을 판정한다(조이스틱을 잡은 채 버튼을 누를 수 있다).
    /// 모든 버튼은 시뮬레이션 명령에 연결되어 있다.
    /// </summary>
    public sealed class Hud
    {
        enum Tab { None, Staff, Materials, Ledger }

        readonly GameController g;
        public float Scale = 1f;
        float W;
        const float H = 720f;

        List<Rect> rects = new List<Rect>(), pending = new List<Rect>();
        GUIStyle label, small, title, button, buttonOn, buttonOff, panel, banner, pin;
        Tab tab = Tab.None;
        int grade = 1, tier = 1, orderPage;
        string toast = "";
        float toastUntil;
        readonly List<string> feed = new List<string>();
        readonly List<float> feedTime = new List<float>();
        bool confirmNew;

        public Hud(GameController controller) { g = controller; }

        public void UpdateScale()
        {
            Scale = Mathf.Max(0.5f, Screen.height / H);
            W = Screen.width / Scale;
        }

        public bool IsOver(Vector2 ui)
        {
            for (int i = 0; i < rects.Count; i++) if (rects[i].Contains(ui)) return true;
            return false;
        }

        public void Toast(string text) { toast = text; toastUntil = Time.unscaledTime + 3.5f; }

        public void Feed(string text)
        {
            feed.Add(text); feedTime.Add(Time.unscaledTime);
            if (feed.Count > 5) { feed.RemoveAt(0); feedTime.RemoveAt(0); }
        }

        // ---------- 그리기 도구 ----------

        static Texture2D Tex(Color c)
        {
            var t = new Texture2D(1, 1);
            t.SetPixel(0, 0, c);
            t.Apply();
            t.hideFlags = HideFlags.HideAndDontSave;
            return t;
        }

        GUIStyle Style(int size, Color text, TextAnchor anchor, Texture2D bg)
        {
            var s = new GUIStyle();
            s.fontSize = size;
            s.normal.textColor = text;
            s.normal.background = bg;
            s.alignment = anchor;
            s.wordWrap = true;
            s.clipping = TextClipping.Clip;
            s.padding = new RectOffset(8, 8, 4, 4);
            return s;
        }

        void EnsureStyles()
        {
            if (label != null && panel.normal.background != null) return;
            label = Style(19, Color.white, TextAnchor.MiddleLeft, null);
            small = Style(16, new Color(0.86f, 0.90f, 0.92f), TextAnchor.MiddleLeft, null);
            title = Style(24, Color.white, TextAnchor.MiddleLeft, null);
            button = Style(18, Color.white, TextAnchor.MiddleCenter, Tex(new Color(0.10f, 0.42f, 0.44f, 0.96f)));
            buttonOn = Style(18, Color.black, TextAnchor.MiddleCenter, Tex(new Color(0.98f, 0.80f, 0.22f, 0.98f)));
            buttonOff = Style(18, new Color(0.7f, 0.7f, 0.7f), TextAnchor.MiddleCenter, Tex(new Color(0.25f, 0.28f, 0.30f, 0.9f)));
            panel = Style(18, Color.white, TextAnchor.UpperLeft, Tex(new Color(0.07f, 0.13f, 0.17f, 0.90f)));
            banner = Style(22, Color.white, TextAnchor.MiddleCenter, Tex(new Color(0.75f, 0.12f, 0.10f, 0.95f)));
            pin = Style(15, Color.white, TextAnchor.MiddleCenter, Tex(new Color(0.07f, 0.13f, 0.17f, 0.80f)));
        }

        void Box(Rect r) { pending.Add(r); GUI.Box(r, GUIContent.none, panel); }
        void Text(Rect r, string text) { GUI.Label(r, text, label); }
        void Small(Rect r, string text) { GUI.Label(r, text, small); }

        bool Btn(Rect r, string text, bool enabled = true, bool on = false)
        {
            pending.Add(r);
            GUI.Box(r, text, !enabled ? buttonOff : (on ? buttonOn : button));
            if (!enabled) { TakeTap(r); return false; }
            return TakeTap(r);
        }

        bool TakeTap(Rect r)
        {
            var taps = g.Input.UiTaps;
            for (int i = 0; i < taps.Count; i++)
                if (r.Contains(taps[i])) { taps.RemoveAt(i); return true; }
            return false;
        }

        static string Won(long v) { return v.ToString("N0") + "원"; }
        static string Num(double v) { return v.ToString("0.#"); }

        // ---------- 화면 ----------

        public void Draw()
        {
            if (Event.current.type != EventType.Repaint) return;
            EnsureStyles();
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
                DrawTouchControls();
            }

            if (Time.unscaledTime < toastUntil)
                GUI.Box(new Rect(W / 2 - 330, H - 150, 660, 46), toast, pin);

            var swap = rects; rects = pending; pending = swap;
        }

        void DrawMenu()
        {
            var r = new Rect(W / 2 - 260, 170, 520, 380);
            Box(r);
            GUI.Label(new Rect(r.x + 20, r.y + 20, 480, 50), "REBUILD CITY 리빌드시티", title);
            Small(new Rect(r.x + 20, r.y + 72, 480, 60), "무너진 도시를 재건하고, 건설 제국을 세워라.\n수직 슬라이스 빌드: 토네이도 피해 주택 복구");
            if (Btn(new Rect(r.x + 60, r.y + 160, 400, 64), "새 게임")) g.NewGame();
            if (Btn(new Rect(r.x + 60, r.y + 240, 400, 64), "이어하기", g.HasSave)) g.Continue();
            Small(new Rect(r.x + 20, r.y + 320, 480, 50), GameInput.Mobile
                ? "왼쪽 조이스틱 이동 · 오른쪽 드래그 시점 · 건물을 눌러 선택"
                : "WASD 이동 · Shift 달리기 · E 상호작용 · Tab 경영 모드 · 우클릭 드래그 시점");
        }

        void DrawTop()
        {
            var w = g.Sim.World;
            Box(new Rect(0, 0, W, 54));
            float x = 12 + Screen.safeArea.xMin / Scale;
            Text(new Rect(x, 6, 260, 42), "자금 " + Won(w.Cash));
            Text(new Rect(x + 260, 6, 190, 42), SimTime.Day(w.Tick) + "일차 " + SimTime.Hour(w.Tick).ToString("00") + ":" + SimTime.Minute(w.Tick).ToString("00"));
            bool windy = ConstructionSystem.WeatherFactor(w) < 1.0;
            Small(new Rect(x + 450, 6, 250, 42), (windy ? "강풍(작업 80%)" : "맑음") + " · 실적 " + w.CompletedContracts + "건 · 평판 " + w.Reputation);

            float bx = W - 12 - (Screen.width - Screen.safeArea.xMax) / Scale - GameController.Speeds.Length * 62;
            for (int i = 0; i < GameController.Speeds.Length; i++)
            {
                int s = GameController.Speeds[i];
                if (Btn(new Rect(bx + i * 62, 6, 58, 42), s == 0 ? "정지" : s + "배", true, g.Speed == s)) g.Speed = s;
            }

            Small(new Rect(x, 58, W - 460, 30), "목표: " + Objective(w));

            if (w.Alert)
            {
                string msg = w.DisasterActive ? "토네이도 통과 중 — 작업 중지, 작업자 대피"
                    : "토네이도 예보 — " + (w.Disaster.StartTick - w.Tick) + "분 뒤 도착. 작업자 대피 중";
                GUI.Box(new Rect(W / 2 - 300, 92, 600, 44), msg, banner);
            }

            float fy = 140;
            for (int i = 0; i < feed.Count; i++)
            {
                if (Time.unscaledTime - feedTime[i] > 12f) continue;
                GUI.Box(new Rect(x, fy, 470, 30), feed[i], pin);
                fy += 34;
            }
        }

        string Objective(WorldState w)
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
                    foreach (double n in need) if (n > 0) return "현장을 선택해 부족 자재를 발주하세요. 트럭이 실어 옵니다.";
                }
                return "공정 진행 중. 작업자가 일하고, 현장에서 직접 작업해 속도를 올릴 수 있습니다.";
            }
            if (anySurveyed) return "견적(자재 등급·이윤)을 정하고 계약을 체결하세요.";
            if (anyDamaged) return GameInput.Mobile ? "피해 주택 앞으로 가서 [상호작용]으로 현장을 조사하세요." : "피해 주택 앞으로 가서 E 키로 현장을 조사하세요.";
            if (w.CompletedContracts > 0) return "준공 완료! [직원]에서 채용하고 다음 재난에 대비하세요.";
            return "토네이도 예보를 기다리는 중입니다. 속도를 올려도 됩니다.";
        }

        void DrawBottom()
        {
            float bw = 104, by = H - 62, bx = W - 12 - (Screen.width - Screen.safeArea.xMax) / Scale - bw * 6 - 5 * 6;
            if (Btn(new Rect(bx, by, bw, 52), g.Management ? "경영 모드" : "직접 모드", true, g.Management)) g.ToggleMode();
            if (Btn(new Rect(bx + (bw + 6), by, bw, 52), "직원", true, tab == Tab.Staff)) tab = tab == Tab.Staff ? Tab.None : Tab.Staff;
            if (Btn(new Rect(bx + (bw + 6) * 2, by, bw, 52), "자재", true, tab == Tab.Materials)) tab = tab == Tab.Materials ? Tab.None : Tab.Materials;
            if (Btn(new Rect(bx + (bw + 6) * 3, by, bw, 52), "원장", true, tab == Tab.Ledger)) tab = tab == Tab.Ledger ? Tab.None : Tab.Ledger;
            if (Btn(new Rect(bx + (bw + 6) * 4, by, bw, 52), "저장")) g.Save(false);
            if (Btn(new Rect(bx + (bw + 6) * 5, by, bw, 52), confirmNew ? "정말 새로?" : "새 게임", true, confirmNew))
            {
                if (confirmNew) { confirmNew = false; g.NewGame(); }
                else { confirmNew = true; Toast("한 번 더 누르면 새 게임을 시작합니다(현재 저장은 덮어쓰게 됩니다)."); }
            }
        }

        void DrawTouchControls()
        {
            if (!GameInput.Mobile) return;
            var input = g.Input;
            GUI.Box(new Rect(input.StickCenter.x - 90, input.StickCenter.y - 90, 180, 180), GUIContent.none, pin);
            Vector2 knob = input.StickActive ? input.StickKnob : input.StickCenter;
            GUI.Box(new Rect(knob.x - 34, knob.y - 34, 68, 68), GUIContent.none, button);
            float rx = W - 12 - (Screen.width - Screen.safeArea.xMax) / Scale;
            float y = H - 62 - 12 - 72;
            float left = g.SelectedBuilding >= 0 ? rx - 440 - 130 : rx - 130;
            if (!g.Management && Btn(new Rect(left, y, 124, 68), "상호작용")) g.Interact();
            if (!g.Management && Btn(new Rect(left - 134, y, 124, 68), "달리기", true, input.RunToggle)) input.RunToggle = !input.RunToggle;
            if (Btn(new Rect(left, y - 78, 60, 68), "+")) input.PendingZoom += 2;
            if (Btn(new Rect(left + 64, y - 78, 60, 68), "-")) input.PendingZoom -= 2;
        }

        void DrawPins()
        {
            var w = g.Sim.World;
            var cam = g.Cam;
            foreach (var b in w.Buildings)
            {
                string text = null;
                var c = w.ContractById(b.ContractId);
                if (c != null)
                {
                    double sum = 0; int n = 0;
                    foreach (int id in c.OrderIds) { var o = w.OrderById(id); if (o != null) { sum += o.Done / o.Total; n++; } }
                    text = b.Name + " 공정 " + (n > 0 ? (sum / n * 100).ToString("0") : "0") + "%";
                }
                else if (b.IsDamaged) text = b.Name + (b.Surveyed ? " 견적 대기" : " 피해!");
                if (text == null) continue;
                Vector3 sp = cam.WorldToScreenPoint(Vis.P(b.X, b.Z, 7f));
                if (sp.z <= 0) continue;
                GUI.Box(new Rect(sp.x / Scale - 80, (Screen.height - sp.y) / Scale - 14, 160, 28), text, pin);
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

        void DrawBuilding()
        {
            var w = g.Sim.World;
            var b = w.BuildingById(g.SelectedBuilding);
            if (b == null) { g.SelectedBuilding = -1; return; }
            float px = W - 12 - (Screen.width - Screen.safeArea.xMax) / Scale - 440, py = 62, pw = 440, ph = H - py - 74;
            Box(new Rect(px, py, pw, ph));
            float y = py + 8, x = px + 6, cw = pw - 12;
            GUI.Label(new Rect(x, y, cw - 60, 34), b.Name + " · " + b.Owner, title);
            if (Btn(new Rect(px + pw - 58, y, 50, 34), "닫기")) { g.SelectedBuilding = -1; g.SelectedPart = -1; return; }
            y += 40;

            var sel = b.PartById(g.SelectedPart);
            if (sel != null)
            {
                Small(new Rect(x, y, cw, 26), "선택 부재: " + sel.Name + " · 상태 " + sel.Hp.ToString("0") + " (" + StateName(sel.State) + ") · " + Num(sel.Quantity) + sel.Unit);
                y += 28;
            }

            var c = w.ContractById(b.ContractId);
            if (c == null) DrawSurvey(w, b, x, ref y, cw);
            else DrawContract(w, b, c, x, ref y, cw, py + ph);
        }

        void DrawSurvey(WorldState w, Building b, float x, ref float y, float cw)
        {
            if (!b.IsDamaged) { Text(new Rect(x, y, cw, 30), "피해가 없습니다."); return; }
            Small(new Rect(x, y, cw, 24), "피해 부재 (구조 안전도 " + b.StructuralSafety.ToString("0") + ")");
            y += 26;
            int shown = 0;
            foreach (var p in b.Parts)
            {
                if (p.Hp >= 90 || shown >= 8) continue;
                Small(new Rect(x, y, cw, 22), "· " + p.Name + "  상태 " + p.Hp.ToString("0") + "  " + StateName(p.State));
                y += 22; shown++;
            }
            if (b.DebrisM3 > 0.001) { Small(new Rect(x, y, cw, 22), "· 잔해 " + Num(b.DebrisM3) + "m3"); y += 22; }
            y += 8;

            if (!b.Surveyed)
            {
                if (Btn(new Rect(x, y, cw, 52), "현장 조사 (건물 10m 이내)")) g.Do(g.Sim.InspectBuilding(b.Id), "조사 완료. 견적을 정하세요.");
                return;
            }

            var plan = ConstructionSystem.Plan(b);
            Small(new Rect(x, y, cw, 24), "고객 예산 " + Won(b.Budget) + " · 공정 " + plan.Count + "개");
            y += 28;
            Small(new Rect(x, y, cw, 22), "자재 등급 (품질·내풍 성능·원가)");
            y += 24;
            for (int i = 0; i < 3; i++)
                if (Btn(new Rect(x + i * (cw / 3), y, cw / 3 - 4, 42), Items.GradeName[i], true, grade == i)) grade = i;
            y += 48;
            Small(new Rect(x, y, cw, 22), "이윤");
            y += 24;
            for (int i = 0; i < 3; i++)
                if (Btn(new Rect(x + i * (cw / 3), y, cw / 3 - 4, 42), ConstructionSystem.MarginName[i], true, tier == i)) tier = i;
            y += 50;

            long cost = ConstructionSystem.EstimateCost(plan, grade);
            long price = ConstructionSystem.QuotePrice(b, grade, tier);
            Text(new Rect(x, y, cw, 26), "견적가 " + Won(price)); y += 26;
            Small(new Rect(x, y, cw, 24), "예상 원가 " + Won(cost) + " · 예상 이익 " + Won(price - cost)); y += 26;
            bool over = price > b.Budget;
            if (over) { Small(new Rect(x, y, cw, 24), "고객 예산을 넘습니다. 등급이나 이윤을 낮추세요."); y += 26; }
            if (Btn(new Rect(x, y, cw, 52), "계약 체결 (선급금 30%)", !over)) g.Do(g.Sim.SignContract(b.Id, grade, tier), null);
        }

        void DrawContract(WorldState w, Building b, Contract c, float x, ref float y, float cw, float bottom)
        {
            Small(new Rect(x, y, cw, 24), "계약 " + Won(c.Price) + " · 수금 " + Won(c.Paid) + " · " + Items.GradeName[c.Grade]);
            y += 24;
            Small(new Rect(x, y, cw, 24), "투입 원가: 자재 " + Won(c.MaterialCost) + " · 노무 " + Won(c.LaborCost));
            y += 26;

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
                Small(new Rect(x, y, cw, 24), "부족: " + sb); y += 26;
                if (Btn(new Rect(x, y, cw, 46), "부족 자재 발주 " + Won(needCost) + " + 운반비")) g.Do(g.Sim.OrderShortage(b.Id), null);
                y += 52;
            }
            sb.Length = 0;
            foreach (var s in b.Stock)
            {
                if (s.OnSite <= 0.001) continue;
                if (sb.Length > 0) sb.Append(", ");
                sb.Append(Items.All[s.ItemId].Name).Append(' ').Append(Num(s.OnSite)).Append(Items.All[s.ItemId].Unit);
            }
            Small(new Rect(x, y, cw, 24), "현장 재고: " + (sb.Length > 0 ? sb.ToString() : "없음")); y += 28;

            if (w.PlayerWorkOrderId >= 0)
            {
                if (Btn(new Rect(x, y, cw, 44), "직접 작업 중단", true, true)) g.Sim.StopPlayerWork();
                y += 50;
            }

            const float rowH = 40;
            int rows = Mathf.Max(1, (int)((bottom - y - 50) / rowH));
            int pages = Mathf.Max(1, (c.OrderIds.Count + rows - 1) / rows);
            if (orderPage >= pages) orderPage = pages - 1;
            for (int n = 0; n < rows; n++)
            {
                int idx = orderPage * rows + n;
                if (idx >= c.OrderIds.Count) break;
                var o = w.OrderById(c.OrderIds[idx]);
                if (o == null) continue;
                string state;
                if (o.IsDone) state = "완료";
                else if (!ConstructionSystem.PrereqsDone(w, o)) state = "선행 대기";
                else if (o.ClaimedBy > 0) { var k = w.WorkerById(o.ClaimedBy); state = k != null ? k.Name : "작업자"; }
                else if (o.ClaimedBy == 0 && w.PlayerWorkOrderId == o.Id) state = "대표 작업";
                else if (o.State == WorkState.WaitMaterial) state = "자재 대기";
                else state = "대기";
                Small(new Rect(x, y, cw - 96, rowH - 2), o.Name + "  " + Num(o.Done) + "/" + Num(o.Total) + o.Unit + "  [" + state + "]");
                bool can = !o.IsDone && !g.Management && o.ClaimedBy <= 0 && w.PlayerWorkOrderId != o.Id && ConstructionSystem.PrereqsDone(w, o);
                if (!o.IsDone && Btn(new Rect(x + cw - 92, y + 2, 90, rowH - 6), "직접", can))
                    g.Do(g.Sim.StartPlayerWork(o.Id), o.Name + " 직접 작업을 시작합니다.");
                y += rowH;
            }
            if (pages > 1)
            {
                float by = bottom - 46;
                if (Btn(new Rect(x, by, 90, 40), "이전", orderPage > 0)) orderPage--;
                Small(new Rect(x + 100, by, 100, 40), (orderPage + 1) + " / " + pages);
                if (Btn(new Rect(x + cw - 92, by, 90, 40), "다음", orderPage < pages - 1)) orderPage++;
            }
        }

        Rect Modal(string heading, float height)
        {
            var r = new Rect(20 + Screen.safeArea.xMin / Scale, 100, 560, height);
            Box(r);
            GUI.Label(new Rect(r.x + 8, r.y + 6, 400, 34), heading, title);
            if (Btn(new Rect(r.xMax - 60, r.y + 6, 52, 34), "닫기")) tab = Tab.None;
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
            var r = Modal("직원", 150 + w.Workers.Count * 50);
            float y = r.y + 48;
            foreach (var k in w.Workers)
            {
                var o = w.OrderById(k.JobId);
                Small(new Rect(r.x + 8, y, r.width - 16, 46),
                    k.Name + " · 숙련 " + k.Skill.ToString("0.00") + " · 피로 " + k.Fatigue.ToString("0") + " · " + WorkerStateName(k.State)
                    + (o != null ? " (" + o.Name + ")" : "") + "\n시급 " + Won(k.WagePerHour) + " · 미지급 " + Won(k.UnpaidWage) + " (18시 지급)");
                y += 50;
            }
            bool can = w.CompletedContracts >= 1 && w.Workers.Count < WorkforceSystem.MaxWorkers;
            string why = w.CompletedContracts < 1 ? "채용 (첫 준공 후 가능)" : (w.Workers.Count >= WorkforceSystem.MaxWorkers ? "채용 (정원 초과)" : "채용 " + Won(WorkforceSystem.HireFee));
            if (Btn(new Rect(r.x + 8, y + 8, r.width - 16, 50), why, can)) g.Do(g.Sim.HireWorker(), null);
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
            var r = Modal("자재·물류", 470);
            float y = r.y + 48;
            Text(new Rect(r.x + 8, y, r.width - 16, 28), "트럭: " + TruckStateName(w.Truck.State) + (w.Alert ? " (경보 대기)" : "")); y += 32;
            Small(new Rect(r.x + 8, y, r.width - 16, 24), "단가(표준): " + Items.All[0].Name + " " + Won(Items.All[0].Price) + "/" + Items.All[0].Unit + ", "
                + Items.All[1].Name + " " + Won(Items.All[1].Price) + "/" + Items.All[1].Unit); y += 24;
            Small(new Rect(r.x + 8, y, r.width - 16, 24), Items.All[2].Name + " " + Won(Items.All[2].Price) + "/" + Items.All[2].Unit + ", "
                + Items.All[3].Name + " " + Won(Items.All[3].Price) + "/" + Items.All[3].Unit + " · 운반비 " + Won(ConstructionSystem.DeliveryFee) + "/회"); y += 30;
            Small(new Rect(r.x + 8, y, r.width - 16, 24), "최근 발주"); y += 24;
            int start = Mathf.Max(0, w.Purchases.Count - 9);
            if (w.Purchases.Count == 0) { Small(new Rect(r.x + 8, y, r.width - 16, 24), "발주 내역이 없습니다. 계약 현장을 선택해 발주하세요."); }
            for (int i = w.Purchases.Count - 1; i >= start; i--)
            {
                var p = w.Purchases[i];
                var b = w.BuildingById(p.BuildingId);
                string st = p.State == PurchaseState.Ordered ? "발주됨" : (p.State == PurchaseState.InTransit ? "운송 중" : "현장 도착");
                Small(new Rect(r.x + 8, y, r.width - 16, 24), (b != null ? b.Name : "") + " · " + Items.All[p.ItemId].Name + " " + Num(p.Qty) + Items.All[p.ItemId].Unit + " · " + Won(p.Cost) + " · " + st);
                y += 26;
            }
        }

        void DrawLedger()
        {
            var w = g.Sim.World;
            var r = Modal("원장", 470);
            float y = r.y + 48;
            Text(new Rect(r.x + 8, y, r.width - 16, 28), "현금 " + Won(w.Cash) + " · 미지급 노무비 " + Won(w.UnpaidWages)); y += 34;
            int start = Mathf.Max(0, w.Ledger.Count - 13);
            for (int i = w.Ledger.Count - 1; i >= start; i--)
            {
                var l = w.Ledger[i];
                Small(new Rect(r.x + 8, y, r.width - 16, 24), SimTime.Day(l.Tick) + "일 " + SimTime.Hour(l.Tick).ToString("00") + ":" + SimTime.Minute(l.Tick).ToString("00")
                    + "  " + (l.Amount >= 0 ? "+" : "") + l.Amount.ToString("N0") + "  " + l.Memo);
                y += 26;
            }
        }
    }
}
