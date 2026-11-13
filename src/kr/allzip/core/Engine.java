package kr.allzip.core;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;

import org.apache.commons.compress.PasswordRequiredException;
import org.apache.commons.compress.archivers.ArchiveEntry;
import org.apache.commons.compress.archivers.ArchiveInputStream;
import org.apache.commons.compress.archivers.ar.ArArchiveInputStream;
import org.apache.commons.compress.archivers.arj.ArjArchiveInputStream;
import org.apache.commons.compress.archivers.cpio.CpioArchiveEntry;
import org.apache.commons.compress.archivers.cpio.CpioArchiveInputStream;
import org.apache.commons.compress.archivers.cpio.CpioArchiveOutputStream;
import org.apache.commons.compress.archivers.cpio.CpioConstants;
import org.apache.commons.compress.archivers.dump.DumpArchiveInputStream;
import org.apache.commons.compress.archivers.sevenz.SevenZArchiveEntry;
import org.apache.commons.compress.archivers.sevenz.SevenZFile;
import org.apache.commons.compress.archivers.sevenz.SevenZMethod;
import org.apache.commons.compress.archivers.sevenz.SevenZMethodConfiguration;
import org.apache.commons.compress.archivers.sevenz.SevenZOutputFile;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.compressors.brotli.BrotliCompressorInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorOutputStream;
import org.apache.commons.compress.compressors.deflate.DeflateCompressorInputStream;
import org.apache.commons.compress.compressors.deflate.DeflateCompressorOutputStream;
import org.apache.commons.compress.compressors.deflate.DeflateParameters;
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream;
import org.apache.commons.compress.compressors.gzip.GzipParameters;
import org.apache.commons.compress.compressors.lz4.FramedLZ4CompressorInputStream;
import org.apache.commons.compress.compressors.lz4.FramedLZ4CompressorOutputStream;
import org.apache.commons.compress.compressors.snappy.FramedSnappyCompressorInputStream;
import org.apache.commons.compress.compressors.snappy.FramedSnappyCompressorOutputStream;
import org.apache.commons.compress.compressors.z.ZCompressorInputStream;
import org.tukaani.xz.LZMA2Options;
import org.tukaani.xz.LZMAInputStream;
import org.tukaani.xz.LZMAOutputStream;
import org.tukaani.xz.XZInputStream;
import org.tukaani.xz.XZOutputStream;

import com.github.junrar.Archive;
import com.github.junrar.ArchiveOptions;
import com.github.junrar.exception.CrcErrorException;
import com.github.junrar.exception.MissingNextVolumeException;
import com.github.junrar.exception.RarException;
import com.github.junrar.exception.UnsupportedRarEncryptedException;
import com.github.junrar.exception.WrongPasswordException;
import com.github.junrar.rarfile.FileHeader;
import com.github.junrar.volume.Volume;
import com.github.junrar.volume.VolumeManager;

import net.lingala.zip4j.exception.ZipException;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.model.enums.AesKeyStrength;
import net.lingala.zip4j.model.enums.CompressionLevel;
import net.lingala.zip4j.model.enums.CompressionMethod;
import net.lingala.zip4j.model.enums.EncryptionMethod;

/**
 * 압축/해제 엔진. 안드로이드 API 에 의존하지 않는 순수 자바 코드.
 */
public final class Engine {

    private Engine() {}

    // ------------------------------------------------------------------ 타입

    /** 압축 파일 입력. */
    public interface Input {
        String name();
        long size();
        /** 처음 위치에서 시작하는 새 스트림. */
        InputStream openStream() throws IOException;
        /** 임의 접근 채널(새로 연다). */
        SeekableByteChannel openChannel() throws IOException;
        /** 실제 파일이 꼭 필요할 때(암호 ZIP). 필요하면 임시 복사본을 만든다. */
        File asFile() throws IOException;
    }

    /** 풀린 파일을 받는 곳. */
    public interface Sink {
        OutputStream createFile(String path, long size) throws IOException;
        void makeDir(String path) throws IOException;
    }

    public interface Listener {
        void onItem(String name);
        void onProgress(long done, long total);
        boolean isCancelled();
    }

    /** 압축할 항목. */
    public interface Item {
        String path();
        boolean isDir();
        long size();
        long mtime();
        InputStream open() throws IOException;
    }

    public static final class Entry {
        public String path;
        public long size = -1;
        public boolean dir;
        public boolean encrypted;
    }

    public static final class Options {
        public char[] password;
        /** null 이면 자동 판별 */
        public String charset;
    }

    public static final class Result {
        public String format = "";
        public int files;
        public int dirs;
        public long bytes;
        public final List<String> skipped = new ArrayList<String>();
    }

    public static class PasswordException extends IOException {
        public final boolean wrong;
        public PasswordException(boolean wrong) {
            super(wrong ? "비밀번호가 틀렸습니다" : "비밀번호가 필요합니다");
            this.wrong = wrong;
        }
    }

    public static class CancelledException extends IOException {
        public CancelledException() { super("취소되었습니다"); }
    }

    public static class UnsupportedException extends IOException {
        public UnsupportedException(String m) { super(m); }
    }

    public enum Format {
        ZIP("ZIP"), SEVENZ("7Z"), RAR("RAR"), TAR("TAR"), AR("AR"), CPIO("CPIO"), ARJ("ARJ"), DUMP("DUMP"),
        GZ("GZIP"), BZ2("BZIP2"), XZ("XZ"), LZMA("LZMA"), Z("Z(compress)"), LZ4("LZ4"), SNAPPY("Snappy"),
        BROTLI("Brotli"), ZLIB("Deflate(zlib)"), ZSTD("Zstandard"), UNKNOWN("알 수 없음");
        public final String label;
        Format(String l) { label = l; }
        public boolean isCompressor() {
            return this == GZ || this == BZ2 || this == XZ || this == LZMA || this == Z || this == LZ4
                    || this == SNAPPY || this == BROTLI || this == ZLIB;
        }
    }

    // ------------------------------------------------------------------ 형식 판별

    private static int readFully(InputStream in, byte[] b) throws IOException {
        int n = 0;
        while (n < b.length) {
            int r = in.read(b, n, b.length - n);
            if (r < 0) break;
            n += r;
        }
        return n;
    }

    private static boolean starts(byte[] b, int n, int... sig) {
        if (n < sig.length) return false;
        for (int i = 0; i < sig.length; i++) if ((b[i] & 0xff) != sig[i]) return false;
        return true;
    }

    private static String lower(String s) { return s == null ? "" : s.toLowerCase(Locale.ROOT); }

