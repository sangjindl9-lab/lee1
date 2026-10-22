// 예정공정표 — 윈도우 단독 실행판 (PC에 데이터 저장, 인터넷 불필요)
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_KEY = 'gongjung.projects.v1';
const KEEP_BACKUPS = 30; // 자동 백업 보관 개수
let win = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

const backupDir = () => path.join(app.getPath('documents'), '예정공정표 백업');
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/** 화면에 저장된 공정표 데이터를 문서 폴더에 JSON으로 자동 백업 */
async function autoBackup() {
  if (!win || win.isDestroyed()) return null;
  try {
    const raw = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(DATA_KEY)})`, true);
    if (!raw) return null;
    const projects = Object.values(JSON.parse(raw) || {});
    if (!projects.length) return null;
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    // 내용이 바뀌지 않았으면 새로 만들지 않음
    const files = fs.readdirSync(dir).filter((f) => /^자동백업_\d{8}_\d{4}\.json$/.test(f)).sort();
    const last = files[files.length - 1];
    const body = JSON.stringify(projects);
    if (last) {
      try {
        if (JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, last), 'utf8')).projects) === body) return path.join(dir, last);
      } catch {}
    }
    const file = path.join(dir, `자동백업_${stamp()}.json`);
    // 프로그램의 [JSON 복원]과 같은 형식(전체 백업)으로 저장
    fs.writeFileSync(file, JSON.stringify({ app: 'gongjung-planner', exportedAt: new Date().toISOString(), projects }, null, 1), 'utf8');
    files.push(path.basename(file));
    for (const old of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
      try {
        fs.unlinkSync(path.join(dir, old));
      } catch {}
    }
    return file;
  } catch {
    return null;
  }
}

function buildMenu() {
  const template = [
    {
      label: '파일',
      submenu: [
        {
          label: '지금 백업하기',
          click: async () => {
            const f = await autoBackup();
            dialog.showMessageBox(win, { type: 'info', title: '백업', message: f ? `백업했습니다.\n${f}` : '백업할 공정표가 없습니다.' });
          },
        },
        { label: '백업 폴더 열기', click: () => (fs.mkdirSync(backupDir(), { recursive: true }), shell.openPath(backupDir())) },
        { type: 'separator' },
        { label: '종료', role: 'quit' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { label: '실행 취소', role: 'undo' },
        { label: '다시 실행', role: 'redo' },
        { type: 'separator' },
        { label: '잘라내기', role: 'cut' },
        { label: '복사', role: 'copy' },
        { label: '붙여넣기', role: 'paste' },
        { label: '모두 선택', role: 'selectAll' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '새로 고침', role: 'reload' },
        { type: 'separator' },
        { label: '크게', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { label: '작게', role: 'zoomOut' },
        { label: '원래 크기', role: 'resetZoom' },
        { type: 'separator' },
        { label: '전체 화면', role: 'togglefullscreen' },
      ],
    },
    {
      label: '도움말',
      submenu: [
        {
          label: '프로그램 정보',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: '프로그램 정보',
              message: `예정공정표 (PC 단독형) ${app.getVersion()}`,
              detail: `공정표 데이터는 이 PC에만 저장됩니다.\n자동 백업 위치: ${backupDir()}\n(프로그램을 닫을 때와 30분마다 자동 백업, 최근 ${KEEP_BACKUPS}개 보관)\n\n다른 PC로 옮길 때는 프로그램 안의 [목록] → [전체 백업(JSON)]으로 저장한 뒤, 새 PC에서 [목록] → [JSON 복원]을 하세요.\n자동 백업 파일도 [JSON 복원]으로 불러올 수 있습니다.`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    title: '예정공정표',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f6f6f3',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // 닫기 전에 자동 백업
  win.on('close', async (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    await autoBackup();
    win.destroy();
  });
  win.on('closed', () => (win = null));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  setInterval(autoBackup, 30 * 60 * 1000);
});

app.on('window-all-closed', () => app.quit());
