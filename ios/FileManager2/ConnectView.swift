import SwiftUI

/// PC 연결: 켜기/끄기, 연결 요청 승인, 연결된 PC, 연결 코드, 기기·기록
struct ConnectView: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var relay: Relay
    @State private var perms: [PermInfo] = []
    @State private var error: String?
    @State private var approving: PermInfo?
    @State private var showCode = false

    var body: some View {
        Group {
            if !session.loggedIn {
                NeedLogin(text: "PC 프로그램과 같은 계정으로 로그인하면\nPC에서 이 아이폰의 보관함을 보고 파일을 주고받을 수 있습니다.")
            } else {
                List {
                    Section {
                        Toggle(isOn: Binding(get: { relay.enabled }, set: { relay.setEnabled($0) })) {
                            VStack(alignment: .leading) {
                                Text("PC 연결").bold()
                                Text(relay.status).font(.caption).foregroundStyle(relay.online ? .green : .secondary)
                            }
                        }
                        if relay.active > 0, let a = relay.lastActivity {
                            Label("\(a) (\(relay.active)건 진행 중)", systemImage: "arrow.up.arrow.down").font(.callout)
                        }
                    } footer: {
                        Text("아이폰은 앱이 화면에 있을 때만 PC와 연결됩니다. 파일을 주고받는 동안에는 앱을 켜 두세요.")
                    }

                    if !relay.pending.isEmpty {
                        Section("연결 승인 요청") {
                            ForEach(relay.pending) { p in
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(p.pcName).bold()
                                        Text("이 아이폰에 연결하려고 합니다").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Button("거절") { Task { await run { try await Api.reject(p.id) } } }.buttonStyle(.bordered)
                                    Button("승인") { approving = p }.buttonStyle(.borderedProminent)
                                }
                            }
                        }
                    }

                    Section {
                        let approved = perms.filter { $0.status == "approved" }
                        if approved.isEmpty { Text("연결된 PC가 없습니다").foregroundStyle(.secondary) }
                        ForEach(approved) { p in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Circle().fill(p.pcOnline ? .green : .gray).frame(width: 8, height: 8)
                                    Text(p.pcName).bold()
                                    if p.readOnly { Text("읽기 전용").font(.caption2).padding(.horizontal, 6).background(.yellow.opacity(0.3), in: Capsule()) }
                                }
                                Text(p.folders.map(FileBridge.folderLabel).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
                            }
                            .swipeActions { Button("연결 해제", role: .destructive) { Task { await run { try await Api.revoke(p.id) } } } }
                        }
                        Button { showCode = true } label: { Label("연결 코드로 PC 연결하기", systemImage: "number.square") }
                    } header: { Text("연결된 PC") } footer: {
                        Text("PC 프로그램은 \(Config.downloadPage) 에서 받을 수 있습니다 (Windows·macOS·Linux).")
                    }

                    Section {
                        NavigationLink { DevicesView() } label: { Label("로그인된 기기", systemImage: "laptopcomputer.and.iphone") }
                        NavigationLink { LogsView() } label: { Label("접속 기록", systemImage: "list.bullet.rectangle") }
                        Link(destination: URL(string: Config.downloadPage)!) { Label("PC 프로그램 받는 곳 열기", systemImage: "safari") }
                    }
                    if let error { Section { Text(error).foregroundStyle(.red) } }
                }
                .refreshable { await reload() }
                .task(id: relay.refreshTick) { await reload() }
            }
        }
        .navigationTitle("PC 연결")
        .sheet(item: $approving) { p in
            FolderChooser(title: "'\(p.pcName)' 연결 승인", button: "승인") { folders, ro in
                try await Api.approve(p.id, folders: folders, readOnly: ro)
                relay.pending.removeAll { $0.id == p.id }
                await reload()
                return nil
            }
        }
        .sheet(isPresented: $showCode) {
            FolderChooser(title: "연결 코드 만들기", button: "코드 만들기") { folders, ro in
                try await Api.pairCode(folders: folders, readOnly: ro)
            }
        }
    }

    private func reload() async {
        do { perms = try await Api.permissions(); relay.pending = perms.filter { $0.status == "pending" }; error = nil }
        catch { self.error = error.localizedDescription }
    }
    private func run(_ f: () async throws -> Void) async {
        do { try await f(); await reload() } catch { self.error = error.localizedDescription }
    }
}

