using System.Collections.Generic;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>키보드·마우스와 터치를 같은 값(이동, 시점, 확대, 탭)으로 바꿔 준다. UI 위의 입력은 월드로 보내지 않는다.</summary>
    public sealed class GameInput
    {
        public Vector2 Move;            // 이동 입력(-1~1)
        public Vector2 Look;            // 시점 회전(픽셀)
        public float Zoom;              // 확대(+)·축소(-)
        public float PendingZoom;       // 화면 버튼으로 누른 확대량(다음 프레임에 반영)
        public bool Run;
        public bool InteractPressed;
        public bool ToggleModePressed;
        public bool HasWorldTap;
        public Vector2 WorldTap;        // 화면 좌표(픽셀)
        public readonly List<Vector2> UiTaps = new List<Vector2>();  // UI 좌표
        public bool RunToggle;
        public Vector2 StickCenter, StickKnob;   // UI 좌표(조이스틱 그리기용)
        public bool StickActive;

        public float UiScale = 1f;
        public System.Func<Vector2, bool> IsOverUi = p => false;

        int stickFinger = -1, lookFinger = -1;
        Vector2 lookStart;
        float lookStartTime;
        bool lookMoved;
        Vector3 lastMouse;

        public static bool Mobile { get { return Application.isMobilePlatform; } }

        public Vector2 ToUi(Vector2 screen) { return new Vector2(screen.x / UiScale, (Screen.height - screen.y) / UiScale); }

        public void Update()
        {
            Move = Vector2.zero; Look = Vector2.zero; Zoom = PendingZoom; PendingZoom = 0;
            InteractPressed = false; ToggleModePressed = false; HasWorldTap = false;
            UiTaps.Clear();
            StickCenter = new Vector2(150, Screen.height / UiScale - 190);

            if (Input.touchCount > 0) Touches();
            else { stickFinger = -1; lookFinger = -1; StickActive = false; if (!Mobile) Mouse(); }

            if (!Mobile || Input.touchCount == 0)
            {
                float x = (Input.GetKey(KeyCode.D) ? 1 : 0) - (Input.GetKey(KeyCode.A) ? 1 : 0);
                float y = (Input.GetKey(KeyCode.W) ? 1 : 0) - (Input.GetKey(KeyCode.S) ? 1 : 0);
                if (x != 0 || y != 0) Move = new Vector2(x, y).normalized;
                Run = Input.GetKey(KeyCode.LeftShift) || RunToggle;
                InteractPressed = Input.GetKeyDown(KeyCode.E);
                ToggleModePressed = Input.GetKeyDown(KeyCode.Tab);
                Zoom += Input.mouseScrollDelta.y;
            }
            else Run = RunToggle;
        }

        void Mouse()
        {
            Vector2 ui = ToUi(Input.mousePosition);
            if (Input.GetMouseButtonDown(0))
            {
                if (IsOverUi(ui)) UiTaps.Add(ui);
                else { HasWorldTap = true; WorldTap = Input.mousePosition; }
            }
            if (Input.GetMouseButtonDown(1)) lastMouse = Input.mousePosition;
            if (Input.GetMouseButton(1))
            {
                Look = Input.mousePosition - lastMouse;
                lastMouse = Input.mousePosition;
            }
        }

        void Touches()
        {
            for (int i = 0; i < Input.touchCount; i++)
            {
                Touch t = Input.GetTouch(i);
                Vector2 ui = ToUi(t.position);
                if (t.phase == TouchPhase.Began)
                {
                    if (IsOverUi(ui)) { UiTaps.Add(ui); continue; }
                    if (stickFinger == -1 && Vector2.Distance(ui, StickCenter) < 150) { stickFinger = t.fingerId; StickActive = true; }
                    else if (lookFinger == -1) { lookFinger = t.fingerId; lookStart = t.position; lookStartTime = Time.unscaledTime; lookMoved = false; }
                }
                if (t.fingerId == stickFinger)
                {
                    Vector2 d = (ui - StickCenter) / 90f;
                    d.y = -d.y;
                    Move = Vector2.ClampMagnitude(d, 1f);
                    if (Move.magnitude < 0.15f) Move = Vector2.zero;
                    if (t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled) { stickFinger = -1; StickActive = false; Move = Vector2.zero; }
                }
                else if (t.fingerId == lookFinger)
                {
                    if (t.phase == TouchPhase.Moved) Look += t.deltaPosition;
                    if ((t.position - lookStart).magnitude > 18f) lookMoved = true;
                    if (t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled)
                    {
                        if (t.phase == TouchPhase.Ended && !lookMoved && Time.unscaledTime - lookStartTime < 0.4f) { HasWorldTap = true; WorldTap = t.position; }
                        lookFinger = -1;
                    }
                }
            }
            StickKnob = StickCenter + new Vector2(Move.x, -Move.y) * 70f;
        }
    }

    /// <summary>대표 캐릭터. CharacterController로 걷고 달리며 벽을 통과하지 못한다.</summary>
    public sealed class PlayerRig
    {
        public const float WalkSpeed = 2.2f, RunSpeed = 4.5f, TurnSpeed = 540f;
        public readonly GameObject Go;
        readonly CharacterController cc;
        readonly HumanView view;
        float vy;

        public PlayerRig(Vector3 pos, float yaw)
        {
            Go = new GameObject("Player");
            Go.transform.position = pos;
            Go.transform.rotation = Quaternion.Euler(0, yaw, 0);
            cc = Go.AddComponent<CharacterController>();
            cc.height = 1.8f; cc.radius = 0.32f; cc.center = new Vector3(0, 0.92f, 0);
            cc.slopeLimit = 40; cc.stepOffset = 0.35f;
            view = new HumanView(Go.transform, Gfx.Hex(0xF4F1EA), Gfx.Hex(0x24405E), Gfx.Hex(0x30343A), false);
        }

        public Vector3 Position { get { return Go.transform.position; } }
        public float Yaw { get { return Go.transform.eulerAngles.y; } }

        /// <summary>이동했으면 true.</summary>
        public bool Tick(Vector2 move, bool run, float cameraYaw, bool working, Vector3 workTarget, float dt)
        {
            Vector3 dir = Quaternion.Euler(0, cameraYaw, 0) * new Vector3(move.x, 0, move.y);
            bool moving = dir.sqrMagnitude > 0.01f;
            Vector3 velocity = Vector3.zero;
            if (moving)
            {
                Go.transform.rotation = Quaternion.RotateTowards(Go.transform.rotation, Quaternion.LookRotation(dir.normalized), TurnSpeed * dt);
                velocity = dir * (run ? RunSpeed : WalkSpeed);
            }
            else if (working)
            {
                Vector3 look = workTarget - Go.transform.position;
                look.y = 0;
                if (look.sqrMagnitude > 0.01f) Go.transform.rotation = Quaternion.RotateTowards(Go.transform.rotation, Quaternion.LookRotation(look.normalized), TurnSpeed * dt);
            }
            vy = cc.isGrounded ? -1f : vy - 20f * dt;
            velocity.y = vy;
            cc.Move(velocity * dt);
            view.Animate(moving ? (run ? 2f : 1f) : 0f, working && !moving, false, dt);
            return moving;
        }

        public void Destroy() { Object.Destroy(Go); }
    }

    /// <summary>
    /// 직접 모드: 캐릭터 뒤에서 따라가고 장애물이 있으면 당겨진다. 경영 모드: 45도로 내려다보는 쿼터뷰.
    /// 시작 화면에서는 마을 주위를 천천히 돈다.
    /// </summary>
    public sealed class CameraRig
    {
        public readonly Camera Cam;
        public float Yaw;
        float distance = 7.2f, pitch = 22f;
        float mgmtDistance = 46f;
        public Vector3 Pivot;
        float orbit = 200f;
        float shake;

        public CameraRig()
        {
            var go = new GameObject("Main Camera");
            go.tag = "MainCamera";
            Cam = go.AddComponent<Camera>();
            Cam.clearFlags = CameraClearFlags.Skybox;
            Cam.backgroundColor = new Color(0.62f, 0.78f, 0.90f);
            Cam.farClipPlane = 700;
            Cam.nearClipPlane = 0.3f;
            Cam.fieldOfView = 55;
            go.AddComponent<AudioListener>();
        }

        public void Shake(float amount) { shake = Mathf.Max(shake, amount); }

        Vector3 ShakeOffset(float dt)
        {
            if (shake <= 0.001f) return Vector3.zero;
            float t = Time.unscaledTime * 31f;
            Vector3 o = new Vector3(Mathf.PerlinNoise(t, 0.3f) - 0.5f, Mathf.PerlinNoise(0.7f, t) - 0.5f, 0) * shake;
            shake = Mathf.MoveTowards(shake, 0, dt * 1.5f);
            return o;
        }

        public void Orbit(float dt)
        {
            orbit += dt * 4f;
            Vector3 target = new Vector3(0, 3f, 0);
            Vector3 pos = target + Quaternion.Euler(24f, orbit, 0) * Vector3.back * 52f;
            Cam.transform.position = pos;
            Cam.transform.rotation = Quaternion.LookRotation(target - pos);
        }

        public void Snap() { snap = true; }
        bool snap;

        public void Tick(GameInput input, bool management, Vector3 playerPos, float dt)
        {
            Yaw += input.Look.x * 0.25f;
            var tr = Cam.transform;
            float follow = snap ? 1f : Mathf.Clamp01(dt * 10f);
            if (!management)
            {
                pitch = Mathf.Clamp(pitch - input.Look.y * 0.15f, 6f, 62f);
                distance = Mathf.Clamp(distance - input.Zoom * 0.7f, 3f, 16f);
                Vector3 target = playerPos + Vector3.up * 1.9f;
                Vector3 dir = Quaternion.Euler(pitch, Yaw, 0) * Vector3.back;
                float d = distance;
                RaycastHit hit;
                if (Physics.SphereCast(target, 0.3f, dir, out hit, distance, ~0, QueryTriggerInteraction.Ignore)) d = Mathf.Max(0.8f, hit.distance);
                tr.position = Vector3.Lerp(tr.position, target + dir * d, follow);
                tr.rotation = Quaternion.LookRotation(target + Vector3.up * 0.3f - tr.position);
                Pivot = playerPos;
            }
            else
            {
                mgmtDistance = Mathf.Clamp(mgmtDistance - input.Zoom * 3f, 16f, 95f);
                Vector3 pan = Quaternion.Euler(0, Yaw, 0) * new Vector3(input.Move.x, 0, input.Move.y);
                Pivot += pan * (mgmtDistance * 0.8f) * dt;
                Pivot.x = Mathf.Clamp(Pivot.x, -95, 95);
                Pivot.z = Mathf.Clamp(Pivot.z, -40, 40);
                Pivot.y = 0;
                Vector3 pos = Pivot + Quaternion.Euler(45f, Yaw, 0) * Vector3.back * mgmtDistance;
                tr.position = Vector3.Lerp(tr.position, pos, follow);
                tr.rotation = Quaternion.Euler(45f, Yaw, 0);
            }
            snap = false;
            tr.position += tr.rotation * ShakeOffset(dt);
        }
    }
}
