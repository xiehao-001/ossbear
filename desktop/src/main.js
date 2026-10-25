const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, clipboard, nativeImage } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch (_) {}

const PUBLIC = (process.env.SB_PUBLIC_URL || "https://www.ai-xiehao.me").replace(/\/+$/, "");
const DEV = !app.isPackaged;
const HIDDEN = process.argv.includes("--hidden");
const UPD = { owner: "xiehao-001", repo: "ossbear-releases" };
const DATA = path.join(app.getPath("appData"), "StorageBear");
app.setName("StorageBear");
try { app.setPath("userData", DATA); } catch (_) {}

fs.mkdirSync(path.join(DATA, "agent", "logs"), { recursive: true });

let win = null;
let tray = null;
let child = null;
let quitting = false;
let trayTip = false;

function log(s) {
  const line = new Date().toISOString() + " " + s + "\n";
  try { fs.appendFileSync(path.join(DATA, "agent", "logs", "desktop.log"), line); } catch (_) {}
}

function runtimePath() {
  return path.join(DATA, "agent", "runtime.json");
}

function readRuntime() {
  try {
    const j = JSON.parse(fs.readFileSync(runtimePath(), "utf8"));
    return j && j.port && j.token ? j : null;
  } catch (_) {
    return null;
  }
}