/// 허용할 폴더 고르기 (보관함 전체 또는 보관함 안의 폴더)
struct FolderChooser: View {
    let title: String
    let button: String
    /// 결과 문자열(연결 코드 등)을 돌려주면 화면에 보여줌
    let onConfirm: ([String], Bool) async throws -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = [Library.virtualRoot]
    @State private var readOnly = false
    @State private var busy = false
    @State private var error: String?
    @State private var result: String?

    private var choices: [(String, String)] {
        [("보관함 전체", Library.virtualRoot)] + ((try? Library.list(Library.root)) ?? []).filter(\.isDir).map { ($0.name, Library.virtualPath($0.url)) }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let result {
                    Section {
                        Text(result).font(.system(size: 44, weight: .bold, design: .monospaced)).frame(maxWidth: .infinity).textSelection(.enabled)
                    } footer: { Text("PC 프로그램의 '연결 코드 입력'에 이 코드를 넣으세요. 5분 동안만 쓸 수 있습니다.") }
                } else {
                    Section {
                        ForEach(choices, id: \.1) { c in
                            Button {
                                if selected.contains(c.1) { selected.remove(c.1) } else { selected.insert(c.1) }
                            } label: {
                                HStack {
                                    Label(c.0, systemImage: c.1 == Library.virtualRoot ? "tray.full" : "folder")
                                    Spacer()
                                    if selected.contains(c.1) { Image(systemName: "checkmark").foregroundStyle(Color("Brand")) }
                                }
                            }.foregroundStyle(.primary)
                        }
                    } header: { Text("PC에서 볼 수 있게 할 폴더") } footer: {
                        Text("iOS는 앱이 휴대폰 전체 저장소를 열 수 없어서 보관함 안의 폴더만 허용할 수 있습니다. 다른 파일은 보관함으로 가져와서 주고받으세요.")
                    }
                    Section { Toggle("읽기 전용 (PC에서 수정·삭제 금지)", isOn: $readOnly) }
                    if let error { Section { Text(error).foregroundStyle(.red) } }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(result == nil ? "취소" : "닫기") { dismiss() } }
                if result == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(button) { Task { await confirm() } }.disabled(selected.isEmpty || busy)
                    }
                }
            }
        }
    }
    private func confirm() async {
        busy = true; defer { busy = false }
        // "보관함 전체"를 고르면 하위 폴더 선택은 의미가 없으므로 정리
        let folders = selected.contains(Library.virtualRoot) ? [Library.virtualRoot] : Array(selected).sorted()
        do {
            if let r = try await onConfirm(folders, readOnly) { result = r } else { dismiss() }
        } catch { self.error = error.localizedDescription }
    }
}

struct DevicesView: View {
    @State private var list: [DeviceInfo] = []
    @State private var error: String?
    var body: some View {
        List {
            ForEach(list) { d in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Image(systemName: d.kind == "pc" ? "desktopcomputer" : "iphone")
                        Text(d.name).bold()
                        if d.isSelf { Text("이 기기").font(.caption2).padding(.horizontal, 6).background(Color("Brand").opacity(0.2), in: Capsule()) }
                        Spacer()
                        Circle().fill(d.online ? .green : .gray).frame(width: 8, height: 8)
                    }
                    Text("\(d.platform.isEmpty ? d.model : d.platform) · 마지막 접속 \(fmtServerDate(d.lastSeen))").font(.caption).foregroundStyle(.secondary)
                }
                .swipeActions {
                    if !d.isSelf {
                        Button("로그아웃", role: .destructive) { Task { try? await Api.revokeDevice(d.id); await reload() } }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("로그인된 기기")
        .refreshable { await reload() }
        .task { await reload() }
    }
    private func reload() async {
        do { list = try await Api.devices() } catch { self.error = error.localizedDescription }
    }
}

struct LogsView: View {
    @State private var list: [LogInfo] = []
    var body: some View {
        List(list) { l in
            VStack(alignment: .leading, spacing: 2) {
                Text(actionLabel(l.action)).bold()
                Text([l.deviceName, l.detail.isEmpty ? nil : l.detail].compactMap { $0 }.joined(separator: " · ")).font(.caption)
                Text(fmtServerDate(l.at)).font(.caption2).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("접속 기록")
        .task { list = (try? await Api.logs()) ?? [] }
    }
}
