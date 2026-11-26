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
    /// 에디터 자동화. 빈 씬과 기본 재질을 만들고 Android·Windows 빌드를 수행한다.
    /// GitHub Actions(GameCI)에서 -executeMethod 로 호출한다.
    /// </summary>
    public static class BuildScript
    {
        const string ScenePath = "Assets/Scenes/Main.unity";
        const string MaterialPath = "Assets/Resources/RC_Lit.mat";

        [MenuItem("RebuildCity/프로젝트 준비 (씬·재질 생성)")]
        public static void Prepare()
        {
            Directory.CreateDirectory("Assets/Scenes");
            Directory.CreateDirectory("Assets/Resources");
            AssetDatabase.Refresh();

            // 실행 중 코드로 만드는 재질의 바탕. Resources에 두어야 빌드에 셰이더가 포함된다.
            if (AssetDatabase.LoadAssetAtPath<Material>(MaterialPath) == null)
            {
                var shader = Shader.Find("Standard");
                if (shader == null) throw new Exception("Standard 셰이더를 찾지 못했습니다.");
                var material = new Material(shader);
                material.SetFloat("_Glossiness", 0.08f);
                material.enableInstancing = true;
                AssetDatabase.CreateAsset(material, MaterialPath);
            }

            if (!File.Exists(ScenePath))
            {
                var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorSceneManager.SaveScene(scene, ScenePath);
            }
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            PlayerSettings.companyName = "EumSoft";
            PlayerSettings.productName = "Rebuild City";
            PlayerSettings.bundleVersion = "0.1.0";
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "kr.eumsoft.rebuildcity");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            AssetDatabase.SaveAssets();
        }

        public static void BuildAndroid() { Build(BuildTarget.Android, "build/Android/RebuildCity.apk"); }
        public static void BuildWindows() { Build(BuildTarget.StandaloneWindows64, "build/StandaloneWindows64/RebuildCity.exe"); }

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