function ping(rt, timeout = 1200) {
  return new Promise((resolve) => {
    const r = http.get({ host: "127.0.0.1", port: rt.port, path: "/api/ping", timeout }, (res) => {
      let b = "";
      res.on("data", (d) => { b += d; });
      res.on("end", () => {
        try {
          const j = JSON.parse(b);
          resolve(j.ok === true && j.app === "StorageBear");
        } catch (_) { resolve(false); }
      });
    });
    r.on("error", () => resolve(false));
    r.on("timeout", () => { r.destroy(); resolve(false); });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function backend() {
  const old = readRuntime();
  if (old && await ping(old)) return old;
  try { fs.unlinkSync(runtimePath()); } catch (_) {}
  if (!child) {
    const exe = path.join(process.resourcesPath, "backend", process.platform === "win32" ? "storagebear.exe" : "storagebear");
    let cmd;
    let args;
    if (DEV) {
      cmd = process.platform === "win32" ? "python" : "python3";
      args = ["-m", "storagebear", "--port", "0"];
    } else {
      if (!fs.existsSync(exe)) throw new Error("未找到本地代理程序：" + exe);
      cmd = exe;
      args = ["--port", "0"];
    }
    const cwd = DEV ? path.join(__dirname, "..", "..", "agent") : path.dirname(exe);
    child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      env: Object.assign({}, process.env, { SB_HOME: path.join(DATA, "agent"), PYTHONUNBUFFERED: "1" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stream = fs.createWriteStream(path.join(DATA, "agent", "logs", "backend-stdout.log"), { flags: "a" });
    child.stdout.pipe(stream);
    child.stderr.pipe(stream);
    child.on("exit", (code) => {
      log("backend exited: " + code);
      child = null;
      if (!quitting) {
        try { win && win.webContents.send("sb:backend-exit", code); } catch (_) {}
      }
    });
    child.on("error", (e) => log("backend spawn error: " + e.message));
  }
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    const rt = readRuntime();
    if (rt && await ping(rt)) return rt;
    await sleep(300);
  }
  throw new Error("本地代理启动超时，请查看日志：" + path.join(DATA, "agent", "logs"));
}

function local(route, method, data, timeout) {
  return backend().then((rt) => new Promise((resolve, reject) => {
    const body = data === undefined ? null : Buffer.from(JSON.stringify(data), "utf8");
    const req = http.request({
      host: "127.0.0.1",
      port: rt.port,
      path: route,
      method: method || "GET",
      timeout: timeout || 120000,
      headers: Object.assign({
        "X-SB-Token": rt.token,
        "Accept": "application/json",
      }, body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}),
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { raw += d; });
      res.on("end", () => {
        let j = {};
        try { j = JSON.parse(raw); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300 && j.ok !== false) {
          resolve(j);
        } else {
          const err = new Error(j.error || ("本地代理请求失败 (" + res.statusCode + ")"));
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("本地代理响应超时")); });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  }));
}

let updateBusy = false;
let updateChecked = false;
let updatePrompt = false;
let pendingUpdate = null;
let manualCheck = false;

function updaterReady() {
  return !DEV && !!autoUpdater;
}

function updateLog(level, ...args) {
  const text = args.map((x) => (x instanceof Error ? (x.stack || x.message) : typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  log("update " + level + ": " + text);
}

async function showUpdate(info) {
  if (updatePrompt) return;
  if (!win || !win.isVisible()) {
    pendingUpdate = info;
    return;
  }
  updatePrompt = true;
  pendingUpdate = null;
  try {
    const r = await dialog.showMessageBox(win, {
      type: "info",
      title: "发现新版本",
      message: "存储熊 " + info.version,
      detail: "当前版本 " + app.getVersion() + "。更新会从 GitHub Releases 下载，完成后可重启安装。",
      buttons: ["下载更新", "稍后"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) await autoUpdater.downloadUpdate();
    else updatePrompt = false;
  } catch (e) {
    updatePrompt = false;
    updateLog("error", e);
    if (win) dialog.showMessageBox(win, { type: "warning", title: "更新失败", message: "更新下载没有开始", detail: e.message });
  }
}

async function askManual(manual, message, detail) {
  if (!manual || !win) return;
  await dialog.showMessageBox(win, { type: "info", title: "检查更新", message, detail, noLink: true });
}

async function checkUpdate(manual) {
  if (!updaterReady()) {
    await askManual(manual, DEV ? "开发模式不检查更新" : "更新组件不可用", DEV ? "打包后的 Windows 客户端会从 GitHub Releases 检查更新。" : "当前安装可能缺少更新组件，请重新安装。");
    return false;
  }
  if (updateBusy) return false;
  if (!manual) {
    if (updateChecked) return false;
    updateChecked = true;
  }
  updateBusy = true;
  manualCheck = !!manual;
  try {
    const r = await autoUpdater.checkForUpdates();
    if (!r && manualCheck) {
      manualCheck = false;
      await askManual(true, "已是最新版本", "当前版本 " + app.getVersion() + "。");
    }
    return !!r;
  } catch (e) {
    updateLog("error", e);
    if (manualCheck) {
      manualCheck = false;
      await askManual(true, "暂时无法检查更新", "请稍后再试，或确认网络可以访问 GitHub Releases。\n\n" + e.message);
    }
    return false;
  } finally {
    updateBusy = false;
  }
}

function setupUpdates() {
  if (!updaterReady()) return;
  autoUpdater.logger = {
    info: (...a) => updateLog("info", ...a),
    warn: (...a) => updateLog("warn", ...a),
    error: (...a) => updateLog("error", ...a),
    debug: () => {},
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  try {
    autoUpdater.setFeedURL({ provider: "github", owner: UPD.owner, repo: UPD.repo });
  } catch (e) {
    updateLog("error", e);
  }
  autoUpdater.on("update-available", (info) => {
    manualCheck = false;
    showUpdate(info);
  });
  autoUpdater.on("update-not-available", async () => {
    const wasManual = manualCheck;
    manualCheck = false;
    if (wasManual) await askManual(true, "已是最新版本", "当前版本 " + app.getVersion() + "。");
  });
  autoUpdater.on("download-progress", (p) => {
    try { if (win) win.setProgressBar(Math.max(0, Math.min(1, p.percent / 100))); } catch (_) {}
  });
  autoUpdater.on("update-downloaded", async (info) => {
    updatePrompt = false;
    try { if (win) win.setProgressBar(-1); } catch (_) {}
    if (!win) return;
    const r = await dialog.showMessageBox(win, {
      type: "info",
      title: "更新已下载",
      message: "存储熊 " + info.version + " 已准备好",
      detail: "立即重启会关闭当前的虚拟磁盘并完成安装。也可以选择稍后，下次退出时自动安装。",
      buttons: ["立即重启安装", "稍后"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) {
      try { autoUpdater.quitAndInstall(false, true); } catch (e) { updateLog("error", e); }
    }
  });
  autoUpdater.on("error", (e) => {
    updateLog("error", e);
    updatePrompt = false;
    try { if (win) win.setProgressBar(-1); } catch (_) {}
  });
  setTimeout(() => { if (win && win.isVisible()) checkUpdate(false); }, 12000);
}

function qs(obj) {
  const u = new URLSearchParams();
  Object.keys(obj || {}).forEach((k) => {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") u.set(k, String(obj[k]));
  });
  const s = u.toString();
  return s ? "?" + s : "";
}

const calls = {
  status: () => ({ route: "/api/status" }),
  login: (a) => ({ route: "/api/login", method: "POST", data: a }),
  register: (a) => ({ route: "/api/register", method: "POST", data: a }),
  registerCode: (a) => ({ route: "/api/register/code", method: "POST", data: a }),
  logout: () => ({ route: "/api/logout", method: "POST", data: {} }),
  getConfig: () => ({ route: "/api/config" }),
  saveConfig: (a) => ({ route: "/api/config", method: "POST", data: a }),
  browse: (a) => ({ route: "/api/browse" + qs({ path: a.path }) }),
  listProviders: () => ({ route: "/api/providers" }),
  saveProvider: (a) => ({ route: "/api/providers", method: "POST", data: a }),
  updateProvider: (a) => ({ route: "/api/providers/" + encodeURIComponent(a.id), method: "POST", data: a }),
  deleteProvider: (a) => ({ route: "/api/providers/" + encodeURIComponent(a.id) + (a.force ? "?force=1" : ""), method: "DELETE" }),
  testProvider: (a) => ({ route: "/api/providers/test", method: "POST", data: a }),
  providerBalance: (a) => ({ route: "/api/providers/" + encodeURIComponent(a.id) + "/balance" }),
  listStitches: () => ({ route: "/api/stitches" }),
  saveStitch: (a) => ({ route: "/api/stitches", method: "POST", data: a }),
  deleteStitch: (a) => ({ route: "/api/stitches/" + encodeURIComponent(a.id), method: "DELETE" }),
  files: (a) => ({ route: "/api/files" + qs(a) }),
  scan: (a) => ({ route: "/api/scan", method: "POST", data: a }),
  jobs: () => ({ route: "/api/jobs" }),
  job: (a) => ({ route: "/api/jobs/" + encodeURIComponent(a.id) }),
  archive: (a) => ({ route: "/api/archive", method: "POST", data: a }),
  restore: (a) => ({ route: "/api/restore", method: "POST", data: a }),
  share: (a) => ({ route: "/api/share", method: "POST", data: a }),
  open: (a) => ({ route: "/api/open", method: "POST", data: a }),
  fetch: (a) => ({ route: "/api/fetch", method: "POST", data: a }),
  reveal: (a) => ({ route: "/api/reveal", method: "POST", data: a }),
  logs: (a) => ({ route: "/api/logs" + qs(a) }),
  log: (a) => ({ route: "/api/logs/" + encodeURIComponent(a.id) }),
  devices: () => ({ route: "/api/devices" }),
  summary: () => ({ route: "/api/summary" }),
  syncMeta: () => ({ route: "/api/sync/meta", method: "POST", data: {} }),
  drive: () => ({ route: "/api/drive" }),
  driveAction: (a) => ({ route: "/api/drive/" + encodeURIComponent(a.action), method: "POST", data: {} }),
  driveRepair: () => ({ route: "/api/drive/repair", method: "POST", data: {}, timeout: 240000 }),
  driveConfig: (a) => ({ route: "/api/drive/config", method: "POST", data: a }),
};

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    backgroundColor: "#F4F6FB",
    title: "存储熊",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => {
    const hidden = HIDDEN || (process.platform === "darwin" && app.getLoginItemSettings && app.getLoginItemSettings().wasOpenedAtLogin);
    if (!hidden) win.show();
  });
  win.on("show", () => {
    if (pendingUpdate) showUpdate(pendingUpdate);
    else setTimeout(() => checkUpdate(false), 1500);
  });
  win.on("close", (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
      if (!trayTip) {
        trayTip = true;
        try { tray.displayBalloon({ title: "存储熊仍在运行", content: "虚拟磁盘和手机访问保持在线，可从托盘退出。" }); } catch (_) {}
      }
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.key === "F12" && DEV) win.webContents.toggleDevTools();
  });
}

async function driveAction(action) {
  try {
    const r = await local("/api/drive/" + action, "POST", {});
    if (r && r.ok === false) throw new Error(r.error || "操作失败");
    return r;
  } catch (e) {
    if (win) dialog.showMessageBox(win, { type: "warning", title: "虚拟磁盘", message: e.message });
    return null;
  }
}

function makeTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "tray.png"));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, "..", "assets", "icon.png")) : img);
  tray.setToolTip("存储熊 · 对象存储虚拟盘");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开存储熊", click: () => { if (win) { win.show(); win.focus(); } } },
    { type: "separator" },
    { label: "挂载虚拟磁盘", click: () => driveAction("mount") },
    { label: "卸载虚拟磁盘", click: () => driveAction("unmount") },
    { type: "separator" },
    { label: "手机访问（开发中）", enabled: false },
    { label: "使用手册", click: () => shell.openExternal(PUBLIC + "/manual") },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => { if (win) { win.show(); win.focus(); } });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      await backend();
    } catch (e) {
      log("startup failed: " + e.message);
      dialog.showErrorBox("存储熊启动失败", e.message + "\n\n日志目录：" + path.join(DATA, "agent", "logs"));
      app.quit();
      return;
    }
    createWindow();
    makeTray();
    setupUpdates();
    Menu.setApplicationMenu(process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]) : null);
    app.on("activate", () => {
      if (!win) createWindow();
      else { win.show(); win.focus(); }
    });
  });
}

