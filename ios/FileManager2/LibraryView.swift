import SwiftUI
import PhotosUI
import QuickLook
import UniformTypeIdentifiers

/// 보관함 폴더 화면 (파일 보기·가져오기·공유·이름 변경·이동·삭제)
struct FolderView: View {
    let dir: URL
    let title: String
    @State private var items: [LocalItem] = []
    @State private var error: String?
    @State private var search = ""
    @State private var showImporter = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var newFolder = false
    @State private var renaming: LocalItem?
    @State private var renameShown = false
    @State private var moving: LocalItem?
    @State private var preview: URL?
    @State private var importing = false
    @State private var sort = UserDefaults.standard.string(forKey: "fm2.sort") ?? "name"

    private var isRoot: Bool { dir.standardizedFileURL == Library.root.standardizedFileURL }
    private var shown: [LocalItem] {
        let f = search.isEmpty ? items : items.filter { $0.name.localizedCaseInsensitiveContains(search) }
        switch sort {
        case "date": return f.sorted { $0.isDir != $1.isDir ? $0.isDir : $0.mtime > $1.mtime }
        case "size": return f.sorted { $0.isDir != $1.isDir ? $0.isDir : $0.size > $1.size }
        default: return f
        }
    }

    var body: some View {
        List {
            if isRoot {
                Section {
                    NavigationLink { TrashView() } label: { Label("휴지통", systemImage: "trash") }
                } footer: {
                    Text("보관함은 아이폰 \"파일\" 앱의 나의 iPhone › 파일 관리자 2 에서도 열 수 있습니다. PC 연결에서 허용하면 PC에서도 보고 주고받을 수 있습니다.")
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
            if shown.isEmpty && error == nil {
                Text(search.isEmpty ? "비어 있는 폴더입니다. 오른쪽 위 ＋ 로 파일이나 사진을 가져오세요." : "찾는 파일이 없습니다")
                    .foregroundStyle(.secondary)
            }
            ForEach(shown) { it in
                Group {
                    if it.isDir {
                        NavigationLink { FolderView(dir: it.url, title: it.name) } label: { Row(item: it) }
                    } else {
                        Button { preview = it.url } label: { Row(item: it) }.foregroundStyle(.primary)
                    }
                }
                .contextMenu { menu(it) }
                .swipeActions {
                    Button(role: .destructive) { trash(it) } label: { Label("삭제", systemImage: "trash") }
                    Button { renaming = it; renameShown = true } label: { Label("이름", systemImage: "pencil") }.tint(.orange)
                }
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $search, prompt: "이 폴더에서 찾기")
        .navigationTitle(title)
        .refreshable { reload() }
        .overlay { if importing { ProgressView("가져오는 중…").padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12)) } }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { showImporter = true } label: { Label("파일 가져오기", systemImage: "square.and.arrow.down") }
                    Button { showPhotos = true } label: { Label("사진·동영상 가져오기", systemImage: "photo.on.rectangle") }
                    Button { newFolder = true } label: { Label("새 폴더", systemImage: "folder.badge.plus") }
                    Divider()
                    Picker("정렬", selection: $sort) {
                        Text("이름순").tag("name"); Text("최신순").tag("date"); Text("크기순").tag("size")
                    }
                } label: { Image(systemName: "plus.circle.fill") }
            }
        }
        .onChange(of: sort) { v in UserDefaults.standard.set(v, forKey: "fm2.sort") }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item, .folder], allowsMultipleSelection: true) { r in
            if case .success(let urls) = r { importURLs(urls) }
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 50, matching: .any(of: [.images, .videos]))
        .onChange(of: photoItems) { list in if !list.isEmpty { importPhotos(list) } }
        .namePrompt("새 폴더", isPresented: $newFolder, initial: "새 폴더") { n in act { try Library.newFolder(in: dir, name: n) } }
        .namePrompt("이름 바꾸기", isPresented: $renameShown, initial: renaming?.name ?? "") { n in
            if let it = renaming { act { try Library.rename(it.url, to: n) } }
        }
        .sheet(item: $moving) { it in MovePicker(item: it) { reload() } }
        .quickLookPreview($preview, in: shown.filter { !$0.isDir }.map(\.url))
        .onAppear(perform: reload)
    }

    @ViewBuilder private func menu(_ it: LocalItem) -> some View {
        if !it.isDir { ShareLink(item: it.url) { Label("공유·다른 앱으로 보내기", systemImage: "square.and.arrow.up") } }
        Button { renaming = it; renameShown = true } label: { Label("이름 바꾸기", systemImage: "pencil") }
        Button { moving = it } label: { Label("이동·복사", systemImage: "folder") }
        Button(role: .destructive) { trash(it) } label: { Label("휴지통으로", systemImage: "trash") }
    }

    private func reload() {
        do { items = try Library.list(dir); error = nil } catch { items = []; self.error = error.localizedDescription }
    }
    private func act(_ f: () throws -> Any) {
        do { _ = try f() } catch { self.error = error.localizedDescription }
        reload()
    }
    private func trash(_ it: LocalItem) { act { try Library.moveToTrash(it.url) } }

    private func importURLs(_ urls: [URL]) {
        importing = true
        let d = dir
        Task.detached {
            var failed = 0
            for u in urls { do { try Library.importFile(u, into: d) } catch { failed += 1 } }
            await MainActor.run {
                importing = false
                if failed > 0 { error = "\(failed)개 파일을 가져오지 못했습니다" }
                reload()
            }
        }
    }
    private func importPhotos(_ list: [PhotosPickerItem]) {
        importing = true
        let d = dir
        Task {
            var failed = 0
            for p in list {
                do {
                    if let f = try await p.loadTransferable(type: PickedFile.self) {
                        _ = try Library.importFile(f.url, into: d, move: true)
                    } else { failed += 1 }
                } catch { failed += 1 }
            }
            photoItems = []
            importing = false
            if failed > 0 { error = "\(failed)개 항목을 가져오지 못했습니다" }
            reload()
        }
    }
}

