import { headers } from "next/headers";

/** 안드로이드 앱(WebView) 안에서 열렸는지 — MainActivity 가 UA 끝에 FamilyAlbumAndroid/버전 을 붙인다. */
export async function isAndroidApp(): Promise<boolean> {
  const h = await headers();
  return (h.get("user-agent") ?? "").includes("FamilyAlbumAndroid");
}
