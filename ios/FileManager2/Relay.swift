import Foundation
import UIKit

/// PC 연결: 서버와 WebSocket 을 유지하고, 승인된 PC의 요청을 '허용된 폴더 안에서만' 처리합니다.
/// iOS는 앱이 화면에 없으면 잠시 뒤 연결이 멈춥니다. 앱을 다시 열면 자동으로 다시 연결합니다.
@MainActor
final class Relay: ObservableObject {
    static let shared = Relay()

    @Published var enabled = UserDefaults.standard.bool(forKey: "fm2.connectEnabled")
    @Published var online = false
    @Published var status = "꺼짐"
    @Published var pending: [PermInfo] = []
    @Published var active = 0
    @Published var lastActivity: String?
    @Published var refreshTick = 0

    private var task: URLSessionWebSocketTask?
    private var loop: Task<Void, Never>?
    private var backoff: UInt64 = 2
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    func setEnabled(_ v: Bool) {
        enabled = v
        UserDefaults.standard.set(v, forKey: "fm2.connectEnabled")
        v ? start() : stop()
    }

    func start() {
        guard enabled, Session.token != nil, loop == nil else { return }
        loop = Task { await self.connectLoop() }
    }

    func stop() {
        loop?.cancel(); loop = nil
        task?.cancel(with: .normalClosure, reason: nil); task = nil
        online = false; status = "꺼짐"
    }

    /// 앱이 뒤로 가면 진행 중 전송이 끝날 시간만 잠깐 얻고, 앞으로 오면 다시 연결
    func scenePhase(active: Bool) {
        if active {
            if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask); bgTask = .invalid }
            start()
        } else if enabled {
            bgTask = UIApplication.shared.beginBackgroundTask(withName: "fm2-connect") { [weak self] in
                Task { @MainActor in
                    guard let self else { return }
                    self.task?.cancel(with: .goingAway, reason: nil)
                    if self.bgTask != .invalid { UIApplication.shared.endBackgroundTask(self.bgTask); self.bgTask = .invalid }
                }
            }
        }
    }

    private func connectLoop() async {
        while !Task.isCancelled && enabled {
            guard let token = Session.token, var comps = URLComponents(string: Config.wsURL) else { break }
            comps.queryItems = [URLQueryItem(name: "token", value: token)]
            status = "서버에 연결 중…"
            let t = Api.session.webSocketTask(with: comps.url!)
            task = t
            t.resume()
            let pinger = Task { [weak t] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 20_000_000_000)
                    t?.sendPing { _ in }
                }
            }
            var opened = false
            while !Task.isCancelled {
                do {
                    let msg = try await t.receive()
                    if !opened {
                        opened = true; backoff = 2; online = true
                        status = "켜짐 · PC에서 접속할 수 있습니다"
                        Task { await self.refreshPending() }
                    }
                    if case .string(let s) = msg { handle(s, socket: t) }
                } catch { break }
            }
            pinger.cancel()
            online = false
            if t.closeCode.rawValue == 4001 { // 로그아웃·차단됨
                Session.shared.clear(); break
            }
            if Task.isCancelled || !enabled { break }
            status = "연결 끊김 · \(backoff)초 후 다시 연결"
            try? await Task.sleep(nanoseconds: backoff * 1_000_000_000)
            backoff = min(backoff * 2, 60)
        }
        loop = nil
        if !enabled { status = "꺼짐" }
    }

    func refreshPending() async {
        if let list = try? await Api.permissions() {
            pending = list.filter { $0.status == "pending" }
            refreshTick += 1
        }
    }

    private func handle(_ text: String, socket: URLSessionWebSocketTask) {
        guard let d = text.data(using: .utf8), let m = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        switch m.str("t") {
        case "req":
            active += 1
            lastActivity = "\(m.str("fromName")): \(Relay.opLabel(m.str("op")))"
            let msg = m
            Task.detached {
                let res = FileBridge.serve(msg)
                let data = (try? JSONSerialization.data(withJSONObject: res)) ?? Data()
                try? await socket.send(.string(String(data: data, encoding: .utf8) ?? "{}"))
                await MainActor.run { Relay.shared.active = max(0, Relay.shared.active - 1) }
            }
        case "pair_request":
            if let p = m["permission"] as? [String: Any] {
                let perm = PermInfo(p)
                pending.removeAll { $0.id == perm.id }
                pending.append(perm)
                refreshTick += 1
            }
        case "perm_changed":
            Task { await refreshPending() }
        default: break
        }
    }

    static func opLabel(_ op: String) -> String {
        switch op {
        case "list": return "폴더 보기"
        case "read": return "파일 받는 중"
        case "write": return "파일 보내는 중"
        case "delete": return "삭제"
        case "rename": return "이름 변경"
        case "mkdir": return "폴더 만들기"
        case "copy": return "복사"
        case "move": return "이동"
        case "thumb": return "미리보기"
        case "roots": return "허용 폴더 보기"
        default: return op
        }
    }
}

