const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, shell, clipboard, nativeImage, Notification } = require("electron");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch (_) {}

const SERVER = "http://47.100.27.233";
const PUBLIC = SERVER;
const DEV = !app.isPackaged;
const HIDDEN = process.argv.includes("--hidden");
const QUICK = quickParse(process.argv);
// 「一键分享」与「迁移到其它盘」都注册在文件与文件夹两类右键菜单上，
// 并且开启多选（MultiSelectModel=Player），一次可以把多个条目一起交给存储熊。
// 注意：%* 会按空格重新切分参数，必须先把每个路径用引号包起来再追加，
// 否则带空格的路径（如 "D:\新建 文件夹"）会被拆成两个不存在的路径。
const MULTI_ARG = ' "%1" %*';
const QUICK_KEYS = [
  "HKCU\\Software\\Classes\\*\\shell\\StorageBearQuickLink",
  "HKCU\\Software\\Classes\\Directory\\shell\\StorageBearQuickLink",
];
const MIGRATE_KEYS = [
  "HKCU\\Software\\Classes\\*\\shell\\StorageBearMigrate",
  "HKCU\\Software\\Classes\\Directory\\shell\\StorageBearMigrate",
];
const LEGACY_QUICK_KEY = "HKCU\\Software\\Classes\\*\\shell\\StorageBearQuickLink";
const UPD_URL = PUBLIC + "/updates/";
const DATA = path.join(app.getPath("appData"), "StorageBear");
app.setName("StorageBear");
try { app.setPath("userData", DATA); } catch (_) {}

fs.mkdirSync(path.join(DATA, "agent", "logs"), { recursive: true });

let win = null;
let previewWin = null;
let previewPath = "";
let tray = null;
let child = null;
let quitting = false;
let trayTip = false;

function log(s) {
  const line = new Date().toISOString() + " " + s + "\n";
  try { fs.appendFileSync(path.join(DATA, "agent", "logs", "desktop.log"), line); } catch (_) {}
}

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_APPROVED = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const RUN_NAMES = ["StorageBear", "存储熊"];

function autoStartGet() {
  if (process.platform !== "win32" || DEV) return false;
  try {
    const s = app.getLoginItemSettings({ path: process.execPath, args: ["--hidden"] });
    return s.openAtLogin === true && s.executableWillLaunchAtLogin !== false;
  } catch (_) {
    return false;
  }
}

function autoStartSet(on) {
  if (process.platform !== "win32" || DEV) return false;
  const del = (key, name) => {
    try {
      execFileSync("reg", ["delete", key, "/v", name, "/f"], {
        stdio: "ignore", windowsHide: true, timeout: 5000,
      });
    } catch (_) {}
  };
  try {
    for (const n of RUN_NAMES) {
      del(RUN_KEY, n);
      del(RUN_APPROVED, n);
    }
    const opt = {
      openAtLogin: !!on,
      path: process.execPath,
      args: ["--hidden"],
    };
    if (on) opt.enabled = true;
    app.setLoginItemSettings(opt);
  } catch (e) {
    log("autostart: " + e.message);
  }
  const state = autoStartGet();
  log("autostart set=" + !!on + " state=" + state);
  return state;
}

function quickParse(argv) {
  const a = Array.isArray(argv) ? argv : [];
  const i = a.findIndex((x) => /^--quick-(link|share|migrate)$/.test(String(x || "")));
  if (i < 0) return { mode: "", paths: [] };
  const mode = String(a[i]).replace("--quick-", "");
  const paths = [];
  for (let j = i + 1; j < a.length; j++) {
    const s = a[j];
    if (!s) continue;
    if (String(s).startsWith("--")) break;
    paths.push(String(s));
  }
  return { mode: mode, paths: paths };
}

