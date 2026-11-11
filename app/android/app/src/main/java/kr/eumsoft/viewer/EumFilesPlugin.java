package kr.eumsoft.viewer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** 휴대폰 파일 열기·저장·인쇄·공유를 뷰어 화면(JS)에 이어 주는 플러그인. */
@CapacitorPlugin(name = "EumFiles")
public class EumFilesPlugin extends Plugin {

    private static final int RW = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private Intent pendingLaunch;

    @Override
    public void load() {
        pendingLaunch = getActivity().getIntent();
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                bridge.triggerWindowJSEvent("eumBack");
            }
        });
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        JSObject file = fileFromIntent(intent);
        if (file != null) bridge.triggerWindowJSEvent("eumLaunch", file.toString());
    }

    /** 다른 앱(파일 관리자·카카오톡 등)에서 "이음뷰어로 열기"로 넘어온 파일. 한 번만 돌려준다. */
    @PluginMethod
    public void getLaunch(PluginCall call) {
        JSObject file = fileFromIntent(pendingLaunch);
        pendingLaunch = null;
        call.resolve(file != null ? file : new JSObject());
    }

    /**
     * 다른 앱(카톡·파일 관리자)이 넘겨 준 주소는 그때만 열 수 있으므로, 파일을 앱 안(files/opened)에 복사해 두고
     * 그 복사본의 주소를 돌려준다 → 최근 문서에서 다시 열 수 있다. 복사에 실패하면 원래 주소를 그대로 쓴다.
     */
    private JSObject fileFromIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return null;
        Uri uri = intent.getData();
        String name = displayName(uri);
        JSObject o = new JSObject();
        o.put("name", name);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            File dir = new File(getContext().getFilesDir(), "opened");
            dir.mkdirs();
            cleanOld(dir);
            File f = new File(dir, System.currentTimeMillis() + "_" + name.replaceAll("[\\/:*?\"<>|]", "_"));
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(readAll(in)); }
            o.put("uri", Uri.fromFile(f).toString());
            o.put("copied", true);
        } catch (Exception e) {
            o.put("uri", uri.toString());
        }
        return o;
    }

    /** 30일 지난 복사본은 지운다. */
    private static void cleanOld(File dir) {
        File[] list = dir.listFiles();
        if (list == null) return;
        long limit = System.currentTimeMillis() - 30L * 24 * 3600 * 1000;
        for (File f : list) if (f.lastModified() < limit) f.delete();
    }

    @PluginMethod
    public void pickOpen(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "*/*"));
        i.addFlags(RW | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "onPicked");
    }

    @PluginMethod
    public void pickSave(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/octet-stream"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "문서.pdf"));
        i.addFlags(RW | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "onPicked");
    }

    @ActivityCallback
    private void onPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        Uri uri = data.getData();
        try {
            // 앱을 껐다 켜도 "최근 문서"에서 다시 열고 저장할 수 있게 권한을 유지한다.
            getContext().getContentResolver().takePersistableUriPermission(uri, data.getFlags() & RW);
        } catch (Exception ignored) {}
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", displayName(uri));
        call.resolve(o);
    }

    private InputStream open(Uri uri) throws Exception {
        if ("file".equals(uri.getScheme())) return new java.io.FileInputStream(new File(uri.getPath()));
        return getContext().getContentResolver().openInputStream(uri);
    }

    @PluginMethod
    public void read(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri"));
        try (InputStream in = open(uri)) {
            JSObject o = new JSObject();
            o.put("data", Base64.encodeToString(readAll(in), Base64.NO_WRAP));
            o.put("name", displayName(uri));
            call.resolve(o);
        } catch (Exception e) {
            call.reject("파일을 읽을 수 없습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        Uri uri = Uri.parse(call.getString("uri"));
        byte[] bytes = Base64.decode(call.getString("data"), Base64.DEFAULT);
        try (OutputStream out = "file".equals(uri.getScheme()) ? new FileOutputStream(new File(uri.getPath())) : getContext().getContentResolver().openOutputStream(uri, "wt")) {
            out.write(bytes);
            call.resolve();
        } catch (Exception e) {
            call.reject("파일을 저장할 수 없습니다: " + e.getMessage());
        }
    }

    /** 지금 화면(인쇄용으로 바꿔 둔 쪽들)을 안드로이드 인쇄 창으로 보낸다. 거기서 PDF 저장·프린터 선택. */
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "문서");
        getActivity().runOnUiThread(() -> {
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            pm.print(name, bridge.getWebView().createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
            call.resolve();
        });
    }

    @PluginMethod
    public void share(PluginCall call) {
        Uri src = Uri.parse(call.getString("uri"));
        String name = call.getString("name", "문서.pdf");
        try (InputStream in = open(src)) {
            File dir = new File(getContext().getCacheDir(), "share");
            dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(readAll(in));
            }
            Uri shared = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/octet-stream");
            send.putExtra(Intent.EXTRA_STREAM, shared);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, name));
            call.resolve();
        } catch (Exception e) {
            call.reject("공유할 수 없습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void exit(PluginCall call) {
        call.resolve();
        getActivity().finish();
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[65536];
        int n;
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return buf.toByteArray();
    }

    private String displayName(Uri uri) {
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
            } catch (Exception ignored) {}
        }
        String last = uri.getLastPathSegment();
        if (last == null) return "문서.pdf";
        last = Uri.decode(last);
        return last.substring(last.lastIndexOf('/') + 1);
    }
}
