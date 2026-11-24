import Foundation

/// 클라우드(Google Drive·Dropbox) — 서버가 공급자와 통신하고 파일은 저장 없이 중계합니다 (안드로이드·PC와 같은 연결을 함께 씀)
struct CloudProvider: Identifiable, Hashable { let id: String, label: String, ready: Bool }
struct CloudConn: Identifiable, Hashable {
    let id: String, provider: String, label: String, account: String, ready: Bool
    var rootRef: String { provider == "dropbox" ? "" : "root" }
    var icon: String { provider == "dropbox" ? "shippingbox" : "externaldrive.connected.to.line.below" }
}
struct CloudItem: Identifiable, Hashable { let id: String, name: String, dir: Bool, size: Int64, mtime: Int64, native: Bool }

enum CloudApi {
    private static func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }

    static func providers() async throws -> [CloudProvider] {
        ((try await Api.call("GET", "/api/cloud/providers", auth: false)) as? [[String: Any]] ?? [])
            .map { CloudProvider(id: $0.str("id"), label: $0.str("label"), ready: $0["ready"] as? Bool ?? false) }
            .filter { $0.id != "onedrive" }
    }
    static func connections() async throws -> [CloudConn] {
        ((try await Api.call("GET", "/api/cloud")) as? [[String: Any]] ?? [])
            .map { CloudConn(id: $0.str("id"), provider: $0.str("provider"), label: $0.str("label"), account: $0.str("account"), ready: $0["ready"] as? Bool ?? false) }
    }
    static func startURL(_ provider: String) async throws -> URL {
        let r = try await Api.call("POST", "/api/cloud/\(provider)/start") as? [String: Any]
        guard let u = URL(string: r?.str("url") ?? "") else { throw ApiError(code: "bad_url", message: "연결 주소를 받지 못했습니다") }
        return u
    }
    static func disconnect(_ id: String) async throws { try await Api.call("DELETE", "/api/cloud/\(id)") }
    static func list(_ conn: String, _ ref: String) async throws -> [CloudItem] {
        let o = try await Api.call("GET", "/api/cloud/\(conn)/list?id=\(enc(ref))") as? [String: Any] ?? [:]
        return (o["items"] as? [[String: Any]] ?? []).map {
            CloudItem(id: $0.str("id"), name: $0.str("name"), dir: $0["dir"] as? Bool ?? false, size: $0.int64("size"), mtime: $0.int64("mtime"), native: $0["native"] as? Bool ?? false)
        }.sorted { $0.dir != $1.dir ? $0.dir : $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    static func mkdir(_ conn: String, parent: String, name: String) async throws {
        try await Api.call("POST", "/api/cloud/\(conn)/mkdir", ["parent": parent, "name": name])
    }
    static func rename(_ conn: String, id: String, name: String) async throws {
        try await Api.call("POST", "/api/cloud/\(conn)/rename", ["id": id, "name": name])
    }
    static func delete(_ conn: String, id: String) async throws {
        try await Api.call("POST", "/api/cloud/\(conn)/delete", ["id": id])
    }
    /// 공유 링크 만들기 (기본 24시간)
    static func share(_ conn: String, id: String, hours: Int = 24) async throws -> String {
        let r = try await Api.call("POST", "/api/shares", ["kind": "cloud", "connId": conn, "id": id, "expiresHours": hours]) as? [String: Any]
        return r?.str("url") ?? ""
    }

    static func errorText(_ data: Data?, _ status: Int, _ fallback: String) -> String {
        if let d = data, let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], !o.str("message").isEmpty { return o.str("message") }
        return "\(fallback) (\(status))"
    }
}