function quickMenuSet(on) {
  if (process.platform !== "win32" || DEV) return false;
  const run = (args) => execFileSync("reg", args, { stdio: "ignore", windowsHide: true, timeout: 8000 });
  const exe = process.execPath;
  const del = (key) => {
    try { run(["delete", key, "/f"]); } catch (_) {}
  };
  const add = (key, label, cmd, model) => {
    run(["add", key, "/ve", "/d", label, "/f"]);
    run(["add", key, "/v", "Icon", "/d", exe, "/f"]);
    if (model) run(["add", key, "/v", "MultiSelectModel", "/d", model, "/f"]);
    run(["add", key + "\\command", "/ve", "/d", cmd, "/f"]);
  };
  try {
    for (const k of QUICK_KEYS) del(k);
    for (const k of MIGRATE_KEYS) del(k);
    if (!on) {
      log("quick menu removed");
      return false;
    }
    // 多选时资源管理器会在 %1 之后再追加其余选中项，%* 一并接住
    for (const k of QUICK_KEYS) {
      add(k, "存储熊：一键分享", '"' + exe + '" --quick-share' + MULTI_ARG, "Player");
    }
    for (const k of MIGRATE_KEYS) {
      add(k, "存储熊：迁移到其它盘并创建链接", '"' + exe + '" --quick-migrate' + MULTI_ARG, "Player");
    }
    log("quick menu registered");
    return true;
  } catch (e) {
    log("quick menu: " + e.message);
    return false;
  }
}

function notifyQuick(title, body) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: String(title || "存储熊"),
        body: String(body || "").slice(0, 600),
        icon: path.join(__dirname, "..", "assets", "icon.png"),
      });
      n.on("click", () => { if (win) { win.show(); win.focus(); } });
      n.show();
      return;
    }
  } catch (e) {
    log("notify: " + e.message);
  }
  if (tray) {
    try { tray.displayBalloon({ title: String(title || "存储熊"), content: String(body || "").slice(0, 600) }); } catch (_) {}
  }
}

function logTail(name, n) {
  try {
    const lines = fs.readFileSync(path.join(DATA, "agent", "logs", name), "utf8").split(/\r?\n/);
    return lines.slice(-(n || 12)).join("\n");
  } catch (_) {
    return "";
  }
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1073741824) return (v / 1073741824).toFixed(2) + " GB";
  if (v >= 1048576) return (v / 1048576).toFixed(1) + " MB";
  if (v >= 1024) return (v / 1024).toFixed(0) + " KB";
  return v + " B";
}

async function runQuickShare(paths, standalone) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((x) => String(x || "")).filter(Boolean);
  try {
    if (!list.length) throw new Error("没有收到文件路径");
    const r = await local("/api/quick-share", "POST", { paths: list }, 3600000);
    clipboard.writeText(r.url || "");
    log("quick share: " + list.join(" | ") + " -> " + (r.provider_label || r.provider_id || ""));
    let cfg = {};
    try { cfg = await local("/api/config", "GET", undefined, 8000); } catch (_) {}
    if (cfg.quick_notify !== false) {
      let head;
      if (r.packed) {
        head = (r.items || list.length) + " 项已打包成 " + (r.name || "压缩包")
          + "（" + fmtBytes(r.bytes_in) + " → " + fmtBytes(r.size) + "，" + (r.engine === "zstd" ? "zstd" : "zip") + "）";
      } else {
        head = (r.name || path.basename(list[0])) + " · " + (r.provider_label || "云端");
      }
      notifyQuick("分享链接已复制", head + "\n链接 6 天内有效，已写入剪贴板。");
    }
    if (standalone) setTimeout(() => { quitting = true; app.quit(); }, 1800);
    return r;
  } catch (e) {
    log("quick share failed: " + list.join(" | ") + " :: " + e.message);
    const tail = [logTail("desktop.log"), logTail("backend-stdout.log")].filter(Boolean).join("\n---\n");
    dialog.showErrorBox("一键分享失败",
      e.message + "\n\n内容：" + list.join("\n") + (tail ? "\n\n最近日志：\n" + tail.slice(-2200) : ""));
    if (standalone) setTimeout(() => { quitting = true; app.quit(); }, 2500);
    throw e;
  }
}

// ---------- 盘间迁移（mklink 快捷方式） ----------

const MIGRATE_DIR = "StorageBearLinks";
const MIGRATE_DENY = [
  "c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata",
  "c:\\$recycle.bin", "c:\\system volume information", "c:\\recovery", "c:\\perflogs",
];

function freeBytes(root) {
  try {
    const s = fs.statfsSync(root);
    return Number(s.bavail) * Number(s.bsize);
  } catch (_) {
    return 0;
  }
}

function driveList() {
  const out = [];
  for (const c of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = c + ":\\";
    try { fs.accessSync(root); } catch (_) { continue; }
    out.push({ root: root, letter: c, free: freeBytes(root), system: c === "C" });
  }
  return out;
}

