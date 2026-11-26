import Foundation
import UIKit

/// 앱스토어 스크린샷 촬영용 (빌드 서버가 실행 인자로만 켬). 일반 사용자에게는 동작하지 않습니다.
///   -demoSeed 1           보관함에 예시 파일 만들기
///   -demoEmail / -demoPassword   심사용 데모 계정으로 자동 로그인
enum Demo {
    static func prepareIfRequested() {
        let ud = UserDefaults.standard
        if ud.bool(forKey: "demoSeed") { seed() }
        if let e = ud.string(forKey: "demoEmail"), let p = ud.string(forKey: "demoPassword"), !e.isEmpty, !p.isEmpty {
            Task { try? await Api.login(email: e, password: p) }
        }
    }

    private static func seed() {
        let fm = FileManager.default, root = Library.root
        func dir(_ n: String) -> URL { let u = root.appendingPathComponent(n, isDirectory: true); try? fm.createDirectory(at: u, withIntermediateDirectories: true); return u }
        let docs = dir("문서"), photos = dir("사진"), recv = dir(Library.receivedFolder)
        _ = dir("현장 자료")
        let texts: [(URL, String, Int)] = [
            (docs.appendingPathComponent("2026 견적서.pdf"), "%PDF-1.4\n", 182_000),
            (docs.appendingPathComponent("공사 일정표.xlsx"), "PK", 48_000),
            (docs.appendingPathComponent("회의록 11월.txt"), "회의록", 3_200),
            (recv.appendingPathComponent("PC에서 받은 도면.dwg"), "AC1027", 2_400_000),
            (recv.appendingPathComponent("발표자료.pptx"), "PK", 5_600_000),
        ]
        for (u, head, size) in texts where !fm.fileExists(atPath: u.path) {
            var d = Data(head.utf8); d.append(Data(count: max(0, size - d.count))); try? d.write(to: u)
        }
        let colors: [UIColor] = [.systemTeal, .systemOrange, .systemIndigo, .systemGreen]
        for (i, c) in colors.enumerated() {
            let u = photos.appendingPathComponent(String(format: "IMG_20261126_%02d.jpg", i + 1))
            if fm.fileExists(atPath: u.path) { continue }
            let img = UIGraphicsImageRenderer(size: CGSize(width: 1200, height: 900)).image { ctx in
                c.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 1200, height: 900))
                UIColor.white.withAlphaComponent(0.35).setFill(); ctx.fill(CGRect(x: 0, y: 600, width: 1200, height: 300))
            }
            try? img.jpegData(compressionQuality: 0.8)?.write(to: u)
        }
    }
}
