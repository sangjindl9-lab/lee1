import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var session: Session
    @State private var showLogin = false
    @State private var confirmLogout = false
    @State private var deleting = false
    @State private var deletePw = ""
    @State private var error: String?
    @State private var usage: Int64 = 0

    var body: some View {
        Form {
            Section("계정") {
                if session.loggedIn {
                    LabeledContent("이메일", value: session.email ?? "-")
                    Button("로그아웃") { confirmLogout = true }
                    Button("계정 삭제", role: .destructive) { deleting = true }
                } else {
                    Button("로그인 / 회원가입") { showLogin = true }
                }
            }
            Section {
                LabeledContent("보관함 사용량", value: fmtSize(usage))
                Link(destination: URL(string: "shareddocuments://")!) { Label("\"파일\" 앱에서 열기", systemImage: "folder") }
            } header: { Text("보관함") } footer: {
                Text("\"파일\" 앱 › 나의 iPhone › 파일 관리자 2 에서도 같은 보관함이 보입니다.")
            }
            Section("정보") {
                LabeledContent("버전", value: Config.appVersion)
                Link("PC 프로그램 받기 (Windows·macOS·Linux)", destination: URL(string: Config.downloadPage)!)
                Link("개인정보처리방침", destination: URL(string: Config.privacy)!)
                Link("이용약관", destination: URL(string: Config.terms)!)
                Link("문의: pm999@naver.com", destination: URL(string: "mailto:pm999@naver.com")!)
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .navigationTitle("설정")
        .onAppear { DispatchQueue.global().async { let u = Library.usage(); DispatchQueue.main.async { usage = u } } }
        .sheet(isPresented: $showLogin) { AuthView() }
        .confirmationDialog("로그아웃할까요? PC 연결도 끊어집니다.", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("로그아웃", role: .destructive) { Task { await Api.logout() } }
        }
        .alert("계정을 삭제할까요?", isPresented: $deleting) {
            SecureField("비밀번호", text: $deletePw)
            Button("취소", role: .cancel) { deletePw = "" }
            Button("삭제", role: .destructive) {
                let pw = deletePw; deletePw = ""
                Task { do { try await Api.deleteAccount(password: pw) } catch { self.error = error.localizedDescription } }
            }
        } message: { Text("계정과 연결 정보, 클라우드 연결이 모두 삭제되며 되돌릴 수 없습니다. 보관함의 파일은 이 아이폰에 그대로 남습니다.") }
    }
}