async function migrateTarget(source, prefer) {
  const srcRoot = path.parse(path.resolve(String(source || ""))).root.toUpperCase();
  const cands = driveList().filter((d) => !d.system && d.root !== srcRoot);
  if (!cands.length) throw new Error("没有可用的目标盘：迁移目标必须是 D / E 等非系统盘，且不能与源同盘");
  const want = String(prefer || "").trim().toUpperCase();
  if (want) {
    const hit = cands.find((d) => d.letter === want[0]);
    if (hit) return hit;
  }
  cands.sort((a, b) => b.free - a.free);
  return cands[0];
}

function safeCell(p) {
  return String(p || "").replace(/[\r\n]+/g, " ");
}

function robocopyCopy(src, dst) {
  return new Promise((resolve) => {
    let out = "";
    let p;
    try {
      p = spawn("robocopy", [src, dst, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:1", "/W:1",
        "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XJ"], { windowsHide: true });
    } catch (e) {
      resolve({ code: 16, out: e.message });
      return;
    }
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.stderr.on("data", (d) => { out += d.toString(); });
    p.on("error", (e) => resolve({ code: 16, out: out + " " + e.message }));
    p.on("close", (code) => resolve({ code: code == null ? 16 : code, out: out }));
  });
}

function makeLink(src, dst, isDir) {
  return new Promise((resolve) => {
    const link = (cmd) => new Promise((done) => {
      let out = "";
      let p;
      try {
        p = spawn("cmd.exe", ["/c", "chcp 65001>nul & " + cmd], { windowsHide: true });
      } catch (e) {
        done({ ok: false, err: e.message });
        return;
      }
      p.stdout.on("data", (d) => { out += d.toString(); });
      p.stderr.on("data", (d) => { out += d.toString(); });
      p.on("error", (e) => done({ ok: false, err: out + " " + e.message }));
      p.on("close", (code) => {
        const ok = code === 0 && fs.existsSync(src);
        done({ ok: ok, err: ok ? "" : (out.trim() || ("退出码 " + code)) });
      });
    });

    (async () => {
      if (!isDir) {
        // 文件可以先试硬链接：同一卷、不需要管理员权限；跨盘会直接失败，再退回符号链接
        const hr = await link('mklink /H "' + src + '" "' + dst + '"');
        if (hr.ok) return { ok: true, hard: true };
        const sr = await link('mklink "' + src + '" "' + dst + '"');
        return { ok: sr.ok, hard: false, err: sr.ok ? "" : (hr.err + " / " + sr.err) };
      }
      const r = await link('mklink /J "' + src + '" "' + dst + '"');
      return { ok: r.ok, hard: false, err: r.err };
    })().then(resolve, (e) => resolve({ ok: false, err: e.message }));
  });
}

async function migrateOne(src, target) {
  const abs = path.resolve(String(src || ""));
  if (!abs) throw new Error("路径为空");
  if (!fs.existsSync(abs)) throw new Error("路径不存在：" + abs);
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) throw new Error("这已经是一个链接，不需要迁移：" + abs);
  const parsed = path.parse(abs);
  if (parsed.dir === parsed.root) throw new Error("不能迁移磁盘根目录：" + abs);
  const lower = abs.toLowerCase();
  if (MIGRATE_DENY.some((d) => lower === d || lower.startsWith(d + "\\"))) {
    throw new Error("系统目录不允许迁移：" + abs);
  }
  if (lower.startsWith(DATA.toLowerCase()) || lower.startsWith(app.getPath("userData").toLowerCase())) {
    throw new Error("存储熊自身的数据目录不能迁移：" + abs);
  }
  const srcRoot = parsed.root.toUpperCase();
  if (srcRoot === String(target).toUpperCase()) throw new Error("源和目标在同一个盘：" + srcRoot);
  const letter = srcRoot.replace(/[\\/:]/g, "").toUpperCase();
  const dst = path.join(target, MIGRATE_DIR, letter, abs.slice(parsed.root.length));
  if (fs.existsSync(dst)) throw new Error("目标位置已有同名内容，请先处理后重试：" + dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const isDir = st.isDirectory();
  const needs = isDir ? 0 : st.size;
  const free = freeBytes(target);
  if (needs && free && free < needs + 64 * 1024 * 1024) {
    throw new Error("目标盘空间不足：" + fmtBytes(free) + " 可用");
  }
  if (isDir) {
    const r = await robocopyCopy(abs, dst);
    if (r.code >= 8) {
      try { fs.rmSync(dst, { recursive: true, force: true }); } catch (_) {}
      throw new Error("复制失败（robocopy " + r.code + "）：" + r.out.slice(-300));
    }
    try {
      fs.rmSync(abs, { recursive: true, force: false });
    } catch (e) {
      throw new Error("已复制到 " + dst + "，但删除原目录失败（可能被占用），请关闭占用程序后重试：" + e.message);
    }
    const lr = await makeLink(abs, dst, true);
    if (!lr.ok) {
      await robocopyCopy(dst, abs);
      throw new Error("内容已复制到 " + dst + "，但创建目录链接失败：" + lr.err + "（已尝试复制回原位置）");
    }
  } else {
    await fs.promises.copyFile(abs, dst);
    let a = 0, b = 0;
    try { a = fs.statSync(abs).size; b = fs.statSync(dst).size; } catch (_) {}
    if (a !== b) {
      try { fs.rmSync(dst, { force: true }); } catch (_) {}
      throw new Error("文件复制校验失败，已放弃迁移");
    }
    fs.rmSync(abs, { force: true });
    const lr = await makeLink(abs, dst, false);
    if (!lr.ok) {
      try { fs.copyFileSync(dst, abs); } catch (_) {}
      throw new Error("文件已复制到 " + dst + "，但创建链接失败（硬链接与符号链接都不可用；"
        + "跨盘符号链接需要管理员权限或开启 Windows 开发者模式）："
        + lr.err + "（已尝试复制回原位置）");
    }
  }
  log("migrate: " + safeCell(abs) + " -> " + safeCell(dst));
  return { source: abs, target: dst, isDir: isDir, ok: true };
}

