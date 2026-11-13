package kr.allzip.app;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.webkit.MimeTypeMap;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.channels.FileChannel;
import java.nio.channels.SeekableByteChannel;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;

import kr.allzip.core.Engine;

/** 안드로이드 저장소(문서 선택기, SAF)와 엔진을 잇는 부분. */
final class Storage {

    private Storage() {}

    static final String MIME_BIN = "application/octet-stream";

    static final class Meta {
        String name;
        long size = -1;
        long mtime;
    }

    static Meta meta(Context ctx, Uri u) {
        Meta m = new Meta();
        Cursor c = null;
        try {
            c = ctx.getContentResolver().query(u, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0 && !c.isNull(i)) m.name = c.getString(i);
                i = c.getColumnIndex(OpenableColumns.SIZE);
                if (i >= 0 && !c.isNull(i)) m.size = c.getLong(i);
                i = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (i >= 0 && !c.isNull(i)) m.mtime = c.getLong(i);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) { }
        }
        if (m.name == null || m.name.length() == 0) {
            String p = u.getLastPathSegment();
            if (p != null) {
                int s = p.lastIndexOf('/');
                m.name = s >= 0 ? p.substring(s + 1) : p;
            }
            if (m.name == null || m.name.length() == 0) m.name = "파일";
        }
        return m;
    }

    // ------------------------------------------------------------ 입력(압축 파일)

    static final class UriInput implements Engine.Input {
        private final Context ctx;
        private final ContentResolver cr;
        final Uri uri;
        final String name;
        volatile long size;
        /** 작업 취소 확인용(임시 복사 중에도 멈출 수 있게). */
        volatile Cancel cancel;
        private File cache;

        UriInput(Context ctx, Uri uri, String name, long size) {
            this.ctx = ctx.getApplicationContext();
            this.cr = this.ctx.getContentResolver();
            this.uri = uri;
            this.name = name;
            this.size = size;
        }

        @Override public String name() { return name; }

        /** 크기를 모르는 곳(일부 앱의 공유 파일)은 처음 쓸 때 알아낸다. 백그라운드 스레드에서만 호출된다. */
        @Override public long size() {
            if (size < 0) {
                try {
                    SeekableByteChannel ch = openChannel();
                    try { if (size < 0) size = ch.size(); } finally { ch.close(); }
                } catch (Exception ignored) {
                }
            }
            return size;
        }

        @Override public InputStream openStream() throws IOException {
            File f;
            synchronized (this) { f = cache; }
            if (f != null) return new FileInputStream(f);
            InputStream is;
            try {
                is = cr.openInputStream(uri);
            } catch (SecurityException se) {
                throw new IOException("파일을 열 권한이 없습니다. 파일을 다시 선택해 주세요");
            }
            if (is == null) throw new IOException("파일을 열 수 없습니다");
            return is;
        }

        @Override public SeekableByteChannel openChannel() throws IOException {
            File f;
            synchronized (this) { f = cache; }
            if (f == null) {
                // 실제 파일이면 복사 없이 바로 임의 접근
                ParcelFileDescriptor pfd = null;
                try {
                    pfd = cr.openFileDescriptor(uri, "r");
                    if (pfd != null) {
                        FileInputStream fis = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
                        FileChannel ch = fis.getChannel();
                        boolean ok = false;
                        long sz = -1;
                        try {
                            sz = ch.size();
                            ch.position(0);
                            ok = sz > 0 && (size <= 0 || sz == size);
                        } catch (Exception ignored) {
                        }
                        if (ok) {
                            if (size < 0) size = sz;
                            return ch;
                        }
                        try { fis.close(); } catch (Exception ignored) { }
                        pfd = null;
                    }
                } catch (Exception ignored) {
                    if (pfd != null) try { pfd.close(); } catch (Exception ignored2) { }
                }
                f = asFile();
            }
            return new FileInputStream(f).getChannel();
        }

        /** 임의 접근이 안 되는 곳(클라우드 등)의 파일은 앱 임시 폴더로 복사해서 쓴다. */
        @Override public synchronized File asFile() throws IOException {
            if (cache != null && cache.exists()) return cache;
            File f = File.createTempFile("in_", ".tmp", ctx.getCacheDir());
            InputStream is = null;
            OutputStream os = null;
            boolean ok = false;
            try {
                is = cr.openInputStream(uri);
                if (is == null) throw new IOException("파일을 열 수 없습니다");
                os = new FileOutputStream(f);
                byte[] b = new byte[1 << 16];
                int r;
                while ((r = is.read(b)) >= 0) {
                    Cancel c = cancel;
                    if (c != null && c.isCancelled()) throw new Engine.CancelledException();
                    os.write(b, 0, r);
                }
                os.flush();
                ok = true;
            } catch (SecurityException se) {
                throw new IOException("파일을 열 권한이 없습니다. 파일을 다시 선택해 주세요");
            } finally {
                if (is != null) try { is.close(); } catch (Exception ignored) { }
                if (os != null) try { os.close(); } catch (Exception ignored) { }
                if (!ok) f.delete();
            }
            cache = f;
            if (size < 0) size = f.length();
            return f;
        }

        synchronized void cleanup() {
            if (cache != null) {
                cache.delete();
                cache = null;
            }
        }
    }

    // ------------------------------------------------------------ 출력(풀 폴더)

    static final class TreeSink implements Engine.Sink {
        private final ContentResolver cr;
        private final Uri tree;
        private final Uri rootDoc;
        private final String top;
        private Uri topDoc;
        String topName;
        private final HashMap<String, Uri> dirs = new HashMap<String, Uri>();
        private final HashSet<Uri> fresh = new HashSet<Uri>();
        /** 방금 만든 파일의 문서 주소(풀린 파일 보기용) */
        Uri lastUri;

        /** top 이 null 이 아니면 그 이름의 새 폴더를 만들어 그 안에 푼다. */
        TreeSink(Context ctx, Uri tree, String top) {
            this.cr = ctx.getContentResolver();
            this.tree = tree;
            this.rootDoc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            this.top = top;
        }

        private HashMap<String, Uri> children(Uri dirDoc, boolean dirsOnly) {
            HashMap<String, Uri> out = new HashMap<String, Uri>();
            Cursor c = null;
            try {
                Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(dirDoc));
                c = cr.query(kids, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null);
                while (c != null && c.moveToNext()) {
                    String id = c.getString(0);
                    String nm = c.getString(1);
                    String mime = c.getString(2);
                    if (nm == null || id == null) continue;
                    if (dirsOnly && !DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) continue;
                    out.put(nm, DocumentsContract.buildDocumentUriUsingTree(tree, id));
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) try { c.close(); } catch (Exception ignored) { }
            }
            return out;
        }

        private Uri create(Uri parent, String mime, String name) throws IOException {
            Uri u;
            try {
                u = DocumentsContract.createDocument(cr, parent, mime, name);
            } catch (Exception e) {
                throw new IOException("만들 수 없습니다: " + name + " (" + String.valueOf(e.getMessage()) + ")");
            }
            if (u == null) throw new IOException("만들 수 없습니다: " + name);
            return u;
        }

        private Uri base() throws IOException {
            if (top == null) return rootDoc;
            if (topDoc == null) {
                HashMap<String, Uri> all = children(rootDoc, false);
                String n = top;
                int i = 2;
                while (all.containsKey(n)) n = top + " (" + (i++) + ")";
                topDoc = create(rootDoc, DocumentsContract.Document.MIME_TYPE_DIR, n);
                topName = n;
                fresh.add(topDoc);
            }
            return topDoc;
        }

        private Uri dir(String rel) throws IOException {
            if (rel.length() == 0) return base();
            Uri u = dirs.get(rel);
            if (u != null) return u;
            int i = rel.lastIndexOf('/');
            Uri parent = dir(i < 0 ? "" : rel.substring(0, i));
            String name = i < 0 ? rel : rel.substring(i + 1);
            if (!fresh.contains(parent)) u = children(parent, true).get(name);
            if (u == null) {
                u = create(parent, DocumentsContract.Document.MIME_TYPE_DIR, name);
                fresh.add(u);
            }
            dirs.put(rel, u);
            return u;
        }

        @Override public OutputStream createFile(String path, long size) throws IOException {
            int i = path.lastIndexOf('/');
            Uri parent = dir(i < 0 ? "" : path.substring(0, i));
            String name = i < 0 ? path : path.substring(i + 1);
            Uri doc = create(parent, MIME_BIN, name);
            lastUri = doc;
            OutputStream os;
            try {
                os = cr.openOutputStream(doc);
            } catch (Exception e) {
                throw new IOException("쓸 수 없습니다: " + name);
            }
            if (os == null) throw new IOException("쓸 수 없습니다: " + name);
            return os;
        }

        @Override public void makeDir(String path) throws IOException {
            dir(path);
        }
    }

    // ------------------------------------------------------------ 다운로드/이음ZIP 폴더 (선택 화면 없이 저장)

    static final String APP_DIR = "이음ZIP";
    private static final Uri DOWNLOADS_URI = Uri.parse("content://media/external/downloads");

    /** 안드로이드 10 이상에서는 권한 없이 다운로드 폴더에 저장할 수 있다. */
    static boolean canUseDownloads() {
        return Build.VERSION.SDK_INT >= 29;
    }

    private static File appDir() {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), APP_DIR);
    }

    private static String mimeOf(String name) {
        int d = name.lastIndexOf('.');
        if (d >= 0 && d < name.length() - 1) {
            try {
                String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(d + 1).toLowerCase(java.util.Locale.ROOT));
                if (m != null) return m;
            } catch (Exception ignored) {
            }
        }
        return MIME_BIN;
    }

    private static String uniqueName(File dir, String name) {
        if (!new File(dir, name).exists()) return name;
        int d = name.lastIndexOf('.');
        String base = d > 0 ? name.substring(0, d) : name;
        String ext = d > 0 ? name.substring(d) : "";
        for (int i = 2; i < 10000; i++) {
            String n = base + " (" + i + ")" + ext;
            if (!new File(dir, n).exists()) return n;
        }
        return base + " (" + System.currentTimeMillis() + ")" + ext;
    }

    /** MediaStore 로 다운로드 폴더 아래에 파일 만들기 (relDir: "이음ZIP/하위" 형태, 앞뒤 / 없음). */
    private static Uri insertDownload(ContentResolver cr, String relDir, String name) throws IOException {
        ContentValues v = new ContentValues();
        v.put("_display_name", name);
        v.put("mime_type", mimeOf(name));
        v.put("relative_path", Environment.DIRECTORY_DOWNLOADS + "/" + relDir);
        Uri u;
        try {
            u = cr.insert(DOWNLOADS_URI, v);
        } catch (Exception e) {
            throw new IOException("다운로드 폴더에 저장할 수 없습니다: " + name + " (" + String.valueOf(e.getMessage()) + ")");
        }
        if (u == null) throw new IOException("다운로드 폴더에 저장할 수 없습니다: " + name);
        return u;
    }

    /** 다운로드/이음ZIP[/top] 아래로 푼다. */
    static final class DownloadSink implements Engine.Sink {
        private final ContentResolver cr;
        private final File baseDir;
        private final String relBase;
        private boolean useFiles;
        final String topName;
        /** 방금 만든 파일(풀린 파일 보기용): 둘 중 하나만 채워진다 */
        File lastFile;
        Uri lastUri;

        DownloadSink(Context ctx, String top) {
            cr = ctx.getContentResolver();
            File app = appDir();
            if (top != null) {
                String n = top;
                if (Build.VERSION.SDK_INT >= 30) {
                    int i = 2;
                    while (new File(app, n).exists()) n = top + " (" + (i++) + ")";
                } else {
                    // 안드로이드 10 은 기존 폴더가 있는지 알 수 없어 시각을 붙여 구분한다
                    n = top + " " + new java.text.SimpleDateFormat("MMdd-HHmmss", java.util.Locale.US).format(new java.util.Date());
                }
                topName = n;
                baseDir = new File(app, n);
                relBase = APP_DIR + "/" + n;
            } else {
                topName = null;
                baseDir = app;
                relBase = APP_DIR;
            }
            useFiles = Build.VERSION.SDK_INT >= 30;
        }

        @Override public OutputStream createFile(String path, long size) throws IOException {
            int i = path.lastIndexOf('/');
            String dirPart = i < 0 ? "" : path.substring(0, i);
            String name = i < 0 ? path : path.substring(i + 1);
            if (useFiles) {
                try {
                    File dir = dirPart.length() == 0 ? baseDir : new File(baseDir, dirPart);
                    if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("폴더를 만들 수 없습니다");
                    File f = new File(dir, uniqueName(dir, name));
                    OutputStream fos = new FileOutputStream(f);
                    lastFile = f;
                    lastUri = null;
                    return fos;
                } catch (IOException e) {
                    String m = String.valueOf(e.getMessage());
                    if (m.contains("ENOSPC") || m.contains("No space")) throw e;
                    useFiles = false; // 직접 쓰기가 막힌 기기: MediaStore 로 전환
                } catch (SecurityException e) {
                    useFiles = false;
                }
            }
            Uri u = insertDownload(cr, dirPart.length() == 0 ? relBase : relBase + "/" + dirPart, name);
            lastUri = u;
            lastFile = null;
            OutputStream os;
            try {
                os = cr.openOutputStream(u);
            } catch (Exception e) {
                throw new IOException("쓸 수 없습니다: " + name);
            }
            if (os == null) throw new IOException("쓸 수 없습니다: " + name);
            return os;
        }

        @Override public void makeDir(String path) {
            if (useFiles) {
                try { new File(baseDir, path).mkdirs(); } catch (Exception ignored) { }
            }
        }
    }

    // ------------------------------------------------------------ 풀린 파일 기록 (풀고 나서 바로 보여 주기)

    static final class Out {
        String path;
        String name;
        boolean dir;
        long size;
        Uri uri;
        File file;
    }

    /** 실제 저장은 inner 에 맡기고, 무엇이 어디에 풀렸는지 기록한다. */
    static final class Recorder implements Engine.Sink {
        final Engine.Sink inner;
        private final java.util.LinkedHashMap<String, Out> outs = new java.util.LinkedHashMap<String, Out>();

        Recorder(Engine.Sink inner) {
            this.inner = inner;
        }

        String topName() {
            if (inner instanceof TreeSink) return ((TreeSink) inner).topName;
            if (inner instanceof DownloadSink) return ((DownloadSink) inner).topName;
            return null;
        }

        @Override public OutputStream createFile(String path, long size) throws IOException {
            OutputStream os = inner.createFile(path, size);
            final Out o = new Out();
            o.path = path;
            if (inner instanceof TreeSink) {
                o.uri = ((TreeSink) inner).lastUri;
            } else if (inner instanceof DownloadSink) {
                o.uri = ((DownloadSink) inner).lastUri;
                o.file = ((DownloadSink) inner).lastFile;
            }
            synchronized (outs) { outs.put(path, o); }
            return new java.io.FilterOutputStream(os) {
                @Override public void write(int b) throws IOException { out.write(b); o.size++; }
                @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); o.size += len; }
            };
        }

        @Override public void makeDir(String path) throws IOException {
            inner.makeDir(path);
            Out o = new Out();
            o.path = path;
            o.dir = true;
            synchronized (outs) { if (!outs.containsKey(path)) outs.put(path, o); }
        }

        /** 폴더 경로("" = 최상위) → 그 안의 항목(폴더 먼저, 이름순) */
        HashMap<String, ArrayList<Out>> tree() {
            HashMap<String, ArrayList<Out>> t = new HashMap<String, ArrayList<Out>>();
            HashSet<String> dirsSeen = new HashSet<String>();
            t.put("", new ArrayList<Out>());
            ArrayList<Out> all;
            synchronized (outs) { all = new ArrayList<Out>(outs.values()); }
            for (Out o : all) {
                if (o.dir) addDir(t, dirsSeen, o.path);
            }
            for (Out o : all) {
                if (o.dir) continue;
                int i = o.path.lastIndexOf('/');
                String parent = i < 0 ? "" : o.path.substring(0, i);
                o.name = i < 0 ? o.path : o.path.substring(i + 1);
                addDir(t, dirsSeen, parent);
                t.get(parent).add(o);
            }
            java.util.Comparator<Out> cmp = new java.util.Comparator<Out>() {
                @Override public int compare(Out a, Out b) {
                    if (a.dir != b.dir) return a.dir ? -1 : 1;
                    return a.name.compareToIgnoreCase(b.name);
                }
            };
            for (ArrayList<Out> l : t.values()) java.util.Collections.sort(l, cmp);
            return t;
        }

        private static void addDir(HashMap<String, ArrayList<Out>> t, HashSet<String> seen, String path) {
            if (path.length() == 0 || !seen.add(path)) return;
            int i = path.lastIndexOf('/');
            String parent = i < 0 ? "" : path.substring(0, i);
            addDir(t, seen, parent);
            Out d = new Out();
            d.path = path;
            d.name = i < 0 ? path : path.substring(i + 1);
            d.dir = true;
            if (!t.containsKey(path)) t.put(path, new ArrayList<Out>());
            t.get(parent).add(d);
        }
    }

    static String mimeFor(String name) {
        return mimeOf(name);
    }

    /** 다운로드/이음ZIP 에 압축 파일 하나를 만든다. */
    static final class DownloadOut {
        private final ContentResolver cr;
        private File file;
        private Uri uri;
        String name;

        DownloadOut(Context ctx, String wanted) {
            cr = ctx.getContentResolver();
            name = wanted;
        }

        OutputStream open() throws IOException {
            if (Build.VERSION.SDK_INT >= 30) {
                try {
                    File dir = appDir();
                    if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("폴더를 만들 수 없습니다");
                    String n = uniqueName(dir, name);
                    File f = new File(dir, n);
                    OutputStream os = new FileOutputStream(f);
                    file = f;
                    name = n;
                    return os;
                } catch (IOException e) {
                    String m = String.valueOf(e.getMessage());
                    if (m.contains("ENOSPC") || m.contains("No space")) throw e;
                } catch (SecurityException ignored) {
                }
            }
            uri = insertDownload(cr, APP_DIR, name);
            OutputStream os;
            try {
                os = cr.openOutputStream(uri);
            } catch (Exception e) {
                throw new IOException("저장할 파일을 열 수 없습니다");
            }
            if (os == null) throw new IOException("저장할 파일을 열 수 없습니다");
            return os;
        }

        long size(Context ctx) {
            if (file != null) return file.length();
            if (uri != null) {
                Meta m = meta(ctx, uri);
                if (m.name != null && m.name.length() > 0) name = m.name;
                return m.size;
            }
            return -1;
        }

        void delete() {
            try {
                if (file != null) file.delete();
                else if (uri != null) cr.delete(uri, null, null);
            } catch (Exception ignored) {
            }
        }
    }

    // ------------------------------------------------------------ 압축할 항목

    static final class UriItem implements Engine.Item {
        private final ContentResolver cr;
        private final Uri uri;
        private final String path;
        private final boolean dir;
        private final long size;
        private final long mtime;

        UriItem(ContentResolver cr, Uri uri, String path, boolean dir, long size, long mtime) {
            this.cr = cr;
            this.uri = uri;
            this.path = path;
            this.dir = dir;
            this.size = size;
            this.mtime = mtime;
        }

        @Override public String path() { return path; }
        @Override public boolean isDir() { return dir; }
        @Override public long size() { return dir ? 0 : size; }
        @Override public long mtime() { return mtime; }

        @Override public InputStream open() throws IOException {
            InputStream is;
            try {
                is = cr.openInputStream(uri);
            } catch (SecurityException se) {
                throw new IOException("읽을 권한이 없습니다: " + path);
            }
            if (is == null) throw new IOException("읽을 수 없습니다: " + path);
            return is;
        }
    }

    interface Cancel {
        boolean isCancelled();
    }

    static String treeName(Context ctx, Uri tree) {
        try {
            Uri rootDoc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            Meta m = meta(ctx, rootDoc);
            if (m.name != null && m.name.length() > 0) return m.name;
        } catch (Exception ignored) {
        }
        return "폴더";
    }

    /** 폴더(트리)를 끝까지 내려가며 항목을 모은다. */
    static void collectTree(Context ctx, Uri tree, String rootName, List<Engine.Item> out, Cancel cancel) throws IOException {
        ContentResolver cr = ctx.getContentResolver();
        out.add(new UriItem(cr, null, rootName, true, 0, 0));
        walkTree(cr, tree, DocumentsContract.getTreeDocumentId(tree), rootName, out, cancel, 0);
    }

    private static void walkTree(ContentResolver cr, Uri tree, String docId, String prefix, List<Engine.Item> out,
                                 Cancel cancel, int depth) throws IOException {
        if (cancel != null && cancel.isCancelled()) throw new Engine.CancelledException();
        if (depth > 60) return;
        ArrayList<String[]> rows = new ArrayList<String[]>();
        Cursor c = null;
        try {
            Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
            c = cr.query(kids, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                    DocumentsContract.Document.COLUMN_FLAGS}, null, null, null);
            while (c != null && c.moveToNext()) {
                String id = c.getString(0);
                String nm = c.getString(1);
                if (id == null || nm == null) continue;
                int flags = c.isNull(5) ? 0 : c.getInt(5);
                if ((flags & DocumentsContract.Document.FLAG_VIRTUAL_DOCUMENT) != 0) continue;
                rows.add(new String[]{id, nm, c.getString(2),
                        c.isNull(3) ? "-1" : String.valueOf(c.getLong(3)),
                        c.isNull(4) ? "0" : String.valueOf(c.getLong(4))});
            }
        } catch (SecurityException se) {
            throw new IOException("폴더를 읽을 권한이 없습니다");
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) { }
        }
        for (String[] r : rows) {
            String path = prefix + "/" + r[1].replace('/', '_');
            boolean dir = DocumentsContract.Document.MIME_TYPE_DIR.equals(r[2]);
            long mtime = 0;
            long size = -1;
            try { size = Long.parseLong(r[3]); mtime = Long.parseLong(r[4]); } catch (Exception ignored) { }
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, r[0]);
            out.add(new UriItem(cr, doc, path, dir, size, mtime));
            if (dir) walkTree(cr, tree, r[0], path, out, cancel, depth + 1);
        }
    }

    /** 하루 넘은 임시 파일 정리. */
    static void cleanCache(Context ctx) {
        try {
            File[] fs = ctx.getCacheDir().listFiles();
            if (fs == null) return;
            long old = System.currentTimeMillis() - 24L * 3600 * 1000;
            for (File f : fs) {
                if (f.isFile() && f.getName().endsWith(".tmp") || f.getName().endsWith(".7z")) {
                    if (f.lastModified() < old) f.delete();
                }
            }
        } catch (Exception ignored) {
        }
    }
}
