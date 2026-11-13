package kr.allzip.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.content.ActivityNotFoundException;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.text.InputType;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.BaseAdapter;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

import kr.allzip.core.Engine;

public class MainActivity extends Activity {

    private static final int REQ_ARCHIVE = 1, REQ_FILES = 2, REQ_FOLDER = 3, REQ_DEST = 4, REQ_CREATE = 5;

    // 로고(이음ZIP)의 노랑→주황 색감에 맞춘 색
    private static final int C_PRIMARY = 0xFFF26A00;
    private static final int C_LINK = 0xFFC24100;        // 흰 바탕 위 글자용 진한 주황
    private static final int C_PRIMARY_SOFT = 0xFFFFEFD2;
    private static final int C_YELLOW = 0xFFFFE04A;
    private static final int C_BG = 0xFFFFF7EC;
    private static final int C_TEXT = 0xFF35200F;
    private static final int C_SUB = 0xFF86695A;
    private static final int C_LINE = 0xFFF5DDBF;
    private static final int C_DANGER = 0xFFD32F2F;

    private static final String[] ARCHIVE_EXTS = {
            "zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "tbz", "tbz2", "xz", "txz", "lzma", "tlz", "z", "lz4", "sz", "br",
            "zz", "cpio", "ar", "a", "deb", "arj", "jar", "apk", "xapk", "apks", "aar", "war", "ear", "cbz", "cbr", "cb7",
            "cbt", "epub", "001"};

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private int screen; // 0 홈, 1 풀기, 2 압축, 3 풀린 파일 보기

    // ---- 풀린 파일 보기 상태
    private HashMap<String, ArrayList<Storage.Out>> brTree;
    private String brDir = "";
    private String brTitle = "";
    private String brSummary = "";
    private String brDetail;

    // ---- 풀기 상태
    private Storage.UriInput arc;
    private int charsetIdx;
    private boolean makeFolder = true;
    private char[] password;
    private TextView exSummary, exList;
    private volatile int listGen;
    private static final String[] CS_LABELS = {"자동 (권장)", "UTF-8", "한국어 (CP949)", "일본어 (Shift_JIS)", "중국어 간체 (GBK)", "중국어 번체 (Big5)", "서유럽 (CP437)"};
    private static final String[] CS_VALUES = {null, "UTF-8", "CP949", "Shift_JIS", "GBK", "Big5", "CP437"};

    // ---- 압축 상태
    private static final class Src {
        Uri uri;
        boolean folder;
        String name;
        long size;
        long mtime;
    }

    private final ArrayList<Src> sources = new ArrayList<Src>();
    private TextView coList;
    private EditText coName, coPw;
    private CheckBox coCompat;
    private View coPwBox;
    private int fmtIdx, levelIdx = 1;
    private Engine.CompressOptions pendingCo;
    private String pendingOutName;

    private static final String[] FMT_IDS = {"zip", "7z", "tar", "tar.gz", "tar.bz2", "tar.xz", "tar.lz4", "tar.lzma", "cpio",
            "gz", "bz2", "xz", "lzma", "lz4", "sz", "zz"};
    private static final String[] FMT_LABELS = {
            "ZIP (.zip) · 가장 널리 쓰임, 암호 가능",
            "7Z (.7z) · 압축률 높음",
            "TAR (.tar) · 묶기만(압축 없음)",
            "TAR.GZ (.tar.gz)",
            "TAR.BZ2 (.tar.bz2)",
            "TAR.XZ (.tar.xz) · 압축률 높음",
            "TAR.LZ4 (.tar.lz4) · 매우 빠름",
            "TAR.LZMA (.tar.lzma)",
            "CPIO (.cpio)",
            "GZIP (.gz) · 파일 1개 전용",
            "BZIP2 (.bz2) · 파일 1개 전용",
            "XZ (.xz) · 파일 1개 전용",
            "LZMA (.lzma) · 파일 1개 전용",
            "LZ4 (.lz4) · 파일 1개 전용",
            "Snappy (.sz) · 파일 1개 전용",
            "Deflate (.zz) · 파일 1개 전용"};

    private Job job;