/// 사진 보관함에서 받은 원본 파일 (임시 폴더에 복사해 둠)
struct PickedFile: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .data) { received in
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = dir.appendingPathComponent(received.file.lastPathComponent)
            try FileManager.default.copyItem(at: received.file, to: dest)
            return PickedFile(url: dest)
        }
    }
}

struct Row: View {
    let item: LocalItem
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: Library.symbol(for: item))
                .font(.title2).frame(width: 34)
                .foregroundStyle(item.isDir ? Color("Brand") : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).lineLimit(2)
                Text(item.isDir ? "\(item.count)개 항목 · \(fmtDate(item.mtime))" : "\(fmtSize(item.size)) · \(fmtDate(item.mtime))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// 이동·복사할 폴더 고르기
struct MovePicker: View {
    let item: LocalItem
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var cur = Library.root
    @State private var error: String?
    var body: some View {
        NavigationStack {
            List {
                if cur != Library.root {
                    Button { cur = cur.deletingLastPathComponent() } label: { Label("상위 폴더", systemImage: "arrow.up") }
                }
                ForEach(((try? Library.list(cur)) ?? []).filter { $0.isDir && $0.url != item.url }) { d in
                    Button { cur = d.url } label: { Label(d.name, systemImage: "folder") }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(cur == Library.root ? "보관함" : cur.lastPathComponent)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("여기로 복사") { run(copy: true) }
                    Spacer()
                    Button("여기로 이동") { run(copy: false) }.bold()
                }
            }
        }
    }
    private func run(copy: Bool) {
        if item.isDir && (cur.path == item.url.path || cur.path.hasPrefix(item.url.path + "/")) { error = "폴더를 자기 안으로 옮길 수 없습니다"; return }
        do {
            _ = try (copy ? Library.copy(item.url, into: cur) : Library.move(item.url, into: cur))
            done(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct TrashView: View {
    @State private var list: [Library.TrashEntry] = []
    @State private var confirmEmpty = false
    var body: some View {
        List {
            Section {
                if list.isEmpty { Text("휴지통이 비어 있습니다").foregroundStyle(.secondary) }
                ForEach(list) { e in
                    VStack(alignment: .leading, spacing: 2) {
                        Label(e.name, systemImage: e.isDir ? "folder" : Library.symbol(forName: e.name))
                        Text("원래 위치: 보관함/\(e.original) · \(fmtDate(e.deletedAt))").font(.caption).foregroundStyle(.secondary)
                    }
                    .swipeActions {
                        Button(role: .destructive) { Library.purge(e); reload() } label: { Label("완전 삭제", systemImage: "xmark.bin") }
                        Button { try? Library.restore(e); reload() } label: { Label("복원", systemImage: "arrow.uturn.backward") }.tint(.green)
                    }
                }
            } footer: { Text("지운 파일은 30일 동안 보관된 뒤 자동으로 사라집니다. PC에서 지운 파일도 여기로 옵니다.") }
        }
        .navigationTitle("휴지통")
        .toolbar { if !list.isEmpty { Button("비우기", role: .destructive) { confirmEmpty = true } } }
        .confirmationDialog("휴지통을 비울까요? 되돌릴 수 없습니다.", isPresented: $confirmEmpty, titleVisibility: .visible) {
            Button("모두 완전 삭제", role: .destructive) { Library.emptyTrash(); reload() }
        }
        .onAppear(perform: reload)
    }
    private func reload() { list = Library.trashEntries() }
}