    private static boolean looksLikeTar(byte[] b, int n) {
        if (n < 512) return false;
        if (TarArchiveInputStream.matches(b, n)) return true;
        // 매직이 없는 옛 tar: 헤더 체크섬 검사
        boolean allZero = true;
        for (int i = 0; i < 512; i++) if (b[i] != 0) { allZero = false; break; }
        if (allZero) return false;
        long stored = 0;
        boolean any = false;
        for (int i = 148; i < 156; i++) {
            int c = b[i] & 0xff;
            if (c >= '0' && c <= '7') { stored = stored * 8 + (c - '0'); any = true; }
            else if (c == ' ' || c == 0) { if (any) break; }
            else return false;
        }
        if (!any) return false;
        long sum = 0;
        for (int i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : (b[i] & 0xff);
        return sum == stored && b[0] != 0;
    }

    /** 머리 바이트와 파일 이름으로 형식 판별. */
    public static Format detect(byte[] b, int n, String name) {
        String nm = lower(name);
        if (starts(b, n, 'P', 'K', 3, 4) || starts(b, n, 'P', 'K', 5, 6) || starts(b, n, 'P', 'K', 7, 8)) return Format.ZIP;
        if (starts(b, n, '7', 'z', 0xBC, 0xAF, 0x27, 0x1C)) return Format.SEVENZ;
        if (starts(b, n, 'R', 'a', 'r', '!', 0x1A, 0x07) || starts(b, n, 'R', 'E', 0x7E, 0x5E)) return Format.RAR;
        if (starts(b, n, 0x1F, 0x8B)) return Format.GZ;
        if (starts(b, n, 'B', 'Z', 'h')) return Format.BZ2;
        if (starts(b, n, 0xFD, '7', 'z', 'X', 'Z', 0x00)) return Format.XZ;
        if (starts(b, n, 0x1F, 0x9D)) return Format.Z;
        if (starts(b, n, 0x04, 0x22, 0x4D, 0x18)) return Format.LZ4;
        if (starts(b, n, 0x28, 0xB5, 0x2F, 0xFD)) return Format.ZSTD;
        if (starts(b, n, 0xFF, 0x06, 0x00, 0x00, 's', 'N', 'a', 'P', 'p', 'Y')) return Format.SNAPPY;
        if (starts(b, n, '!', '<', 'a', 'r', 'c', 'h', '>', '\n')) return Format.AR;
        if (starts(b, n, '0', '7', '0', '7', '0', '1') || starts(b, n, '0', '7', '0', '7', '0', '2')
                || starts(b, n, '0', '7', '0', '7', '0', '7') || starts(b, n, 0xC7, 0x71) || starts(b, n, 0x71, 0xC7)) return Format.CPIO;
        if (looksLikeTar(b, n)) return Format.TAR;
        if (starts(b, n, 0x60, 0xEA) && (nm.endsWith(".arj") || n > 10 && (b[10] & 0xff) == 2)) return Format.ARJ;
        if (n >= 32 && DumpArchiveInputStream.matches(b, n)) return Format.DUMP;
        // 매직이 없는 형식은 확장자로
        if (nm.endsWith(".lzma") || nm.endsWith(".tlz")) return Format.LZMA;
        if (nm.endsWith(".br")) return Format.BROTLI;
        if (nm.endsWith(".zz") || nm.endsWith(".zlib") || nm.endsWith(".deflate")) return Format.ZLIB;
        if (nm.endsWith(".tar")) return Format.TAR;
        if (nm.endsWith(".zst") || nm.endsWith(".tzst")) return Format.ZSTD;
        // 자동 압축 풀림(SFX) exe 등: ZIP 으로 시도
        if (starts(b, n, 'M', 'Z') || nm.endsWith(".zip") || nm.endsWith(".exe")) return Format.ZIP;
        return Format.UNKNOWN;
    }

    public static Format detect(Input in) throws IOException {
        byte[] head = new byte[1024];
        int n;
        InputStream s = in.openStream();
        try { n = readFully(s, head); } finally { closeQuietly(s); }
        return detect(head, n, in.name());
    }

    // ------------------------------------------------------------------ 공통 도우미

    static void closeQuietly(java.io.Closeable c) {
        if (c != null) try { c.close(); } catch (Throwable ignored) { }
    }

    /** 경로 정리: 상위 폴더 탈출(..) 과 절대경로 제거. */
    public static String safePath(String p) {
        if (p == null) return "";
        String[] parts = p.replace('\\', '/').split("/");
        StringBuilder sb = new StringBuilder();
        for (String raw : parts) {
            String s = raw.trim();
            if (s.length() == 0 || s.equals(".") || s.equals("..")) continue;
            if (sb.length() == 0 && s.length() == 2 && s.charAt(1) == ':') continue; // C:
            StringBuilder t = new StringBuilder(s.length());
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c < 0x20 || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') t.append('_');
                else t.append(c);
            }
            if (sb.length() > 0) sb.append('/');
            sb.append(t);
        }
        return sb.toString();
    }

    public static String stripExt(String name) {
        if (name == null) return "archive";
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        String n = name.substring(slash + 1);
        int dot = n.lastIndexOf('.');
        return dot > 0 ? n.substring(0, dot) : n;
    }

    /** 압축 파일 이름에서 풀 폴더 이름 만들기 (a.tar.gz -> a). */
    public static String baseName(String name) {
        String n = stripExt(name);
        String l = lower(n);
        if (l.endsWith(".tar") || l.endsWith(".cpio")) n = stripExt(n);
        if (lower(name).matches(".*\\.part\\d+\\.rar$")) n = stripExt(n);
        return n.length() == 0 ? "archive" : n;
    }

    private static Charset charsetOrNull(String... names) {
        for (String n : names) {
            try { if (n != null && Charset.isSupported(n)) return Charset.forName(n); } catch (Exception ignored) { }
        }
        return null;
    }

    /** 한국어 윈도우 기본(CP949). 없으면 EUC-KR. */
    public static Charset koreanCharset() {
        Charset c = charsetOrNull("x-windows-949", "windows-949", "MS949", "CP949", "KSC_5601", "x-KSC5601", "EUC-KR");
        return c != null ? c : Charset.forName("UTF-8");
    }

    public static Charset resolveCharset(String name) {
        if (name == null) return null;
        if (name.equalsIgnoreCase("CP949")) return koreanCharset();
        Charset c = charsetOrNull(name);
        if (c == null && name.equalsIgnoreCase("CP437")) c = charsetOrNull("IBM437", "ISO-8859-1");
        return c;
    }