    // ================================================================ 생명주기

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(C_BG);
        // 안드로이드 15 이상은 화면이 상태 표시줄·내비게이션 바 밑까지 그려지므로
        // 그 높이만큼 위(주황)·아래(흰색) 띠를 직접 넣어 내용이 가려지지 않게 한다.
        final LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(Color.WHITE);
        final View topStrip = new View(this);
        topStrip.setBackgroundColor(0xFFD94A00);
        final View bottomStrip = new View(this);
        bottomStrip.setBackgroundColor(Color.WHITE);
        shell.addView(topStrip, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        shell.addView(root, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        shell.addView(bottomStrip, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0));
        shell.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public android.view.WindowInsets onApplyWindowInsets(View v, android.view.WindowInsets in) {
                ViewGroup.LayoutParams t = topStrip.getLayoutParams();
                t.height = in.getSystemWindowInsetTop();
                topStrip.setLayoutParams(t);
                ViewGroup.LayoutParams b = bottomStrip.getLayoutParams();
                b.height = in.getSystemWindowInsetBottom();   // 키보드가 올라오면 그 높이도 포함된다
                bottomStrip.setLayoutParams(b);
                shell.setPadding(in.getSystemWindowInsetLeft(), 0, in.getSystemWindowInsetRight(), 0);
                return in.consumeSystemWindowInsets();
            }
        });
        setContentView(shell);
        Storage.cleanCache(this);
        showHome();
        Update.check(this);
        if (savedInstanceState == null) handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onDestroy() {
        listGen++;
        if (job != null) job.cancelled = true;
        if (arc != null && isFinishing()) arc.cleanup();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (screen == 3 && brDir.length() > 0) {
            int i = brDir.lastIndexOf('/');
            brDir = i < 0 ? "" : brDir.substring(0, i);
            showBrowser();
        } else if (screen != 0) {
            listGen++;
            showHome();
        } else {
            super.onBackPressed();
        }
    }

    private void handleIntent(Intent it) {
        if (it == null) return;
        try {
            String act = it.getAction();
            boolean incoming = Intent.ACTION_VIEW.equals(act) || Intent.ACTION_SEND.equals(act) || Intent.ACTION_SEND_MULTIPLE.equals(act);
            if (incoming && job != null) {
                toast("진행 중인 작업이 끝난 뒤 다시 시도해 주세요");
                return;
            }
            if (Intent.ACTION_VIEW.equals(act) && it.getData() != null) {
                openArchive(it.getData());
            } else if (Intent.ACTION_SEND.equals(act)) {
                Parcelable p = it.getParcelableExtra(Intent.EXTRA_STREAM);
                if (p instanceof Uri) {
                    Uri u = (Uri) p;
                    Storage.Meta m = Storage.meta(this, u);
                    if (looksLikeArchive(m.name)) {
                        openArchive(u);
                    } else {
                        sources.clear();
                        addFile(u);
                        showCompress();
                    }
                } else {
                    toast("파일을 공유해야 압축하거나 풀 수 있습니다");
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(act)) {
                ArrayList<Parcelable> ps = it.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (ps != null && !ps.isEmpty()) {
                    sources.clear();
                    for (Parcelable p : ps) if (p instanceof Uri) addFile((Uri) p);
                    showCompress();
                }
            }
        } catch (Exception e) {
            toast("파일을 열 수 없습니다");
        }
    }

    private static boolean looksLikeArchive(String name) {
        if (name == null) return false;
        String n = name.toLowerCase(Locale.ROOT);
        int d = n.lastIndexOf('.');
        if (d < 0) return false;
        String ext = n.substring(d + 1);
        for (String e : ARCHIVE_EXTS) if (e.equals(ext)) return true;
        return false;
    }

    // ================================================================ 화면 도우미

    private int dp(float v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private GradientDrawable shape(int color, float radiusDp, int strokeColor) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        if (strokeColor != 0) g.setStroke(dp(1), strokeColor);
        return g;
    }

    private TextView button(String label, boolean primary) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setGravity(Gravity.CENTER);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? Color.WHITE : C_LINK);
        b.setPadding(dp(16), dp(15), dp(16), dp(15));
        GradientDrawable bg = primary ? gradient(GradientDrawable.Orientation.LEFT_RIGHT, 0xFFF78A00, 0xFFDF4A00, 14)
                : shape(C_PRIMARY_SOFT, 14, 0);
        if (primary) b.setShadowLayer(dp(1), 0, dp(1), 0x66000000);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33000000), bg, null));
        b.setClickable(true);
        b.setFocusable(true);
        return b;
    }

    private GradientDrawable gradient(GradientDrawable.Orientation o, int from, int to, float radiusDp) {
        GradientDrawable g = new GradientDrawable(o, new int[]{from, to});
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    /** 제목 줄 배경: 로고와 같은 주황 그라데이션 */
    private GradientDrawable barBg() {
        return new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{0xFFF58A00, 0xFFE25000});
    }

    /** 홈 화면 맨 위: 로고 + 앱 이름 */
    private View hero() {
        LinearLayout h = new LinearLayout(this);
        h.setOrientation(LinearLayout.HORIZONTAL);
        h.setGravity(Gravity.CENTER_VERTICAL);
        h.setPadding(dp(20), dp(22), dp(20), dp(26));
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFFFFB31A, 0xFFF47A00, 0xFFDC4A02});
        float r = dp(26);
        g.setCornerRadii(new float[]{0, 0, 0, 0, r, r, r, r});
        h.setBackground(g);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setElevation(dp(6));
        h.addView(logo, new LinearLayout.LayoutParams(dp(84), dp(84)));
        LinearLayout tx = column();
        tx.setPadding(dp(16), 0, 0, 0);
        LinearLayout nameRow = new LinearLayout(this);
        nameRow.setOrientation(LinearLayout.HORIZONTAL);
        nameRow.setGravity(Gravity.BOTTOM);
        TextView n1 = text("이음", 30, Color.WHITE, true);
        n1.setShadowLayer(dp(2), 0, dp(2), 0x80000000);
        TextView n2 = text("ZIP", 30, C_YELLOW, true);
        n2.setTypeface(Typeface.create(Typeface.DEFAULT_BOLD, Typeface.BOLD_ITALIC));
        n2.setShadowLayer(dp(2), 0, dp(2), 0xA0000000);
        // 기울임 글꼴은 마지막 글자가 오른쪽으로 삐져나오므로 여백을 줘서 잘리지 않게 한다
        n2.setPadding(dp(2), 0, dp(12), 0);
        nameRow.addView(n1);
        nameRow.addView(n2);
        tx.addView(nameRow);
        TextView sub = text("압축 풀기와 압축하기를 한 번에", 14, Color.WHITE, false);
        sub.setShadowLayer(dp(1), 0, dp(1), 0x66000000);
        tx.addView(sub, lp(4));
        h.addView(tx, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        return h;
    }

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private LinearLayout card() {
        LinearLayout l = column();
        l.setBackground(shape(Color.WHITE, 14, C_LINE));
        l.setPadding(dp(16), dp(14), dp(16), dp(14));
        return l;
    }

    private LinearLayout.LayoutParams lp(int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(topDp);
        return p;
    }

    /** 제목 줄 + 스크롤 내용 + 아래 고정 버튼 영역으로 된 화면 틀. */
    private LinearLayout[] frame(String title, boolean back) {
        LinearLayout page = column();
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackground(barBg());
        bar.setPadding(dp(back ? 4 : 18), dp(10), dp(16), dp(10));
        if (back) {
            TextView b = text("‹", 30, Color.WHITE, false);
            b.setPadding(dp(14), 0, dp(14), dp(4));
            b.setClickable(true);
            b.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { onBackPressed(); }
            });
            bar.addView(b);
        }
        TextView t = text(title, 20, Color.WHITE, true);
        t.setShadowLayer(dp(1), 0, dp(1), 0x66000000);
        bar.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        page.addView(back ? bar : hero(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        LinearLayout body = column();
        body.setPadding(dp(16), dp(16), dp(16), dp(24));
        body.setFocusable(true);
        body.setFocusableInTouchMode(true);
        sv.addView(body, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        page.addView(sv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout bottom = column();
        bottom.setPadding(dp(16), dp(10), dp(16), dp(14));
        bottom.setBackgroundColor(Color.WHITE);
        page.addView(bottom, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.removeAllViews();
        root.addView(page, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return new LinearLayout[]{body, bottom};
    }

    private Spinner spinner(String[] items, int sel, final IntCallback cb) {
        Spinner sp = new Spinner(this);
        ArrayAdapter<String> ad = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, items);
        ad.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        sp.setAdapter(ad);
        sp.setSelection(sel, false);
        sp.setBackground(shape(0xFFFFFBF5, 10, C_LINE));
        sp.setPadding(dp(6), dp(6), dp(6), dp(6));
        sp.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { cb.on(position); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        return sp;
    }

    private interface IntCallback {
        void on(int v);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }

    private void alert(String title, String msg) {
        if (isFinishing() || isDestroyed()) return;
        try {
            new AlertDialog.Builder(this).setTitle(title).setMessage(msg).setPositiveButton("확인", null).show();
        } catch (Exception ignored) {
        }
    }

    static String fmtSize(long n) {
        if (n < 0) return "크기 모름";
        if (n < 1024) return n + " B";
        double v = n;
        String[] u = {"KB", "MB", "GB", "TB"};
        int i = -1;
        do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
        return String.format(Locale.US, v >= 100 ? "%.0f %s" : "%.1f %s", v, u[i]);
    }

    static String errText(Throwable t) {
        if (t instanceof OutOfMemoryError) return "메모리가 부족합니다";
        String m = t.getMessage();
        if (t instanceof Engine.PasswordException || t instanceof Engine.UnsupportedException) return m;
        String s = m == null ? "" : m;
        if (t instanceof java.io.EOFException || s.contains("Truncated") || s.contains("Unexpected end") || s.contains("unexpected end")
                || s.contains("Premature end") || s.contains("truncated"))
            return "압축 파일이 손상되었거나 끝까지 받아지지 않았습니다";
        if (s.contains("ENOSPC") || s.contains("No space left")) return "저장 공간이 부족합니다";
        if (s.contains("CRC") || s.contains("Checksum") || s.contains("checksum")) return "파일이 손상되었습니다 (검사합 오류)";
        if (s.length() == 0) return "알 수 없는 오류 (" + t.getClass().getSimpleName() + ")";
        return s;
    }

    private void pick(Intent it, int req) {
        try {
            startActivityForResult(it, req);
        } catch (Exception e) {
            alert("오류", "이 기기에서 파일 선택 화면을 열 수 없습니다.");
        }
    }

    // ================================================================ 홈

    private void showHome() {
        screen = 0;
        LinearLayout[] f = frame("이음ZIP", false);
        LinearLayout body = f[0];
        f[1].setVisibility(View.GONE);

        body.addView(bigButton("📂  압축 풀기", "ZIP · 7Z · RAR · TAR · GZ 등 압축 파일 선택", true, new View.OnClickListener() {
            @Override public void onClick(View v) { pickArchive(); }
        }));
        body.addView(bigButton("🗜  파일 압축하기", "여러 파일을 골라 하나로 압축", false, new View.OnClickListener() {
            @Override public void onClick(View v) {
                sources.clear();
                showCompress();
                pickFiles();
            }
        }), lp(12));
        body.addView(bigButton("📁  폴더 압축하기", "폴더를 통째로 압축", false, new View.OnClickListener() {
            @Override public void onClick(View v) {
                sources.clear();
                showCompress();
                pickFolder();
            }
        }), lp(12));

        LinearLayout c = card();
        c.addView(text("풀 수 있는 형식", 15, C_TEXT, true));
        TextView t1 = text("ZIP, 7Z, RAR(RAR4·RAR5), TAR, GZ, TGZ, BZ2, TBZ2, XZ, TXZ, LZMA, Z, LZ4, Snappy(SZ), Brotli(BR), "
                + "Deflate(ZZ), CPIO, AR, DEB, ARJ, DUMP\n"
                + "ZIP 계열: JAR, APK, XAPK, AAR, WAR, EPUB, CBZ, DOCX·XLSX·PPTX·HWPX 등\n"
                + "암호 걸린 ZIP(AES·ZipCrypto) · 7Z · RAR, 한글 파일 이름 깨짐 자동 보정", 14, C_SUB, false);
        t1.setLineSpacing(dp(3), 1f);
        c.addView(t1, lp(6));
        c.addView(text("만들 수 있는 형식", 15, C_TEXT, true), lp(14));
        TextView t2 = text("ZIP(암호 가능), 7Z, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, TAR.LZ4, TAR.LZMA, CPIO\n"
                + "파일 1개 전용: GZ, BZ2, XZ, LZMA, LZ4, SZ, ZZ", 14, C_SUB, false);
        t2.setLineSpacing(dp(3), 1f);
        c.addView(t2, lp(6));
        body.addView(c, lp(20));

        TextView note = text("분할 압축(여러 권)과 Zstandard(.zst)는 아직 지원하지 않습니다.", 12, C_SUB, false);
        body.addView(note, lp(12));

        // 자체 배너광고 자리 (서버에 배너가 없으면 표시되지 않음)
        body.addView(Ads.slot(this, "home"), lp(16));
    }

    private View bigButton(String title, String sub, boolean primary, View.OnClickListener l) {
        LinearLayout b = column();
        b.setPadding(dp(18), dp(18), dp(18), dp(18));
        GradientDrawable bg = primary ? gradient(GradientDrawable.Orientation.TL_BR, 0xFFF98F00, 0xFFDC4700, 18)
                : shape(Color.WHITE, 18, C_LINE);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22000000), bg, null));
        b.setElevation(dp(primary ? 4 : 1));
        TextView tt = text(title, 19, primary ? Color.WHITE : C_TEXT, true);
        if (primary) tt.setShadowLayer(dp(1), 0, dp(1), 0x66000000);
        b.addView(tt);
        TextView s = text(sub, 13, primary ? 0xFFFFF3D6 : C_SUB, false);
        b.addView(s, lp(4));
        b.setClickable(true);
        b.setFocusable(true);
        b.setOnClickListener(l);
        return b;
    }

    private void pickArchive() {
        Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("*/*");
        pick(it, REQ_ARCHIVE);
    }

    private void pickFiles() {
        Intent it = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("*/*");
        it.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        pick(it, REQ_FILES);
    }

    private void pickFolder() {
        pick(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQ_FOLDER);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null) {
            if (req == REQ_CREATE) pendingCo = null;
            return;
        }
        if ((req == REQ_DEST && arc == null) || (req == REQ_CREATE && pendingCo == null)) {
            // 선택 화면에 있는 동안 앱이 다시 시작된 경우
            if (req == REQ_CREATE && data.getData() != null) {
                try { DocumentsContract.deleteDocument(getContentResolver(), data.getData()); } catch (Exception ignored) { }
            }
            toast("앱이 다시 시작되어 작업을 이어갈 수 없습니다. 처음부터 다시 해 주세요");
            return;
        }
        try {
            if (req == REQ_ARCHIVE) {
                if (data.getData() != null) openArchive(data.getData());
            } else if (req == REQ_FILES) {
                ClipData cd = data.getClipData();
                if (cd != null) {
                    for (int i = 0; i < cd.getItemCount(); i++) {
                        Uri u = cd.getItemAt(i).getUri();
                        if (u != null) addFile(u);
                    }
                } else if (data.getData() != null) {
                    addFile(data.getData());
                }
                if (screen != 2) showCompress(); else refreshSources();
            } else if (req == REQ_FOLDER) {
                Uri tree = data.getData();
                if (tree != null) {
                    Src s = new Src();
                    s.uri = tree;
                    s.folder = true;
                    s.name = Storage.treeName(this, tree);
                    sources.add(s);
                }
                if (screen != 2) showCompress(); else refreshSources();
            } else if (req == REQ_DEST) {
                if (data.getData() != null && arc != null) startExtract(data.getData(), null);
            } else if (req == REQ_CREATE) {
                if (data.getData() != null && pendingCo != null) startCompress(data.getData());
            }
        } catch (Exception e) {
            alert("오류", errText(e));
        }
    }

    // ================================================================ 압축 풀기

    private void openArchive(Uri u) {
        listGen++;
        if (arc != null) arc.cleanup();
        Storage.Meta m = Storage.meta(this, u);
        arc = new Storage.UriInput(this, u, m.name, m.size);
        password = null;
        charsetIdx = 0;
        showExtract();
    }

    private void showExtract() {
        screen = 1;
        LinearLayout[] f = frame("압축 풀기", true);
        LinearLayout body = f[0];

        LinearLayout info = card();
        TextView nm = text(arc.name, 17, C_TEXT, true);
        info.addView(nm);
        exSummary = text(fmtSize(arc.size), 14, C_SUB, false);
        info.addView(exSummary, lp(4));
        body.addView(info);

        LinearLayout opt = card();
        CheckBox cb = new CheckBox(this);
        cb.setText("압축 파일 이름으로 새 폴더를 만들어 풀기");
        cb.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        cb.setTextColor(C_TEXT);
        cb.setChecked(makeFolder);
        cb.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override public void onCheckedChanged(CompoundButton b, boolean on) { makeFolder = on; }
        });
        opt.addView(cb);
        opt.addView(text("파일 이름 글자 인코딩 (이름이 깨져 보일 때만 바꾸세요)", 13, C_SUB, false), lp(10));
        opt.addView(spinner(CS_LABELS, charsetIdx, new IntCallback() {
            @Override public void on(int v) {
                if (v == charsetIdx) return;
                charsetIdx = v;
                startListing();
            }
        }), lp(6));
        body.addView(opt, lp(12));

        LinearLayout lc = card();
        lc.addView(text("들어 있는 파일", 15, C_TEXT, true));
        exList = text("목록을 읽는 중…", 13, C_SUB, false);
        exList.setLineSpacing(dp(3), 1f);
        lc.addView(exList, lp(8));
        body.addView(lc, lp(12));

        TextView other = text("다른 압축 파일 선택 ›", 14, C_LINK, true);
        other.setPadding(0, dp(10), dp(10), dp(2));
        other.setClickable(true);
        other.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pickArchive(); }
        });
        info.addView(other);

        View.OnClickListener choose = new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (job != null) return;
                toast("압축을 풀 폴더를 고른 뒤 ‘이 폴더 사용’을 누르세요");
                pick(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQ_DEST);
            }
        };
        if (Storage.canUseDownloads()) {
            TextView go = button("압축 풀기", true);
            go.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { startExtract(null, null); }
            });
            f[1].addView(go);
            TextView where = text("‘다운로드 › " + Storage.APP_DIR + "’ 폴더에 풀립니다", 12, C_SUB, false);
            where.setGravity(Gravity.CENTER);
            f[1].addView(where, lp(4));
            TextView go2 = button("다른 폴더에 풀기…", false);
            go2.setOnClickListener(choose);
            f[1].addView(go2, lp(8));
        } else {
            TextView go = button("풀 위치 선택하고 압축 풀기", true);
            go.setOnClickListener(choose);
            f[1].addView(go);
        }

        startListing();
    }

    private Engine.Options options() {
        Engine.Options o = new Engine.Options();
        o.password = password;
        o.charset = CS_VALUES[charsetIdx];
        return o;
    }

    private void startListing() {
        final int gen = ++listGen;
        final Storage.UriInput in = arc;
        final Engine.Options o = options();
        final TextView listView = exList, sumView = exSummary;
        if (in == null || listView == null) return;
        listView.setText("목록을 읽는 중…");
        new Thread(new Runnable() {
            @Override public void run() {
                final ArrayList<Engine.Entry> es = new ArrayList<Engine.Entry>();
                String summary = null;
                String listText;
                try {
                    Engine.Result r = Engine.list(in, o, es, 300, new Engine.Listener() {
                        @Override public void onItem(String name) { }
                        @Override public void onProgress(long done, long total) { }
                        @Override public boolean isCancelled() { return gen != listGen; }
                    });
                    StringBuilder sb = new StringBuilder();
                    boolean enc = false;
                    for (Engine.Entry e : es) {
                        if (e.encrypted) enc = true;
                        String p = Engine.safePath(e.path);
                        if (p.length() == 0) continue;
                        sb.append(e.dir ? "📁 " : (e.encrypted ? "🔒 " : "📄 ")).append(p);
                        if (!e.dir && e.size >= 0) sb.append("  (").append(fmtSize(e.size)).append(")");
                        sb.append('\n');
                    }
                    int totalCount = r.files + r.dirs;
                    if (totalCount > es.size()) sb.append("… 외 ").append(totalCount - es.size()).append("개");
                    if (totalCount == 0) sb.append("(비어 있음)");
                    listText = sb.toString().trim();
                    summary = r.format + " · " + fmtSize(in.size) + " · 파일 " + r.files + "개"
                            + (r.dirs > 0 ? ", 폴더 " + r.dirs + "개" : "")
                            + (r.bytes > 0 ? " · 풀면 " + fmtSize(r.bytes) : "") + (enc ? " · 🔒 암호" : "");
                } catch (Engine.CancelledException ce) {
                    return;
                } catch (Engine.PasswordException pe) {
                    listText = "🔒 암호가 걸려 있어 목록을 볼 수 없습니다.\n압축을 풀 때 비밀번호를 물어봅니다.";
                } catch (Throwable t) {
                    listText = "목록을 읽을 수 없습니다: " + errText(t);
                }
                final String fs = summary, fl = listText;
                ui.post(new Runnable() {
                    @Override public void run() {
                        if (gen != listGen) return;
                        listView.setText(fl);
                        if (fs != null) sumView.setText(fs);
                    }
                });
            }
        }, "list").start();
    }

    /** reuse: 비밀번호를 다시 입력해 재시도할 때 앞서 만든 저장 위치를 그대로 쓴다. */
    private void startExtract(final Uri destTree, Storage.Recorder reuse) {
        if (arc == null) return;
        if (job != null) {
            toast("이전 작업을 정리하는 중입니다. 잠시 뒤 다시 눌러 주세요");
            return;
        }
        listGen++; // 목록 읽기 중단
        final Storage.UriInput in = arc;
        final Engine.Options o = options();
        String top0 = makeFolder ? Engine.safePath(Engine.baseName(in.name).replace('/', '_')) : null;
        final String top = top0 != null && top0.length() > 0 ? top0 : null;
        final Storage.Recorder sink = reuse != null ? reuse : new Storage.Recorder(
                destTree != null ? (Engine.Sink) new Storage.TreeSink(this, destTree, top) : new Storage.DownloadSink(this, top));
        final String destName = destTree != null ? Storage.treeName(this, destTree) : "다운로드 › " + Storage.APP_DIR;
        final long t0 = SystemClock.elapsedRealtime();
        job = new Job("압축 푸는 중") {
            Engine.Result r;
            HashMap<String, ArrayList<Storage.Out>> tree;

            @Override void work() throws Exception {
                final Job self = this;
                in.cancel = new Storage.Cancel() {
                    @Override public boolean isCancelled() { return self.cancelled; }
                };
                onItem("준비 중…");
                r = Engine.extract(in, o, sink, this);
                tree = sink.tree();
            }

            @Override void finished(Throwable err) {
                if (err instanceof Engine.PasswordException) {
                    askPassword(((Engine.PasswordException) err).wrong, destTree, sink);
                    return;
                }
                if (err instanceof Engine.CancelledException) {
                    toast("취소했습니다. 이미 풀린 파일은 남아 있습니다.");
                    return;
                }
                if (err != null) {
                    alert("압축을 풀지 못했습니다", errText(err));
                    return;
                }
                // 완료되면 풀린 폴더 화면으로 바로 이동
                String topName = sink.topName();
                StringBuilder sb = new StringBuilder();
                sb.append("파일 ").append(r.files).append("개");
                if (r.dirs > 0) sb.append(", 폴더 ").append(r.dirs).append("개");
                sb.append(" · ").append(fmtSize(r.bytes));
                sb.append(String.format(Locale.US, " · %.1f초", (SystemClock.elapsedRealtime() - t0) / 1000.0));
                sb.append("\n저장 위치: ").append(destName);
                if (topName != null) sb.append(" › ").append(topName);
                brSummary = sb.toString();
                brDetail = null;
                if (!r.skipped.isEmpty()) {
                    StringBuilder sk = new StringBuilder();
                    for (int i = 0; i < r.skipped.size() && i < 30; i++) sk.append("· ").append(r.skipped.get(i)).append('\n');
                    if (r.skipped.size() > 30) sk.append("…");
                    brDetail = sk.toString().trim();
                    brSummary += "\n⚠ 풀지 못한 항목 " + r.skipped.size() + "개 (눌러서 보기)";
                }
                brTree = tree;
                brDir = "";
                brTitle = topName != null ? topName : Engine.baseName(in.name);
                // 최상위에 폴더 하나만 있으면 그 안으로 바로 들어간다
                ArrayList<Storage.Out> rootList = brTree.get("");
                if (rootList != null && rootList.size() == 1 && rootList.get(0).dir) brDir = rootList.get(0).path;
                showBrowser();
                toast("압축 풀기 완료 · 파일 " + r.files + "개");
            }
        };
        job.start();
    }

    private void askPassword(boolean wrong, final Uri destTree, final Storage.Recorder sink) {
        if (isFinishing() || isDestroyed()) return;
        final EditText et = new EditText(this);
        et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        et.setHint("비밀번호");
        et.setSingleLine(true);
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(dp(20), dp(8), dp(20), 0);
        wrap.addView(et);
        AlertDialog d = new AlertDialog.Builder(this)
                .setTitle(wrong ? "비밀번호가 틀렸습니다" : "비밀번호가 필요합니다")
                .setMessage(wrong ? "다시 입력해 주세요." : "이 압축 파일은 암호가 걸려 있습니다.")
                .setView(wrap)
                .setNegativeButton("취소", null)
                .setPositiveButton("확인", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dialog, int which) {
                        String s = et.getText().toString();
                        if (s.length() == 0) {
                            toast("비밀번호를 입력하지 않았습니다");
                            return;
                        }
                        password = s.toCharArray();
                        startExtract(destTree, sink);
                    }
                }).create();
        if (d.getWindow() != null) d.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        d.show();
        et.requestFocus();
    }

    // ================================================================ 풀린 파일 보기

    private void showBrowser() {
        if (brTree == null) {
            showHome();
            return;
        }
        screen = 3;
        final ArrayList<Storage.Out> items = brTree.get(brDir) != null ? brTree.get(brDir) : new ArrayList<Storage.Out>();

        LinearLayout page = column();
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackground(barBg());
        bar.setPadding(dp(4), dp(10), dp(16), dp(10));
        TextView back = text("‹", 30, Color.WHITE, false);
        back.setPadding(dp(14), 0, dp(14), dp(4));
        back.setClickable(true);
        back.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { onBackPressed(); }
        });
        bar.addView(back);
        TextView title = text("풀린 파일", 20, Color.WHITE, true);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView home = text("처음으로", 14, Color.WHITE, true);
        home.setPadding(dp(10), dp(6), dp(4), dp(6));
        home.setClickable(true);
        home.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showHome(); }
        });
        bar.addView(home);
        page.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout head = column();
        head.setBackgroundColor(Color.WHITE);
        head.setPadding(dp(16), dp(12), dp(16), dp(12));
        TextView sum = text("✅ " + brSummary, 13, C_SUB, false);
        sum.setLineSpacing(dp(2), 1f);
        if (brDetail != null) {
            sum.setClickable(true);
            sum.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { alert("풀지 못한 항목", brDetail); }
            });
        }
        head.addView(sum);
        TextView path = text("📂 " + brTitle + (brDir.length() > 0 ? " › " + brDir.replace("/", " › ") : ""), 15, C_TEXT, true);
        head.addView(path, lp(8));
        page.addView(head, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        if (items.isEmpty()) {
            TextView empty = text("(비어 있는 폴더)", 14, C_SUB, false);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(dp(16), dp(40), dp(16), dp(40));
            page.addView(empty, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        } else {
            ListView lv = new ListView(this);
            lv.setDivider(new ColorDrawable(C_LINE));
            lv.setDividerHeight(dp(1));
            lv.setBackgroundColor(Color.WHITE);
            lv.setAdapter(new BaseAdapter() {
                @Override public int getCount() { return items.size(); }
                @Override public Object getItem(int position) { return items.get(position); }
                @Override public long getItemId(int position) { return position; }
                @Override public View getView(int position, View convertView, ViewGroup parent) {
                    LinearLayout row;
                    TextView name, size;
                    if (convertView instanceof LinearLayout) {
                        row = (LinearLayout) convertView;
                        name = (TextView) row.getChildAt(0);
                        size = (TextView) row.getChildAt(1);
                    } else {
                        row = new LinearLayout(MainActivity.this);
                        row.setOrientation(LinearLayout.HORIZONTAL);
                        row.setGravity(Gravity.CENTER_VERTICAL);
                        row.setPadding(dp(16), dp(14), dp(16), dp(14));
                        name = text("", 16, C_TEXT, false);
                        name.setSingleLine(true);
                        name.setEllipsize(TextUtils.TruncateAt.MIDDLE);
                        row.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
                        size = text("", 13, C_SUB, false);
                        size.setPadding(dp(10), 0, 0, 0);
                        row.addView(size, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                    }
                    Storage.Out o = items.get(position);
                    name.setText((o.dir ? "📁 " : "📄 ") + o.name);
                    if (o.dir) {
                        ArrayList<Storage.Out> kids = brTree.get(o.path);
                        size.setText((kids == null ? 0 : kids.size()) + "개 ›");
                    } else {
                        size.setText(fmtSize(o.size));
                    }
                    return row;
                }
            });
            lv.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                @Override public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                    if (position < 0 || position >= items.size()) return;
                    Storage.Out o = items.get(position);
                    if (o.dir) {
                        brDir = o.path;
                        showBrowser();
                    } else {
                        openOut(o);
                    }
                }
            });
            page.addView(lv, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        }

        LinearLayout bottom = column();
        bottom.setPadding(dp(16), dp(8), dp(16), dp(12));
        bottom.setBackgroundColor(Color.WHITE);
        View resultAd = Ads.slot(this, "result");
        resultAd.setPadding(0, 0, 0, dp(6));
        bottom.addView(resultAd);
        TextView hint = text("파일을 누르면 열립니다", 12, C_SUB, false);
        hint.setGravity(Gravity.CENTER);
        bottom.addView(hint);
        TextView more = button("다른 압축 파일 풀기", false);
        more.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pickArchive(); }
        });
        bottom.addView(more, lp(8));
        page.addView(bottom, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.removeAllViews();
        root.addView(page, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** 풀린 파일 열기: 압축 파일이면 이 앱에서 다시 풀고, 아니면 맞는 앱으로 연다. */
    private void openOut(final Storage.Out o) {
        if (o.uri != null) {
            openUri(o.uri, o.name);
            return;
        }
        if (o.file == null) {
            toast("이 파일은 열 수 없습니다");
            return;
        }
        // 직접 저장한 파일은 다른 앱에 넘길 주소를 미디어 저장소에서 받아 온다
        try {
            MediaScannerConnection.scanFile(getApplicationContext(), new String[]{o.file.getAbsolutePath()},
                    new String[]{Storage.mimeFor(o.name)}, new MediaScannerConnection.OnScanCompletedListener() {
                        @Override public void onScanCompleted(String path, final Uri uri) {
                            ui.post(new Runnable() {
                                @Override public void run() {
                                    if (isFinishing() || isDestroyed()) return;
                                    if (uri == null) {
                                        toast("파일을 열 수 없습니다. 파일 앱의 다운로드 › " + Storage.APP_DIR + " 폴더에서 열어 주세요");
                                        return;
                                    }
                                    o.uri = uri;
                                    openUri(uri, o.name);
                                }
                            });
                        }
                    });
        } catch (Exception e) {
            toast("파일을 열 수 없습니다");
        }
    }

    private void openUri(Uri uri, String name) {
        if (looksLikeArchive(name)) {
            if (job != null) {
                toast("진행 중인 작업이 끝난 뒤 다시 시도해 주세요");
                return;
            }
            openArchive(uri);
            return;
        }
        try {
            Intent it = new Intent(Intent.ACTION_VIEW);
            String mime = Storage.mimeFor(name);
            it.setDataAndType(uri, Storage.MIME_BIN.equals(mime) ? "*/*" : mime);
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent ch = Intent.createChooser(it, name);
            ch.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(ch);
        } catch (ActivityNotFoundException e) {
            toast("이 파일을 열 수 있는 앱이 없습니다");
        } catch (Exception e) {
            toast("파일을 열 수 없습니다");
        }
    }

    // ================================================================ 압축하기

    private void addFile(Uri u) {
        for (Src s : sources) if (!s.folder && s.uri.equals(u)) return;
        Storage.Meta m = Storage.meta(this, u);
        Src s = new Src();
        s.uri = u;
        s.name = m.name;
        s.size = m.size;
        s.mtime = m.mtime;
        sources.add(s);
    }

    private String defaultOutName() {
        if (sources.size() == 1) {
            Src s = sources.get(0);
            String n = s.folder ? s.name : Engine.stripExt(s.name);
            if (n != null && n.length() > 0) return n;
        }
        return "압축파일";
    }

    private void showCompress() {
        screen = 2;
        LinearLayout[] f = frame("압축하기", true);
        LinearLayout body = f[0];

        LinearLayout sc = card();
        sc.addView(text("압축할 대상", 15, C_TEXT, true));
        coList = text("", 13, C_SUB, false);
        coList.setLineSpacing(dp(3), 1f);
        sc.addView(coList, lp(8));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        TextView addF = button("＋ 파일", false);
        addF.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pickFiles(); }
        });
        TextView addD = button("＋ 폴더", false);
        addD.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pickFolder(); }
        });
        TextView clr = button("비우기", false);
        clr.setTextColor(C_DANGER);
        clr.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                sources.clear();
                refreshSources();
            }
        });
        LinearLayout.LayoutParams w1 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        LinearLayout.LayoutParams w2 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        w2.leftMargin = dp(8);
        LinearLayout.LayoutParams w3 = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        w3.leftMargin = dp(8);
        row.addView(addF, w1);
        row.addView(addD, w2);
        row.addView(clr, w3);
        sc.addView(row, lp(12));
        body.addView(sc);

        LinearLayout oc = card();
        oc.addView(text("압축 형식", 13, C_SUB, false));
        oc.addView(spinner(FMT_LABELS, fmtIdx, new IntCallback() {
            @Override public void on(int v) {
                fmtIdx = v;
                updatePwBox();
            }
        }), lp(6));
        oc.addView(text("압축 수준", 13, C_SUB, false), lp(12));
        oc.addView(spinner(new String[]{"빠르게", "보통 (권장)", "최대 압축 (느림)"}, levelIdx, new IntCallback() {
            @Override public void on(int v) { levelIdx = v; }
        }), lp(6));
        oc.addView(text("압축 파일 이름 (확장자는 자동으로 붙습니다)", 13, C_SUB, false), lp(12));
        coName = new EditText(this);
        coName.setSingleLine(true);
        coName.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        coName.setText(defaultOutName());
        oc.addView(coName, lp(2));

        LinearLayout pw = column();
        pw.addView(text("비밀번호 (선택 · ZIP 전용, 비워 두면 암호 없음)", 13, C_SUB, false), lp(12));
        coPw = new EditText(this);
        coPw.setSingleLine(true);
        coPw.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        coPw.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        pw.addView(coPw, lp(2));
        coCompat = new CheckBox(this);
        coCompat.setText("윈도우 탐색기에서도 열리는 옛 암호 방식 사용 (보안 약함)");
        coCompat.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        coCompat.setTextColor(C_SUB);
        pw.addView(coCompat, lp(2));
        pw.addView(text("기본은 AES-256 암호화입니다. 반디집·알집·7-Zip 등으로 풀 수 있습니다.", 12, C_SUB, false), lp(2));
        coPwBox = pw;
        oc.addView(pw);
        body.addView(oc, lp(12));

        if (Storage.canUseDownloads()) {
            TextView go = button("압축하기", true);
            go.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { onCompressClick(false); }
            });
            f[1].addView(go);
            TextView where = text("‘다운로드 › " + Storage.APP_DIR + "’ 폴더에 저장됩니다", 12, C_SUB, false);
            where.setGravity(Gravity.CENTER);
            f[1].addView(where, lp(4));
            TextView go2 = button("저장 위치 직접 선택…", false);
            go2.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { onCompressClick(true); }
            });
            f[1].addView(go2, lp(8));
        } else {
            TextView go = button("저장 위치 선택하고 압축하기", true);
            go.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { onCompressClick(true); }
            });
            f[1].addView(go);
        }

        body.addView(Ads.slot(this, "compress"), lp(12));

        updatePwBox();
        refreshSources();
    }

    private void updatePwBox() {
        if (coPwBox != null) coPwBox.setVisibility("zip".equals(FMT_IDS[fmtIdx]) ? View.VISIBLE : View.GONE);
    }

    private void refreshSources() {
        if (coList == null) return;
        if (sources.isEmpty()) {
            coList.setText("아직 고른 것이 없습니다. 아래 버튼으로 파일이나 폴더를 추가하세요.");
        } else {
            StringBuilder sb = new StringBuilder();
            long total = 0;
            int shown = 0;
            for (Src s : sources) {
                if (!s.folder && s.size > 0) total += s.size;
                if (shown < 50) {
                    sb.append(s.folder ? "📁 " : "📄 ").append(s.name);
                    if (!s.folder) sb.append("  (").append(fmtSize(s.size)).append(")");
                    sb.append('\n');
                    shown++;
                }
            }
            if (sources.size() > shown) sb.append("… 외 ").append(sources.size() - shown).append("개\n");
            sb.append("\n모두 ").append(sources.size()).append("개");
            if (total > 0) sb.append(" · 파일 합계 ").append(fmtSize(total));
            coList.setText(sb.toString());
        }
        if (coName != null) {
            String cur = coName.getText().toString();
            if (cur.length() == 0 || cur.equals("압축파일")) coName.setText(defaultOutName());
        }
    }

    private void onCompressClick(boolean choose) {
        if (job != null) {
            toast("이전 작업을 정리하는 중입니다. 잠시 뒤 다시 눌러 주세요");
            return;
        }
        if (sources.isEmpty()) {
            toast("압축할 파일이나 폴더를 먼저 추가하세요");
            return;
        }
        String fmt = FMT_IDS[fmtIdx];
        if (Engine.isSingleFormat(fmt)) {
            if (sources.size() != 1 || sources.get(0).folder) {
                alert("형식을 바꿔 주세요", "‘" + fmt.toUpperCase(Locale.ROOT) + "’ 형식은 파일 1개만 압축할 수 있습니다.\n"
                        + "여러 파일이나 폴더는 ZIP, 7Z, TAR.GZ 같은 형식을 고르세요.");
                return;
            }
        }
        Engine.CompressOptions co = new Engine.CompressOptions();
        co.format = fmt;
        co.level = levelIdx;
        co.tempDir = getCacheDir();
        if ("zip".equals(fmt) && coPw != null) {
            String p = coPw.getText().toString();
            if (p.length() > 0) {
                co.password = p.toCharArray();
                co.aes = coCompat == null || !coCompat.isChecked();
            }
        }
        String name = coName == null ? "" : coName.getText().toString().trim();
        name = Engine.safePath(name.replace('/', '_'));
        if (name.length() == 0) name = defaultOutName();
        String ext = "." + fmt;
        if (Engine.isSingleFormat(fmt)) {
            // a.txt -> a.txt.gz
            name = sources.get(0).name;
        }
        if (!name.toLowerCase(Locale.ROOT).endsWith(ext)) name = name + ext;
        pendingCo = co;
        pendingOutName = name;
        if (!choose) {
            startCompress(null);
            return;
        }
        Intent it = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        it.addCategory(Intent.CATEGORY_OPENABLE);
        it.setType("zip".equals(fmt) ? "application/zip" : Storage.MIME_BIN);
        it.putExtra(Intent.EXTRA_TITLE, name);
        pick(it, REQ_CREATE);
    }

    private void startCompress(final Uri outUri) {
        if (job != null) return;
        final Engine.CompressOptions co = pendingCo;
        pendingCo = null;
        if (co == null) return;
        final Storage.DownloadOut dlOut = outUri == null ? new Storage.DownloadOut(this, pendingOutName) : null;
        final ArrayList<Src> srcs = new ArrayList<Src>(sources);
        final long t0 = SystemClock.elapsedRealtime();
        job = new Job("압축하는 중") {
            Engine.Result r;

            @Override void work() throws Exception {
                onItem("파일 목록을 읽는 중…");
                final Job self = this;
                List<Engine.Item> items = new ArrayList<Engine.Item>();
                HashSet<String> used = new HashSet<String>();
                for (Src s : srcs) {
                    String nm = Engine.safePath(s.name.replace('/', '_'));
                    if (nm.length() == 0) nm = "이름없음";
                    String base = nm;
                    int k = 2;
                    while (!used.add(nm.toLowerCase(Locale.ROOT))) {
                        int dot = base.lastIndexOf('.');
                        nm = (dot > 0 && !s.folder) ? base.substring(0, dot) + " (" + k + ")" + base.substring(dot) : base + " (" + k + ")";
                        k++;
                    }
                    if (s.folder) {
                        Storage.collectTree(MainActivity.this, s.uri, nm, items, new Storage.Cancel() {
                            @Override public boolean isCancelled() { return self.cancelled; }
                        });
                    } else {
                        items.add(new Storage.UriItem(getContentResolver(), s.uri, nm, false, s.size, s.mtime));
                    }
                }
                boolean anyFile = false;
                for (Engine.Item it : items) if (!it.isDir()) { anyFile = true; break; }
                if (!anyFile && Engine.isSingleFormat(co.format)) throw new java.io.IOException("압축할 파일이 없습니다");
                OutputStream os;
                if (outUri != null) {
                    os = getContentResolver().openOutputStream(outUri, "wt");
                    if (os == null) throw new java.io.IOException("저장할 파일을 열 수 없습니다");
                } else {
                    os = dlOut.open();
                }
                r = Engine.compress(items, co, os, this);
            }

            @Override void finished(Throwable err) {
                if (err != null) {
                    if (outUri != null) {
                        try { DocumentsContract.deleteDocument(getContentResolver(), outUri); } catch (Exception ignored) { }
                    } else {
                        dlOut.delete();
                    }
                    if (err instanceof Engine.CancelledException) toast("취소했습니다");
                    else alert("압축하지 못했습니다", errText(err));
                    return;
                }
                Storage.Meta m;
                if (outUri != null) {
                    m = Storage.meta(MainActivity.this, outUri);
                } else {
                    m = new Storage.Meta();
                    m.size = dlOut.size(MainActivity.this);
                    m.name = dlOut.name;
                }
                StringBuilder sb = new StringBuilder();
                sb.append(m.name).append("\n");
                if (outUri == null) sb.append("위치: 다운로드 › ").append(Storage.APP_DIR).append("\n");
                sb.append("\n");
                sb.append("파일 ").append(r.files).append("개");
                if (r.dirs > 0) sb.append(", 폴더 ").append(r.dirs).append("개");
                sb.append("\n원본 ").append(fmtSize(r.bytes));
                if (m.size > 0) {
                    sb.append(" → 압축 ").append(fmtSize(m.size));
                    if (r.bytes > 0) sb.append(String.format(Locale.US, " (%.0f%%)", 100.0 * m.size / r.bytes));
                }
                sb.append("\n걸린 시간: ").append(String.format(Locale.US, "%.1f초", (SystemClock.elapsedRealtime() - t0) / 1000.0));
                alert("압축 완료", sb.toString());
            }
        };
        job.start();
    }

    // ================================================================ 작업(진행 표시)

    private abstract class Job implements Engine.Listener, Runnable {
        final String title;
        volatile boolean cancelled;
        private volatile String item = "";
        private volatile long done, total;
        private volatile long lastPost;
        private AlertDialog dlg;
        private ProgressBar bar;
        private TextView tItem, tPct;

        Job(String title) {
            this.title = title;
        }

        abstract void work() throws Exception;

        /** 화면 스레드에서 호출. err 가 null 이면 성공. */
        abstract void finished(Throwable err);

        void start() {
            LinearLayout v = column();
            v.setPadding(dp(22), dp(10), dp(22), dp(4));
            tItem = text("준비 중…", 14, C_TEXT, false);
            tItem.setSingleLine(true);
            tItem.setEllipsize(TextUtils.TruncateAt.MIDDLE);
            v.addView(tItem);
            bar = new ProgressBar(MainActivity.this, null, android.R.attr.progressBarStyleHorizontal);
            bar.setMax(1000);
            bar.setIndeterminate(true);
            v.addView(bar, lp(10));
            tPct = text("", 13, C_SUB, false);
            v.addView(tPct, lp(6));
            dlg = new AlertDialog.Builder(MainActivity.this).setTitle(title).setView(v).setCancelable(false)
                    .setNegativeButton("취소", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int w) { cancelled = true; }
                    }).create();
            try {
                dlg.show();
            } catch (Exception ignored) {
            }
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            new Thread(this, "job").start();
        }

        @Override public void run() {
            Throwable err = null;
            try {
                work();
            } catch (Throwable t) {
                err = cancelled ? new Engine.CancelledException() : t;
            }
            final Throwable fe = err;
            ui.post(new Runnable() {
                @Override public void run() {
                    job = null;
                    try { getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); } catch (Exception ignored) { }
                    try { if (dlg != null && dlg.isShowing()) dlg.dismiss(); } catch (Exception ignored) { }
                    if (isFinishing() || isDestroyed()) return;
                    try {
                        finished(fe);
                    } catch (Exception e) {
                        alert("오류", errText(e));
                    }
                }
            });
        }

        private final Runnable update = new Runnable() {
            @Override public void run() {
                if (dlg == null || !dlg.isShowing()) return;
                tItem.setText(item);
                long d = done, t = total;
                if (t > 0) {
                    if (d > t) d = t;
                    bar.setIndeterminate(false);
                    bar.setProgress((int) (d * 1000 / t));
                    tPct.setText(String.format(Locale.US, "%d%%  ·  %s / %s", d * 100 / t, fmtSize(d), fmtSize(t)));
                } else {
                    bar.setIndeterminate(true);
                    tPct.setText(d > 0 ? fmtSize(d) : "");
                }
            }
        };

        private void post() {
            long now = SystemClock.uptimeMillis();
            if (now - lastPost < 100) return;
            lastPost = now;
            ui.post(update);
        }

        @Override public void onItem(String name) {
            item = name == null ? "" : name;
            post();
        }

        @Override public void onProgress(long d, long t) {
            done = d;
            total = t;
            post();
        }

        @Override public boolean isCancelled() {
            return cancelled;
        }
    }
}
