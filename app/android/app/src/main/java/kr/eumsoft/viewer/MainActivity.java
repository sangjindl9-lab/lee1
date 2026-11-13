package kr.eumsoft.viewer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

public class MainActivity extends BridgeActivity {
    private static final int REQ_UPDATE = 7001;
    private AppUpdateManager updates;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EumFilesPlugin.class);
        super.onCreate(savedInstanceState);
        updates = AppUpdateManagerFactory.create(this);
    }

    /** 플레이 스토어에 새 버전이 올라와 있으면 구글의 업데이트 화면을 바로 띄운다(스토어에서 설치한 경우에만 동작). */
    @Override
    public void onResume() {
        super.onResume();
        try {
            updates.getAppUpdateInfo().addOnSuccessListener((info) -> {
                try {
                    boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                            || info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
                    if (available && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE))
                        updates.startUpdateFlowForResult(info, this, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(), REQ_UPDATE);
                } catch (Exception ignored) { }
            });
        } catch (Exception ignored) { }
    }

    /** 뒤로 가기는 앱을 바로 끄지 않고 화면(JS)에 넘긴다 — 문서 중이면 확인 창을 띄우고, 홈에서는 두 번 눌러 종료. */
    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().triggerWindowJSEvent("eumBack");
        else super.onBackPressed();
    }
}