async function migratePaths(paths, opts) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((x) => String(x || "")).filter(Boolean);
  if (!list.length) throw new Error("没有收到要迁移的路径");
  const first = list.find((p) => fs.existsSync(p)) || list[0];
  const drive = await migrateTarget(first, (opts || {}).target);
  const items = [];
  for (const p of list) {
    try {
      items.push(await migrateOne(p, drive.root));
    } catch (e) {
      log("migrate failed: " + safeCell(p) + " :: " + e.message);
      items.push({ source: p, ok: false, error: e.message });
    }
  }
  const okN = items.filter((x) => x.ok).length;
  log("migrate done: " + okN + "/" + items.length + " -> " + drive.root);
  return { target: drive.root, free: drive.free, moved: okN, items: items };
}

async function runQuickMigrate(paths, standalone) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((x) => String(x || "")).filter(Boolean);
  const fin = (ms) => { if (standalone) setTimeout(() => { quitting = true; app.quit(); }, ms || 2000); };
  try {
    if (!list.length) throw new Error("没有收到文件路径");
    const drive = await migrateTarget(list[0], "");
    const r = await dialog.showMessageBox({
      type: "warning",
      title: "迁移到其它盘并创建链接",
      message: "把下面 " + list.length + " 项迁移到 " + drive.root + " 吗？（剩余 " + fmtBytes(drive.free) + "）",
      detail: list.map(safeCell).join("\n")
        + "\n\n迁移后原位置会变成一个指向新位置的链接，程序、快捷方式和索引里的路径都照旧可用。"
        + "\n建议先关闭正在使用这些文件的程序；迁移期间请不要强制退出存储熊。",
      buttons: ["开始迁移", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response !== 0) { fin(200); return { canceled: true }; }
    const res = await migratePaths(list, { target: drive.root });
    const bad = res.items.filter((x) => !x.ok);
    if (bad.length) {
      dialog.showErrorBox("部分内容没有迁移成功",
        bad.map((x) => safeCell(x.source) + "\n  " + x.error).join("\n\n"));
    } else {
      notifyQuick("迁移完成", res.moved + " 项已迁移到 " + res.target + "，原位置已创建链接。");
    }
    fin(1500);
    return res;
  } catch (e) {
    log("quick migrate failed: " + e.message);
    dialog.showErrorBox("迁移失败", e.message);
    fin(2000);
    return { error: e.message };
  }
}

// ---------- 自身清理 ----------

function updaterCacheDirs() {
  const out = [];
  const add = (p) => { if (p && !out.includes(p)) out.push(p); };
  add(path.join(app.getPath("userData"), "..", "storagebear-updater"));
  add(path.join(app.getPath("userData"), "pending"));
  try { add(path.join(app.getPath("temp"), "storagebear-updater")); } catch (_) {}
  return out;
}

function dirSize(p) {
  let total = 0, files = 0;
  try {
    if (fs.statSync(p).isFile()) return { bytes: fs.statSync(p).size, files: 1 };
  } catch (_) { return { bytes: 0, files: 0 }; }
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of names) {
      const q = path.join(d, e.name);
      try {
        if (e.isDirectory()) walk(q);
        else { total += fs.statSync(q).size; files += 1; }
      } catch (_) {}
    }
  };
  walk(p);
  return { bytes: total, files: files };
}