/// 클라우드 전송 목록 (화면을 나가도 계속 진행)
@MainActor
final class Transfers: ObservableObject {
    static let shared = Transfers()
    final class T: ObservableObject, Identifiable {
        let id = UUID()
        let up: Bool, name: String, size: Int64
        @Published var done: Int64 = 0
        @Published var status = "대기"   // 대기·진행·완료·실패·취소
        @Published var error: String?
        @Published var saved: URL?
        var task: URLSessionTask?
        init(up: Bool, name: String, size: Int64) { self.up = up; self.name = name; self.size = size }
    }
    @Published var items: [T] = []
    var onFinished: ((T) -> Void)?

    private lazy var big: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 120
        c.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: c)
    }()

    /// 받기: 보관함 "받은 파일" 폴더로 저장 (같은 이름이 있으면 번호를 붙임)
    func download(conn: String, item: CloudItem) {
        let t = T(up: false, name: item.name, size: item.size)
        items.insert(t, at: 0)
        var r = Api.request("GET", "/api/cloud/\(conn)/download?id=\(item.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? item.id)")
        r.timeoutInterval = 120
        t.status = "진행"
        let task = big.downloadTask(with: r) { [weak self] tmp, resp, err in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            var saved: URL?, msg: String?
            if let tmp, (200..<300).contains(status) {
                let dir = Library.root.appendingPathComponent(Library.receivedFolder, isDirectory: true)
                try? Library.fm.createDirectory(at: dir, withIntermediateDirectories: true)
                let dest = Library.unique(in: dir, name: item.name)
                do { try Library.fm.moveItem(at: tmp, to: dest); saved = dest } catch { msg = "저장하지 못했습니다" }
            } else if let tmp {
                msg = CloudApi.errorText(try? Data(contentsOf: tmp), status, "받지 못했습니다")
            } else { msg = err?.localizedDescription ?? "받지 못했습니다" }
            let canceled = (err as? URLError)?.code == .cancelled
            Task { @MainActor in self?.finish(t, saved: saved, error: msg, canceled: canceled) }
        }
        observe(t, task)
    }

    /// 올리기: 보관함의 파일을 스트리밍으로 전송
    func upload(conn: String, parent: String, file: URL) {
        let size = Library.item(file)?.size ?? 0
        let t = T(up: true, name: file.lastPathComponent, size: size)
        items.insert(t, at: 0)
        let enc = { (s: String) in s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }
        var r = Api.request("POST", "/api/cloud/\(conn)/upload?parent=\(enc(parent))&name=\(enc(file.lastPathComponent))")
        r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        t.status = "진행"
        let task = big.uploadTask(with: r, fromFile: file) { [weak self] data, resp, err in
            let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let ok = err == nil && (200..<300).contains(status)
            let msg = ok ? nil : (err != nil ? err!.localizedDescription : CloudApi.errorText(data, status, "올리지 못했습니다"))
            let canceled = (err as? URLError)?.code == .cancelled
            Task { @MainActor in self?.finish(t, saved: nil, error: msg, canceled: canceled) }
        }
        observe(t, task)
    }

    private var observers: [UUID: NSKeyValueObservation] = [:]
    private func observe(_ t: T, _ task: URLSessionTask) {
        t.task = task
        observers[t.id] = task.observe(\.countOfBytesReceived) { tk, _ in
            let n = t.up ? tk.countOfBytesSent : tk.countOfBytesReceived
            Task { @MainActor in t.done = n }
        }
        if t.up {
            observers[t.id] = task.observe(\.countOfBytesSent) { tk, _ in
                let n = tk.countOfBytesSent
                Task { @MainActor in t.done = n }
            }
        }
        task.resume()
    }

    private func finish(_ t: T, saved: URL?, error: String?, canceled: Bool) {
        observers[t.id] = nil
        if canceled { t.status = "취소" }
        else if let error { t.status = "실패"; t.error = error }
        else { t.status = "완료"; t.done = max(t.size, t.done); t.saved = saved }
        onFinished?(t)
    }

    func cancel(_ t: T) { t.task?.cancel() }
    func clearFinished() { items.removeAll { ["완료", "실패", "취소"].contains($0.status) } }
}
