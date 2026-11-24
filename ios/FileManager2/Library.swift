import Foundation
import ImageIO
import UniformTypeIdentifiers

/// 앱 보관함 = 앱의 Documents 폴더. 아이폰 "파일" 앱의 "나의 iPhone > 파일 관리자 2"에서도 보입니다.
/// iOS는 앱이 휴대폰 전체 저장소를 볼 수 없어서, PC·클라우드와 주고받는 파일은 모두 이 보관함을 거칩니다.
struct LocalItem: Identifiable, Hashable {
    var id: URL { url }
    let url: URL
    let name: String
    let isDir: Bool
    let size: Int64
    let mtime: Date
    let count: Int
}

enum Library {
    static let fm = FileManager.default
    static var root: URL { fm.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    /// 휴지통은 보관함 밖(Application Support)에 둬서 "파일" 앱과 PC에 보이지 않게 함
    static var trash: URL {
        let u = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Trash", isDirectory: true)
        try? fm.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }
    static let receivedFolder = "받은 파일"

    /// PC와 주고받을 때 쓰는 가상 경로 ("/보관함/…") — 앱 업데이트로 실제 경로가 바뀌어도 그대로 유지됨
    static let virtualRoot = "/보관함"

    static func ensureDefaults() {
        for n in [receivedFolder, "사진", "문서"] {
            try? fm.createDirectory(at: root.appendingPathComponent(n, isDirectory: true), withIntermediateDirectories: true)
        }
    }

    static func item(_ u: URL) -> LocalItem? {
        guard let v = try? u.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey]) else { return nil }
        let dir = v.isDirectory ?? false
        let count = dir ? ((try? fm.contentsOfDirectory(atPath: u.path))?.filter { !$0.hasPrefix(".") }.count ?? 0) : 0
        return LocalItem(url: u, name: u.lastPathComponent, isDir: dir, size: Int64(v.fileSize ?? 0), mtime: v.contentModificationDate ?? Date(), count: count)
    }

    static func list(_ dir: URL, hidden: Bool = false) throws -> [LocalItem] {
        let urls = try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey], options: hidden ? [] : [.skipsHiddenFiles])
        return urls.compactMap(item).filter { !$0.name.hasSuffix(".fm2part") }
            .sorted { $0.isDir != $1.isDir ? $0.isDir : $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// 같은 이름이 있으면 "이름 (1).확장자"
    static func unique(in dir: URL, name: String) -> URL {
        var u = dir.appendingPathComponent(name)
        guard fm.fileExists(atPath: u.path) else { return u }
        let ext = (name as NSString).pathExtension, stem = (name as NSString).deletingPathExtension
        var i = 1
        repeat {
            u = dir.appendingPathComponent(ext.isEmpty ? "\(stem) (\(i))" : "\(stem) (\(i)).\(ext)")
            i += 1
        } while fm.fileExists(atPath: u.path)
        return u
    }

    static func validName(_ n: String) -> Bool {
        let t = n.trimmingCharacters(in: .whitespaces)
        return !t.isEmpty && !t.contains("/") && t != "." && t != ".." && !t.hasPrefix(".")
    }

    @discardableResult
    static func newFolder(in dir: URL, name: String) throws -> URL {
        guard validName(name) else { throw ApiError(code: "bad_name", message: "폴더 이름이 올바르지 않습니다") }
        let u = unique(in: dir, name: name.trimmingCharacters(in: .whitespaces))
        try fm.createDirectory(at: u, withIntermediateDirectories: false)
        return u
    }

    @discardableResult
    static func rename(_ u: URL, to name: String) throws -> URL {
        guard validName(name) else { throw ApiError(code: "bad_name", message: "이름이 올바르지 않습니다") }
        let dest = u.deletingLastPathComponent().appendingPathComponent(name.trimmingCharacters(in: .whitespaces))
        if fm.fileExists(atPath: dest.path) { throw ApiError(code: "exists", message: "같은 이름이 이미 있습니다") }
        try fm.moveItem(at: u, to: dest)
        return dest
    }

    /// 다른 앱·"파일" 앱에서 고른 파일을 보관함으로 복사
    @discardableResult
    static func importFile(_ src: URL, into dir: URL, move: Bool = false) throws -> URL {
        let scoped = src.startAccessingSecurityScopedResource()
        defer { if scoped { src.stopAccessingSecurityScopedResource() } }
        let dest = unique(in: dir, name: src.lastPathComponent)
        if move { try fm.moveItem(at: src, to: dest) } else { try fm.copyItem(at: src, to: dest) }
        return dest
    }

    static func copy(_ src: URL, into dir: URL) throws -> URL {
        let dest = unique(in: dir, name: src.lastPathComponent)
        try fm.copyItem(at: src, to: dest); return dest
    }
    static func move(_ src: URL, into dir: URL) throws -> URL {
        let dest = unique(in: dir, name: src.lastPathComponent)
        try fm.moveItem(at: src, to: dest); return dest
    }

    // MARK: 휴지통 (삭제 실수 방지 — 30일 보관)

    struct TrashEntry: Identifiable, Hashable { var id: URL { url }; let url: URL; let name: String; let original: String; let deletedAt: Date; let isDir: Bool; let size: Int64 }

    static func moveToTrash(_ u: URL) throws {
        let rel = relative(u) ?? u.lastPathComponent
        let box = trash.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: box, withIntermediateDirectories: true)
        try fm.moveItem(at: u, to: box.appendingPathComponent(u.lastPathComponent))
        let meta: [String: Any] = ["original": rel, "deletedAt": Date().timeIntervalSince1970]
        try JSONSerialization.data(withJSONObject: meta).write(to: box.appendingPathComponent(".meta.json"))
    }
    static func trashEntries() -> [TrashEntry] {
        let boxes = (try? fm.contentsOfDirectory(at: trash, includingPropertiesForKeys: nil)) ?? []
        var out: [TrashEntry] = []
        for b in boxes {
            guard let d = try? Data(contentsOf: b.appendingPathComponent(".meta.json")),
                  let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let f = (try? fm.contentsOfDirectory(at: b, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]))?.first,
                  let it = item(f) else { continue }
            let at = Date(timeIntervalSince1970: (m["deletedAt"] as? Double) ?? 0)
            if Date().timeIntervalSince(at) > 30 * 86400 { try? fm.removeItem(at: b); continue }
            out.append(TrashEntry(url: f, name: it.name, original: m.str("original"), deletedAt: at, isDir: it.isDir, size: it.size))
        }
        return out.sorted { $0.deletedAt > $1.deletedAt }
    }
    static func restore(_ e: TrashEntry) throws {
        var dir = root.appendingPathComponent((e.original as NSString).deletingLastPathComponent, isDirectory: true)
        if !fm.fileExists(atPath: dir.path) { dir = root }
        try fm.moveItem(at: e.url, to: unique(in: dir, name: e.name))
        try? fm.removeItem(at: e.url.deletingLastPathComponent())
    }
    static func purge(_ e: TrashEntry) { try? fm.removeItem(at: e.url.deletingLastPathComponent()) }
    static func emptyTrash() { try? fm.removeItem(at: trash) }

    // MARK: 가상 경로 ↔ 실제 경로

    static func relative(_ u: URL) -> String? {
        let r = root.standardizedFileURL.resolvingSymlinksInPath().path
        let p = u.standardizedFileURL.resolvingSymlinksInPath().path
        if p == r { return "" }
        guard p.hasPrefix(r + "/") else { return nil }
        return String(p.dropFirst(r.count + 1))
    }
    static func virtualPath(_ u: URL) -> String {
        guard let rel = relative(u) else { return virtualRoot }
        return rel.isEmpty ? virtualRoot : virtualRoot + "/" + rel
    }
    /// "/보관함/사진/a.jpg" → 실제 URL. ".." 등 보관함 밖으로 나가는 경로는 거부
    static func realURL(_ virtual: String) -> URL? {
        guard virtual == virtualRoot || virtual.hasPrefix(virtualRoot + "/") else { return nil }
        let rest = virtual.dropFirst(virtualRoot.count).split(separator: "/").map(String.init)
        if rest.contains(where: { $0 == ".." || $0 == "." }) { return nil }
        var u = root
        for c in rest { u.appendPathComponent(c) }
        return u
    }

    /// 보관함 전체 사용량
    static func usage() -> Int64 {
        guard let e = fm.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        var n: Int64 = 0
        for case let u as URL in e { n += Int64((try? u.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0) }
        return n
    }

    static func thumbnailJPEG(_ u: URL, size: Int) -> Data? {
        guard let src = CGImageSourceCreateWithURL(u as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: size,
                                     kCGImageSourceCreateThumbnailWithTransform: true]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        let out = NSMutableData()
        guard let dst = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dst, img, [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary)
        return CGImageDestinationFinalize(dst) ? out as Data : nil
    }

    static func symbol(for item: LocalItem) -> String { item.isDir ? "folder.fill" : symbol(forName: item.name) }
    static func symbol(forName name: String) -> String {
        let t = UTType(filenameExtension: (name as NSString).pathExtension.lowercased())
        if t?.conforms(to: .image) == true { return "photo" }
        if t?.conforms(to: .movie) == true || t?.conforms(to: .video) == true { return "film" }
        if t?.conforms(to: .audio) == true { return "music.note" }
        if t?.conforms(to: .pdf) == true { return "doc.richtext" }
        if t?.conforms(to: .archive) == true { return "doc.zipper" }
        if t?.conforms(to: .text) == true { return "doc.text" }
        return "doc"
    }
}
