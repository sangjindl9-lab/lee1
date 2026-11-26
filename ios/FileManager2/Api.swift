import Foundation
import Security
import UIKit

/// PC CONNECT 서버 (안드로이드 앱·PC 프로그램과 같은 서버, 같은 계정)
enum Config {
    static let server = "https://fm2.ieumerp.kr"
    static let wsURL = "wss://fm2.ieumerp.kr/ws"
    static let downloadPage = "https://fm2.ieumerp.kr/download"
    static let privacy = "https://fm2.ieumerp.kr/privacy"
    static let terms = "https://fm2.ieumerp.kr/terms"
    static var appVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0" }
}

struct ApiError: LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }
}

/// 로그인 토큰은 iOS 키체인에만 보관 (이 기기에서만, 잠금 해제 후 접근)
enum Keychain {
    private static let service = "kr.eumsoft.filemanager2"
    static func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return memory[key] }
        return String(data: d, encoding: .utf8)
    }
    /// 키체인을 쓸 수 없는 환경(서명 없는 시뮬레이터 빌드 등)에서는 실행 중에만 메모리에 보관
    nonisolated(unsafe) private static var memory: [String: String] = [:]
    static func set(_ value: String?, _ key: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        memory[key] = nil
        guard let v = value, let d = v.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = d
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(add as CFDictionary, nil) != errSecSuccess { memory[key] = v }
    }
}

/// 로그인 상태 (화면이 함께 봄)
@MainActor
final class Session: ObservableObject {
    static let shared = Session()
    @Published private(set) var email: String?
    @Published private(set) var deviceId: String?
    @Published private(set) var loggedIn = false

    private let ud = UserDefaults.standard
    private init() {
        email = ud.string(forKey: "fm2.email")
        deviceId = ud.string(forKey: "fm2.deviceId")
        loggedIn = Keychain.get("session") != nil && email != nil
    }
    nonisolated static var token: String? { Keychain.get("session") }
    nonisolated static var installId: String {
        if let v = UserDefaults.standard.string(forKey: "fm2.install") { return v }
        let v = "ios-" + UUID().uuidString.lowercased()
        UserDefaults.standard.set(v, forKey: "fm2.install")
        return v
    }
    func saveLogin(token: String, email: String, deviceId: String) {
        Keychain.set(token, "session")
        ud.set(email, forKey: "fm2.email"); ud.set(deviceId, forKey: "fm2.deviceId")
        self.email = email; self.deviceId = deviceId; loggedIn = true
    }
    func clear() {
        Keychain.set(nil, "session")
        ud.removeObject(forKey: "fm2.email"); ud.removeObject(forKey: "fm2.deviceId")
        email = nil; deviceId = nil; loggedIn = false
        Relay.shared.stop()
    }
}

// MARK: - 모델

struct PermInfo: Identifiable, Hashable {
    let id: String, pcId: String, pcName: String, status: String
    let folders: [String], readOnly: Bool, pcOnline: Bool, createdAt: String
    init(_ o: [String: Any]) {
        id = o.str("id"); pcId = o.str("pcId"); pcName = o.str("pcName"); status = o.str("status")
        folders = o["folders"] as? [String] ?? []; readOnly = o["readOnly"] as? Bool ?? false
        pcOnline = o["pcOnline"] as? Bool ?? false; createdAt = o.str("createdAt")
    }
}
struct DeviceInfo: Identifiable, Hashable {
    let id: String, kind: String, name: String, model: String, platform: String, online: Bool, isSelf: Bool, lastSeen: String?
    init(_ o: [String: Any]) {
        id = o.str("id"); kind = o.str("kind"); name = o.str("name"); model = o.str("model"); platform = o.str("platform")
        online = o["online"] as? Bool ?? false; isSelf = o["self"] as? Bool ?? false
        lastSeen = o["last_seen"] as? String
    }
}
struct LogInfo: Identifiable, Hashable {
    let id = UUID()
    let action: String, detail: String, deviceName: String?, at: String
    init(_ o: [String: Any]) { action = o.str("action"); detail = o.str("detail"); deviceName = o["device_name"] as? String; at = o.str("at") }
}

extension Dictionary where Key == String, Value == Any {
    func str(_ k: String) -> String {
        if let s = self[k] as? String { return s }
        if let n = self[k] as? NSNumber { return n.stringValue }
        return ""
    }
    func int64(_ k: String) -> Int64 { (self[k] as? NSNumber)?.int64Value ?? Int64(self.str(k)) ?? 0 }
}

// MARK: - REST API