struct BridgeError: Error { let code: String; let message: String }

/// 실제 파일 작업. PC가 보는 경로는 모두 "/보관함/…" 가상 경로이며, 허용 폴더 밖은 거부합니다.
enum FileBridge {
    static func serve(_ m: [String: Any]) -> [String: Any] {
        var res: [String: Any] = ["t": "res", "id": m.str("id")]
        do {
            let perm = m["perm"] as? [String: Any] ?? [:]
            let serverFolders = perm["folders"] as? [String] ?? []
            let mine = AllowedFolders.all
            let folders = mine.isEmpty ? serverFolders : serverFolders.filter { f in mine.contains { u in f == u || f.hasPrefix(u + "/") } }
            if folders.isEmpty { throw BridgeError(code: "forbidden", message: "아이폰에서 허용한 폴더가 아닙니다") }
            let data = try run(m.str("op"), m["args"] as? [String: Any] ?? [:], folders: folders, readOnly: perm["readOnly"] as? Bool ?? false)
            res["ok"] = true; res["data"] = data
        } catch let e as BridgeError {
            res["ok"] = false; res["error"] = e.code; res["message"] = e.message
        } catch {
            res["ok"] = false; res["error"] = "io_error"; res["message"] = error.localizedDescription
        }
        return res
    }

    static func folderLabel(_ v: String) -> String {
        v == Library.virtualRoot ? "보관함 전체" : (v as NSString).lastPathComponent
    }

