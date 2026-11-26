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
        public Sfx Audio;
        public bool Scripted;            // 자동 촬영 중에는 시간과 저장을 촬영 쪽에서 다룬다

        WorldView view;
        WorldState menuWorld;
        PlayerRig player;
        CameraRig cameraRig;
        Sky sky;
        Hud hud;
        float acc, autosaveTimer, storm;

        public bool Started { get { return Sim != null; } }
        public string SavePath { get { return Path.Combine(Application.persistentDataPath, "save1.rbc"); } }
        public bool HasSave { get { return File.Exists(SavePath) || File.Exists(SavePath + ".bak"); } }
        public Camera Cam { get { return cameraRig.Cam; } }
        public Hud Hud { get { return hud; } }
        public CameraRig Rig { get { return cameraRig; } }

        void Awake()
        {
            Instance = this;
            Debug.Log("[rc] Awake");
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            bool mobile = Application.isMobilePlatform;
            QualitySettings.shadows = ShadowQuality.All;
            QualitySettings.shadowResolution = mobile ? ShadowResolution.Medium : ShadowResolution.VeryHigh;
            QualitySettings.shadowDistance = mobile ? 60f : 110f;
            QualitySettings.shadowCascades = mobile ? 2 : 4;
            QualitySettings.antiAliasing = mobile ? 2 : 4;
            QualitySettings.pixelLightCount = mobile ? 3 : 8;

            cameraRig = new CameraRig();
            sky = new Sky();
            Audio = new Sfx(gameObject);
            hud = new Hud(this);
            Input.IsOverUi = hud.IsOver;

            // 시작 화면 뒤에 보이는 마을
            menuWorld = WorldFactory.NewGame(3);
            view = new WorldView(menuWorld);

            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == "-rcshots") gameObject.AddComponent<ShotDirector>().Begin(this, args[i + 1]);
            Debug.Log("[rc] 시작 준비 완료 " + Time.realtimeSinceStartup.ToString("0.0") + "초");
        }

        public void NewGame() { NewGame((ulong)DateTime.UtcNow.Ticks); }

        public void NewGame(ulong seed)
        {
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
            player = new PlayerRig(Gfx.P(w.PlayerX, w.PlayerZ, 0.1f), (float)w.PlayerYaw);
            cameraRig.Yaw = (float)w.PlayerYaw;
            cameraRig.Snap();
            SelectedBuilding = -1; SelectedPart = -1;
            Speed = 1; acc = 0; Management = false; storm = 0;
            hud.ResetCash();
        }

        public void Save(bool quiet)
        {
            if (Sim == null || Scripted) return;
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
            hud.Toast(Management ? "경영 모드: 내려다보며 원격 지시만 할 수 있습니다." : "직접 모드: 대표를 움직여 조사하고 작업합니다.");
        }

        public Building NearestBuilding()
        {
            var w = Sim.World;
            Building best = null;
            double bestDist = ConstructionSystem.SurveyRange;
            foreach (var b in w.Buildings)
            {
                double d = Mathx.Dist(w.PlayerX, w.PlayerZ, b.X, b.Z);
                if (d <= bestDist) { best = b; bestDist = d; }
            }
            return best;
        }

        /// <summary>E / 상호작용 버튼: 가장 가까운 건물을 고르고, 조사 전이면 조사한다.</summary>
        public void Interact()
        {
            var best = NearestBuilding();
            if (best == null) { hud.Toast("가까운 건물이 없습니다. 주택 앞으로 가세요."); return; }
            SelectedBuilding = best.Id;
            SelectedPart = -1;
            if (best.ContractId < 0 && best.IsDamaged && !best.Surveyed) Do(Sim.InspectBuilding(best.Id), "조사 완료. 견적을 정하세요.");
        }

        public void TeleportPlayer(double x, double z, float yaw)
        {
            if (player != null) player.Destroy();
            player = new PlayerRig(Gfx.P(x, z, 0.1f), yaw);
            cameraRig.Yaw = yaw;
            cameraRig.Snap();
            Sim.SetPlayerPosition(x, z, yaw);
        }

        void Update()
        {
            hud.UpdateScale();
            Input.UiScale = hud.Scale;
            Input.Update();
            float dt = Time.deltaTime;

            if (Sim == null)
            {
                sky.Sync(16.6f, 0);
                view.Sync(menuWorld, -1, -1, sky.Night, 0, dt);
                cameraRig.Orbit(dt);
                Audio.Tick(0.05f, false, 0, dt);
                return;
            }
            var w = Sim.World;

            if (Input.ToggleModePressed) ToggleMode();
            if (Input.InteractPressed && !Management) Interact();
            if (Input.HasWorldTap) Pick(Input.WorldTap);

            Vector3 workTarget = Vector3.zero;
            if (w.PlayerWorkOrderId >= 0)
            {
                var o = w.OrderById(w.PlayerWorkOrderId);
                var b = o != null ? w.BuildingById(o.BuildingId) : null;
                if (b != null) workTarget = Gfx.P(b.X, b.Z);
            }
            bool moved = player.Tick(Management ? Vector2.zero : Input.Move, Input.Run, cameraRig.Yaw, w.PlayerWorkOrderId >= 0, workTarget, dt);
            if (moved && w.PlayerWorkOrderId >= 0) { Sim.StopPlayerWork(); hud.Toast("이동해서 작업을 멈췄습니다. 완료한 물량은 그대로입니다."); }
            Sim.SetPlayerPosition(player.Position.x, player.Position.z, player.Yaw);

            // 고정 틱: 렌더 프레임과 분리. 배속은 틱 횟수만 늘린다.
            if (!Scripted)
            {
                acc += dt * TicksPerSecond * Speed;
                int steps = 0;
                bool wasWorking = w.PlayerWorkOrderId >= 0;
                while (acc >= 1f && steps < 30) { Sim.Step(); acc -= 1f; steps++; }
                if (acc > 30f) acc = 0;
                if (wasWorking && w.PlayerWorkOrderId < 0 && !Sim.LastPlayerWork.Ok) hud.Toast(Sim.LastPlayerWork.Message);
            }

            for (int i = 0; i < w.Events.Count; i++)
            {
                var e = w.Events[i];
                hud.Feed(e.Text);
                if (e.Kind == "Warn")
                {
                    Audio.Play(Audio.Siren, 0.8f);
                    if (Speed > 0 && !Scripted)
                    {
                        Speed = 0;
                        hud.Toast("토네이도 예보로 일시정지했습니다. 배속 버튼을 누르면 계속됩니다.");
                    }
                }
                else if (e.Kind == "Complete" || e.Kind == "Contract") Audio.Play(Audio.Coin, 0.8f);
                else if (e.Kind == "Delivered") Audio.Play(Audio.Thud, 0.7f);
            }
            w.Events.Clear();

            // 하늘, 폭풍, 3D 동기화
            float target = w.DisasterActive ? 1f : (w.Alert ? 0.45f : 0f);
            storm = Mathf.MoveTowards(storm, target, dt * 0.35f);
            float hour = (w.Tick % SimTime.TicksPerDay) / 60f + Mathf.Clamp01(acc) / 60f;
            sky.Sync(hour, storm);
            view.Sync(w, SelectedBuilding, SelectedPart, sky.Night, storm, dt);

            float near = 0;
            if (view.TornadoActive)
            {
                float d = Vector3.Distance(cameraRig.Cam.transform.position, view.TornadoPosition);
                near = Mathf.Clamp01(1f - d / 90f);
                if (near > 0.05f) cameraRig.Shake(near * 0.55f);
            }
            float hammerDistance = Vector3.Distance(cameraRig.Cam.transform.position, view.HammerPosition);
            Audio.Tick(0.04f + storm * 0.35f + near * 0.6f, view.HammerPulse && Speed > 0, hammerDistance, dt);

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
            if (!Physics.Raycast(cameraRig.Cam.ScreenPointToRay(screen), out hit, 400f)) return;
            var pr = hit.collider.GetComponentInParent<PartRef>();
            if (pr == null) return;
            SelectedBuilding = pr.BuildingId;
            SelectedPart = pr.PartId;
        }

        void OnGUI() { hud.Draw(); }
    }
}