function updaterCacheInfo() {
  const items = updaterCacheDirs().map((p) => Object.assign({ path: p }, dirSize(p)));
  return { items: items, bytes: items.reduce((s, x) => s + x.bytes, 0), files: items.reduce((s, x) => s + x.files, 0) };
}

function clearUpdaterCache() {
  let bytes = 0, files = 0;
  for (const p of updaterCacheDirs()) {
    const sz = dirSize(p);
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
    bytes += sz.bytes;
    files += sz.files;
  }
  return { bytes: bytes, files: files };
}

async function selfClean(opts) {
  const o = opts || {};
  const days = Math.max(1, Math.min(3650, Number(o.days) || 30));
  const types = Array.isArray(o.types) && o.types.length ? o.types : ["tmp", "cache", "logs", "share"];
  let agent = null;
  try {
    agent = await local("/api/self-clean", "POST", { types: types, days: days }, 600000);
  } catch (e) {
    log("self-clean agent: " + e.message);
    agent = { error: e.message, bytes: 0, files: 0 };
  }
  const upd = o.updater === false ? { bytes: 0, files: 0 } : clearUpdaterCache();
  const logs = o.logs === false ? { bytes: 0, files: 0 } : cleanLogs(days, o.logtypes && o.logtypes.length ? o.logtypes : ["agent", "backend", "desktop"]);
  const total = Number(agent.bytes || 0) + upd.bytes + Number(logs.bytes || 0);
  log("self-clean total: " + total + " bytes");
  return { agent: agent, updater: upd, logs: logs, bytes: total, days: days };
}

async function selfUsage() {
  let agent = null;
  try { agent = await local("/api/self-usage", "GET", undefined, 60000); } catch (e) { agent = { error: e.message }; }
  return { agent: agent, updater: updaterCacheInfo(), dataDir: DATA, logDir: path.join(DATA, "agent", "logs") };
}

const LOG_FILES = {
  agent: ["agent.log", "agent.log.1"],
  backend: ["backend-stdout.log"],
  desktop: ["desktop.log"],
  webdav: ["webdav.log", "webdav.log.1"],
  repair: ["repair-webdav.log"],
};

