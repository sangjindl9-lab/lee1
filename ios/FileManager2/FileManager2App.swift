import SwiftUI

@main
struct FileManager2App: App {
    @StateObject private var session = Session.shared
    @StateObject private var relay = Relay.shared
    @StateObject private var transfers = Transfers.shared
    @Environment(\.scenePhase) private var phase

    init() {
        Library.ensureDefaults()
        Demo.prepareIfRequested()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(relay)
                .environmentObject(transfers)
                .tint(Color("Brand"))
                .onChange(of: phase) { p in relay.scenePhase(active: p == .active) }
                .onChange(of: session.loggedIn) { v in if v { relay.start() } }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var relay: Relay
    // 실행 인자 -startTab N 으로 첫 탭 지정 (빌드 서버 화면 확인용)
    @State private var tab = UserDefaults.standard.integer(forKey: "startTab")
    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { FolderView(dir: Library.root, title: "보관함") }
                .tabItem { Label("보관함", systemImage: "folder") }.tag(0)
            NavigationStack { ConnectView() }
                .tabItem { Label("PC 연결", systemImage: "desktopcomputer") }.tag(1)
                .badge(relay.pending.count)
            NavigationStack { CloudView() }
                .tabItem { Label("클라우드", systemImage: "cloud") }.tag(2)
            NavigationStack { SettingsView() }
                .tabItem { Label("설정", systemImage: "gearshape") }.tag(3)
        }
        .onAppear { relay.start() }
    }
}

/// 공통: 로그인이 필요한 화면 안내
struct NeedLogin: View {
    let text: String
    @State private var show = false
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.crop.circle.badge.checkmark").font(.system(size: 56)).foregroundStyle(Color("Brand"))
            Text(text).multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("로그인 / 회원가입") { show = true }.buttonStyle(.borderedProminent)
        }
        .padding(32)
        .sheet(isPresented: $show) { AuthView() }
    }
}

/// 공통: 이름 입력 창
struct NamePrompt: ViewModifier {
    @Binding var isPresented: Bool
    let title: String
    let initial: String
    let onDone: (String) -> Void
    @State private var text = ""
    func body(content: Content) -> some View {
        content.alert(title, isPresented: $isPresented) {
            TextField("이름", text: $text).textInputAutocapitalization(.never)
            Button("취소", role: .cancel) {}
            Button("확인") { onDone(text) }
        }
        .onChange(of: isPresented) { v in if v { text = initial } }
    }
}
extension View {
    func namePrompt(_ title: String, isPresented: Binding<Bool>, initial: String = "", onDone: @escaping (String) -> Void) -> some View {
        modifier(NamePrompt(isPresented: isPresented, title: title, initial: initial, onDone: onDone))
    }
}
