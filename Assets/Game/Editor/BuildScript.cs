using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RebuildCity.EditorTools
{
    /// <summary>
    /// 에디터 자동화. 빈 씬과 공용 재질을 만들고 Android·Windows·Linux 빌드를 수행한다.
    /// GitHub Actions(GameCI)에서 -executeMethod 로 호출한다.
    /// </summary>
    public static class BuildScript
    {
        const string ScenePath = "Assets/Scenes/Main.unity";

        [MenuItem("RebuildCity/프로젝트 준비 (씬·재질 생성)")]
        public static void Prepare()
        {
            Directory.CreateDirectory("Assets/Scenes");
            Directory.CreateDirectory("Assets/Resources");
            AssetDatabase.Refresh();

            // 실행 중 코드로 쓰는 재질. Resources에 두어야 빌드에 셰이더가 포함된다.
            MakeMaterial("RC_Lit", "RebuildCity/Lit");
            MakeMaterial("RC_Unlit", "RebuildCity/Unlit");
            MakeMaterial("RC_Fade", "RebuildCity/Fade");
            MakeMaterial("RC_Sky", "Skybox/Procedural");

            if (!File.Exists(ScenePath))
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, ScenePath);
            }
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            PlayerSettings.companyName = "EumSoft";
            PlayerSettings.productName = "Rebuild City";
            PlayerSettings.bundleVersion = "0.2.0";
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.runInBackground = true;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "kr.eumsoft.rebuildcity");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            AssetDatabase.SaveAssets();
        }

        static void MakeMaterial(string name, string shaderName)
        {
            string path = "Assets/Resources/" + name + ".mat";
            if (AssetDatabase.LoadAssetAtPath<Material>(path) != null) return;
            var shader = Shader.Find(shaderName);
            if (shader == null) throw new Exception("셰이더를 찾지 못했습니다: " + shaderName);
            var material = new Material(shader);
            AssetDatabase.CreateAsset(material, path);
        }

        public static void BuildAndroid() { Build(BuildTarget.Android, "build/Android/RebuildCity.apk"); }
        public static void BuildWindows() { Build(BuildTarget.StandaloneWindows64, "build/StandaloneWindows64/RebuildCity.exe"); }
        public static void BuildLinux() { Build(BuildTarget.StandaloneLinux64, "build/StandaloneLinux64/RebuildCity"); }

        static void Build(BuildTarget target, string defaultPath)
        {
            Prepare();
            string path = Arg("-customBuildPath") ?? defaultPath;
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = path,
                target = target,
                options = BuildOptions.None
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
            {
                Debug.LogError("빌드 실패: " + report.summary.result + ", 오류 " + report.summary.totalErrors + "건");
                if (Application.isBatchMode) EditorApplication.Exit(1);
                return;
            }
            Debug.Log("빌드 성공: " + path + " (" + report.summary.totalSize + " bytes)");
        }

        static string Arg(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == name) return args[i + 1];
            return null;
        }
    }
}
