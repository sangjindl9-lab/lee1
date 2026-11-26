using System;
using System.IO;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    public static class Bootstrap
    {
        // 어떤 씬에서 시작해도 게임이 스스로 만들어진다(빈 씬 하나만 있으면 된다).
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Init()
        {
            if (GameController.Instance != null) return;
            var go = new GameObject("RebuildCity");
            UnityEngine.Object.DontDestroyOnLoad(go);
            go.AddComponent<GameController>();
        }
    }

    /// <summary>
    /// 화면 쪽 총괄. 입력을 시뮬레이션 명령으로 바꾸고, 고정 틱으로 시뮬레이션을 돌리고, 상태를 3D와 HUD로 그린다.
    /// 게임 규칙은 여기 없다. 전부 RebuildCity.Sim 안에 있다.
    /// </summary>
    public sealed class GameController : MonoBehaviour
    {
        public static GameController Instance;
        public const float TicksPerSecond = 2f;     // 1배속: 1초에 게임 2분
        public static readonly int[] Speeds = { 0, 1, 2, 5, 10 };

        public Simulation Sim;
        public int Speed = 1;
        public bool Management;
        public int SelectedBuilding = -1, SelectedPart = -1;
        public readonly GameInput Input = new GameInput();

        WorldView view;
        PlayerRig player;
        CameraRig cameraRig;
        Hud hud;
        float acc, autosaveTimer;

        public bool Started { get { return Sim != null; } }
        public string SavePath { get { return Path.Combine(Application.persistentDataPath, "save1.rbc"); } }
        public bool HasSave { get { return File.Exists(SavePath) || File.Exists(SavePath + ".bak"); } }
        public Camera Cam { get { return cameraRig.Cam; } }

        void Awake()
        {
            Instance = this;
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            if (Application.isMobilePlatform) QualitySettings.shadowDistance = 45f;

            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.15f;
            sun.shadows = LightShadows.Soft;
            sun.transform.rotation = Quaternion.Euler(48, -35, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.52f, 0.55f, 0.60f);

            cameraRig = new CameraRig();
            hud = new Hud(this);
            Input.IsOverUi = hud.IsOver;
        }

        public void NewGame()
        {
            ulong seed = (ulong)DateTime.UtcNow.Ticks;
            Begin(Simulation.NewGame(seed));
            hud.Toast("새 게임을 시작했습니다. 곧 토네이도 예보가 옵니다.");
        }

        public void Continue()
        {
            try
            {
                Begin(new Simulation(SaveCodec.LoadFile(SavePath)));
                hud.Toast("저장된 게임을 불러왔습니다.");
            }
            catch (Exception e)
            {
                Debug.LogError("불러오기 실패: " + e);
                hud.Toast("불러오기 실패: " + e.Message);
            }
        }

        void Begin(Simulation sim)
        {
            if (view != null) view.Destroy();
            if (player != null) player.Destroy();
            Sim = sim;
            var w = sim.World;
            sim.StopPlayerWork();
            view = new WorldView(w);
            player = new PlayerRig(Vis.P(w.PlayerX, w.PlayerZ, 0.1f), (float)w.PlayerYaw);
            cameraRig.Yaw = (float)w.PlayerYaw;
            SelectedBuilding = -1; SelectedPart = -1;
            Speed = 1; acc = 0; Management = false;
        }

        public void Save(bool quiet)
        {
            if (Sim == null) return;
            try
            {
                SaveCodec.SaveFile(Sim.World, SavePath);
                if (!quiet) hud.Toast("저장했습니다.");
            }
            catch (Exception e)
            {
                Debug.LogError("저장 실패: " + e);
                hud.Toast("저장 실패: " + e.Message);
            }
        }

        void OnApplicationPause(bool paused) { if (paused) Save(true); }
        void OnApplicationQuit() { Save(true); }

        /// <summary>명령 결과를 사용자에게 알린다. 실패 이유를 숨기지 않는다.</summary>
        public bool Do(Result r, string okMessage)
        {
            if (r.Ok) { if (okMessage != null) hud.Toast(okMessage); }
            else hud.Toast(r.Message);
            return r.Ok;
        }

        public void ToggleMode()
        {
            Management = !Management;
            if (Management) Sim.StopPlayerWork();
            hud.Toast(Management ? "경영 모드: 내려다보며 원격 지시만 할 수 있습니다." : "직접 모드: 대표를 움직여 조사·작업합니다.");
        }

        /// <summary>E / 상호작용 버튼: 가장 가까운 건물을 고르고, 조사 전이면 조사한다.</summary>
        public void Interact()
        {
            var w = Sim.World;
            Building best = null;
            double bestDist = ConstructionSystem.SurveyRange;
            foreach (var b in w.Buildings)
            {
                double d = Mathx.Dist(w.PlayerX, w.PlayerZ, b.X, b.Z);
                if (d <= bestDist) { best = b; bestDist = d; }
            }
            if (best == null) { hud.Toast("가까운 건물이 없습니다. 주택 앞으로 가세요."); return; }
            SelectedBuilding = best.Id;
            SelectedPart = -1;
            if (best.ContractId < 0 && best.IsDamaged && !best.Surveyed) Do(Sim.InspectBuilding(best.Id), null);
        }

        void Update()
        {
            hud.UpdateScale();
            Input.UiScale = hud.Scale;
            Input.Update();
            if (Sim == null) return;
            var w = Sim.World;
            float dt = Time.deltaTime;

            if (Input.ToggleModePressed) ToggleMode();
            if (Input.InteractPressed && !Management) Interact();
            if (Input.HasWorldTap) Pick(Input.WorldTap);

            bool moved = player.Tick(Management ? Vector2.zero : Input.Move, Input.Run, cameraRig.Yaw, w.PlayerWorkOrderId >= 0, dt);
            if (moved && w.PlayerWorkOrderId >= 0) { Sim.StopPlayerWork(); hud.Toast("이동해서 작업을 멈췄습니다. 완료한 물량은 그대로입니다."); }
            Sim.SetPlayerPosition(player.Position.x, player.Position.z, player.Yaw);

            // 고정 틱: 렌더 프레임과 분리. 배속은 틱 횟수만 늘린다.
            acc += dt * TicksPerSecond * Speed;
            int steps = 0;
            bool wasWorking = w.PlayerWorkOrderId >= 0;
            while (acc >= 1f && steps < 30) { Sim.Step(); acc -= 1f; steps++; }
            if (acc > 30f) acc = 0;
            if (wasWorking && w.PlayerWorkOrderId < 0 && !Sim.LastPlayerWork.Ok) hud.Toast(Sim.LastPlayerWork.Message);

            for (int i = 0; i < w.Events.Count; i++)
            {
                hud.Feed(w.Events[i].Text);
                if (w.Events[i].Kind == "Warn" && Speed > 0)
                {
                    Speed = 0;
                    hud.Toast("토네이도 예보로 일시정지했습니다. 속도 버튼을 누르면 계속됩니다.");
                }
            }
            w.Events.Clear();

            view.Sync(w, SelectedBuilding, SelectedPart, dt);

            autosaveTimer += Time.unscaledDeltaTime;
            if (autosaveTimer > 120f) { autosaveTimer = 0; Save(true); }
        }

        void LateUpdate()
        {
            if (Sim == null) return;
            cameraRig.Tick(Input, Management, player.Position, Time.deltaTime);
        }

        void Pick(Vector2 screen)
        {
            RaycastHit hit;
            if (!Physics.Raycast(cameraRig.Cam.ScreenPointToRay(screen), out hit, 300f)) return;
            var pr = hit.collider.GetComponentInParent<PartRef>();
            if (pr == null) return;
            SelectedBuilding = pr.BuildingId;
            SelectedPart = pr.PartId;
        }

        void OnGUI() { hud.Draw(); }
    }
}
