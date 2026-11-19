import UIKit
import Capacitor
import UniformTypeIdentifiers

/// 이음과 문서 — 파일 열기·저장·공유·인쇄 (안드로이드 EumFilesPlugin.java 와 같은 모양의 iOS 판)
///
/// 화면(JS)에 주는 "uri" 는 두 가지다.
///  - "file://…"  : 앱 안의 파일(다른 앱에서 "이음과 문서로 열기"로 받은 사본 등). 그대로 읽고 쓴다.
///  - "eumbm:…"   : 파일 앱에서 고른 파일의 보안 북마크(base64). 앱을 다시 켜도 같은 파일에 접근할 수 있다.
@objc(EumFilesPlugin)
public class EumFilesPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "EumFilesPlugin"
    public let jsName = "EumFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLaunch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickOpen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickSave", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "canRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exit", returnType: CAPPluginReturnPromise),
    ]

    private var pendingLaunch: [String: Any]?
    private var launchAsked = false
    private var pickCall: CAPPluginCall?
    private var saveTemp: URL?

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(onOpenURL(_:)), name: .capacitorOpenURL, object: nil)
        // 앱이 꺼져 있다가 파일로 켜진 경우, 이 플러그인이 준비되기 전에 받은 주소
        if let url = ApplicationDelegateProxy.shared.lastURL, url.isFileURL { pendingLaunch = keepCopy(of: url) }
    }

    // ── 다른 앱에서 "이음과 문서로 열기" ────────────────────────────
    @objc private func onOpenURL(_ note: Notification) {
        guard let info = note.object as? [String: Any], let url = info["url"] as? URL, url.isFileURL else { return }
        guard let file = keepCopy(of: url) else { return }
        if launchAsked {
            if let data = try? JSONSerialization.data(withJSONObject: file), let json = String(data: data, encoding: .utf8) {
                bridge?.triggerWindowJSEvent(eventName: "eumLaunch", data: json)
            }
        } else {
            pendingLaunch = file
        }
    }

    /// 넘겨받은 파일은 앱 문서 폴더(recent/)에 복사해 두고 그 경로를 쓴다 — 앱을 다시 켜도 열 수 있다.
    private func keepCopy(of url: URL) -> [String: Any]? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let fm = FileManager.default
        let dir = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("recent", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000))_\(url.lastPathComponent)")
        do { try fm.copyItem(at: url, to: dest) } catch { return nil }
        return ["uri": dest.absoluteString, "name": url.lastPathComponent]
    }

    @objc func getLaunch(_ call: CAPPluginCall) {
        launchAsked = true
        let file = pendingLaunch ?? [:]
        pendingLaunch = nil
        call.resolve(file)
    }

    // ── uri ↔ URL ───────────────────────────────────────────────
    private func bookmarkUri(_ url: URL) -> String {
        if let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            return "eumbm:" + data.base64EncodedString()
        }
        return url.absoluteString
    }

    /// 북마크를 풀어 접근을 시작한다. 끝나면 반드시 stopAccessing… 을 불러야 한다.
    private func resolve(_ uri: String) -> (url: URL, scoped: Bool)? {
        if uri.hasPrefix("eumbm:") {
            guard let data = Data(base64Encoded: String(uri.dropFirst(6))) else { return nil }
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
            return (url, url.startAccessingSecurityScopedResource())
        }
        guard let url = URL(string: uri) else { return nil }
        return (url, false)
    }

    private func withFile<T>(_ uri: String?, writing: Bool = false, _ body: (URL) throws -> T) throws -> T {
        guard let uri = uri, let r = resolve(uri) else { throw NSError(domain: "EumFiles", code: 1, userInfo: [NSLocalizedDescriptionKey: "파일 위치를 알 수 없습니다"]) }
        defer { if r.scoped { r.url.stopAccessingSecurityScopedResource() } }
        var result: T?
        var failure: Error?
        // 파일 앱(iCloud 등)의 파일은 조정된 읽기/쓰기로 다뤄야 내려받기가 끝난 내용을 얻는다.
        var coordErr: NSError?
        let run: (URL) -> Void = { u in
            do { result = try body(u) } catch { failure = error }
        }
        if writing {
            NSFileCoordinator().coordinate(writingItemAt: r.url, options: .forReplacing, error: &coordErr, byAccessor: run)
        } else {
            NSFileCoordinator().coordinate(readingItemAt: r.url, options: [], error: &coordErr, byAccessor: run)
        }
        if let e = failure ?? coordErr { throw e }
        return result!
    }

    // ── 파일 고르기 ─────────────────────────────────────────────
    @objc func pickOpen(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: false)
            picker.delegate = self
            self.pickCall = call
            self.saveTemp = nil
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    /// 저장할 곳 고르기: 빈 파일을 만들어 "내보내기" 창으로 옮기고, 옮겨진 위치를 돌려준다(그다음 write 로 내용을 쓴다).
    @objc func pickSave(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "문서.hwp"
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let temp = dir.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try Data().write(to: temp)
        } catch {
            call.reject("저장 위치를 준비하지 못했습니다: \(error.localizedDescription)")
            return
        }
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forExporting: [temp], asCopy: false)
            picker.delegate = self
            self.pickCall = call
            self.saveTemp = temp
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall, let url = urls.first else { return }
        pickCall = nil
        saveTemp = nil
        call.resolve(["uri": bookmarkUri(url), "name": url.lastPathComponent])
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve([:])
        pickCall = nil
        if let t = saveTemp { try? FileManager.default.removeItem(at: t.deletingLastPathComponent()) }
        saveTemp = nil
    }

    // ── 읽기·쓰기 ───────────────────────────────────────────────
    @objc func canRead(_ call: CAPPluginCall) {
        let ok = (try? withFile(call.getString("uri")) { url in FileManager.default.isReadableFile(atPath: url.path) }) ?? false
        call.resolve(["ok": ok])
    }

    @objc func read(_ call: CAPPluginCall) {
        do {
            let (data, name) = try withFile(call.getString("uri")) { url in (try Data(contentsOf: url), url.lastPathComponent) }
            call.resolve(["data": data.base64EncodedString(), "name": name])
        } catch {
            call.reject("파일을 읽을 수 없습니다: \(error.localizedDescription)")
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("저장할 내용이 없습니다")
            return
        }
        do {
            try withFile(call.getString("uri"), writing: true) { url in try data.write(to: url) }
            call.resolve()
        } catch {
            call.reject("파일을 저장할 수 없습니다: \(error.localizedDescription)")
        }
    }

    // ── 공유·인쇄·종료 ──────────────────────────────────────────
    @objc func share(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "문서.hwp"
        do {
            let data = try withFile(call.getString("uri")) { url in try Data(contentsOf: url) }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let f = dir.appendingPathComponent(name)
            try data.write(to: f, options: .atomic)
            DispatchQueue.main.async {
                guard let vc = self.bridge?.viewController else { return }
                let sheet = UIActivityViewController(activityItems: [f], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = vc.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
                vc.present(sheet, animated: true)
                call.resolve()
            }
        } catch {
            call.reject("공유할 수 없습니다: \(error.localizedDescription)")
        }
    }

    @objc func print(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "문서"
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView else { call.reject("인쇄할 화면이 없습니다"); return }
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = name
            info.outputType = .general
            let pc = UIPrintInteractionController.shared
            pc.printInfo = info
            pc.printFormatter = web.viewPrintFormatter()
            pc.present(animated: true) { _, _, _ in call.resolve() }
        }
    }

    /// iOS 앱은 스스로 종료하지 않는다(애플 지침). 요청은 받아 두기만 한다.
    @objc func exit(_ call: CAPPluginCall) {
        call.resolve()
    }
}