    private static func run(_ op: String, _ a: [String: Any], folders: [String], readOnly: Bool) throws -> Any {
        func inRoots(_ v: String) -> Bool { folders.contains { v == $0 || v.hasPrefix($0 + "/") } }
        func resolve(_ v: String?) throws -> URL {
            guard let v, !v.isEmpty else { throw BridgeError(code: "bad_path", message: "경로가 없습니다") }
            let norm = v.count > 1 && v.hasSuffix("/") ? String(v.dropLast()) : v
            guard inRoots(norm), let u = Library.realURL(norm) else { throw BridgeError(code: "forbidden", message: "아이폰에서 허용하지 않은 폴더입니다") }
            // 링크로 보관함 밖을 가리키는 경우 차단
            if Library.fm.fileExists(atPath: u.path), Library.relative(u) == nil { throw BridgeError(code: "forbidden", message: "보관함 밖의 경로입니다") }
            return u
        }
        func needWrite() throws { if readOnly { throw BridgeError(code: "read_only", message: "읽기 전용으로 허용된 연결입니다") } }
        func isRoot(_ v: String) -> Bool { folders.contains(v) }
        func item(_ u: URL) -> [String: Any] {
            guard let it = Library.item(u) else { return ["name": u.lastPathComponent, "path": Library.virtualPath(u), "dir": false, "size": 0, "mtime": 0] }
            var o: [String: Any] = ["name": it.name, "path": Library.virtualPath(u), "dir": it.isDir, "size": it.size, "mtime": Int64(it.mtime.timeIntervalSince1970 * 1000)]
            if it.isDir { o["count"] = it.count }
            return o
        }
        let path = a["path"] as? String

        switch op {
        case "roots":
            return folders.map { f -> [String: Any] in
                let u = Library.realURL(f)
                return ["name": folderLabel(f), "path": f, "exists": u.map { Library.fm.fileExists(atPath: $0.path) } ?? false]
            }
        case "list":
            let d = try resolve(path)
            var isDir: ObjCBool = false
            guard Library.fm.fileExists(atPath: d.path, isDirectory: &isDir), isDir.boolValue else { throw BridgeError(code: "not_dir", message: "폴더가 아닙니다") }
            let items = try Library.list(d, hidden: a["hidden"] as? Bool ?? false).prefix(5000).map { item($0.url) }
            return ["path": Library.virtualPath(d), "items": items]
        case "stat":
            let u = try resolve(path)
            guard Library.fm.fileExists(atPath: u.path) else { throw BridgeError(code: "not_found", message: "파일이 없습니다") }
            return item(u)
        case "read":
            let u = try resolve(path)
            guard let it = Library.item(u), !it.isDir else { throw BridgeError(code: "not_found", message: "파일이 없습니다") }
            let off = UInt64(max(0, (a["offset"] as? NSNumber)?.int64Value ?? 0))
            let len = min(max((a["length"] as? NSNumber)?.intValue ?? 512 * 1024, 1), 1024 * 1024)
            let h = try FileHandle(forReadingFrom: u)
            defer { try? h.close() }
            try h.seek(toOffset: off)
            let buf = try h.read(upToCount: len) ?? Data()
            return ["b64": buf.base64EncodedString(), "size": it.size, "eof": Int64(off) + Int64(buf.count) >= it.size]
        case "write":
            try needWrite()
            let target = try resolve(path)
            let dir = target.deletingLastPathComponent()
            _ = try resolve(Library.virtualPath(dir))
            let part = dir.appendingPathComponent(".\(target.lastPathComponent).fm2part")
            let off = (a["offset"] as? NSNumber)?.int64Value ?? 0
            if off == 0 { try? Library.fm.removeItem(at: part) }
            if !Library.fm.fileExists(atPath: part.path) { Library.fm.createFile(atPath: part.path, contents: nil) }
            let cur = Int64((try? part.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
            if cur != off { throw BridgeError(code: "offset_mismatch", message: "전송 위치가 맞지 않습니다 (이어받기 위치 \(cur))") }
            let bytes = Data(base64Encoded: a.str("b64")) ?? Data()
            let h = try FileHandle(forWritingTo: part)
            try h.seekToEnd(); try h.write(contentsOf: bytes); try h.close()
            if a["final"] as? Bool == true {
                let dest = Library.fm.fileExists(atPath: target.path) ? Library.unique(in: dir, name: target.lastPathComponent) : target
                try Library.fm.moveItem(at: part, to: dest)
                return ["path": Library.virtualPath(dest), "size": Library.item(dest)?.size ?? 0, "done": true]
            }
            return ["received": cur + Int64(bytes.count)]
        case "mkdir":
            try needWrite()
            let parent = try resolve(path)
            do { return item(try Library.newFolder(in: parent, name: a.str("name"))) }
            catch let e as ApiError { throw BridgeError(code: e.code, message: e.message) }
        case "rename":
            try needWrite()
            let p = path ?? ""
            if isRoot(p) { throw BridgeError(code: "forbidden", message: "허용 폴더 자체는 바꿀 수 없습니다") }
            let u = try resolve(p)
            do { return item(try Library.rename(u, to: a.str("newName"))) }
            catch let e as ApiError { throw BridgeError(code: e.code, message: e.message) }
        case "delete":
            try needWrite()
            let p = path ?? ""
            if isRoot(p) { throw BridgeError(code: "forbidden", message: "허용 폴더 자체는 삭제할 수 없습니다") }
            let u = try resolve(p)
            try Library.moveToTrash(u) // 아이폰 휴지통으로 (30일 동안 복원 가능)
            return ["trashed": true]
        case "copy", "move":
            try needWrite()
            let p = path ?? ""
            if isRoot(p) { throw BridgeError(code: "forbidden", message: "허용 폴더 자체는 \(op == "copy" ? "복사" : "이동")할 수 없습니다") }
            let src = try resolve(p)
            guard Library.fm.fileExists(atPath: src.path) else { throw BridgeError(code: "not_found", message: "파일이 없습니다") }
            let destV = a.str("destDir")
            let dest = try resolve(destV)
            if destV == p || destV.hasPrefix(p + "/") { throw BridgeError(code: "bad_dest", message: "폴더를 자기 안으로 옮길 수 없습니다") }
            let out = try (op == "copy" ? Library.copy(src, into: dest) : Library.move(src, into: dest))
            return item(out)
        case "thumb":
            let u = try resolve(path)
            let size = min(max((a["size"] as? NSNumber)?.intValue ?? 160, 48), 512)
            guard let jpg = Library.thumbnailJPEG(u, size: size) else { throw BridgeError(code: "no_thumb", message: "미리보기를 만들 수 없습니다") }
            return ["b64": jpg.base64EncodedString(), "mime": "image/jpeg"]
        default:
            throw BridgeError(code: "bad_op", message: "지원하지 않는 작업")
        }
    }
}