    /** gzip 머리의 원래 파일 이름은 Latin-1 로 읽히므로 UTF-8/CP949 로 다시 해석한다. */
    private static String fixGzName(String n) {
        try {
            byte[] raw = n.getBytes("ISO-8859-1");
            if (isAscii(raw)) return n;
            return new String(raw, isValidUtf8(raw) ? Charset.forName("UTF-8") : koreanCharset());
        } catch (Exception e) {
            return n;
        }
    }

    private static boolean isAscii(byte[] b) {
        for (byte x : b) if (x < 0) return false;
        return true;
    }

    private static boolean isValidUtf8(byte[] b) {
        try {
            Charset.forName("UTF-8").newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b));
            return true;
        } catch (CharacterCodingException e) {
            return false;
        }
    }

    private static final class Counting extends FilterInputStream {
        long count;
        Counting(InputStream in) { super(in); }
        @Override public int read() throws IOException { int r = in.read(); if (r >= 0) count++; return r; }
        @Override public int read(byte[] b, int o, int l) throws IOException { int r = in.read(b, o, l); if (r > 0) count += r; return r; }
        @Override public long skip(long n) throws IOException { long r = in.skip(n); if (r > 0) count += r; return r; }
        @Override public boolean markSupported() { return false; }
    }

    /** 진행 상황 추적 + 복사. */
    private static final class Ctx {
        final Listener l;
        final Result res = new Result();
        long total;          // 전체 바이트(모르면 0)
        long done;
        Counting raw;        // 스트림 형식이면 원본 읽은 양으로 진행률 계산
        final byte[] buf = new byte[1 << 16];
        Ctx(Listener l) { this.l = l; }

        void check() throws IOException { if (l != null && l.isCancelled()) throw new CancelledException(); }

        void report() {
            if (l == null) return;
            if (raw != null) l.onProgress(raw.count, total); else l.onProgress(done, total);
        }

        long copy(InputStream in, OutputStream out) throws IOException {
            long n = 0;
            int r;
            while ((r = in.read(buf)) >= 0) {
                check();
                if (r == 0) continue;
                if (out != null) out.write(buf, 0, r);
                n += r;
                done += r;
                res.bytes += r;
                report();
            }
            return n;
        }
    }

    private interface Opener { InputStream open() throws IOException; }

    /** 공유 스트림을 항목 단위로 넘길 때 닫히지 않게 감싼다. */
    private static final class NoClose extends FilterInputStream {
        NoClose(InputStream in) { super(in); }
        @Override public void close() { }
    }

    private interface Visitor {
        void visit(Entry e, Opener o) throws IOException;
    }

    // ------------------------------------------------------------------ 목록 / 풀기

    /** 압축 파일 안의 목록. max 개까지만 모은다(전체 개수는 Result.files/dirs). */
    public static Result list(Input in, Options opt, final List<Entry> outList, final int max, Listener l) throws IOException {
        final Ctx ctx = new Ctx(l);
        walk(in, opt == null ? new Options() : opt, true, ctx, new Visitor() {
            @Override public void visit(Entry e, Opener o) throws IOException {
                ctx.check();
                if (e.dir) ctx.res.dirs++; else { ctx.res.files++; if (e.size > 0) ctx.res.bytes += e.size; }
                if (outList.size() < max) outList.add(e);
                ctx.report();
            }
        });
        return ctx.res;
    }

    public static Result extract(Input in, Options opt, final Sink sink, Listener l) throws IOException {
        final Ctx ctx = new Ctx(l);
        walk(in, opt == null ? new Options() : opt, false, ctx, new Visitor() {
            @Override public void visit(Entry e, Opener o) throws IOException {
                ctx.check();
                String p = safePath(e.path);
                if (p.length() == 0) return;
                if (ctx.l != null) ctx.l.onItem(p);
                if (e.dir) {
                    sink.makeDir(p);
                    ctx.res.dirs++;
                    return;
                }
                InputStream is = o.open();
                if (is == null) { ctx.res.skipped.add(p); return; }
                OutputStream os = null;
                try {
                    os = new BufferedOutputStream(sink.createFile(p, e.size), 1 << 16);
                    ctx.copy(is, os);
                    os.flush();
                    os.close();
                    os = null;
                } finally {
                    closeQuietly(os);
                    closeQuietly(is);
                }
                ctx.res.files++;
            }
        });
        return ctx.res;
    }

    private static void walk(Input in, Options opt, boolean listOnly, Ctx ctx, Visitor v) throws IOException {
        Format f = detect(in);
        ctx.res.format = f.label;
        try {
            switch (f) {
                case ZIP: walkZip(in, opt, listOnly, ctx, v); break;
                case SEVENZ: walk7z(in, opt, listOnly, ctx, v); break;
                case RAR: walkRar(in, opt, listOnly, ctx, v); break;
                case TAR: case AR: case CPIO: case ARJ: case DUMP: {
                    ctx.total = in.size();
                    ctx.raw = new Counting(in.openStream());
                    InputStream bi = new BufferedInputStream(ctx.raw, 1 << 16);
                    try { walkStreamArchive(f, bi, opt, ctx, v); } finally { closeQuietly(bi); }
                    break;
                }
                case ZSTD:
                    throw new UnsupportedException("Zstandard(.zst) 형식은 아직 지원하지 않습니다");
                case UNKNOWN:
                    throw new UnsupportedException("지원하지 않는 형식이거나 압축 파일이 아닙니다");
                default:
                    walkCompressed(f, in, opt, ctx, v);
            }
        } catch (OutOfMemoryError oom) {
            throw new IOException("메모리가 부족합니다 (사전 크기가 너무 큰 압축 파일)");
        }
    }

    // ---- 단일 압축 스트림 (gz, bz2, xz ...) : 안에 tar/cpio 가 있으면 이어서 푼다

    private static InputStream decompressor(Format f, InputStream in) throws IOException {
        switch (f) {
            case GZ: return new GzipCompressorInputStream(in, true);
            case BZ2: return new BZip2CompressorInputStream(in, true);
            case XZ: return new XZInputStream(in);
            case LZMA: return new LZMAInputStream(in);
            case Z: return new ZCompressorInputStream(in);
            case LZ4: return new FramedLZ4CompressorInputStream(in, true);
            case SNAPPY: return new FramedSnappyCompressorInputStream(in);
            case BROTLI: return new BrotliCompressorInputStream(in);
            case ZLIB: return new DeflateCompressorInputStream(in);
            default: throw new UnsupportedException("지원하지 않는 형식");
        }
    }

    private static void walkCompressed(Format f, Input in, Options opt, final Ctx ctx, Visitor v) throws IOException {
        ctx.total = in.size();
        ctx.raw = new Counting(in.openStream());
        InputStream dec = null;
        try {
            dec = decompressor(f, new BufferedInputStream(ctx.raw, 1 << 16));
            String inner = null;
            if (dec instanceof GzipCompressorInputStream) {
                try { inner = ((GzipCompressorInputStream) dec).getMetaData().getFilename(); } catch (Throwable ignored) { }
            }
            final BufferedInputStream b = new BufferedInputStream(dec, 1 << 16);
            byte[] head = new byte[1024];
            b.mark(2048);
            int n = readFully(b, head);
            b.reset();
            Format innerFmt = detect(head, n, "");
            if (innerFmt == Format.TAR || innerFmt == Format.CPIO || innerFmt == Format.AR) {
                ctx.res.format = innerFmt.label + "." + f.label;
                walkStreamArchive(innerFmt, b, opt, ctx, v);
                return;
            }
            Entry e = new Entry();
            String nm = in.name() == null ? "data" : in.name();
            String ln = lower(nm);
            if (ln.endsWith(".gz") || ln.endsWith(".bz2") || ln.endsWith(".xz") || ln.endsWith(".lzma") || ln.endsWith(".z")
                    || ln.endsWith(".lz4") || ln.endsWith(".sz") || ln.endsWith(".br") || ln.endsWith(".zz") || ln.endsWith(".bz")
                    || ln.endsWith(".zlib") || ln.endsWith(".deflate") || ln.endsWith(".snappy")) {
                e.path = stripExt(nm);
            } else if (ln.endsWith(".svgz")) {
                e.path = stripExt(nm) + ".svg";
            } else if (inner != null && safePath(fixGzName(inner)).length() > 0) {
                e.path = fixGzName(inner);
            } else {
                e.path = nm + ".out";
            }
            v.visit(e, new Opener() {
                @Override public InputStream open() { return new NoClose(b); }
            });
        } finally {
            closeQuietly(dec);
            closeQuietly(ctx.raw);
        }
    }

    // ---- 스트림 방식 보관 형식 (tar, cpio, ar, arj, dump)

    private static void walkStreamArchive(Format f, InputStream in, Options opt, Ctx ctx, Visitor v) throws IOException {
        Charset cs = resolveCharset(opt.charset);
        final ArchiveInputStream ais;
        switch (f) {
            case TAR: ais = new TarArchiveInputStream(in, cs == null ? "UTF-8" : cs.name()); break;
            case CPIO: ais = new CpioArchiveInputStream(in, cs == null ? "UTF-8" : cs.name()); break;
            case AR: ais = new ArArchiveInputStream(in); break;
            case ARJ:
                try {
                    ais = new ArjArchiveInputStream(in, cs == null ? koreanCharset().name() : cs.name());
                } catch (org.apache.commons.compress.archivers.ArchiveException ex) {
                    throw new IOException(ex.getMessage());
                }
                break;
            case DUMP:
                try {
                    ais = new DumpArchiveInputStream(in, cs == null ? "UTF-8" : cs.name());
                } catch (org.apache.commons.compress.archivers.ArchiveException ex) {
                    throw new IOException(ex.getMessage());
                }
                break;
            default: throw new UnsupportedException("지원하지 않는 형식");
        }
        ArchiveEntry ae;
        while ((ae = ais.getNextEntry()) != null) {
            ctx.check();
            Entry e = new Entry();
            e.path = ae.getName();
            e.dir = ae.isDirectory();
            e.size = ae.getSize();
            boolean regular = true;
            if (ae instanceof TarArchiveEntry) {
                TarArchiveEntry te = (TarArchiveEntry) ae;
                regular = te.isDirectory() || te.isFile();
                if (te.isLink() || te.isSymbolicLink() || te.isCharacterDevice() || te.isBlockDevice() || te.isFIFO()
                        || te.isGlobalPaxHeader() || te.isPaxHeader()) regular = false;
            } else if (ae instanceof CpioArchiveEntry) {
                CpioArchiveEntry ce = (CpioArchiveEntry) ae;
                regular = ce.isDirectory() || ce.isRegularFile();
            }
            if (!regular) {
                if (e.path != null) ctx.res.skipped.add(e.path + " (링크/특수 파일)");
                continue;
            }
            if (!ais.canReadEntryData(ae)) {
                ctx.res.skipped.add(e.path + " (지원하지 않는 압축 방식)");
                continue;
            }
            v.visit(e, new Opener() {
                @Override public InputStream open() { return new NoClose(ais); }
            });
        }
    }

    // ---- ZIP

    private static void walkZip(Input in, Options opt, boolean listOnly, final Ctx ctx, Visitor v) throws IOException {
        SeekableByteChannel ch = in.openChannel();
        org.apache.commons.compress.archivers.zip.ZipFile zf = null;
        try {
            try {
                zf = new org.apache.commons.compress.archivers.zip.ZipFile(ch, in.name(), "UTF-8", true);
            } catch (IOException ex) {
                closeQuietly(ch);
                ch = null;
                // 중앙 디렉터리가 깨졌거나 없는 경우: 앞에서부터 순서대로 읽어 본다
                walkZipStream(in, opt, ctx, v);
                return;
            }
            List<ZipArchiveEntry> entries = new ArrayList<ZipArchiveEntry>();
            Enumeration<ZipArchiveEntry> en = zf.getEntriesInPhysicalOrder();
            boolean anyEnc = false;
            boolean needLegacy = false;
            long total = 0;
            while (en.hasMoreElements()) {
                ZipArchiveEntry ze = en.nextElement();
                entries.add(ze);
                if (ze.getGeneralPurposeBit().usesEncryption()) anyEnc = true;
                if (ze.getSize() > 0) total += ze.getSize();
                if (!ze.getGeneralPurposeBit().usesUTF8ForNames()
                        && ze.getNameSource() == ZipArchiveEntry.NameSource.NAME) {
                    byte[] raw = ze.getRawName();
                    if (raw != null && !isAscii(raw) && !isValidUtf8(raw)) needLegacy = true;
                }
            }
            ctx.total = total;
            Charset cs = resolveCharset(opt.charset);
            if (cs == null && needLegacy) cs = koreanCharset();
            final Charset nameCs = cs;

            if (anyEnc && !listOnly) {
                zf.close();
                zf = null;
                ch = null;
                walkZip4j(in, opt, nameCs, ctx, v);
                return;
            }
            final org.apache.commons.compress.archivers.zip.ZipFile zff = zf;
            for (final ZipArchiveEntry ze : entries) {
                ctx.check();
                Entry e = new Entry();
                e.path = zipName(ze, nameCs);
                e.dir = ze.isDirectory();
                e.size = ze.getSize();
                e.encrypted = ze.getGeneralPurposeBit().usesEncryption();
                if (!listOnly && !e.dir && !zff.canReadEntryData(ze)) {
                    ctx.res.skipped.add(e.path + " (지원하지 않는 압축 방식)");
                    continue;
                }
                v.visit(e, new Opener() {
                    @Override public InputStream open() throws IOException { return zff.getInputStream(ze); }
                });
            }
        } finally {
            closeQuietly(zf);
            closeQuietly(ch);
        }
    }

    private static String zipName(ZipArchiveEntry ze, Charset cs) {
        if (cs != null && !ze.getGeneralPurposeBit().usesUTF8ForNames()
                && ze.getNameSource() == ZipArchiveEntry.NameSource.NAME) {
            byte[] raw = ze.getRawName();
            if (raw != null && !isAscii(raw)) return new String(raw, cs);
        }
        return ze.getName();
    }

    /** 중앙 디렉터리 없이 앞에서부터 읽기(손상된 ZIP 복구용). */
    private static void walkZipStream(Input in, Options opt, Ctx ctx, Visitor v) throws IOException {
        ctx.total = in.size();
        ctx.raw = new Counting(in.openStream());
        Charset cs = resolveCharset(opt.charset);
        final org.apache.commons.compress.archivers.zip.ZipArchiveInputStream zis =
                new org.apache.commons.compress.archivers.zip.ZipArchiveInputStream(
                        new BufferedInputStream(ctx.raw, 1 << 16), cs == null ? "UTF-8" : cs.name(), true, true);
        try {
            ZipArchiveEntry ze;
            int count = 0;
            while ((ze = zis.getNextZipEntry()) != null) {
                ctx.check();
                count++;
                Entry e = new Entry();
                e.path = ze.getName();
                e.dir = ze.isDirectory();
                e.size = ze.getSize();
                e.encrypted = ze.getGeneralPurposeBit().usesEncryption();
                if (e.encrypted) throw new UnsupportedException("손상된 암호 ZIP 파일은 풀 수 없습니다");
                if (!zis.canReadEntryData(ze)) { ctx.res.skipped.add(e.path + " (지원하지 않는 압축 방식)"); continue; }
                v.visit(e, new Opener() {
                    @Override public InputStream open() { return new NoClose(zis); }
                });
            }
            if (count == 0) throw new UnsupportedException("ZIP 파일이 손상되었거나 압축 파일이 아닙니다");
        } finally {
            closeQuietly(zis);
        }
    }

    /** 암호가 걸린 ZIP (ZipCrypto / AES) */
    private static void walkZip4j(Input in, Options opt, Charset cs, Ctx ctx, Visitor v) throws IOException {
        if (opt.password == null || opt.password.length == 0) throw new PasswordException(false);
        final net.lingala.zip4j.ZipFile zf = new net.lingala.zip4j.ZipFile(in.asFile(), opt.password);
        try {
            zf.setCharset(cs != null ? cs : Charset.forName("UTF-8"));
            List<net.lingala.zip4j.model.FileHeader> hs = zf.getFileHeaders();
            for (final net.lingala.zip4j.model.FileHeader h : hs) {
                ctx.check();
                Entry e = new Entry();
                e.path = h.getFileName();
                e.dir = h.isDirectory();
                e.size = h.getUncompressedSize();
                e.encrypted = h.isEncrypted();
                try {
                    v.visit(e, new Opener() {
                        @Override public InputStream open() throws IOException { return zf.getInputStream(h); }
                    });
                } catch (ZipException ze) {
                    if (ze.getType() == ZipException.Type.WRONG_PASSWORD) throw new PasswordException(true);
                    if (ze.getType() == ZipException.Type.CHECKSUM_MISMATCH && e.encrypted) throw new PasswordException(true);
                    String m = String.valueOf(ze.getMessage());
                    if (e.encrypted && (m.contains("Wrong password") || m.contains("wrong password"))) throw new PasswordException(true);
                    throw ze;
                }
            }
        } finally {
            closeQuietly(zf);
        }
    }

    // ---- 7z

    private static void walk7z(Input in, Options opt, boolean listOnly, Ctx ctx, Visitor v) throws IOException {
        SeekableByteChannel ch = in.openChannel();
        SevenZFile sz = null;
        boolean hasPw = opt.password != null && opt.password.length > 0;
        try {
            try {
                sz = hasPw ? new SevenZFile(ch, in.name(), opt.password) : new SevenZFile(ch, in.name());
            } catch (PasswordRequiredException pe) {
                throw new PasswordException(false);
            } catch (IOException ex) {
                if (hasPw) throw new PasswordException(true);
                throw ex;
            }
            long total = 0;
            for (SevenZArchiveEntry se : sz.getEntries()) if (se.hasStream() && se.getSize() > 0) total += se.getSize();
            ctx.total = total;
            String fallback = baseName(in.name());
            if (listOnly) {
                for (SevenZArchiveEntry se : sz.getEntries()) {
                    Entry e = new Entry();
                    e.path = se.getName() == null ? fallback : se.getName();
                    e.dir = se.isDirectory();
                    e.size = se.getSize();
                    if (se.isAntiItem()) continue;
                    v.visit(e, null);
                }
                return;
            }
            final SevenZFile szf = sz;
            SevenZArchiveEntry se;
            while (true) {
                try {
                    se = sz.getNextEntry();
                } catch (PasswordRequiredException pe) {
                    throw new PasswordException(false);
                }
                if (se == null) break;
                if (se.isAntiItem()) continue;
                Entry e = new Entry();
                e.path = se.getName() == null ? fallback : se.getName();
                e.dir = se.isDirectory();
                e.size = se.getSize();
                final boolean hasStream = se.hasStream();
                try {
                    v.visit(e, new Opener() {
                        @Override public InputStream open() {
                            if (!hasStream) return new java.io.ByteArrayInputStream(new byte[0]);
                            return new InputStream() {
                                @Override public int read() throws IOException { return szf.read(); }
                                @Override public int read(byte[] b, int o, int l) throws IOException { return szf.read(b, o, l); }
                            };
                        }
                    });
                } catch (PasswordRequiredException pe) {
                    throw new PasswordException(false);
                } catch (CancelledException ce) {
                    throw ce;
                } catch (IOException ex) {
                    if (hasPw && isDecodeError(ex)) throw new PasswordException(true);
                    throw ex;
                }
            }
        } finally {
            closeQuietly(sz);
            closeQuietly(ch);
        }
    }

    private static boolean isDecodeError(IOException ex) {
        // 쓰기 쪽 오류(저장 공간 등)와 구분하기 위해 압축 라이브러리에서 난 오류만 암호 오류로 본다
        for (StackTraceElement el : ex.getStackTrace()) {
            String c = el.getClassName();
            if (c.startsWith("org.apache.commons.compress") || c.startsWith("org.tukaani")) return true;
            if (c.startsWith("kr.allzip")) break;
        }
        return false;
    }

    // ---- RAR

    private static final class RarChannel implements com.github.junrar.io.SeekableReadOnlyByteChannel {
        private final SeekableByteChannel ch;
        private final byte[] one = new byte[1];
        RarChannel(SeekableByteChannel ch) { this.ch = ch; }
        @Override public long getPosition() throws IOException { return ch.position(); }
        @Override public void setPosition(long pos) throws IOException { ch.position(pos); }
        @Override public int read() throws IOException {
            int r = read(one, 0, 1);
            return r <= 0 ? -1 : (one[0] & 0xff);
        }
        @Override public int read(byte[] buffer, int off, int count) throws IOException {
            if (count == 0) return 0;
            ByteBuffer bb = ByteBuffer.wrap(buffer, off, count);
            int total = 0;
            while (bb.hasRemaining()) {
                int r = ch.read(bb);
                if (r < 0) break;
                total += r;
            }
            return total == 0 ? -1 : total;
        }
        @Override public int readFully(byte[] buffer, int count) throws IOException {
            int n = 0;
            ByteBuffer bb = ByteBuffer.wrap(buffer, 0, count);
            while (bb.hasRemaining()) {
                int r = ch.read(bb);
                if (r < 0) break;
                n += r;
            }
            if (n < count) throw new java.io.EOFException("파일 끝에 도달했습니다");
            return n;
        }
        @Override public void close() throws IOException { ch.close(); }
    }

    private static void walkRar(final Input in, Options opt, boolean listOnly, final Ctx ctx, Visitor v) throws IOException {
        final SeekableByteChannel ch = in.openChannel();
        final long len = in.size();
        final boolean hasPw = opt.password != null && opt.password.length > 0;
        Archive ar = null;
        try {
            VolumeManager vm = new VolumeManager() {
                @Override public Volume nextVolume(final Archive archive, Volume last) {
                    if (last != null) return null;
                    return new Volume() {
                        @Override public com.github.junrar.io.SeekableReadOnlyByteChannel getChannel() { return new RarChannel(ch); }
                        @Override public long getLength() { return len; }
                        @Override public Archive getArchive() { return archive; }
                    };
                }
            };
            ArchiveOptions.Builder ob = ArchiveOptions.builder().maxDictionarySize(256L * 1024 * 1024);
            if (hasPw) ob.password(opt.password);
            try {
                ar = new Archive(vm, ob.build());
            } catch (UnsupportedRarEncryptedException ue) {
                throw new PasswordException(hasPw);
            } catch (WrongPasswordException we) {
                throw new PasswordException(true);
            } catch (RarException re) {
                throw rarError(re);
            }
            boolean headersEnc;
            try { headersEnc = ar.isEncrypted(); } catch (RarException re) { headersEnc = false; }
            if (headersEnc && !hasPw) throw new PasswordException(false);
            List<FileHeader> hs = ar.getFileHeaders();
            if (hs.isEmpty() && headersEnc) throw new PasswordException(hasPw);
            long total = 0;
            for (FileHeader h : hs) if (!h.isDirectory() && h.getFullUnpackSize() > 0) total += h.getFullUnpackSize();
            ctx.total = total;
            final Archive arf = ar;
            for (final FileHeader h : hs) {
                ctx.check();
                final Entry e = new Entry();
                e.path = h.getFileName();
                e.dir = h.isDirectory();
                e.size = h.getFullUnpackSize();
                e.encrypted = h.isEncrypted();
                if (listOnly) { v.visit(e, null); continue; }
                if (e.encrypted && !hasPw) throw new PasswordException(false);
                if (e.dir) { v.visit(e, null); continue; }
                // junrar 는 출력 스트림으로 밀어 넣는 방식이라 직접 써 준다
                try {
                    extractRarEntry(arf, h, e, ctx, v);
                } catch (CancelledException ce) {
                    throw ce;
                } catch (PasswordException pe) {
                    throw pe;
                } catch (IOException ex) {
                    if (e.encrypted && hasPw && String.valueOf(ex.getMessage()).startsWith("CRC")) throw new PasswordException(true);
                    throw ex;
                }
            }
        } catch (PasswordException pe) {
            if (!hasPw && pe.wrong) throw new PasswordException(false);
            throw pe;
        } catch (RuntimeException rte) {
            throw new IOException("RAR 오류: 파일이 손상되었습니다 (" + rte.getClass().getSimpleName() + ")");
        } finally {
            closeQuietly(ar);
            closeQuietly(ch);
        }
    }

    private static IOException rarError(RarException re) {
        if (re instanceof WrongPasswordException) return new PasswordException(true);
        if (re instanceof UnsupportedRarEncryptedException) return new PasswordException(false);
        if (re instanceof MissingNextVolumeException) return new UnsupportedException("분할 압축(RAR 여러 권)은 지원하지 않습니다");
        if (re instanceof CrcErrorException) return new IOException("CRC 오류: 파일이 손상되었거나 비밀번호가 틀렸습니다");
        String m = re.getMessage();
        return new IOException("RAR 오류: " + (m == null ? re.getClass().getSimpleName() : m));
    }

    private static void extractRarEntry(final Archive ar, final FileHeader h, Entry e, final Ctx ctx, Visitor v) throws IOException {
        // Visitor 는 InputStream 을 원하므로 파이프 대신, 방문자가 준 스트림에 맞춰 별도 스레드 없이 처리:
        // junrar 의 getInputStream 은 내부 스레드+파이프를 쓴다(오류 전달 포함).
        try {
            v.visit(e, new Opener() {
                @Override public InputStream open() throws IOException { return ar.getInputStream(h); }
            });
        } catch (IOException ex) {
            Throwable c = ex.getCause();
            if (c instanceof RarException) throw rarError((RarException) c);
            throw ex;
        }
    }

    // ------------------------------------------------------------------ 압축하기

    public static final String[] ARCHIVE_FORMATS = {"zip", "7z", "tar", "tar.gz", "tar.bz2", "tar.xz", "tar.lz4", "tar.lzma", "cpio"};
    public static final String[] SINGLE_FORMATS = {"gz", "bz2", "xz", "lzma", "lz4", "sz", "zz"};

    public static boolean isSingleFormat(String fmt) {
        for (String s : SINGLE_FORMATS) if (s.equals(fmt)) return true;
        return false;
    }

    public static final class CompressOptions {
        public String format = "zip";
        /** 0 빠름, 1 보통, 2 최대 */
        public int level = 1;
        public char[] password;
        /** true: AES-256, false: ZipCrypto(호환) */
        public boolean aes = true;
        public File tempDir;
    }

    private static OutputStream compressor(String kind, OutputStream out, int level, String fileName) throws IOException {
        if (kind.equals("gz")) {
            GzipParameters gp = new GzipParameters();
            gp.setCompressionLevel(level == 0 ? 1 : level == 1 ? 6 : 9);
            if (fileName != null) {
                boolean ascii = true;
                for (int i = 0; i < fileName.length(); i++) if (fileName.charAt(i) > 0x7e) ascii = false;
                if (ascii) gp.setFilename(fileName);
            }
            return new GzipCompressorOutputStream(out, gp);
        }
        if (kind.equals("bz2")) return new BZip2CompressorOutputStream(out, level == 0 ? 3 : 9);
        if (kind.equals("xz")) return new XZOutputStream(out, new LZMA2Options(level == 0 ? 1 : level == 1 ? 4 : 6));
        if (kind.equals("lzma")) {
            // LZMAOutputStream 은 flush 를 지원하지 않아서 무시하도록 감싼다
            return new java.io.FilterOutputStream(new LZMAOutputStream(out, new LZMA2Options(level == 0 ? 1 : level == 1 ? 4 : 6), -1)) {
                @Override public void flush() { }
                @Override public void write(byte[] b, int o, int l) throws IOException { out.write(b, o, l); }
                @Override public void close() throws IOException { out.close(); }
            };
        }
        if (kind.equals("lz4")) return new FramedLZ4CompressorOutputStream(out);
        if (kind.equals("sz")) return new FramedSnappyCompressorOutputStream(out);
        if (kind.equals("zz")) {
            DeflateParameters dp = new DeflateParameters();
            dp.setCompressionLevel(level == 0 ? 1 : level == 1 ? 6 : 9);
            return new DeflateCompressorOutputStream(out, dp);
        }
        throw new UnsupportedException("지원하지 않는 형식: " + kind);
    }

    /** 크기를 모르는 항목은 임시 파일로 받아 크기를 확정한다. */
    private static final class Sized {
        final long size;
        final File tmp;
        final Item item;
        Sized(Item it, File tempDir, Ctx ctx) throws IOException {
            item = it;
            if (it.isDir()) { size = 0; tmp = null; return; }
            if (it.size() >= 0) { size = it.size(); tmp = null; return; }
            tmp = File.createTempFile("item", ".tmp", tempDir);
            InputStream is = it.open();
            OutputStream os = new FileOutputStream(tmp);
            long n = 0;
            try {
                byte[] b = new byte[1 << 16];
                int r;
                while ((r = is.read(b)) >= 0) { ctx.check(); os.write(b, 0, r); n += r; }
            } finally { closeQuietly(os); closeQuietly(is); }
            size = n;
        }
        InputStream open() throws IOException { return tmp != null ? new FileInputStream(tmp) : item.open(); }
        void done() { if (tmp != null) tmp.delete(); }
    }

    /** 선언된 크기만큼만 복사(부족하면 0으로 채움) — tar/cpio/ar 는 크기가 정확해야 한다. */
    private static void copyExact(InputStream is, OutputStream os, long size, Ctx ctx) throws IOException {
        long left = size;
        while (left > 0) {
            ctx.check();
            int r = is.read(ctx.buf, 0, (int) Math.min(ctx.buf.length, left));
            if (r < 0) break;
            os.write(ctx.buf, 0, r);
            left -= r;
            ctx.done += r;
            ctx.res.bytes += r;
            ctx.report();
        }
        if (left > 0) {
            java.util.Arrays.fill(ctx.buf, (byte) 0);
            while (left > 0) {
                int r = (int) Math.min(ctx.buf.length, left);
                os.write(ctx.buf, 0, r);
                left -= r;
            }
        }
    }

    public static Result compress(List<Item> items, CompressOptions co, OutputStream rawOut, Listener l) throws IOException {
        final Ctx ctx = new Ctx(l);
        String fmt = co.format;
        ctx.res.format = fmt;
        long total = 0;
        for (Item it : items) if (!it.isDir() && it.size() > 0) total += it.size();
        ctx.total = total;
        OutputStream out = new BufferedOutputStream(rawOut, 1 << 16);
        try {
            if (isSingleFormat(fmt)) {
                Item only = null;
                for (Item it : items) if (!it.isDir()) { if (only != null) throw new IOException("이 형식은 파일 1개만 압축할 수 있습니다"); only = it; }
                if (only == null) throw new IOException("압축할 파일이 없습니다");
                String nm = only.path();
                int sl = nm.lastIndexOf('/');
                if (sl >= 0) nm = nm.substring(sl + 1);
                if (l != null) l.onItem(nm);
                OutputStream cos = compressor(fmt, out, co.level, nm);
                InputStream is = only.open();
                try { ctx.copy(is, cos); } finally { closeQuietly(is); }
                cos.close();
                ctx.res.files = 1;
            } else if (fmt.equals("zip")) {
                compressZip(items, co, out, ctx);
            } else if (fmt.equals("7z")) {
                compress7z(items, co, out, ctx);
            } else if (fmt.equals("tar") || fmt.startsWith("tar.")) {
                OutputStream cos = fmt.equals("tar") ? out : compressor(fmt.substring(4), out, co.level, null);
                TarArchiveOutputStream tos = new TarArchiveOutputStream(cos, "UTF-8");
                tos.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX);
                tos.setBigNumberMode(TarArchiveOutputStream.BIGNUMBER_POSIX);
                tos.setAddPaxHeadersForNonAsciiNames(true);
                for (Item it : items) {
                    ctx.check();
                    if (l != null) l.onItem(it.path());
                    Sized s = new Sized(it, co.tempDir, ctx);
                    try {
                        TarArchiveEntry te = new TarArchiveEntry(it.isDir() ? dirName(it.path()) : it.path());
                        if (!it.isDir()) te.setSize(s.size);
                        if (it.mtime() > 0) te.setModTime(it.mtime());
                        tos.putArchiveEntry(te);
                        if (!it.isDir()) {
                            InputStream is = s.open();
                            try { copyExact(is, tos, s.size, ctx); } finally { closeQuietly(is); }
                            ctx.res.files++;
                        } else ctx.res.dirs++;
                        tos.closeArchiveEntry();
                    } finally { s.done(); }
                }
                tos.finish();
                tos.close();
            } else if (fmt.equals("cpio")) {
                CpioArchiveOutputStream cos = new CpioArchiveOutputStream(out, CpioConstants.FORMAT_NEW, 512, "UTF-8");
                long ino = 1;
                for (Item it : items) {
                    ctx.check();
                    if (l != null) l.onItem(it.path());
                    Sized s = new Sized(it, co.tempDir, ctx);
                    try {
                        CpioArchiveEntry ce = new CpioArchiveEntry(CpioConstants.FORMAT_NEW, it.path(), it.isDir() ? 0 : s.size);
                        ce.setMode(it.isDir() ? (CpioConstants.C_ISDIR | 0755) : (CpioConstants.C_ISREG | 0644));
                        ce.setInode(ino++);
                        ce.setNumberOfLinks(it.isDir() ? 2 : 1);
                        if (it.mtime() > 0) ce.setTime(it.mtime() / 1000L);
                        cos.putArchiveEntry(ce);
                        if (!it.isDir()) {
                            InputStream is = s.open();
                            try { copyExact(is, cos, s.size, ctx); } finally { closeQuietly(is); }
                            ctx.res.files++;
                        } else ctx.res.dirs++;
                        cos.closeArchiveEntry();
                    } finally { s.done(); }
                }
                cos.finish();
                cos.close();
            } else {
                throw new UnsupportedException("지원하지 않는 형식: " + fmt);
            }
            out.flush();
        } catch (OutOfMemoryError oom) {
            throw new IOException("메모리가 부족합니다. 압축 수준을 낮춰 주세요");
        } finally {
            closeQuietly(out);
        }
        return ctx.res;
    }

    private static String dirName(String p) { return p.endsWith("/") ? p : p + "/"; }

    private static void compressZip(List<Item> items, CompressOptions co, OutputStream out, Ctx ctx) throws IOException {
        boolean enc = co.password != null && co.password.length > 0;
        net.lingala.zip4j.io.outputstream.ZipOutputStream zos = enc
                ? new net.lingala.zip4j.io.outputstream.ZipOutputStream(out, co.password)
                : new net.lingala.zip4j.io.outputstream.ZipOutputStream(out);
        for (Item it : items) {
            ctx.check();
            if (ctx.l != null) ctx.l.onItem(it.path());
            ZipParameters p = new ZipParameters();
            if (it.mtime() > 0) p.setLastModifiedFileTime(it.mtime());
            if (it.isDir()) {
                p.setFileNameInZip(dirName(it.path()));
                p.setCompressionMethod(CompressionMethod.STORE);
                p.setEntrySize(0);
                zos.putNextEntry(p);
                zos.closeEntry();
                ctx.res.dirs++;
                continue;
            }
            p.setFileNameInZip(it.path());
            p.setCompressionMethod(CompressionMethod.DEFLATE);
            p.setCompressionLevel(co.level == 0 ? CompressionLevel.FASTEST : co.level == 1 ? CompressionLevel.NORMAL : CompressionLevel.MAXIMUM);
            if (it.size() >= 0) p.setEntrySize(it.size());
            if (enc) {
                p.setEncryptFiles(true);
                if (co.aes) {
                    p.setEncryptionMethod(EncryptionMethod.AES);
                    p.setAesKeyStrength(AesKeyStrength.KEY_STRENGTH_256);
                } else {
                    p.setEncryptionMethod(EncryptionMethod.ZIP_STANDARD);
                }
            }
            zos.putNextEntry(p);
            InputStream is = it.open();
            try { ctx.copy(is, zos); } finally { closeQuietly(is); }
            zos.closeEntry();
            ctx.res.files++;
        }
        zos.close();
    }

    private static void compress7z(List<Item> items, CompressOptions co, OutputStream out, Ctx ctx) throws IOException {
        File tmp = File.createTempFile("out", ".7z", co.tempDir);
        try {
            SevenZOutputFile sz = new SevenZOutputFile(tmp);
            try {
                int preset = co.level == 0 ? 1 : co.level == 1 ? 4 : 6;
                LZMA2Options lo = new LZMA2Options(preset);
                final int presetDict = lo.getDictSize();
                sz.setContentMethods(Collections.singletonList(new SevenZMethodConfiguration(SevenZMethod.LZMA2, lo)));
                for (Item it : items) {
                    ctx.check();
                    if (ctx.l != null) ctx.l.onItem(it.path());
                    SevenZArchiveEntry e = new SevenZArchiveEntry();
                    String p = it.path();
                    if (p.endsWith("/")) p = p.substring(0, p.length() - 1);
                    e.setName(p);
                    e.setDirectory(it.isDir());
                    if (it.mtime() > 0) e.setLastModifiedDate(new Date(it.mtime()));
                    if (!it.isDir() && it.size() >= 0 && it.size() < presetDict) {
                        // 작은 파일은 사전을 파일 크기에 맞춰 메모리 할당 시간을 줄인다
                        int d = 4096;
                        while (d < it.size()) d <<= 1;
                        if (d < presetDict) {
                            LZMA2Options small = new LZMA2Options(preset);
                            small.setDictSize(d);
                            e.setContentMethods(Collections.singletonList(new SevenZMethodConfiguration(SevenZMethod.LZMA2, small)));
                        }
                    }
                    sz.putArchiveEntry(e);
                    if (!it.isDir()) {
                        InputStream is = it.open();
                        try {
                            int r;
                            while ((r = is.read(ctx.buf)) >= 0) {
                                ctx.check();
                                if (r == 0) continue;
                                sz.write(ctx.buf, 0, r);
                                ctx.done += r;
                                ctx.res.bytes += r;
                                ctx.report();
                            }
                        } finally { closeQuietly(is); }
                        ctx.res.files++;
                    } else ctx.res.dirs++;
                    sz.closeArchiveEntry();
                }
                sz.finish();
            } finally {
                closeQuietly(sz);
            }
            if (ctx.l != null) ctx.l.onItem("저장하는 중…");
            InputStream is = new FileInputStream(tmp);
            try {
                int r;
                while ((r = is.read(ctx.buf)) >= 0) { ctx.check(); out.write(ctx.buf, 0, r); }
            } finally { closeQuietly(is); }
        } finally {
            tmp.delete();
        }
    }
}
