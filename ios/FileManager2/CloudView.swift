import SwiftUI
import SafariServices

/// 클라우드 목록 (Google Drive · Dropbox)
struct CloudView: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var transfers: Transfers
    @State private var conns: [CloudConn] = []
    @State private var providers: [CloudProvider] = []
    @State private var error: String?
    @State private var authURL: URL?

    var body: some View {
        Group {
            if !session.loggedIn {
                NeedLogin(text: "로그인하면 Google Drive·Dropbox를 연결해\n보관함과 파일을 주고받을 수 있습니다.")
            } else {
                List {
                    Section {
                        if conns.isEmpty { Text("연결된 클라우드가 없습니다").foregroundStyle(.secondary) }
                        ForEach(conns) { c in
                            NavigationLink {
                                CloudBrowser(conn: c, ref: c.rootRef, title: c.label)
                            } label: {
                                VStack(alignment: .leading) {
                                    Label(c.label, systemImage: c.icon).bold()
                                    Text(c.account).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .disabled(!c.ready)
                            .swipeActions {
                                Button("연결 끊기", role: .destructive) { Task { try? await CloudApi.disconnect(c.id); await reload() } }
                            }
                        }
                    } header: { Text("내 클라우드") } footer: {
                        Text("안드로이드 앱·PC 프로그램에서 연결한 클라우드도 여기에 함께 보입니다.")
                    }
                    Section("클라우드 추가") {
                        ForEach(providers) { p in
                            Button { Task { await connect(p) } } label: { Label("\(p.label) 연결", systemImage: "plus.circle") }
                                .disabled(!p.ready)
                        }
                    }
                    if !transfers.items.isEmpty {
                        Section {
                            ForEach(transfers.items) { t in TransferRow(t: t) }
                        } header: {
                            HStack { Text("전송"); Spacer(); Button("완료 지우기") { transfers.clearFinished() }.font(.caption) }
                        }
                    }
                    if let error { Section { Text(error).foregroundStyle(.red) } }
                }
                .refreshable { await reload() }
                .task { await reload() }
            }
        }
        .navigationTitle("클라우드")
        .sheet(item: $authURL, onDismiss: { Task { await reload() } }) { u in SafariView(url: u).ignoresSafeArea() }
    }

    private func reload() async {
        do {
            async let c = CloudApi.connections()
            async let p = CloudApi.providers()
            let (cc, pp) = try await (c, p)
            conns = cc; providers = pp
            error = nil
        } catch { self.error = error.localizedDescription }
    }
    private func connect(_ p: CloudProvider) async {
        do { authURL = try await CloudApi.startURL(p.id) } catch { self.error = error.localizedDescription }
    }
}

extension URL: Identifiable { public var id: String { absoluteString } }

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

struct TransferRow: View {
    @ObservedObject var t: Transfers.T
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: t.up ? "arrow.up.circle" : "arrow.down.circle")
                Text(t.name).lineLimit(1)
                Spacer()
                Text(t.status).font(.caption).foregroundStyle(t.status == "실패" ? .red : .secondary)
                if t.status == "진행" { Button { Transfers.shared.cancel(t) } label: { Image(systemName: "xmark.circle") }.buttonStyle(.borderless) }
            }
            if t.status == "진행", t.size > 0 { ProgressView(value: Double(min(t.done, t.size)), total: Double(t.size)) }
            if let e = t.error { Text(e).font(.caption).foregroundStyle(.red) }
            if t.status == "완료", !t.up { Text("보관함 › \(Library.receivedFolder) 에 저장했습니다").font(.caption).foregroundStyle(.secondary) }
        }
    }
}