function cleanLogs(days, types) {
  const dir = path.join(DATA, "agent", "logs");
  const n = Math.max(1, Math.min(3650, Number(days) || 30));
  const cutoff = Date.now() - n * 86400000;
  const result = { ok: true, files: 0, bytes: 0, skipped: [], protected: ["迁移日志（本机数据库与云端 JSONL）"] };
  const picked = Array.isArray(types) ? types.filter((t) => LOG_FILES[t]) : [];
  const tsRe = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/;
  for (const type of picked) {
    for (const name of LOG_FILES[type]) {
      const p = path.join(dir, name);
      let st;
      try { st = fs.statSync(p); } catch (_) { continue; }
      if (!st.isFile()) continue;
      let text;
      try { text = fs.readFileSync(p, "utf8"); } catch (_) { result.skipped.push(name); continue; }
      const lines = text.split(/\r?\n/);
      let stamped = false;
      const kept = [];
      for (const line of lines) {
        const m = line.match(tsRe);
        if (!m) { kept.push(line); continue; }
        stamped = true;
        const t = new Date(m[1] + "T" + m[2]).getTime();
        if (!isNaN(t) && t >= cutoff) kept.push(line);
      }
      let out;
      if (!stamped) {
        if (st.mtimeMs >= cutoff) { result.skipped.push(name); continue; }
        out = "";
      } else {
        out = kept.join("\n");
      }
      if (out === text) { result.skipped.push(name); continue; }
      try {
        const tmp = p + ".clean";
        fs.writeFileSync(tmp, out, "utf8");
        fs.renameSync(tmp, p);
        result.files += 1;
        result.bytes += Math.max(0, st.size - Buffer.byteLength(out));
      } catch (_) {
        try { fs.unlinkSync(p + ".clean"); } catch (__) {}
        result.skipped.push(name + "（正在使用，已跳过）");
      }
    }
  }
  return result;
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
  if (old && await ping(old, 4000)) return old;
  const alive = !!child && child.exitCode === null;
  if (!alive) {
    // 只有确认没有存活子进程时才删除 runtime；否则一次瞬时 ping 失败会把
    // 正在启动/忙碌的代理 runtime 删掉，后面的请求永远等不到新的 runtime。
    try { fs.unlinkSync(runtimePath()); } catch (_) {}
    child = null;
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
    log("backend spawn: " + cmd + " " + args.join(" "));
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
  const until = Date.now() + 40000;
  while (Date.now() < until) {
    const rt = readRuntime();
    if (rt && await ping(rt, 4000)) return rt;
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
      detail: "当前版本 " + app.getVersion() + "。更新会从存储熊官网下载，完成后可重启安装。",
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

function updateError(e) {
  const raw = String((e && e.message) || e || "");
  const low = raw.toLowerCase();
  const status = Number((e && (e.statusCode || (e.response && e.response.statusCode))) || 0);
  const head = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "未知错误";
  let msg;
  if (status === 404 || /\b404\b|not found/.test(low)) {
    msg = "更新目录暂时不可用（HTTP 404）。当前版本可以正常使用，这通常表示服务器上还没有发布 latest.yml 或最新安装包。";
  } else if (/enotfound|eai_again|getaddrinfo/.test(low)) {
    msg = "无法解析更新服务器地址。请检查网络或稍后再试。";
  } else if (/etimedout|timeout|econnreset|econnrefused|socket hang up/.test(low)) {
    msg = "连接更新服务器超时。请检查网络、代理或安全软件后重试。";
  } else {
    msg = "暂时无法检查更新。当前版本可以正常使用。";
  }
  const tech = head.length > 120 ? head.slice(0, 120) + "…" : head;
  return {
    msg,
    detail: "当前版本 " + app.getVersion() + "。\n需要新版本安装包时，请联系部署者获取；也可以先继续使用当前版本。\n\n错误摘要：" + tech,
  };
}

async function checkUpdate(manual) {
  if (!updaterReady()) {
    await askManual(manual, DEV ? "开发模式不检查更新" : "更新组件不可用", DEV ? "打包后的客户端会从存储熊官网检查更新。" : "当前安装可能缺少更新组件，请重新安装。");
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
      const u = updateError(e);
      await askManual(true, "暂时无法检查更新", u.detail ? u.msg + "\n\n" + u.detail : u.msg);
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
    autoUpdater.setFeedURL({ provider: "generic", url: UPD_URL });
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
  apps: () => ({ route: "/api/apps" }),
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
  sharePack: (a) => ({ route: "/api/share-pack", method: "POST", data: a, timeout: 3600000 }),
  selfUsage: () => ({ route: "/api/self-usage" }),
  downloads: () => ({ route: "/api/downloads" }),
  link: (a) => ({ route: "/api/link", method: "POST", data: a }),
  preview: (a) => ({ route: "/api/preview", method: "POST", data: a, timeout: 1800000 }),
  edit: (a) => ({ route: "/api/edit", method: "POST", data: a, timeout: 1800000 }),
  saveEdit: (a) => ({ route: "/api/save-edit", method: "POST", data: a, timeout: 1800000 }),
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
  driveRepair: () => ({ route: "/api/drive/repair", method: "POST", data: {}, timeout: 450000 }),
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
    title: "存储熊 | storagebear",
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

function openPreviewWindow(file) {
  previewPath = String(file || "");
  if (!previewPath) return;
  if (previewWin && !previewWin.isDestroyed()) {
    if (previewWin.isMinimized()) previewWin.restore();
    previewWin.show();
    previewWin.focus();
    previewWin.webContents.send("sb:preview-path", previewPath);
    return;
  }
  previewWin = new BrowserWindow({
    width: 1080,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    show: false,
    parent: win || undefined,
    backgroundColor: "#EEF2F8",
    title: "文档预览 · 存储熊",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preview-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  previewWin.loadFile(path.join(__dirname, "preview.html"));
  previewWin.once("ready-to-show", () => previewWin.show());
  previewWin.webContents.on("did-finish-load", () => {
    if (previewPath) previewWin.webContents.send("sb:preview-path", previewPath);
  });
  previewWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  previewWin.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  previewWin.on("closed", () => { previewWin = null; });
}

function fromPreview(event) {
  return !!previewWin && !previewWin.isDestroyed() && event.sender === previewWin.webContents;
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

const gotLock = app.requestSingleInstanceLock({ quick: QUICK });
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (event, argv, cwd, extra) => {
    const target = (extra && extra.quick) || quickArg(argv);
    if (target) {
      runQuickLink(target, false);
      return;
    }
    if (!win) {
      createWindow();
      makeTray();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("com.storagebear.desktop");
    try {
      await backend();
    } catch (e) {
      log("startup failed: " + e.message);
      dialog.showErrorBox("存储熊启动失败", e.message + "\n\n日志目录：" + path.join(DATA, "agent", "logs"));
      app.quit();
      return;
    }
    if (QUICK.mode) {
      if (QUICK.mode === "migrate") await runQuickMigrate(QUICK.paths, true);
      else await runQuickShare(QUICK.paths, true);
      return;
    }
    try {
      const cfg = await local("/api/config", "GET", undefined, 10000);
      quickMenuSet(cfg.quick_menu !== false);
    } catch (_) {}
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
  server: SERVER,
  dev: DEV,
  dataDir: DATA,
  logFile: path.join(DATA, "agent", "logs", "agent.log"),
  platform: process.platform,
  startHidden: HIDDEN,
  autoStart: autoStartGet(),
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

ipcMain.handle("sb:clean-logs", (event, days, types) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  return cleanLogs(days, types);
});

ipcMain.handle("sb:set-quick-menu", (event, on) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  return { enabled: quickMenuSet(!!on) };
});

ipcMain.handle("sb:self-usage", (event) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  return selfUsage();
});

ipcMain.handle("sb:self-clean", (event, opts) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  return selfClean(opts || {});
});

ipcMain.handle("sb:migrate-info", (event) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  const drives = driveList().map((d) => ({ root: d.root, letter: d.letter, free: d.free, system: d.system }));
  const cands = drives.filter((d) => !d.system).sort((a, b) => b.free - a.free);
  return { drives: drives, recommend: cands[0] ? cands[0].root : "" };
});

ipcMain.handle("sb:migrate", (event, paths, opts) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  return migratePaths(paths, opts || {});
});

ipcMain.handle("sb:choose-any", async (event) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  const r = await dialog.showOpenDialog(win, {
    title: "选择要迁移或分享的文件或文件夹",
    properties: ["openFile", "openDirectory", "multiSelections"],
  });
  return r.canceled ? [] : r.filePaths;
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

ipcMain.handle("sb:auto-start", (event, on) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  return autoStartSet(!!on);
});

ipcMain.handle("sb:preview-open", (event, file) => {
  const frame = event.senderFrame && event.senderFrame.url;
  if (!frame || !frame.startsWith("file://")) throw new Error("拒绝非法调用");
  openPreviewWindow(String(file || "").slice(0, 4096));
  return true;
});

ipcMain.handle("sb:preview-data", async (event, file) => {
  if (!fromPreview(event)) throw new Error("拒绝非法调用");
  const r = await local("/api/preview", "POST", { path: String(file || "").slice(0, 4096) }, 1800000);
  const q = String(r.file || "");
  if (!q) throw new Error("本地代理没有返回预览文件");
  let buf;
  try {
    buf = await fs.promises.readFile(q);
  } catch (e) {
    throw new Error("读取本机副本失败：" + e.message);
  }
  delete r.file;
  r.data = buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
    ? buf.buffer
    : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return r;
});

ipcMain.handle("sb:preview-edit", async (event, file) => {
  if (!fromPreview(event)) throw new Error("拒绝非法调用");
  return local("/api/edit", "POST", { path: String(file || "").slice(0, 4096) }, 1800000);
});

ipcMain.handle("sb:preview-save", async (event, file) => {
  if (!fromPreview(event)) throw new Error("拒绝非法调用");
  const r = await local("/api/save-edit", "POST", { path: String(file || "").slice(0, 4096) }, 1800000);
  if (r && r.changed && win && !win.isDestroyed()) win.webContents.send("sb:files-changed");
  return r;
});

ipcMain.handle("sb:preview-close", (event) => {
  if (!fromPreview(event)) throw new Error("拒绝非法调用");
  if (previewWin) previewWin.close();
  return true;
});