enum Api {
    static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 30
        return URLSession(configuration: c)
    }()

    static func request(_ method: String, _ path: String, auth: Bool = true) -> URLRequest {
        var r = URLRequest(url: URL(string: Config.server + path)!)
        r.httpMethod = method
        if auth, let t = Session.token { r.setValue("Bearer " + t, forHTTPHeaderField: "Authorization") }
        return r
    }

    @discardableResult
    static func call(_ method: String, _ path: String, _ body: [String: Any]? = nil, auth: Bool = true) async throws -> Any {
        var r = request(method, path, auth: auth)
        if method != "GET" {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try JSONSerialization.data(withJSONObject: body ?? [:])
        }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await session.data(for: r) } catch {
            throw ApiError(code: "network", message: "서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요")
        }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let parsed = (try? JSONSerialization.jsonObject(with: data)) ?? [:]
        guard (200..<300).contains(status) else {
            let o = parsed as? [String: Any] ?? [:]
            if status == 401 && auth { await MainActor.run { Session.shared.clear() } }
            let m = o.str("message")
            throw ApiError(code: o.str("error").isEmpty ? "http_\(status)" : o.str("error"), message: m.isEmpty ? "요청을 처리하지 못했습니다 (\(status))" : m)
        }
        return parsed
    }

    /// 서버 역할상 휴대폰 쪽 기기는 kind "android"(=모바일)로 등록합니다. 기종·OS는 model·platform 으로 구분됩니다.
    static func deviceJSON() async -> [String: Any] {
        let (name, model, os) = await MainActor.run { (UIDevice.current.name, UIDevice.current.model, UIDevice.current.systemVersion) }
        return ["kind": "android", "name": name, "model": model, "platform": "iOS " + os, "appVersion": Config.appVersion, "installId": Session.installId]
    }

    static func register(email: String, password: String, name: String) async throws -> Bool {
        let r = try await call("POST", "/api/auth/register", ["email": email, "password": password, "name": name], auth: false) as? [String: Any]
        return r?["needsVerification"] as? Bool ?? false
    }
    static func verify(email: String, code: String) async throws {
        try await call("POST", "/api/auth/verify", ["email": email, "code": code], auth: false)
    }
    static func login(email: String, password: String) async throws {
        let dev = await deviceJSON()
        guard let r = try await call("POST", "/api/auth/login", ["email": email, "password": password, "device": dev], auth: false) as? [String: Any],
              let token = r["token"] as? String else { throw ApiError(code: "bad_response", message: "로그인 응답이 올바르지 않습니다") }
        let user = r["user"] as? [String: Any] ?? [:]
        let device = r["device"] as? [String: Any] ?? [:]
        await MainActor.run { Session.shared.saveLogin(token: token, email: user.str("email").isEmpty ? email : user.str("email"), deviceId: device.str("id")) }
    }
    static func forgot(email: String) async throws { try await call("POST", "/api/auth/forgot", ["email": email], auth: false) }
    static func reset(email: String, code: String, password: String) async throws {
        try await call("POST", "/api/auth/reset", ["email": email, "code": code, "password": password], auth: false)
    }
    static func logout() async {
        _ = try? await call("POST", "/api/auth/logout")
        await MainActor.run { Session.shared.clear() }
    }
    static func deleteAccount(password: String) async throws {
        try await call("DELETE", "/api/account", ["password": password])
        await MainActor.run { Session.shared.clear() }
    }

    static func permissions() async throws -> [PermInfo] {
        ((try await call("GET", "/api/permissions")) as? [[String: Any]] ?? []).map(PermInfo.init)
    }
    static func approve(_ id: String, folders: [String], readOnly: Bool) async throws {
        AllowedFolders.remember(folders)
        try await call("POST", "/api/permissions/\(id)/approve", ["folders": folders, "readOnly": readOnly])
    }
    static func reject(_ id: String) async throws { try await call("POST", "/api/permissions/\(id)/reject") }
    static func revoke(_ id: String) async throws { try await call("POST", "/api/permissions/\(id)/revoke") }
    static func pairCode(folders: [String], readOnly: Bool) async throws -> String {
        AllowedFolders.remember(folders)
        let r = try await call("POST", "/api/pair/code", ["folders": folders, "readOnly": readOnly]) as? [String: Any]
        return r?.str("code") ?? ""
    }
    static func devices() async throws -> [DeviceInfo] {
        ((try await call("GET", "/api/devices")) as? [[String: Any]] ?? []).map(DeviceInfo.init)
    }
    static func revokeDevice(_ id: String) async throws { try await call("POST", "/api/devices/\(id)/revoke") }
    static func logs() async throws -> [LogInfo] {
        ((try await call("GET", "/api/logs")) as? [[String: Any]] ?? []).map(LogInfo.init)
    }
}

/// 이 아이폰에서 사용자가 직접 허용한 폴더 — 서버가 보낸 허용 범위가 이를 넘으면 거부
enum AllowedFolders {
    static var all: Set<String> { Set(UserDefaults.standard.stringArray(forKey: "fm2.userFolders") ?? []) }
    static func remember(_ f: [String]) { UserDefaults.standard.set(Array(all.union(f)), forKey: "fm2.userFolders") }
}

func actionLabel(_ a: String) -> String {
    switch a {
    case "login": return "로그인"
    case "login_failed": return "로그인 실패"
    case "register": return "회원가입"
    case "pair_request": return "PC 연결 요청"
    case "pair_approved": return "연결 승인"
    case "pair_rejected": return "연결 거절"
    case "pair_revoked": return "연결 해제"
    case "pair_code_used": return "연결 코드로 연결"
    case "device_revoked": return "기기 로그아웃"
    case "password_reset": return "비밀번호 재설정"
    case "remote_delete": return "PC에서 삭제"
    case "remote_rename": return "PC에서 이름 변경"
    case "remote_mkdir": return "PC에서 폴더 생성"
    default: return a
    }
}

func fmtSize(_ n: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: n, countStyle: .file)
}
func fmtDate(_ d: Date) -> String {
    let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR"); f.dateFormat = "yyyy.MM.dd HH:mm"
    return f.string(from: d)
}
func fmtServerDate(_ s: String?) -> String {
    guard let s, !s.isEmpty else { return "-" }
    let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) { return fmtDate(d) }
    return s
}
