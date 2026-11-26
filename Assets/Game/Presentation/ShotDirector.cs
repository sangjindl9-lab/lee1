using System;
using System.Collections;
using System.IO;
using RebuildCity.Sim;
using UnityEngine;

namespace RebuildCity.Presentation
{
    /// <summary>
    /// 자동 촬영. "-rcshots 폴더" 인자로 실행하면 게임을 처음부터 준공까지 스스로 진행하면서
    /// 장면마다 화면을 저장하고 끝낸다. 빌드가 실제로 실행되는지, 화면이 어떻게 보이는지 확인하는 용도다.
    /// </summary>
    public sealed class ShotDirector : MonoBehaviour
    {
        GameController g;
        string dir;
        int index;

        public void Begin(GameController controller, string directory)
        {
            g = controller;
            dir = directory;
            Directory.CreateDirectory(dir);
            g.Scripted = true;
            Time.captureFramerate = 30;
            StartCoroutine(Guarded());
        }

        IEnumerator Guarded()
        {
            yield return Run();
            Debug.Log("[shots] 완료: " + index + "장");
            Application.Quit(0);
        }

        IEnumerator Shot(string name)
        {
            yield return null;
            yield return new WaitForEndOfFrame();
            string path = Path.Combine(dir, index.ToString("00") + "_" + name + ".png");
            ScreenCapture.CaptureScreenshot(path);
            Debug.Log("[shots] " + path);
            index++;
            yield return null;
            yield return null;
        }

        IEnumerator Frames(int count, int stepsPerFrame)
        {
            for (int i = 0; i < count; i++)
            {
                for (int s = 0; s < stepsPerFrame; s++) g.Sim.Step();
                yield return null;
            }
        }

        IEnumerator Advance(Func<bool> until, int maxTicks, int perFrame)
        {
            int done = 0;
            while (!until() && done < maxTicks)
            {
                for (int s = 0; s < perFrame && !until(); s++) { g.Sim.Step(); done++; }
                yield return null;
            }
        }

        IEnumerator Run()
        {
            for (int i = 0; i < 50; i++) yield return null;
            yield return Shot("menu");

            g.NewGame(3);
            var sim = g.Sim;
            var w = sim.World;
            g.Speed = 5;
            yield return Frames(25, 1);
            yield return Shot("start");

            yield return Advance(() => w.Alert, 300, 2);
            yield return Frames(20, 0);
            yield return Shot("warning");

            yield return Advance(() => w.DisasterActive, 300, 2);
            long mid = (w.Disaster.StartTick + w.Disaster.EndTick) / 2;
            double tx, tz;
            DisasterSystem.Position(w.Disaster, mid, out tx, out tz);
            bool east = w.Disaster.Path[0] < 0;
            g.TeleportPlayer(tx + (east ? -34 : 34), 2.5, east ? 82 : -82);
            yield return Advance(() => w.Tick >= mid - 5, 300, 1);
            yield return Frames(6, 1);
            yield return Shot("tornado");
            g.Management = true;
            g.Rig.Pivot = new Vector3((float)tx, 0, 0);
            yield return Frames(8, 0);
            yield return Shot("tornado_top");
            g.Management = false;

            yield return Advance(() => w.Disaster.Finished, 600, 4);
            Building target = null;
            foreach (var b in w.Buildings)
                if (target == null || b.Find(PartType.Roof, 0).Hp < target.Find(PartType.Roof, 0).Hp) target = b;
            float yaw = target.Side == 1 ? 14f : 194f;
            g.TeleportPlayer(target.X - target.Side * 2.2, target.Z - target.Side * 8.4, yaw);
            yield return Frames(25, 0);
            yield return Shot("damage");

            g.Interact();
            yield return Frames(10, 0);
            yield return Shot("survey");

            Result r = Result.Fail("x", "x");
            for (int tier = 1; tier >= 0 && !r.Ok; tier--) r = sim.SignContract(target.Id, 1, tier);
            Debug.Log("[shots] 계약: " + r);
            yield return Frames(10, 0);
            yield return Shot("contract");

            Debug.Log("[shots] 발주: " + sim.OrderShortage(target.Id));
            g.SelectedBuilding = -1;
            yield return Advance(() => w.Truck.State == TruckState.Unloading, 900, 3);
            yield return Frames(12, 0);
            yield return Shot("delivery");

            var c = w.ContractById(target.ContractId);
            Func<bool> roofing = () =>
            {
                foreach (int id in c.OrderIds) { var o = w.OrderById(id); if (o != null && o.Type == WorkType.Install && o.Done > o.Total * 0.4) return true; }
                return c.State == ContractState.Completed;
            };
            yield return Advance(roofing, 6000, 30);
            g.TeleportPlayer(target.X - target.Side * 5.5, target.Z - target.Side * 9.5, target.Side == 1 ? 28f : 208f);
            yield return Frames(45, 1);
            yield return Shot("work");

            g.SelectedBuilding = target.Id;
            yield return Frames(6, 1);
            yield return Shot("work_panel");
            g.SelectedBuilding = -1;

            g.Management = true;
            g.Rig.Pivot = new Vector3((float)target.X, 0, 0);
            yield return Frames(10, 1);
            yield return Shot("manage");
            g.Management = false;

            yield return Advance(() => SimTime.Hour(w.Tick) == 20, 1600, 30);
            g.TeleportPlayer(-6, 1.5, 78);
            yield return Frames(20, 0);
            yield return Shot("night");

            int guard = 0;
            while (c.State != ContractState.Completed && guard < 20000)
            {
                for (int s = 0; s < 80 && c.State != ContractState.Completed; s++)
                {
                    sim.Step(); guard++;
                    if (guard % 240 == 0 && target.ContractId == c.Id) sim.OrderShortage(target.Id);
                }
                yield return null;
            }
            Debug.Log("[shots] 준공: " + c.State + ", 품질 " + c.Quality + ", 현금 " + w.Cash);
            yield return Advance(() => SimTime.Hour(w.Tick) == 11, 1500, 40);
            g.TeleportPlayer(target.X + target.Side * 3.0, target.Z - target.Side * 9.0, target.Side == 1 ? -16f : 164f);
            yield return Frames(25, 0);
            yield return Shot("complete");

            g.Hud.SetTab(1);
            yield return Frames(4, 0);
            yield return Shot("staff");
            g.Hud.SetTab(3);
            yield return Frames(4, 0);
            yield return Shot("ledger");
        }
    }
}