app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  quitting = true;
  if (child) {
    try { child.kill(); } catch (_) {}
    child = null;
  }
});

ipcMain.handle("sb:call", async (event, name, args) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  const fn = calls[name];
  if (!fn) throw new Error("未知接口：" + name);
  const c = fn(args || {});
  return local(c.route, c.method || "GET", c.data, c.timeout);
});

ipcMain.handle("sb:app-info", () => ({
  version: app.getVersion(),
  publicUrl: PUBLIC,
  dev: DEV,
  dataDir: DATA,
  logFile: path.join(DATA, "agent", "logs", "agent.log"),
  platform: process.platform,
  autoStart: app.getLoginItemSettings ? app.getLoginItemSettings().openAtLogin : false,
  updates: updaterReady(),
}));

ipcMain.handle("sb:check-update", async (event) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  await checkUpdate(true);
  return true;
});

ipcMain.handle("sb:choose-dirs", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "选择要建立索引的目录",
    properties: ["openDirectory", "multiSelections"],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle("sb:choose-files", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "选择要迁出或建立链接的文件",
    properties: ["openFile", "multiSelections"],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle("sb:open-external", async (e, url) => {
  if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("只允许打开网页链接");
  await shell.openExternal(url);
  return true;
});

ipcMain.handle("sb:copy", (e, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

ipcMain.handle("sb:open-folder", async (e, kind) => {
  const target = kind === "logs" ? path.join(DATA, "agent", "logs") : kind === "data" ? path.join(DATA, "agent") : "";
  if (!target) throw new Error("无效目录");
  fs.mkdirSync(target, { recursive: true });
  await shell.openPath(target);
  return target;
});

ipcMain.handle("sb:auto-start", (e, on) => {
  if (DEV) return false;
  app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args: ["--hidden"] });
  return app.getLoginItemSettings().openAtLogin;
});