/// 클라우드 폴더 화면
struct CloudBrowser: View {
    let conn: CloudConn
    let ref: String
    let title: String
    @State private var items: [CloudItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var newFolder = false
    @State private var renaming: CloudItem?
    @State private var renameShown = false
    @State private var pickUpload = false
    @State private var shareURL: String?

    var body: some View {
        List {
            if loading { ProgressView() }
            if let error { Text(error).foregroundStyle(.red) }
            if !loading && items.isEmpty && error == nil { Text("비어 있는 폴더입니다").foregroundStyle(.secondary) }
            ForEach(items) { it in
                Group {
                    if it.dir {
                        NavigationLink { CloudBrowser(conn: conn, ref: it.id, title: it.name) } label: { row(it) }
                    } else {
                        Menu { menu(it) } label: { row(it) }.foregroundStyle(.primary)
                    }
                }
                .contextMenu { menu(it) }
            }
        }
        .navigationTitle(title)
        .refreshable { await reload() }
        .task { await reload() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { pickUpload = true } label: { Label("보관함에서 올리기", systemImage: "square.and.arrow.up") }
                    Button { newFolder = true } label: { Label("새 폴더", systemImage: "folder.badge.plus") }
                } label: { Image(systemName: "plus.circle.fill") }
            }
        }
        .namePrompt("새 폴더", isPresented: $newFolder, initial: "새 폴더") { n in Task { await run { try await CloudApi.mkdir(conn.id, parent: ref, name: n) } } }
        .namePrompt("이름 바꾸기", isPresented: $renameShown, initial: renaming?.name ?? "") { n in
            if let it = renaming { Task { await run { try await CloudApi.rename(conn.id, id: it.id, name: n) } } }
        }
        .sheet(isPresented: $pickUpload) {
            LibraryPicker { urls in
                for u in urls { Transfers.shared.upload(conn: conn.id, parent: ref, file: u) }
                Transfers.shared.onFinished = { t in if t.up { Task { await reload() } } }
            }
        }
        .alert("공유 링크 (24시간)", isPresented: Binding(get: { shareURL != nil }, set: { if !$0 { shareURL = nil } })) {
            Button("복사") { UIPasteboard.general.string = shareURL }
            Button("닫기", role: .cancel) {}
        } message: { Text(shareURL ?? "") }
    }

    private func row(_ it: CloudItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: it.dir ? "folder.fill" : Library.symbol(forName: it.name)).font(.title2).frame(width: 34)
                .foregroundStyle(it.dir ? Color("Brand") : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(it.name).lineLimit(2)
                if !it.dir {
                    Text(it.mtime > 0 ? "\(fmtSize(it.size)) · \(fmtDate(Date(timeIntervalSince1970: Double(it.mtime) / 1000)))" : fmtSize(it.size))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private func menu(_ it: CloudItem) -> some View {
        if !it.dir {
            Button { Transfers.shared.download(conn: conn.id, item: it) } label: { Label("보관함으로 받기", systemImage: "arrow.down.circle") }
            Button { Task { do { shareURL = try await CloudApi.share(conn.id, id: it.id) } catch { self.error = error.localizedDescription } } } label: {
                Label("공유 링크 만들기", systemImage: "link")
            }
        }
        Button { renaming = it; renameShown = true } label: { Label("이름 바꾸기", systemImage: "pencil") }
        Button(role: .destructive) { Task { await run { try await CloudApi.delete(conn.id, id: it.id) } } } label: { Label("삭제", systemImage: "trash") }
    }

    private func reload() async {
        loading = true; defer { loading = false }
        do { items = try await CloudApi.list(conn.id, ref); error = nil } catch { items = []; self.error = error.localizedDescription }
    }
    private func run(_ f: () async throws -> Void) async {
        do { try await f() } catch { self.error = error.localizedDescription }
        await reload()
    }
}

/// 보관함에서 올릴 파일 고르기
struct LibraryPicker: View {
    let onPick: ([URL]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var cur = Library.root
    @State private var sel: Set<URL> = []
    var body: some View {
        NavigationStack {
            List {
                if cur != Library.root {
                    Button { cur = cur.deletingLastPathComponent() } label: { Label("상위 폴더", systemImage: "arrow.up") }
                }
                ForEach((try? Library.list(cur)) ?? []) { it in
                    Button {
                        if it.isDir { cur = it.url } else if sel.contains(it.url) { sel.remove(it.url) } else { sel.insert(it.url) }
                    } label: {
                        HStack {
                            Row(item: it)
                            Spacer()
                            if sel.contains(it.url) { Image(systemName: "checkmark.circle.fill").foregroundStyle(Color("Brand")) }
                        }
                    }.foregroundStyle(.primary)
                }
            }
            .navigationTitle(cur == Library.root ? "보관함" : cur.lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("올리기 (\(sel.count))") { onPick(Array(sel)); dismiss() }.disabled(sel.isEmpty) }
            }
        }
    }
}
