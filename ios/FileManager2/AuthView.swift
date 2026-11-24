import SwiftUI

/// 로그인 · 회원가입 · 이메일 인증 · 비밀번호 재설정 (안드로이드 앱·PC 프로그램과 같은 계정)
struct AuthView: View {
    enum Mode { case login, register, verify, forgot, reset }
    @Environment(\.dismiss) private var dismiss
    @State private var mode: Mode = .login
    @State private var email = UserDefaults.standard.string(forKey: "fm2.lastEmail") ?? ""
    @State private var password = ""
    @State private var password2 = ""
    @State private var name = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("이메일", text: $email).keyboardType(.emailAddress).textContentType(.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    switch mode {
                    case .login:
                        SecureField("비밀번호", text: $password).textContentType(.password)
                    case .register:
                        TextField("이름(선택)", text: $name)
                        SecureField("비밀번호 (8자 이상)", text: $password).textContentType(.newPassword)
                        SecureField("비밀번호 확인", text: $password2).textContentType(.newPassword)
                    case .verify:
                        TextField("이메일로 받은 인증 코드", text: $code).keyboardType(.numberPad)
                    case .forgot:
                        EmptyView()
                    case .reset:
                        TextField("이메일로 받은 코드", text: $code).keyboardType(.numberPad)
                        SecureField("새 비밀번호 (8자 이상)", text: $password).textContentType(.newPassword)
                    }
                } footer: {
                    Text("파일 관리자 2 안드로이드 앱, PC 프로그램과 같은 계정을 씁니다.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                if let info { Section { Text(info).foregroundStyle(.green) } }
                Section {
                    Button { Task { await submit() } } label: {
                        HStack { Spacer(); if busy { ProgressView() } else { Text(primaryTitle).bold() }; Spacer() }
                    }.disabled(busy || email.isEmpty)
                }
                Section {
                    switch mode {
                    case .login:
                        Button("계정이 없나요? 회원가입") { switchTo(.register) }
                        Button("비밀번호를 잊었어요") { switchTo(.forgot) }
                    default:
                        Button("로그인으로 돌아가기") { switchTo(.login) }
                    }
                    Link("개인정보처리방침", destination: URL(string: Config.privacy)!)
                    Link("이용약관", destination: URL(string: Config.terms)!)
                }
            }
            .navigationTitle(title)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        }
    }

    private var title: String {
        switch mode { case .login: return "로그인"; case .register: return "회원가입"; case .verify: return "이메일 인증"; case .forgot: return "비밀번호 찾기"; case .reset: return "비밀번호 재설정" }
    }
    private var primaryTitle: String {
        switch mode { case .login: return "로그인"; case .register: return "가입하기"; case .verify: return "인증하고 로그인"; case .forgot: return "재설정 코드 받기"; case .reset: return "비밀번호 바꾸기" }
    }
    private func switchTo(_ m: Mode) { mode = m; error = nil; info = nil }

    private func submit() async {
        busy = true; error = nil; info = nil
        defer { busy = false }
        let em = email.trimmingCharacters(in: .whitespaces).lowercased()
        UserDefaults.standard.set(em, forKey: "fm2.lastEmail")
        do {
            switch mode {
            case .login:
                try await Api.login(email: em, password: password)
                dismiss()
            case .register:
                guard password.count >= 8 else { error = "비밀번호는 8자 이상이어야 합니다"; return }
                guard password == password2 else { error = "비밀번호 확인이 일치하지 않습니다"; return }
                if try await Api.register(email: em, password: password, name: name) {
                    mode = .verify; info = "\(em) 으로 인증 코드를 보냈습니다"
                } else {
                    try await Api.login(email: em, password: password); dismiss()
                }
            case .verify:
                try await Api.verify(email: em, code: code)
                try await Api.login(email: em, password: password)
                dismiss()
            case .forgot:
                try await Api.forgot(email: em)
                mode = .reset; info = "메일로 받은 코드와 새 비밀번호를 입력하세요"
            case .reset:
                guard password.count >= 8 else { error = "비밀번호는 8자 이상이어야 합니다"; return }
                try await Api.reset(email: em, code: code, password: password)
                mode = .login; password = ""; info = "비밀번호를 바꿨습니다. 새 비밀번호로 로그인하세요"
            }
        } catch {
            if (error as? ApiError)?.code == "not_verified" { mode = .verify }
            self.error = error.localizedDescription
        }
    }
}
