"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const api = window.sb;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRESETS = [
  { code: "volcengine", name: "火山引擎 TOS", short: "火", color: "#1664ff", endpoint: "https://tos-s3-cn-beijing.volces.com", region: "cn-beijing", style: "virtual", beta: true, note: "默认推荐。TOS 需要带 -s3- 的端点，仅支持虚拟主机样式；余额查询为 Beta，需要费用中心查询权限。" },
  { code: "aliyun", name: "阿里云 OSS", short: "阿", color: "#ff6a00", endpoint: "https://s3.oss-cn-hangzhou.aliyuncs.com", region: "cn-hangzhou", style: "path", note: "在 OSS 控制台创建 Bucket，并确认地域与 S3 兼容 Endpoint。" },
  { code: "tencent", name: "腾讯云 COS", short: "腾", color: "#1d7dfa", endpoint: "https://cos.ap-guangzhou.myqcloud.com", region: "ap-guangzhou", style: "virtual", note: "使用 COS 的 S3 兼容访问域名，按 Bucket 所在地域修改。" },
  { code: "huawei", name: "华为云 OBS", short: "华", color: "#cf0a2c", endpoint: "https://obs.cn-north-4.myhuaweicloud.com", region: "cn-north-4", style: "virtual", note: "以 OBS 控制台给出的 S3 兼容 Endpoint 为准。" },
  { code: "tianyi", name: "天翼云 OOS", short: "天", color: "#db0e2e", endpoint: "", region: "cn-shanghai", style: "virtual", note: "从 OOS 控制台获取 S3 兼容 Endpoint 后填写。" },
  { code: "minio", name: "MinIO / 自建", short: "M", color: "#c72c48", endpoint: "http://127.0.0.1:9000", region: "us-east-1", style: "path", note: "自建 S3 兼容存储，适合家庭 NAS 与本地测试。" },
  { code: "custom", name: "其他 S3 兼容", short: "S3", color: "#6b7280", endpoint: "", region: "us-east-1", style: "path", note: "填写标准 S3 兼容 Endpoint、Region 与 Bucket。" },
];

const PCOL = { aliyun: "#ff6a00", tencent: "#1d7dfa", huawei: "#cf0a2c", volcengine: "#1664ff", tianyi: "#db0e2e", minio: "#c72c48", custom: "#6b7280" };
const PAGE = {
  dashboard: ["工作台", "总览"],
  files: ["文件库", "扫描索引与云端副本"],
  cloud: ["云端与续费", "各家对象存储"],
  transfer: ["迁出与迁回", "数据搬家与日志"],
  drive: ["虚拟磁盘", "WebDAV 网络盘"],
  phone: ["手机访问", "正在开发"],
  settings: ["设置与帮助", "本机与账号"],
};
const OPLABEL = { archive: "迁出到云", restore: "迁回本地", save: "编辑回传", log_upload: "上传日志", verify: "校验" };
const IC = {
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2.7 19a1.4 1.4 0 0 0 1.2 2h16.2a1.4 1.4 0 0 0 1.2-2z"/><path d="M12 9v5M12 17.5v.5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.7-7.94A5.5 5.5 0 0 1 17 9.3 3.5 3.5 0 0 1 16.5 18z"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M4 20h16"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="m13.5 6.5 3 3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  drive: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="5" rx="2"/><path d="M7 8.5h.01M7 16.5h.01"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  pc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 3 3"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="m12 3 8 3v6c0 4.5-3.3 7.7-8 9-4.7-1.3-8-4.5-8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  scan: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 12h8"/></svg>',
  merge: '<svg viewBox="0 0 24 24"><path d="M6 4v5a4 4 0 0 0 4 4h8m0 0-3-3m3 3-3 3M6 20v-5a4 4 0 0 1 4-4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m0 0-5-5m5 5-5 5"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
};

const st = {
  info: null, status: null, cfg: null, providers: [], stitches: [], devices: [],
  view: "dashboard", path: "", parent: "", q: "", filter: "all", status: "all", provider: "", sel: new Set(),
  entries: [], recent: [], logs: [], logRemote: [], drive: null, pick: [], dl: [], apps: [],
  renderSeq: 0, poll: null, autoStart: false,
};
let codeTimer = null;

function e(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function au(s) { return encodeURIComponent(String(s || "")); }
function un(s) { try { return decodeURIComponent(s || ""); } catch (_) { return s || ""; } }
function errMsg(err) {
  return String((err && err.message) || err || "操作失败")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}
function fmtSize(n) {
  n = Number(n || 0);
  if (n < 1024) return n + " B";
  const u = ["KB", "MB", "GB", "TB", "PB"];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + " " + u[i];
}
function fmtTime(t) {
  if (!t) return "—";
  const d = new Date(Number(t) * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function ago(t) {
  if (!t) return "从未";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(t)));
  if (s < 60) return "刚刚";
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  return Math.floor(s / 86400) + " 天前";
}
function dateVal(t) {
  if (!t) return "";
  const d = new Date(Number(t) * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function dueText(d) {
  if (d === null || d === undefined) return '<span class="tag">未填写</span>';
  if (d < 0) return '<span class="tag red">已过期 ' + Math.abs(d) + " 天</span>";
  if (d === 0) return '<span class="tag red">今天到期</span>';
  if (d <= 15) return '<span class="tag amber">剩余 ' + d + " 天</span>";
  return '<span class="tag green">剩余 ' + d + " 天</span>";
}
function pcolor(p) { return PCOL[p.code] || "#5468ff"; }
function pshort(p) { return (p.label || "云").slice(0, 1).toUpperCase(); }
function providerLabel(id) { const p = st.providers.find((x) => x.id === id); return p ? p.label : (id ? "未命名云存储" : "未指定"); }
function fileSvg(kind, dir) {
  if (dir) return IC.folder;
  if (kind === "pdf") return IC.pdf;
  if (kind === "audio") return IC.audio;
  if (kind === "video") return IC.video;
  return IC.file;
}
function badge(ent) {
  if (ent.is_dir) return '<span class="badge badge-dir">目录</span>';
  if (ent.archived) return '<span class="badge badge-cloud">仅云端</span>';
  if (ent.has_cloud && ent.exists) return '<span class="badge badge-both">本地 + 云</span>';
  if (ent.has_cloud) return '<span class="badge badge-cloud">云端副本</span>';
  return '<span class="badge badge-local">仅本地</span>';
}
function spinner() { return '<span class="dot-loader"><i></i><i></i><i></i></span>'; }
function banner() {
  const a = st.status && st.status.auth_error;
  if (!a) return "";
  return `<div class="alert alert-danger mb16">${IC.warn}<div><b>账号连接需要处理</b><br>${e(a)}</div><button class="btn btn-sm btn-ghost" data-act="relogin">重新登录</button></div>`;
}

function toast(msg, type = "info", title = "") {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast " + (type === "error" ? "err" : type === "ok" ? "ok" : "");
  el.innerHTML = `<i></i><div>${title ? "<b>" + e(title) + "</b>" : ""}<span>${e(msg)}</span></div>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .25s"; setTimeout(() => el.remove(), 300); }, 4600);
}

const modals = [];
function openModal({ title, sub = "", body, foot = "", wide = false, onClose = null }) {
  const el = document.createElement("div");
  el.className = "overlay";
  el.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
    <div class="modal-head"><div><h3>${e(title)}</h3>${sub ? `<p>${sub}</p>` : ""}</div>
    <button class="modal-x" data-act="close-modal" aria-label="关闭">×</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div>`;
  $("#modal-root").appendChild(el);
  let closed = false;
  const rec = {
    el, root: el.querySelector(".modal"),
    close: () => {
      if (closed) return;
      closed = true;
      el.remove();
      const i = modals.indexOf(rec);
      if (i >= 0) modals.splice(i, 1);
      if (onClose) onClose();
    },
  };
  modals.push(rec);
  el.addEventListener("mousedown", (ev) => { if (ev.target === el) rec.close(); });
  return rec;
}
function closeModalEl(el) {
  const ov = el.closest ? el.closest(".overlay") : null;
  if (!ov) return;
  const rec = modals.find((m) => m.el === ov);
  if (rec) rec.close(); else ov.remove();
}
function confirmBox({ title, text, ok = "确认", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = openModal({
      title, body: `<p class="confirm-text">${e(text)}</p>`,
      foot: `<button class="btn btn-ghost" data-close>取消</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${e(ok)}</button>`,
      onClose: () => finish(false),
    });
    m.root.querySelector("[data-close]").onclick = () => m.close();
    m.root.querySelector("[data-ok]").onclick = () => { finish(true); m.close(); };
  });
}

function track(jobId, label, opt = {}) {
  if (!jobId) return;
  const dock = $("#jobdock");
  let card = $("#job-" + jobId);
  if (card) return;
  card = document.createElement("div");
  card.id = "job-" + jobId;
  card.className = "job-card";
  card.innerHTML = `<div class="jh"><b>${e(label)}</b><span>准备中</span></div><p>任务已提交</p><div class="job-bar"><i style="width:8%"></i></div>`;
  dock.prepend(card);
  let finished = false;
  const tick = async () => {
    if (finished) return;
    try {
      const { job } = await api.job(jobId);
      const bar = card.querySelector(".job-bar i");
      const stateText = job.state === "done" ? "完成" : job.state === "failed" ? "失败" : job.total ? Math.round((job.progress / job.total) * 100) + "%" : "处理中";
      card.querySelector(".jh span").textContent = stateText;
      card.querySelector("p").textContent = job.error || job.message || "正在处理";
      bar.style.width = (job.state === "done" ? 100 : job.state === "failed" ? 100 : job.total ? Math.max(8, Math.round((job.progress / job.total) * 100)) : 48) + "%";
      if (job.state === "done" || job.state === "failed") {
        finished = true;
        card.classList.add(job.state === "done" ? "done" : "err");
        if (job.state === "failed") toast(job.error || "任务失败", "error", label);
        else if (!opt.silent) toast(label + "已完成", "ok");
        if (opt.onDone) { try { opt.onDone(job); } catch (err) { toast(errMsg(err), "error"); } }
        if (opt.refresh !== false) setTimeout(() => refreshAll().then(render).catch(() => {}), 500);
        setTimeout(() => card.remove(), 6500);
      }
    } catch (err) {
      card.querySelector("p").textContent = errMsg(err);
    }
  };
  tick();
  const timer = setInterval(() => { if (finished) { clearInterval(timer); return; } tick(); }, 900);
}

async function refreshAll() {
  try {
    const [status, cfg, pv, sg] = await Promise.all([api.status(), api.getConfig(), api.providers(), api.stitches()]);
    st.status = status;
    st.cfg = cfg;
    st.providers = pv.providers || [];
    st.stitches = sg.stitches || [];
    try { st.devices = (await api.devices()).devices || []; } catch (_) { st.devices = []; }
    chrome();
  } catch (err) {
    toast(errMsg(err), "error", "读取状态失败");
    throw err;
  }
}

async function boot() {
  let lastErr = null;
  for (let i = 0; i < 10; i++) {
    try {
      st.info = await api.appInfo();
      st.status = await api.status();
      break;
    } catch (err) { lastErr = err; await sleep(650); }
  }
  $("#boot").classList.add("hidden");
  if (!st.info) {
    $("#auth").classList.remove("hidden");
    $("#auth").innerHTML = `<div class="auth-panel"><div class="auth-card"><h2>无法连接本地代理</h2><p class="sub">${e(errMsg(lastErr))}</p><button class="btn btn-primary" data-act="reload-app">重试</button></div></div>`;
    return;
  }
  if (st.status && st.status.logged_in) {
    await enterApp();
  } else {
    showAuth("login");
  }
}

function showAuth(mode = "login") {
  if (codeTimer) { clearInterval(codeTimer); codeTimer = null; }
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  const server = localStorage.getItem("sb.server") || (st.info && st.info.publicUrl) || "http://www.ai-xiehao.me";
  const login = mode === "login";
  const insecure = /^http:\/\//i.test(server);
  $("#auth").innerHTML = `
  <section class="auth-visual">
    <div class="auth-brand"><img src="../../assets/tray.png" alt=""><div><b>存储熊</b><span>STORAGEBEAR</span></div></div>
    <div class="auth-hero">
      <h1>把散落在各家的云盘，<br>装进一块<em>熟悉的磁盘</em>。</h1>
      <p>存储熊不售卖存储。你继续使用自己的火山、阿里、腾讯、华为等对象存储账号，我们把它整理成好用的虚拟磁盘、文件库与迁移工具。</p>
      <div class="auth-points">
        <div><i>01</i><span>密钥只加密保存在这台电脑，服务器只同步文件索引与设备信息。</span></div>
        <div><i>02</i><span>手机只读访问正在开发中；上线前不会开放任何手机写入电脑的能力。</span></div>
        <div><i>03</i><span>续费不足时一键迁回本地；迁出时同步上传日志，按日志原路恢复。</span></div>
      </div>
    </div>
    <div class="auth-art">
      <img src="../../assets/icon.png" alt="">
      <div class="auth-art-note"><b>先扫描，再上云</b>建立本机索引后，PDF、音乐、视频会自动进入文件库，原路径始终可追溯。</div>
    </div>
  </section>
  <section class="auth-panel"><div class="auth-card">
    <div class="auth-seg"><button class="${login ? "on" : ""}" data-act="auth-mode" data-mode="login">登录</button><button class="${login ? "" : "on"}" data-act="auth-mode" data-mode="register">注册</button></div>
    <h2>${login ? "欢迎回来" : "创建你的存储熊账号"}</h2>
    <p class="sub">${login ? "登录这台电脑的本地代理，同步索引与设备信息。" : "一个账号管理多台电脑。手机访问正在开发中。请使用能长期使用的邮箱。"}</p>
    <form data-form="auth" data-mode="${login ? "login" : "register"}">
      <div class="field"><label>服务器地址 <small>自建服务器可修改</small></label><input class="input" name="server" value="${e(server)}" placeholder="http://你的服务器" required></div>
      ${login ? "" : `<div class="field"><label>昵称</label><input class="input" name="name" maxlength="40" placeholder="例如：小王的电脑"></div>`}
      <div class="field"><label>邮箱</label><input class="input" type="email" name="email" placeholder="you@example.com" required autocomplete="username"></div>
      ${login ? "" : `<div class="field"><label>邮箱验证码</label><div class="auth-code"><input class="input" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="6 位验证码" required autocomplete="one-time-code"><button type="button" class="btn btn-ghost auth-send">获取验证码</button></div><small class="auth-tip">10 分钟内有效，没收到请检查垃圾邮件。</small></div>`}
      <div class="field"><label>密码 <small>${login ? "" : "至少 8 位"}</small></label><input class="input" type="password" name="password" minlength="8" required autocomplete="${login ? "current-password" : "new-password"}"></div>
      ${login ? "" : `<div class="field"><label>确认密码</label><input class="input" type="password" name="confirm" minlength="8" required autocomplete="new-password"></div>`}
      <div class="auth-err"></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">${login ? "登录存储熊" : "注册并开始"}</button>
    </form>
    <div class="form-note mt12"><b>安全提示：</b>对象存储 AccessKey 不会上传服务器；在 Windows 上由 DPAPI 加密保存在本机。请勿在公共电脑登录。</div>
    ${insecure ? '<div class="form-note mt8" style="color:#b26a00"><b>当前服务器未启用 HTTPS：</b>登录密码与令牌在传输中不加密。仅在可信网络使用，或请部署者启用 HTTPS 后把服务器地址改为 https://。</div>' : ""}
    <div class="auth-foot">继续即表示同意 <button data-act="open-terms">服务条款</button> 与 <button data-act="open-privacy">隐私说明</button><br><button data-act="open-manual">查看小白使用手册</button> · <button data-act="open-site">了解存储熊</button></div>
  </div></section>`;
  const form = $('[data-form="auth"]');
  form.addEventListener("submit", submitAuth);
  if (!login) {
    const send = form.querySelector(".auth-send");
    send.addEventListener("click", () => sendAuthCode(form, send));
  }
  setTimeout(() => { const el = form.querySelector('[name="email"]'); if (el) el.focus(); }, 60);
}

function authCodeWait(btn, until) {
  if (codeTimer) clearInterval(codeTimer);
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left > 0) {
      btn.disabled = true;
      btn.textContent = "重发 " + left + "s";
    } else {
      clearInterval(codeTimer);
      codeTimer = null;
      btn.disabled = false;
      btn.textContent = "重新发送";
    }
  };
  tick();
  codeTimer = setInterval(tick, 1000);
}

async function sendAuthCode(form, btn) {
  const errBox = form.querySelector(".auth-err");
  const d = Object.fromEntries(new FormData(form).entries());
  errBox.innerHTML = "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email || "").trim())) {
    errBox.innerHTML = `<div class="err">请先填写有效邮箱</div>`;
    return;
  }
  btn.disabled = true;
  btn.textContent = "发送中…";
  try {
    const r = await api.registerCode({ server: d.server, email: String(d.email).trim() });
    authCodeWait(btn, Date.now() + (Number(r.cooldown) || 60) * 1000);
    toast("验证码已发送，请检查邮箱", "ok");
  } catch (err) {
    errBox.innerHTML = `<div class="err">${e(errMsg(err))}</div>`;
    btn.disabled = false;
    btn.textContent = "获取验证码";
  }
}

async function submitAuth(ev) {
  ev.preventDefault();
  const f = ev.currentTarget;
  const mode = f.dataset.mode;
  const btn = f.querySelector('button[type="submit"]');
  const errBox = f.querySelector(".auth-err");
  const d = Object.fromEntries(new FormData(f).entries());
  errBox.innerHTML = "";
  if (mode === "register" && !/^\d{6}$/.test(String(d.code || "").trim())) {
    errBox.innerHTML = `<div class="err">请输入 6 位邮箱验证码</div>`;
    return;
  }
  if (mode === "register" && d.password !== d.confirm) {
    errBox.innerHTML = `<div class="err">两次输入的密码不一致</div>`;
    return;
  }
  btn.disabled = true;
  const prev = btn.textContent;
  btn.innerHTML = spinner() + " 正在连接";
  try {
    if (mode === "register") {
      await api.register({ server: d.server, email: d.email, password: d.password, name: d.name || "", code: String(d.code).trim() });
    } else {
      await api.login({ server: d.server, email: d.email, password: d.password });
    }
    localStorage.setItem("sb.server", d.server.trim());
    await enterApp();
  } catch (err) {
    errBox.innerHTML = `<div class="err">${e(errMsg(err))}</div>`;
    btn.disabled = false;
    btn.textContent = prev;
  }
}

async function enterApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  await refreshAll();
  startPoll();
  const h = location.hash.replace(/^#\/?/, "");
  setView(PAGE[h] ? h : "dashboard");
  setTimeout(maybeAskAutoStart, 1000);
}

function maybeAskAutoStart() {
  const info = st.info || {};
  if (info.dev || info.platform !== "win32" || info.startHidden) return;
  try {
    if (info.autoStart) { localStorage.setItem("sb.autostart.asked.v2", "1"); return; }
    if (localStorage.getItem("sb.autostart.asked.v2")) return;
    localStorage.setItem("sb.autostart.asked.v2", "1");
  } catch (_) { return; }
  openModal({
    title: "以后开机就自动运行？",
    sub: "只需设置一次，之后登录 Windows 时会安静地待在托盘里。",
    body: `<p class="confirm-text">开启后，存储熊会随 Windows 启动，让文件库、云端任务和虚拟磁盘更早恢复在线。启动时不会弹出主窗口，也不会自动修改你的文件。</p>
      <div class="form-note mt12">会写入当前 Windows 用户的启动项，可在「任务管理器 → 启动应用」中看到「存储熊」或「StorageBear」；也可以随时在「设置与帮助 → 这台电脑」中关闭。安装或升级后只会询问一次。</div>`,
    foot: `<button class="btn btn-ghost" data-act="autostart-no">暂不开启</button><button class="btn btn-primary" data-act="autostart-yes">开机自动启动</button>`,
  });
}

function chrome() {
  const s = st.status || {};
  const u = s.user || {};
  $("#side-device").textContent = s.logged_in ? (u.name || u.email || "已登录") : "未登录";
  $("#side-dot").className = s.logged_in ? "on" : "";
  const chip = $("#conn-chip");
  chip.className = "status-chip" + (s.auth_error ? " off" : "");
  chip.querySelector("b").textContent = s.auth_error ? "需要重新登录" : "本地代理在线";
  const scanBtn = $('.top-actions [data-act="scan-modal"]');
  if (scanBtn) scanBtn.textContent = s.scanning ? "扫描进行中…" : "一键扫描";
  if (st.info) document.title = "存储熊 · " + (st.info.publicUrl || "");
}

function startPoll() {
  if (st.poll) return;
  st.poll = setInterval(async () => {
    try {
      st.status = await api.status();
      chrome();
      if (st.status && !st.status.logged_in) {
        showAuth("login");
        clearInterval(st.poll);
        st.poll = null;
      }
    } catch (_) {}
  }, 5000);
}

function setView(v) {
  if (!PAGE[v]) v = "dashboard";
  st.view = v;
  if (location.hash !== "#/" + v) {
    try { history.replaceState(null, "", "#/" + v); } catch (_) { location.hash = "#/" + v; }
  }
  $$("#nav .nav-item").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  $("#page-title").textContent = PAGE[v][0];
  $("#page-kicker").textContent = PAGE[v][1];
  $("#view").scrollTop = 0;
  render();
}

async function render() {
  const seq = ++st.renderSeq;
  const fn = { dashboard: viewDash, files: viewFiles, cloud: viewCloud, transfer: viewTransfer, drive: viewDrive, phone: viewPhone, settings: viewSettings }[st.view] || viewDash;
  let html;
  try { html = await fn(); } catch (err) { html = `<div class="view-inner">${banner()}<div class="card card-pad"><div class="alert alert-danger">${IC.warn}<div>${e(errMsg(err))}</div></div></div></div>`; }
  if (seq !== st.renderSeq) return;
  $("#view").innerHTML = html;
  $("#view").scrollTop = 0;
  syncSel();
}

function provOptions(sel) {
  return st.providers.map((p) => `<option value="${e(p.id)}" ${p.id === sel ? "selected" : ""}>${e(p.label)}${p.has_key ? "" : "（缺少密钥）"}</option>`).join("");
}
function destOptions(sel) {
  const psel = sel && sel.slice(0, 2) !== "s:" ? sel : "";
  return `<optgroup label="单个云存储">${provOptions(psel)}</optgroup><optgroup label="拼接组合">${st.stitches.map((s) => `<option value="s:${e(s.id)}" ${"s:" + s.id === sel ? "selected" : ""}>${e(s.name)}（${s.providers.length} 家）</option>`).join("")}</optgroup>`;
}
function parseDest(v) {
  if (v && v.slice(0, 2) === "s:") return { stitch_id: v.slice(2) };
  return { provider_id: v || "" };
}
function jobErr(job) {
  const r = (job && job.result) || {};
  return (r.errors && r.errors.length) ? r.errors[0] : "";
}

/* ---------------- dashboard ---------------- */
async function viewDash() {
  let recent = [], logs = [];
  try { recent = (await api.files({ kind: "media", limit: 8 })).entries || []; } catch (_) {}
  try { logs = (await api.logs({ limit: 4 })).logs || []; } catch (_) {}
  const s = st.status || {};
  const c = s.counts || {};
  const cloudBytes = st.providers.reduce((a, p) => a + Number(p.archived_bytes || 0), 0);
  const cloudFiles = st.providers.reduce((a, p) => a + Number(p.archived_files || 0), 0);
  const due = st.providers.filter((p) => p.days_left !== null && p.days_left !== undefined && p.days_left <= 15);
  const scanned = !!(st.cfg && st.cfg.last_scan);
  const mounted = s.drive && s.drive.mounted;
  const hasProvider = st.providers.length > 0;
  const dueHtml = due.length ? `<div class="alert alert-warn mb16">${IC.warn}<div><b>${due.length} 个云存储临近到期</b>　${due.map((p) => e(p.label) + (p.days_left < 0 ? "（已过期）" : "（剩 " + p.days_left + " 天）")).join("、")}。续费不足时，建议先把云端文件迁回本机。</div><button class="btn btn-sm btn-ghost" data-act="restore-provider" data-id="${e(due[0].id)}">一键迁回</button></div>` : "";
  const steps = [
    { done: hasProvider, t: "接入一朵云", p: "填入你自己的对象存储 AccessKey，选择 Bucket。密钥留在本机。", b: "添加云存储", a: "nav", v: "cloud" },
    { done: scanned, t: "扫描本机媒体", p: "一键索引 PDF、音乐、视频，保留原路径，随时找回。", b: "开始扫描", a: "scan-modal" },
    { done: mounted, t: "挂上一块盘", p: "Windows 自动映射网络盘；macOS / Linux 使用 WebDAV 连接。", b: "去挂载", a: "nav", v: "drive" },
  ];
  return `<div class="view-inner">
  ${banner()}
  ${dueHtml}
  <section class="hero">
    <div class="hero-main">
      <p class="eyebrow">MULTI-CLOUD VIRTUAL DRIVE</p>
      <h1>你的云，不该被锁在<br><em>某一个控制台</em>里。</h1>
      <p>存储熊把火山、阿里、腾讯、华为等对象存储整理成统一的虚拟磁盘和文件库。原文件留在你熟悉的路径，迁移、续费、跨设备访问，都从这里开始。</p>
      <div class="hero-actions"><button class="btn btn-primary btn-lg" data-act="scan-modal">${IC.scan} 扫描本机</button><button class="btn btn-ghost btn-lg" data-act="nav" data-view="cloud">${IC.cloud} 接入云存储</button></div>
    </div>
    <div class="hero-art">
      <img src="../../assets/icon.png" alt="">
      <div class="hero-stack">
        <div class="hero-chip"><b>${c.files || 0}</b>本机已索引文件</div>
        <div class="hero-chip"><b>${cloudFiles}</b>云端可恢复副本</div>
        <div class="hero-chip"><b>${st.providers.length}</b>家对象存储</div>
      </div>
    </div>
  </section>
  <div class="grid g4 mb16">
    <div class="card stat"><div class="stat-ic">${IC.folder}</div><div><b>${c.files || 0}</b><span>本机文件</span><small>${fmtSize(c.bytes || 0)} 已纳管</small></div></div>
    <div class="card stat"><div class="stat-ic amber">${IC.cloud}</div><div><b>${c.archived || 0}</b><span>仅云端文件</span><small>${fmtSize(cloudBytes)} 迁出空间</small></div></div>
    <div class="card stat"><div class="stat-ic mint">${IC.drive}</div><div><b>${mounted ? "已挂载" : (s.drive && s.drive.running ? "服务就绪" : "未启动")}</b><span>虚拟磁盘</span><small>${mounted ? ((s.drive && s.drive.cloud !== false) ? "云端盘在线" : "只读镜像盘在线") : "WebDAV · 本机安全连接"}</small></div></div>
    <div class="card stat"><div class="stat-ic violet">${IC.clock}</div><div><b>${due.length ? due.length + " 个" : "正常"}</b><span>续费提醒</span><small>${due.length ? "建议尽快处理" : "15 天内无到期"}</small></div></div>
  </div>
  <div class="split">
    <div>
      <section class="section">
        <div class="sec-head"><div><h3>最近媒体文件</h3><p>扫描索引后的 PDF、音乐与视频。云端文件可直接取回或创建链接。</p></div><button class="btn btn-sm btn-ghost" data-act="nav" data-view="files">全部文件</button></div>
        ${recent.length ? `<div class="media-grid">${recent.map(mediaCard).join("")}</div>` : `<div class="card empty"><div class="e-ic">${IC.scan}</div><b>还没有扫描记录</b><p>选择目录后，存储熊会建立本地索引，并把媒体文件整理到这里。</p><button class="btn btn-primary" data-act="scan-modal">开始扫描</button></div>`}
      </section>
      <section class="section">
        <div class="sec-head"><div><h3>快速开始</h3><p>三步把对象存储变成真正能用的盘。</p></div></div>
        <div class="card card-pad"><div class="steps">${steps.map((x, i) => `<div class="step ${x.done ? "done" : ""}"><div class="step-no">${x.done ? "✓" : String(i + 1).padStart(2, "0")}</div><div><b>${x.t}</b><p>${x.p}</p><button class="btn btn-sm ${x.done ? "btn-ghost" : "btn-primary"}" data-act="${x.a}" ${x.v ? `data-view="${x.v}"` : ""}>${x.b}</button></div></div>`).join("")}</div></div>
      </section>
    </div>
    <div>
      <section class="section">
        <div class="sec-head"><div><h3>最近日志</h3><p>迁出、迁回、编辑回传与日志上传记录。</p></div><button class="btn btn-sm btn-ghost" data-act="nav" data-view="transfer">查看</button></div>
        <div class="card card-pad">${logs.length ? `<div class="steps">${logs.map((l) => `<div class="row-between" style="padding:8px 0;border-bottom:1px dashed var(--line)"><div><b style="font-size:12px">${e(OPLABEL[l.op] || l.op)}</b><span class="faint tiny" style="display:block;margin-top:2px">${fmtTime(l.created_at)} · ${l.count} 个文件</span></div><span class="tag">${e(providerLabel(l.provider_id))}</span></div>`).join("")}</div>` : `<div class="empty" style="padding:24px 8px"><b>还没有迁移记录</b><p>把文件迁出云端后，日志会出现在这里。</p></div>`}</div>
      </section>
      <section class="section">
        <div class="card card-pad" style="background:linear-gradient(140deg,#fffdf7,#fff)">
          <div class="row" style="align-items:flex-start"><div class="stat-ic amber" style="width:34px;height:34px;border-radius:10px">${IC.shield}</div><div><b style="font-size:12.5px">账号与设备边界</b><p class="muted small" style="line-height:1.7;margin:4px 0 0">手机只读访问正在开发中。上线后会保持单向边界：手机只能读这台电脑，电脑永远不能访问手机目录。</p><button class="btn btn-sm btn-ghost mt8" data-act="nav" data-view="phone">查看开发进度</button></div></div>
        </div>
      </section>
    </div>
  </div>
</div>`;
}
function mediaCard(x) {
  return `<div class="media-card">
    <div class="media-thumb">${fileSvg(x.kind, false)}</div>
    <div class="nm" title="${e(x.path)}">${e(x.name)}</div>
    <div class="meta"><span>${fmtSize(x.size)}</span><span>${x.archived ? "云端" : "本地"}</span></div>
    <div class="acts">
      <button class="btn btn-sm btn-icon btn-ghost" title="打开" data-act="open-entry" data-path="${au(x.path)}">${IC.open}</button>
      <button class="btn btn-sm btn-icon btn-ghost" title="创建链接" data-act="share-entry" data-path="${au(x.path)}">${IC.link}</button>
      <button class="btn btn-sm btn-icon btn-ghost" title="在文件夹中定位" data-act="reveal-entry" data-path="${au(x.path)}">${IC.locate}</button>
    </div>
  </div>`;
}

/* ---------------- files ---------------- */
async function viewFiles() {
  let mode = "media";
  let data = { entries: [] };
  try {
    if (st.q) { data = await api.files({ q: st.q, limit: 500 }); mode = "search"; }
    else if (st.path) { data = await api.files({ path: st.path }); mode = "browse"; }
    else {
      data = await api.files({
        kind: st.filter || "all", status: st.status === "all" ? "" : st.status,
        provider_id: st.provider || "", limit: 500,
      });
      mode = "media";
    }
  } catch (err) {
    return `<div class="view-inner">${banner()}<div class="alert alert-danger">${IC.warn}<div>${e(errMsg(err))}</div></div></div>`;
  }
  st.parent = data.parent || "";
  const match = (x) => {
    if (x.is_dir) return true;
    if (st.filter !== "all" && x.kind !== st.filter) return false;
    if (st.status === "local" && (x.archived || x.has_cloud)) return false;
    if (st.status === "cloud" && !x.archived) return false;
    if (st.status === "both" && (!x.has_cloud || x.archived)) return false;
    if (st.provider && x.provider_id !== st.provider) return false;
    return true;
  };
  let entries = (data.entries || []).filter(match);
  st.entries = entries;
  const types = [["all", "全部类型"], ["pdf", "PDF"], ["doc", "文档"], ["audio", "音乐"], ["video", "视频"], ["image", "图片"], ["archive", "压缩包"], ["other", "其他"]];
  const states = [["all", "全部状态"], ["local", "仅本地"], ["cloud", "仅云端"], ["both", "本地 + 云"]];
  const provOpts = [["", "全部云存储"]].concat(st.providers.map((p) => [p.id, p.label]));
  const filtOn = st.filter !== "all" || st.status !== "all" || st.provider;
  const backBtns = (st.q || st.path) ? `<button class="btn btn-sm btn-ghost" data-act="files-reset">返回文件库</button>` : "";
  const crumbs = st.path ? `<div class="breadcrumbs"><button data-act="files-reset">文件库</button>${IC.arrow.replace("<svg", '<svg style="width:12px;height:12px"')}<span>${e(st.path)}</span><button class="btn btn-sm btn-ghost" style="margin-left:auto" data-act="files-up">上一级</button></div>` : "";
  const selCount = st.sel.size;
  const pv = st.provider ? st.providers.find((p) => p.id === st.provider) : null;
  return `<div class="view-inner">
  ${banner()}
  <div class="sec-head"><div><h3>${st.q ? "搜索结果" : st.path ? "磁盘目录" : "文件库"}</h3><p>${st.q ? `“${e(st.q)}”的结果` : st.path ? e(st.path) : "全部已索引文件；迁出后仍会保留在这里，并标记为仅云端。"}</p></div>
    <div class="row"><button class="btn btn-ghost" data-act="downloads-archives">${IC.upload} 下载目录压缩包</button><button class="btn btn-ghost" data-act="files-browse">${IC.folder} 浏览磁盘</button><button class="btn btn-primary" data-act="scan-modal">${IC.scan} 扫描</button></div></div>
  <div class="table-wrap">
    <div class="toolbar">
      <form data-form="files-search" style="display:flex;gap:7px;flex:1;max-width:420px">
        <input class="input" name="q" value="${e(st.q)}" placeholder="搜索文件名或完整路径…" style="max-width:none;flex:1">
        <button class="btn btn-sm" type="submit">搜索</button>
      </form>
      ${backBtns}
      <button class="btn btn-sm btn-ghost" data-act="files-root-pick">${IC.folder} 选择目录</button>
    </div>
    ${crumbs}
    <div class="toolbar" style="border-top:0">
      <b class="small">筛选</b>
      <select class="select" data-filter="kind" style="width:auto;min-width:104px" aria-label="文件类型">${types.map(([k, n]) => `<option value="${k}" ${st.filter === k ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select class="select" data-filter="status" style="width:auto;min-width:104px" aria-label="文件状态">${states.map(([k, n]) => `<option value="${k}" ${st.status === k ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select class="select" data-filter="provider" style="width:auto;min-width:116px" aria-label="云存储">${provOpts.map(([k, n]) => `<option value="${e(k)}" ${st.provider === k ? "selected" : ""}>${e(n)}</option>`).join("")}</select>
      ${filtOn ? `<button class="btn btn-sm btn-ghost" data-act="files-filter-clear">清除筛选</button>` : ""}
      <div class="spacer"></div>
      <span class="tag">${entries.filter((x) => !x.is_dir).length} 个文件</span>
      ${pv ? `<span class="tag amber">${e(pv.label)}</span>` : ""}
    </div>
    <div id="selbar" class="selbar ${selCount ? "" : "hidden"}"><b><span data-cnt>${selCount}</span> 个文件已选择</b><div class="spacer"></div><button class="btn btn-sm btn-ghost" data-act="sel-clear">清除</button><button class="btn btn-sm btn-primary" data-act="${st.status === "cloud" ? "sel-restore" : "sel-archive"}">${st.status === "cloud" ? IC.download + " 迁回所选" : IC.upload + " 迁出所选"}</button></div>
    ${entries.length ? `<table class="tbl"><thead><tr><th class="col-check"><input type="checkbox" class="check" id="sel-all" title="全选当前列表"></th><th>名称与位置</th><th class="col-size">大小</th><th class="col-badge">状态</th><th class="col-acts"></th></tr></thead><tbody>${entries.map(rowHtml).join("")}</tbody></table>` : emptyFiles(mode, filtOn)}
  </div>
  <p class="small faint mt12">提示：扫描只收录设置中的扩展名，压缩包（zip / rar / 7z 等）会一并收录；目录不会被迁出，迁出目录时只处理其中的已索引文件。本机索引镜像模式为只读；云端盘只会在自动生成的桶文件夹内上传，不会改动本地原文件。</p>
</div>`;
}
function rowHtml(x) {
  const sel = st.sel.has(x.path);
  const nameClick = x.is_dir ? `data-act="enter-dir" data-path="${au(x.path)}"` : `data-act="open-entry" data-path="${au(x.path)}"`;
  let acts = "";
  if (x.is_dir) {
    acts = `<button class="btn btn-sm btn-ghost" data-act="enter-dir" data-path="${au(x.path)}">打开</button>`;
  } else {
    if (x.archived || !x.exists) acts += `<button class="btn btn-sm btn-ghost" title="下载回原路径" data-act="fetch-entry" data-path="${au(x.path)}">${IC.download}取回</button>`;
    else acts += `<button class="btn btn-sm btn-ghost" title="迁出到云" data-act="archive-entry" data-path="${au(x.path)}">${IC.upload}迁出</button>`;
    acts += `<button class="btn btn-sm btn-icon btn-ghost" title="创建分享链接" data-act="share-entry" data-path="${au(x.path)}">${IC.link}</button>`;
    acts += `<button class="btn btn-sm btn-icon btn-ghost" title="在文件夹中定位" data-act="reveal-entry" data-path="${au(x.path)}">${IC.locate}</button>`;
    acts += `<button class="btn btn-sm btn-icon btn-ghost" title="打开" data-act="open-entry" data-path="${au(x.path)}">${IC.open}</button>`;
  }
  return `<tr class="${sel ? "sel" : ""}" data-row="${au(x.path)}">
    <td class="col-check">${x.is_dir ? "" : `<input type="checkbox" class="check entry-check" data-path="${au(x.path)}" ${sel ? "checked" : ""}>`}</td>
    <td><div class="name-cell"><span class="file-ic">${fileSvg(x.kind, x.is_dir)}</span><div class="nm"><b><button class="btn-link" style="font-weight:600;color:var(--ink);text-align:left" ${nameClick}>${e(x.name)}</button></b><span title="${e(x.path)}">${e(x.path)}</span></div></div></td>
    <td class="col-size">${x.is_dir ? "—" : fmtSize(x.size)}</td>
    <td class="col-badge">${badge(x)}</td>
    <td class="col-acts"><div class="acts">${acts}</div></td>
  </tr>`;
}
function emptyFiles(mode, filtOn) {
  if (filtOn) return `<div class="empty"><div class="e-ic">${IC.scan}</div><b>没有符合筛选条件的文件</b><p>可以换一个类型、状态或云存储条件。</p><button class="btn btn-sm" data-act="files-filter-clear">清除筛选</button></div>`;
  if (mode === "search") return `<div class="empty"><div class="e-ic">${IC.scan}</div><b>没有找到匹配文件</b><p>试试更短的关键词。若文档确实存在却搜不到，可能是旧版本扫描时尚未收录 Office / WPS 类型，重新扫描一次即可补全索引。</p><div class="row" style="justify-content:center"><button class="btn btn-sm" data-act="scan-modal">重新扫描</button><button class="btn btn-sm btn-ghost" data-act="files-reset">清空搜索</button></div></div>`;
  if (mode === "browse") return `<div class="empty"><div class="e-ic">${IC.folder}</div><b>这里还没有索引记录</b><p>只显示已经扫描过的文件与目录。可以返回文件库，或扫描包含此目录的位置。</p><button class="btn btn-sm" data-act="files-reset">返回文件库</button></div>`;
  return `<div class="empty"><div class="e-ic">${IC.scan}</div><b>文件库是空的</b><p>先扫描包含文档、PDF、音乐或视频的目录。扫描不会上传文件。</p><button class="btn btn-primary" data-act="scan-modal">${IC.scan} 一键扫描</button></div>`;
}
function syncSel() {
  const bar = $("#selbar");
  if (!bar) return;
  bar.classList.toggle("hidden", st.sel.size === 0);
  const cnt = bar.querySelector("[data-cnt]");
  if (cnt) cnt.textContent = String(st.sel.size);
  $$("#view .entry-check").forEach((cb) => {
    const tr = cb.closest("tr");
    const path = un(cb.dataset.path);
    cb.checked = st.sel.has(path);
    if (tr) tr.classList.toggle("sel", st.sel.has(path));
  });
  const all = $("#sel-all");
  if (all) {
    const boxes = $$("#view .entry-check");
    all.checked = boxes.length > 0 && boxes.every((cb) => cb.checked);
    all.indeterminate = !all.checked && boxes.some((cb) => cb.checked);
  }
}

/* ---------------- cloud ---------------- */
function hostOf(u) {
  return String(u || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}
function siteUrl(path) {
  const base = ((st.cfg && st.cfg.server) || (st.info && st.info.publicUrl) || "http://www.ai-xiehao.me").replace(/\/+$/, "");
  return base + path;
}

async function viewCloud() {
  let ce = [];
  try { ce = (await api.files({ kind: "cloud", limit: 6 })).entries || []; } catch (_) {}
  const totalFiles = st.providers.reduce((a, p) => a + Number(p.archived_files || 0), 0);
  const totalBytes = st.providers.reduce((a, p) => a + Number(p.archived_bytes || 0), 0);
  const due = st.providers.filter((p) => p.days_left !== null && p.days_left !== undefined && p.days_left <= 15);
  const quota = st.providers.reduce((a, p) => a + Number(p.quota_bytes || 0), 0);
  const cards = st.providers.length
    ? `<div class="grid g3">${st.providers.map(provCard).join("")}</div>`
    : `<div class="card card-pad">
        <div class="empty" style="padding:18px 8px 26px"><div class="e-ic">${IC.cloud}</div><b>还没有接入云存储</b><p>存储熊不替你买存储。使用你已经有的对象存储 Bucket，把 AccessKey 填进本机即可。密钥不会上传服务器。</p><button class="btn btn-primary" data-act="provider-add">${IC.plus} 添加第一朵云</button><button class="btn btn-ghost" data-act="provider-help">怎么获取密钥</button></div>
        <div class="flow"><div class="flow-node"><div class="fi">${IC.folder}</div><b>本机文件</b><span>扫描后建立索引</span></div><div class="flow-arrow">${IC.arrow}</div><div class="flow-node"><div class="fi">${IC.shield}</div><b>加密密钥</b><span>AccessKey 只留本机</span></div><div class="flow-arrow">${IC.arrow}</div><div class="flow-node"><div class="fi">${IC.cloud}</div><b>对象存储</b><span>迁出、续费与恢复</span></div></div>
      </div>`;

  return `<div class="view-inner">
  ${banner()}
  ${due.length ? `<div class="alert alert-warn mb16">${IC.warn}<div><b>${due.length} 个云存储将在 15 天内到期</b>　${due.map((p) => e(p.label)).join("、")}。建议先迁回云端文件，再决定是否续费。</div></div>` : ""}
  <div class="sec-head"><div><h3>云端与续费</h3><p>接入多家对象存储、拼接容量，并在这里掌握到期时间。</p></div>
    <div class="row"><button class="btn btn-ghost" data-act="provider-help">${IC.help} 获取密钥指引</button><button class="btn btn-ghost" data-act="stitch-add">${IC.merge} 新建拼接</button><button class="btn btn-primary" data-act="provider-add">${IC.plus} 添加云存储</button></div></div>
  <div class="grid g4 mb16">
    <div class="card stat"><div class="stat-ic">${IC.cloud}</div><div><b>${st.providers.length}</b><span>家云存储</span><small>${st.stitches.length} 个拼接组合</small></div></div>
    <div class="card stat"><div class="stat-ic amber">${IC.upload}</div><div><b>${totalFiles}</b><span>云端副本</span><small>${fmtSize(totalBytes)} 已迁出</small></div></div>
    <div class="card stat"><div class="stat-ic violet">${IC.clock}</div><div><b>${due.length ? due.length + " 个" : "正常"}</b><span>临近到期</span><small>${due.length ? "请尽快迁回或续费" : "15 天内无到期"}</small></div></div>
    <div class="card stat"><div class="stat-ic mint">${IC.drive}</div><div><b>${quota ? fmtSize(quota) : "未填写"}</b><span>总配额记录</span><small>以各厂商控制台为准</small></div></div>
  </div>
  ${cards}

  <section class="section">
    <div class="sec-head"><div><h3>多云拼接</h3><p>把多家 Bucket 组合成一个迁出目标；新文件会优先放进占用较少的一家。任意一家快到期，都能按日志单独迁回。</p></div><button class="btn btn-sm btn-ghost" data-act="stitch-add">${IC.plus} 新建拼接</button></div>
    ${st.stitches.length ? `<div class="grid g2">${st.stitches.map(stitchCard).join("")}</div>` : `<div class="card empty" style="padding:28px 20px"><div class="e-ic">${IC.merge}</div><b>还没有拼接组合</b><p>例如把阿里云与腾讯云拼在一起。迁出时自动分摊，迁回时仍按云存储和日志独立处理。</p><button class="btn btn-sm" data-act="stitch-add">创建拼接</button></div>`}
  </section>

  <section class="section">
    <div class="sec-head"><div><h3>最近云端副本</h3><p>本地已删除、仍可从云端取回的文件。</p></div><button class="btn btn-sm btn-ghost" data-act="nav" data-view="files">全部文件</button></div>
    <div class="table-wrap">
      ${ce.length ? `<table class="tbl"><thead><tr><th>文件</th><th class="col-size">大小</th><th class="col-badge">云存储</th><th class="col-acts"></th></tr></thead><tbody>${ce.map((x) => `<tr>
        <td><div class="name-cell"><span class="file-ic">${fileSvg(x.kind, false)}</span><div class="nm"><b>${e(x.name)}</b><span title="${e(x.path)}">${e(x.path)}</span></div></div></td>
        <td class="col-size">${fmtSize(x.size)}</td>
        <td class="col-badge"><span class="tag">${e(x.provider_label || providerLabel(x.provider_id))}</span></td>
        <td class="col-acts"><div class="acts"><button class="btn btn-sm btn-ghost" data-act="fetch-entry" data-path="${au(x.path)}">${IC.download}取回</button><button class="btn btn-sm btn-icon btn-ghost" title="创建链接" data-act="share-entry" data-path="${au(x.path)}">${IC.link}</button><button class="btn btn-sm btn-icon btn-ghost" title="打开" data-act="open-entry" data-path="${au(x.path)}">${IC.open}</button></div></td>
      </tr>`).join("")}</tbody></table>` : `<div class="empty" style="padding:28px 20px"><div class="e-ic">${IC.cloud}</div><b>暂无云端文件</b><p>在文件库中选择本地文件执行「迁出」，上传后即可释放本机空间。</p><button class="btn btn-sm" data-act="nav" data-view="files">去文件库</button></div>`}
    </div>
  </section>

  <div class="grid g2">
    <div class="card card-pad">
      <div class="card-title-row"><div><h3>对象存储是什么</h3><p>不需要懂技术，按这个顺序理解就够了。</p></div><span class="tag indigo">入门</span></div>
      <div class="steps">
        <div class="step"><div class="step-no">01</div><div><b>Bucket 就是云上的一个房间</b><p>在阿里云 OSS、腾讯云 COS 等控制台创建一个 Bucket，用来存放存储熊迁出的文件。</p></div></div>
        <div class="step"><div class="step-no">02</div><div><b>AccessKey 是进房间的钥匙</b><p>钥匙只加密保存在这台电脑。存储熊服务器不会收到密钥，也不接触你的云账号。</p></div></div>
        <div class="step"><div class="step-no">03</div><div><b>迁出与迁回都可追溯</b><p>迁出时自动把清单日志写入同一个 Bucket；续费不足时按日志或云存储迁回原路径。</p></div></div>
      </div>
      <button class="btn btn-sm btn-ghost mt12" data-act="open-manual">查看小白使用手册</button>
    </div>
    <div class="card card-pad" style="background:linear-gradient(145deg,#fffdf8,#fff)">
      <div class="card-title-row"><div><h3>密钥与费用边界</h3><p>存储熊只整理，不代管你的云资产。</p></div><span class="tag green">本机加密</span></div>
      <p class="small muted" style="line-height:1.85;margin:0">存储费用仍由云厂商按你的 Bucket 用量结算；存储熊不售卖容量、不代扣续费。到期时间与续费链接由你填写，仅用于提醒和跳转。删除云存储配置前，请先迁回仍有用的云端副本。</p>
      <div class="form-note mt12"><b>请注意：</b>Windows 使用 DPAPI 加密密钥；macOS / Linux 当前使用本机配置文件的权限保护，请确保系统账号本身安全。</div>
    </div>
  </div>
</div>`;
}

function provCard(p) {
  const used = Number(p.archived_bytes || 0);
  const quota = Number(p.quota_bytes || 0);
  const pct = quota ? Math.min(100, Math.round(used / quota * 100)) : 0;
  const ready = !!(p.has_key && p.endpoint && p.bucket);
  const beta = p.code === "volcengine";
  return `<div class="card provider-card">
    <div class="provider-top">
      <div class="provider-logo" style="background:${pcolor(p)}">${e(pshort(p))}</div>
      <div style="flex:1;min-width:0">
        <div class="provider-name">${e(p.label)} ${beta ? '<span class="tag indigo">Beta</span>' : ""} ${p.enabled === 0 || p.enabled === false ? '<span class="tag">已停用</span>' : ""} ${ready ? "" : '<span class="tag amber">配置未完成</span>'}</div>
        <div class="provider-sub">${e(p.bucket || "未填写 Bucket")} · ${e(hostOf(p.endpoint) || "未填写 Endpoint")}</div>
      </div>
      <button class="btn btn-sm btn-icon btn-ghost" title="编辑" data-act="provider-edit" data-id="${e(p.id)}">${IC.edit}</button>
    </div>
    <div class="provider-metrics">
      <div class="pmetric"><span>续费状态</span><b>${dueText(p.days_left)}</b></div>
      <div class="pmetric"><span>配额记录</span><b>${quota ? fmtSize(quota) : "未填写"}</b></div>
      <div class="pmetric"><span>云端副本</span><b>${p.archived_files || 0} 个 · ${fmtSize(used)}</b></div>
      <div class="pmetric"><span>区域 / 样式</span><b>${e(p.region || "默认")} · ${p.style === "virtual" ? "虚拟主机" : "路径"}</b></div>
    </div>
    ${quota ? `<div style="margin-top:11px"><div class="row-between tiny faint"><span>占配额记录</span><span>${pct}%</span></div><div style="height:5px;background:#f0f2f8;border-radius:4px;overflow:hidden;margin-top:5px"><i style="display:block;height:100%;width:${pct}%;background:${pct > 85 ? "#e6a33c" : pcolor(p)};border-radius:4px"></i></div></div>` : ""}
    <div class="provider-acts">
      <button class="btn btn-sm btn-ghost" data-act="provider-restore" data-id="${e(p.id)}" ${p.archived_files ? "" : "disabled"}>${IC.download} 迁回</button>
      <button class="btn btn-sm btn-ghost" data-act="provider-files" data-id="${e(p.id)}">云端文件</button>
      <button class="btn btn-sm btn-ghost" data-act="provider-test" data-id="${e(p.id)}">测试连接</button>
      ${beta ? `<button class="btn btn-sm btn-ghost" data-act="provider-balance" data-id="${e(p.id)}">余额 Beta</button>` : ""}
      <button class="btn btn-sm btn-ghost" data-act="provider-renew" data-id="${e(p.id)}">续费</button>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-icon btn-ghost" title="删除配置" data-act="provider-del" data-id="${e(p.id)}">${IC.trash}</button>
    </div>
    ${p.has_key ? "" : `<p class="tiny warn-text" style="margin:9px 0 0">缺少 AccessKey / SecretKey，迁出与迁回暂不可用。</p>`}
  </div>`;
}

function stitchCard(s) {
  const ps = (s.providers || []).map((id) => st.providers.find((p) => p.id === id)).filter(Boolean);
  return `<div class="card stitch-card">
    <div class="row-between"><div class="provider-name">${IC.merge} ${e(s.name)} <span class="tag indigo">轮询均衡</span></div>
      <div class="row"><button class="btn btn-sm btn-icon btn-ghost" title="编辑" data-act="stitch-edit" data-id="${e(s.id)}">${IC.edit}</button><button class="btn btn-sm btn-icon btn-ghost" title="删除" data-act="stitch-del" data-id="${e(s.id)}">${IC.trash}</button></div></div>
    <div class="stitch-line">${ps.map((p, i) => `${i ? '<span class="stitch-plus">+</span>' : ""}<span class="stitch-dot"><i style="background:${pcolor(p)}"></i>${e(p.label)}</span>`).join("") || '<span class="tag amber">没有可用的云存储</span>'}</div>
    <p class="tiny faint" style="margin:10px 0 0">迁出时优先选择当前云端副本占用较少的一家；删除拼接不会删除任何云端文件。</p>
  </div>`;
}

function providerModal(p) {
  p = p || {};
  const edit = !!p.id;
  const code = p.code || "volcengine";
  const base = edit ? {} : (PRESETS.find((x) => x.code === code) || {});
  const style = p.style || base.style || "path";
  const note = (PRESETS.find((x) => x.code === code) || {}).note || "选择一家云存储后会自动填入官方 S3 兼容端点，也可手动修改。";
  const presets = PRESETS.map((x) => `<button type="button" class="preset ${x.code === code ? "on" : ""}" data-preset="${x.code}"><i style="background:${x.color}"></i><span>${e(x.name)}${x.beta ? " · Beta" : ""}</span></button>`).join("");
  return openModal({
    title: edit ? "编辑云存储" : "添加云存储",
    sub: "默认推荐火山引擎 TOS。密钥只加密保存在这台电脑，不会上传服务器。",
    wide: true,
    body: `<form id="provForm" data-form="provider" data-id="${e(p.id || "")}">
      <input type="hidden" name="code" value="${e(code)}">
      <div class="preset-grid">${presets}</div>
      <div class="help-box" id="preset-note">${e(note)} <button type="button" data-act="provider-help">查看获取密钥步骤</button></div>
      <div class="form-grid">
        <div class="field full"><label>显示名称</label><input class="input" name="label" maxlength="60" value="${e(p.label || "")}" placeholder="例如：我的火山引擎 TOS" required></div>
        <div class="field full"><label>S3 兼容 Endpoint <small>必须带 https:// 或 http://</small></label><input class="input" name="endpoint" value="${e(p.endpoint || base.endpoint || "")}" placeholder="https://tos-s3-cn-beijing.volces.com" required></div>
        <div class="field"><label>地域 Region</label><input class="input" name="region" maxlength="40" value="${e(p.region || base.region || "us-east-1")}" placeholder="cn-beijing"></div>
        <div class="field"><label>Bucket 名称</label><input class="input" name="bucket" maxlength="120" value="${e(p.bucket || "")}" placeholder="my-bucket" required></div>
        <div class="field"><label>访问样式</label><select class="input" name="style"><option value="path" ${style !== "virtual" ? "selected" : ""}>路径样式（Path）</option><option value="virtual" ${style === "virtual" ? "selected" : ""}>虚拟主机样式（Virtual）</option></select></div>
        <div class="field"><label>配额记录 <small>GB，可留空</small></label><input class="input" type="number" min="0" step="1" name="quota_gb" value="${p.quota_bytes ? Math.round(Number(p.quota_bytes) / 1073741824) : ""}" placeholder="例如 100"></div>
        <div class="field"><label>到期日期 <small>用于续费提醒</small></label><input class="input" type="date" name="expires_at" value="${dateVal(p.expires_at)}"></div>
        <div class="field"><label>续费网址 <small>可留空</small></label><input class="input" name="renew_url" value="${e(p.renew_url || "")}" placeholder="https://控制台续费页面"></div>
        <div class="field"><label>AccessKey</label><input class="input" name="access_key" autocomplete="off" placeholder="${edit && p.has_key ? "留空表示保持不变" : "填写云厂商的 AccessKey"}"></div>
        <div class="field"><label>SecretKey</label><input class="input" type="password" name="secret_key" autocomplete="new-password" placeholder="${edit && p.has_key ? "留空表示保持不变" : "填写云厂商的 SecretKey"}"></div>
        <div class="field full"><label class="opt-line"><input type="checkbox" name="enabled" ${p.enabled === 0 || p.enabled === false ? "" : "checked"}> 启用这个云存储</label></div>
      </div>
      <div class="form-note"><b>安全提示：</b>建议单独创建只有目标 Bucket 读写权限的子账号密钥，不要使用主账号密钥。填错不会损坏云端文件，可随时修改。</div>
      ${code === "volcengine" ? `<div class="form-note mt12"><b>火山引擎 Beta：</b>TOS 迁出与迁回使用 S3 兼容接口；保存后可在卡片上查询账户余额。余额查询需要在火山引擎「访问控制 IAM」中给子账号授予费用中心 QueryBalanceAcct 权限，遇到 403 时会提示权限不足。连接手机功能正在开发中。</div>` : ""}
      <div class="test-state mt8 tiny" id="provTest"></div>
    </form>`,
    foot: `<button class="btn btn-ghost" type="button" data-act="provider-form-test">测试连接</button><button class="btn btn-ghost" type="button" data-act="close-modal">取消</button><button class="btn btn-primary" type="submit" form="provForm">${edit ? "保存修改" : "保存云存储"}</button>`,
  });
}

function applyPreset(code) {
  const p = PRESETS.find((x) => x.code === code);
  const f = $("#provForm");
  if (!p || !f) return;
  f.elements.code.value = p.code;
  f.elements.label.value = p.name;
  f.elements.endpoint.value = p.endpoint || "";
  f.elements.region.value = p.region || "us-east-1";
  f.elements.style.value = p.style || "path";
  const note = $("#preset-note");
  if (note) note.innerHTML = e(p.note) + ' <button type="button" data-act="provider-help">查看获取密钥步骤</button>';
  $$(".preset").forEach((b) => b.classList.toggle("on", b.dataset.preset === code));
}

function providerData() {
  const f = $("#provForm");
  const v = (n) => String((f.elements[n] && f.elements[n].value) || "").trim();
  const d = {
    code: v("code") || "custom", label: v("label"), endpoint: v("endpoint"), region: v("region"),
    bucket: v("bucket"), style: v("style"), access_key: v("access_key"), secret_key: v("secret_key"),
    expires_at: v("expires_at"), quota_bytes: Math.max(0, Math.round(Number(v("quota_gb") || 0) * 1073741824)),
    renew_url: v("renew_url"), enabled: !!(f.elements.enabled && f.elements.enabled.checked),
  };
  if (f.dataset.id) d.id = f.dataset.id;
  return d;
}

function providerHelp() {
  const rows = PRESETS.filter((p) => p.code !== "custom").map((p) => `<div class="pick-item" style="align-items:flex-start"><i style="width:8px;height:8px;border-radius:50%;background:${p.color};margin-top:5px;flex:none"></i><div><b>${e(p.name)}${p.beta ? ' <span class="tag indigo">Beta</span>' : ""}</b><div class="tiny faint" style="line-height:1.7;margin-top:2px">控制台 → 对象存储 → 创建 Bucket；在访问密钥 / AccessKey 页面创建子账号密钥。端点：<span class="inline-code">${e(p.endpoint || "以控制台为准")}</span>，区域：<span class="inline-code">${e(p.region)}</span>，${p.style === "virtual" ? "通常使用虚拟主机样式" : "通常使用路径样式"}。${p.beta ? "余额查询还需 IAM 费用中心 QueryBalanceAcct 权限；连接手机正在开发中。" : ""}</div></div></div>`).join("");
  openModal({
    title: "如何获取对象存储密钥",
    sub: "看不懂也没关系，按下面顺序操作。存储熊只需要 Bucket、Endpoint、Region、AccessKey 与 SecretKey。",
    wide: true,
    body: `<div class="steps mb16">
      <div class="step"><div class="step-no">01</div><div><b>先在云厂商控制台创建 Bucket</b><p>Bucket 名称全球唯一，地域选离你近的。私有读写即可，不需要把 Bucket 设为公开。</p></div></div>
      <div class="step"><div class="step-no">02</div><div><b>创建一组访问密钥</b><p>优先创建子账号 / RAM 用户，只授予目标 Bucket 的读写权限。把 AccessKey 与 SecretKey 核对完整。</p></div></div>
      <div class="step"><div class="step-no">03</div><div><b>回到存储熊填写并测试</b><p>选择对应厂商后端点会自动填入。点击「测试连接」确认 Endpoint、Bucket 与密钥匹配，再保存。</p></div></div>
    </div>
    <div class="pick-list">${rows}</div>
    <div class="form-note mt12"><b>常见问题：</b>测试失败通常是 Bucket 与 Endpoint 地域不一致、密钥被空格截断、子账号没有该 Bucket 权限，或端点需要虚拟主机样式。云端已存在的同名对象不会被覆盖清理，但请勿在存储熊目录下手动改动文件。</div>`,
    foot: `<button class="btn btn-ghost" data-act="open-manual">使用手册</button><button class="btn btn-primary" data-act="close-modal">知道了</button>`,
  });
}

function balanceModal(p, b) {
  const row = (k, label) => `<dt>${label}</dt><dd>${e(b[k] === undefined || b[k] === "" ? "—" : b[k])}</dd>`;
  openModal({
    title: "火山引擎账户余额",
    sub: `${p.label || "火山引擎"} · Beta 功能，数据来自费用中心 OpenAPI。`,
    body: `<dl class="kv">${row("AvailableBalance", "可用余额")}${row("CashBalance", "现金余额")}${row("CreditLimit", "信控额度")}${row("FreezeAmount", "冻结金额")}${row("ArrearsBalance", "欠费金额")}${row("AccountID", "账号 ID")}</dl>
      <div class="form-note mt12"><b>Beta 提示：</b>余额只能查询，充值和管理仍需在火山引擎费用中心完成。若提示 403，请在「访问控制 IAM」中为子账号添加费用中心 QueryBalanceAcct 权限，或改用主账号密钥。连接手机功能正在开发中。</div>`,
    foot: `<button class="btn btn-ghost" data-act="provider-balance-recharge">去费用中心</button><button class="btn btn-primary" data-act="close-modal">知道了</button>`,
  });
}

function balanceError(p, err) {
  const msg = errMsg(err);
  const denied = /权限不足|403|AccessDenied|Forbidden/i.test(msg);
  openModal({
    title: "余额查询失败",
    sub: p.label || "火山引擎",
    body: `<p class="confirm-text">${e(msg)}</p>${denied ? `<div class="form-note mt12"><b>如何授权：</b>登录火山引擎控制台 → 访问控制 IAM → 用户 → 选择这个 AccessKey 所属的子账号 → 添加权限 → 授予费用中心查询余额（QueryBalanceAcct）权限。保存后立即生效，无需重新填写密钥。</div>` : `<div class="form-note mt12">请检查 AccessKey / SecretKey 是否完整、账号是否已开通费用中心，以及本机网络能否访问 billing.volcengineapi.com。</div>`}`,
    foot: `<button class="btn btn-primary" data-act="close-modal">知道了</button>`,
  });
}

function stitchModal(s) {
  s = s || {};
  const chosen = new Set(s.providers || []);
  const rows = st.providers.map((p) => `<label class="pick-item"><input type="checkbox" name="providers" value="${e(p.id)}" ${chosen.has(p.id) ? "checked" : ""}><span style="flex:1">${e(p.label)}</span><span class="tag">${p.has_key ? "可迁出" : "缺少密钥"}</span><span class="tag">${fmtSize(Number(p.archived_bytes || 0))}</span></label>`).join("");
  return openModal({
    title: s.id ? "编辑拼接组合" : "新建拼接组合",
    sub: "把多家云存储拼成一个迁出目标。迁回仍按每家云存储与原路径独立处理。",
    body: `<form id="stitchForm" data-form="stitch" data-id="${e(s.id || "")}">
      <div class="field"><label>组合名称</label><input class="input" name="name" maxlength="60" value="${e(s.name || "")}" placeholder="例如：主力多云" required></div>
      <div class="field"><label>包含的云存储</label><div class="pick-list">${rows || '<div class="empty" style="padding:20px">还没有云存储，请先添加。</div>'}</div></div>
      <div class="field"><label>分配策略</label><select class="input" name="strategy"><option value="round_robin">优先放入占用较少的云存储</option></select></div>
      <div class="form-note">拼接只是迁出时的选择规则，不会合并各家的账号权限，也不会自动删除任何文件。到期时仍建议按单一云存储迁回。</div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" type="submit" form="stitchForm">${s.id ? "保存修改" : "创建拼接"}</button>`,
  });
}

/* ---------------- transfer ---------------- */
async function viewTransfer() {
  let res = { logs: [], remote: [] };
  try { res = await api.logs({ limit: 120, remote: 1 }); } catch (err) { return `<div class="view-inner">${banner()}<div class="alert alert-danger">${IC.warn}<div>${e(errMsg(err))}</div></div></div>`; }
  const map = new Map();
  (res.logs || []).forEach((l) => map.set(l.id, Object.assign({ source: "local" }, l)));
  (res.remote || []).forEach((l) => { if (map.has(l.id)) map.get(l.id).remote = true; else map.set(l.id, Object.assign({ source: "remote" }, l)); });
  st.logs = Array.from(map.values()).sort((a, b) => Number(b.created_at) - Number(a.created_at));
  const archiveLogs = st.logs.filter((l) => l.op === "archive");
  const cloudFiles = st.providers.reduce((a, p) => a + Number(p.archived_files || 0), 0);
  const cloudBytes = st.providers.reduce((a, p) => a + Number(p.archived_bytes || 0), 0);
  const last = st.logs[0];
  return `<div class="view-inner">
    ${banner()}
    <div class="sec-head"><div><h3>迁出与迁回</h3><p>迁出时上传清单日志；续费不足时可按日志、云存储或文件原路迁回。</p></div>
      <div class="row"><button class="btn btn-ghost" data-act="restore-open">${IC.download} 迁回</button><button class="btn btn-primary" data-act="archive-open">${IC.upload} 迁出文件</button></div></div>
    <div class="flow">
      <div class="flow-node"><div class="fi">${IC.folder}</div><b>本机原路径</b><span>保留目录结构，随时按原位置找回</span></div>
      <div class="flow-arrow">${IC.arrow}</div>
      <div class="flow-node"><div class="fi">${IC.cloud}</div><b>对象存储 Bucket</b><span>${cloudFiles} 个副本 · ${fmtSize(cloudBytes)}</span></div>
      <div class="flow-arrow">${IC.arrow}</div>
      <div class="flow-node"><div class="fi">${IC.shield}</div><b>迁移日志</b><span>本机 + 服务器 + 云端清单 JSONL</span></div>
    </div>
    <div class="grid g4 mb16">
      <div class="card stat"><div class="stat-ic amber">${IC.upload}</div><div><b>${cloudFiles}</b><span>云端副本</span><small>${fmtSize(cloudBytes)} 可迁回</small></div></div>
      <div class="card stat"><div class="stat-ic">${IC.clock}</div><div><b>${archiveLogs.length}</b><span>迁出日志</span><small>最近 ${last ? ago(last.created_at) : "暂无记录"}</small></div></div>
      <div class="card stat"><div class="stat-ic mint">${IC.shield}</div><div><b>${st.logs.filter((l) => l.op === "restore").length}</b><span>迁回记录</span><small>按清单恢复原路径</small></div></div>
      <div class="card stat"><div class="stat-ic violet">${IC.link}</div><div><b>${st.logs.length}</b><span>全部迁移日志</span><small>本机与服务器合并</small></div></div>
    </div>
    ${res.remote_error ? `<div class="alert alert-warn mb16">${IC.warn}<div>服务器日志暂不可用：${e(res.remote_error)}。本机日志仍可正常使用。</div></div>` : ""}
    <div class="table-wrap">
      <div class="toolbar"><b style="font-size:12.5px">迁移日志</b><span class="tag">${st.logs.length} 条</span><div class="spacer"></div><button class="btn btn-sm btn-ghost" data-act="refresh-view">${IC.refresh} 刷新</button><button class="btn btn-sm btn-ghost" data-act="restore-open">一键迁回</button></div>
      ${st.logs.length ? `<table class="tbl"><thead><tr><th style="width:140px">操作</th><th>云存储 / 日志</th><th style="width:140px">时间</th><th style="width:90px">文件</th><th style="width:80px">来源</th><th style="width:140px"></th></tr></thead><tbody>${st.logs.slice(0, 80).map(logRow).join("")}</tbody></table>` : `<div class="empty" style="padding:34px 20px"><div class="e-ic">${IC.upload}</div><b>还没有迁移记录</b><p>在文件库中选择本地文件迁出，日志会自动记录在这里并上传到云端。</p><button class="btn btn-sm" data-act="archive-open">迁出文件</button></div>`}
    </div>
    <div class="alert alert-info mt16">${IC.info}<div><b>日志如何帮助恢复？</b><br>迁出时，每批文件会在目标 Bucket 的 <span class="inline-code">_storagebear/logs/</span> 下写入 JSONL 清单，记录原路径、对象 Key、大小与云存储。迁回时按清单下载到原路径；即使本机重装，只要日志与密钥仍在，也能恢复。</div></div>
  </div>`;
}

function logRow(l) {
  const op = OPLABEL[l.op] || l.op || "操作";
  const src = l.source === "remote" ? "服务器" : (l.remote ? "本机+服务器" : "本机");
  return `<tr>
    <td><span class="log-op">${e(op)}</span><span class="log-manifest">${e(l.id)}</span></td>
    <td>${e(l.provider_label || providerLabel(l.provider_id))}</td>
    <td class="small muted">${fmtTime(l.created_at)}</td>
    <td>${Number(l.count || 0)} 个</td>
    <td><span class="tag">${src}</span></td>
    <td><div class="acts"><button class="btn btn-sm btn-ghost" data-act="log-view" data-id="${e(l.id)}">详情</button>${l.op === "archive" ? `<button class="btn btn-sm btn-ghost" data-act="restore-log" data-id="${e(l.id)}">迁回</button>` : ""}</div></td>
  </tr>`;
}

function logDetail(d) {
  const o = d && typeof d === "object" ? d : {};
  const ms = o.manifests && typeof o.manifests === "object" ? Object.values(o.manifests) : (o.manifest ? [o.manifest] : []);
  return {
    ms, errors: Array.isArray(o.errors) ? o.errors : [],
    extra: Object.assign({}, o, { manifests: undefined, manifest: undefined, errors: undefined }),
  };
}

async function logView(id) {
  let log = null;
  try { log = (await api.log(id)).log; } catch (_) {}
  const cached = st.logs.find((x) => x.id === id);
  if (!log && cached) log = cached;
  if (!log) { toast("无法读取这条日志", "error"); return; }
  if (typeof log.detail === "string") { try { log.detail = JSON.parse(log.detail); } catch (_) { log.detail = {}; } }
  if ((!log.detail || !Object.keys(log.detail).length) && cached && cached.detail) log.detail = cached.detail;
  const d = logDetail(log.detail);
  const extra = Object.keys(d.extra).filter((k) => d.extra[k] !== undefined && d.extra[k] !== "" && d.extra[k] !== null);
  const m = openModal({
    title: (OPLABEL[log.op] || log.op) + "记录",
    sub: e(fmtTime(log.created_at) + " · " + (log.provider_label || providerLabel(log.provider_id)) + " · " + Number(log.count || 0) + " 个文件"),
    wide: true,
    body: `<dl class="kv">
      <dt>日志 ID</dt><dd><span class="copy-val">${e(log.id)}</span></dd>
      <dt>操作类型</dt><dd>${e(OPLABEL[log.op] || log.op)}</dd>
      <dt>云存储</dt><dd>${e(log.provider_label || providerLabel(log.provider_id) || "未指定")}</dd>
      ${log.device_name ? `<dt>来源设备</dt><dd>${e(log.device_name)}</dd>` : ""}
      <dt>文件数量</dt><dd>${Number(log.count || 0)}</dd>
      <dt>记录来源</dt><dd>${cached && cached.source === "remote" ? "服务器（本机无此记录）" : "本机"}</dd>
    </dl>
    ${d.ms.length ? `<div class="panel-head mt16"><div><h3>云端清单</h3><p>清单由迁移日志指向，实际内容存放在对象存储中。</p></div></div><div class="modal-list">${d.ms.map((k) => `<div class="pick-item"><span class="copy-val" style="flex:1">${e(k)}</span><button class="btn btn-sm btn-ghost" data-copy="${e(k)}" data-label="清单路径">复制</button></div>`).join("")}</div>` : ""}
    ${d.errors.length ? `<div class="alert alert-warn mt16">${IC.warn}<div><b>${d.errors.length} 条异常</b><br>${d.errors.map((x) => e(x)).join("<br>")}</div></div>` : ""}
    ${extra.length ? `<div class="panel-head mt16"><div><h3>详细信息</h3></div></div><pre class="mono small" style="background:#f7f8fc;border:1px solid var(--line);border-radius:9px;padding:12px;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto">${e(JSON.stringify(d.extra, null, 2))}</pre>` : ""}
    <div class="form-note mt16">日志详情中的清单路径与对象 Key 可用于排查。请勿手动删除云端日志目录，否则按日志迁回会退化为按云存储现有副本恢复。</div>`,
    foot: `${log.op === "archive" ? `<button class="btn btn-primary" data-act="restore-log" data-id="${e(log.id)}">${IC.download} 按此日志迁回</button>` : ""}<button class="btn btn-ghost" data-act="close-modal">关闭</button>`,
  });
  return m;
}

function archiveModal(paths) {
  const usable = st.providers.filter((p) => p.enabled && p.endpoint && p.bucket && p.has_key);
  if (!usable.length) {
    return openModal({
      title: "还不能迁出",
      body: `<div class="empty" style="padding:16px 8px"><div class="e-ic">${IC.cloud}</div><b>先接入一个可用的云存储</b><p>迁出需要填写 AccessKey、SecretKey、Bucket 与 Endpoint。密钥仅保存在本机。</p></div>`,
      foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" data-act="provider-add">添加云存储</button>`,
    });
  }
  const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
  const dest = localStorage.getItem("sb.dest") || usable[0].id;
  return openModal({
    title: "迁出到云存储",
    sub: "上传完成后可按设置删除本机文件。迁移日志会自动写入目标 Bucket。",
    wide: true,
    body: `<form id="archForm" data-form="archive">
      <div class="field"><label>要迁出的文件或目录 <small>每行一个路径</small></label><textarea class="input" name="paths" rows="5" style="resize:vertical;font-family:Consolas,monospace;font-size:11px" placeholder="选择文件，或把完整路径粘贴到这里">${e(list.join("\n"))}</textarea></div>
      <div class="row mb8"><button class="btn btn-sm btn-ghost" type="button" data-act="archive-pick">${IC.folder} 选择文件</button><button class="btn btn-sm btn-ghost" type="button" data-act="archive-dirs">${IC.folder} 选择目录</button><span class="tiny faint">目录只处理已经索引过的文件</span></div>
      <div class="form-grid">
        <div class="field"><label>迁出到</label><select class="input" name="dest">${destOptions(dest)}</select></div>
        <div class="field"><label>本机处理</label><label class="opt-line" style="height:39px"><input type="checkbox" name="move" checked> 上传成功后删除本机原文件</label></div>
      </div>
      <div class="alert alert-warn">${IC.warn}<div><b>迁出不是备份到两家。</b>勾选删除后，本机只在数据库中保留原路径映射；需要时可通过「取回」或「迁回」恢复。请先确认目标 Bucket 可用。</div></div>
      <div class="form-note">文件将按 SHA-1 路径摘要生成对象 Key，并保留原始文件名。日志与清单用于按原路径恢复；请在续费前完成迁回。</div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" type="submit" form="archForm">开始迁出</button>`,
  });
}

async function downloadsArchives() {
  let r;
  try { r = await api.downloads(); } catch (err) { toast(errMsg(err), "error", "无法读取下载目录"); return; }
  st.dl = r.archives || [];
  const usable = st.providers.filter((p) => p.enabled && p.endpoint && p.bucket && p.has_key);
  if (!usable.length) {
    openModal({
      title: "还不能上传压缩包",
      body: `<div class="empty" style="padding:16px 8px"><div class="e-ic">${IC.cloud}</div><b>先接入一个可用的云存储</b><p>上传需要填写 AccessKey、SecretKey、Bucket 与 Endpoint。密钥仅保存在本机。</p></div>`,
      foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" data-act="provider-add">添加云存储</button>`,
    });
    return;
  }
  const pending = st.dl.filter((x) => !x.archived);
  if (!pending.length) {
    openModal({
      title: "下载目录里的压缩包已处理",
      sub: `目录：${e(r.path || "")}`,
      body: `<div class="empty" style="padding:18px 8px"><div class="e-ic">${IC.upload}</div><b>没有待上传的压缩包</b><p>这里只列出下载目录第一层的 zip、rar、7z、tar、gz 等压缩包。已经迁出到云端的文件会单独标记。</p></div>`,
      foot: `<button class="btn btn-primary" data-act="close-modal">知道了</button>`,
    });
    return;
  }
  const rows = st.dl.map((x, i) => `<label class="opt-line" style="display:flex;align-items:center;gap:9px;padding:7px 4px;border-bottom:1px solid #f1f3f9">
      <input type="checkbox" name="arch" value="${i}" ${x.archived ? "disabled" : "checked"}>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis" title="${e(x.name)}">${e(x.name)}</span>
      <span class="tag">${e(x.size_h)}</span>${x.archived ? '<span class="tag green">已在云端</span>' : x.has_cloud ? '<span class="tag amber">已有关联</span>' : ""}
    </label>`).join("");
  const total = pending.reduce((a, x) => a + Number(x.size || 0), 0);
  const dest = localStorage.getItem("sb.dest") || usable[0].id;
  openModal({
    title: "上传下载目录中的压缩包",
    sub: `下载目录：${r.path || ""}　共 ${pending.length} 个待上传，${fmtSize(total)}。`,
    wide: true,
    body: `<form id="dlForm" data-form="downloads">
      <div class="field"><label>选择压缩包 <small>只读取下载目录第一层；暂不提供在线解压</small></label>
        <div style="max-height:270px;overflow:auto;border:1px solid var(--line);border-radius:9px;padding:4px 10px">${rows}</div>
      </div>
      <div class="form-grid">
        <div class="field"><label>上传到</label><select class="input" name="dest">${destOptions(dest)}</select></div>
        <div class="field"><label>本机处理</label><label class="opt-line" style="height:39px"><input type="checkbox" name="move" checked> 上传成功后删除下载目录中的原文件</label></div>
      </div>
      <div class="alert alert-warn">${IC.warn}<div><b>压缩包按原文件上传，不会在云端解压。</b>勾选删除后，本机只保留索引映射，需要时可通过「取回」恢复。请先确认目标 Bucket 可用。</div></div>
      <div class="form-note">只列出下载目录第一层的常见压缩包，不会递归扫描子目录；已在云端的条目默认跳过。</div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" type="submit" form="dlForm">${IC.upload} 开始上传</button>`,
  });
}

async function submitDownloads(f, btn) {
  const ids = $$('input[name="arch"]:checked', f).map((x) => Number(x.value));
  const paths = Array.from(new Set(ids.map((i) => (st.dl[i] || {}).path).filter(Boolean)));
  if (!paths.length) throw new Error("请至少选择一个压缩包");
  const dest = f.elements.dest.value;
  if (!dest) throw new Error("请选择上传目标");
  const d = Object.assign({ paths, move: !!f.elements.move.checked }, parseDest(dest));
  buttonBusy(btn, true, "提交中");
  try {
    const r = await api.archive(d);
    localStorage.setItem("sb.dest", dest);
    closeModalEl(f);
    track(r.job_id, "上传下载目录压缩包", { onDone: (job) => {
      const rr = job.result || {};
      const er = jobErr(job);
      if (er) toast(`已迁出 ${Number(rr.files) || 0} 个压缩包；${er}`, "info", "上传完成，有清理提示");
      else toast("压缩包已上传到云端", "ok");
    } });
  } finally { buttonBusy(btn, false); }
}

function restoreModal(opt) {
  opt = opt || {};
  const clouds = st.providers.reduce((a, p) => a + Number(p.archived_files || 0), 0);
  if (!clouds) {
    return openModal({ title: "没有可迁回的文件", body: `<p class="confirm-text">当前没有记录为「仅云端」的文件。先迁出文件后，就能在这里按云存储或日志迁回。</p>`, foot: `<button class="btn btn-primary" data-act="close-modal">知道了</button>` });
  }
  const paths = Array.isArray(opt.paths) ? opt.paths.filter(Boolean) : [];
  const byLog = opt.log_id || "";
  const byProv = opt.provider_id || "";
  const provOpts = st.providers.filter((p) => Number(p.archived_files || 0) > 0).map((p) => `<option value="p:${e(p.id)}" ${byProv === p.id && !byLog && !paths.length ? "selected" : ""}>${e(p.label)}（${p.archived_files} 个 · ${fmtSize(p.archived_bytes)}）</option>`).join("");
  let scope;
  if (byLog) scope = `<input type="hidden" name="scope" value="log:${e(byLog)}"><div class="help-box"><b>按迁出日志迁回</b><br>日志 ID：<span class="inline-code">${e(byLog)}</span>。存储熊会读取对应云端清单，把文件恢复到原始路径。</div>`;
  else scope = `<div class="field"><label>迁回范围</label><select class="input" name="scope">
    ${provOpts}
    <option value="all" ${byProv || paths.length ? "" : "selected"}>全部云端文件（${clouds} 个）</option>
    ${paths.length ? `<option value="paths" selected>刚才选择的 ${paths.length} 个文件</option>` : ""}
  </select></div>`;
  return openModal({
    title: "迁回本地",
    sub: "文件按原路径恢复；目标文件已存在且大小相同时会跳过，除非选择覆盖。",
    body: `<form id="restForm" data-form="restore">
      ${scope}
      <div class="field"><label class="opt-line"><input type="checkbox" name="keep_cloud"> 保留云端副本（不释放云端空间）</label><label class="opt-line mt8"><input type="checkbox" name="overwrite"> 覆盖本地同名文件</label></div>
      <div class="alert alert-warn">${IC.warn}<div><b>默认会删除云端副本。</b>如果需要先校验后再手动清理，请勾选「保留云端副本」。迁回失败的文件不会删除云端对象，详情会写入新日志。</div></div>
      <div class="form-note">按日志迁回需要日志所属云存储的密钥仍在当前电脑。若本机文件已完整存在且大小一致，会直接解除云端映射。</div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" type="submit" form="restForm">开始迁回</button>`,
  });
}

/* ---------------- browse / scan ---------------- */
let browseCur = "";
async function openBrowse(start) {
  const m = openModal({
    title: "浏览磁盘目录",
    sub: "这里只列出目录。你可以扫描当前目录，或把它加入常用扫描位置。",
    wide: true,
    body: `<div id="browse-body"><div class="loading-block">${spinner()} 正在读取目录</div></div>`,
    foot: `<button class="btn btn-ghost" data-act="browse-native">使用系统选择器</button><button class="btn btn-ghost" data-act="browse-root">${IC.plus} 加入常用目录</button><button class="btn btn-primary" data-act="browse-scan">${IC.scan} 扫描此目录</button>`,
  });
  await browseGo(start || "", m);
}
async function browseGo(path, m) {
  const box = m.root.querySelector("#browse-body");
  if (!box) return;
  box.innerHTML = `<div class="loading-block">${spinner()} 正在读取目录</div>`;
  let d;
  try { d = await api.browse(path || ""); } catch (err) { box.innerHTML = `<div class="alert alert-danger">${IC.warn}<div>${e(errMsg(err))}</div></div>`; return; }
  browseCur = d.path;
  const sep = d.sep || "/";
  const driveBtns = (d.drives || []).map((x) => `<button class="chip ${d.path === x ? "on" : ""}" data-act="browse-open" data-path="${au(x)}">${e(x)}</button>`).join("");
  box.innerHTML = `<div class="breadcrumbs" style="border:1px solid var(--line);border-radius:9px;margin-bottom:10px"><button data-act="browse-home">起始位置</button><span class="mono">${e(d.path)}</span>${d.parent && d.parent !== d.path ? `<button class="btn btn-sm btn-ghost" style="margin-left:auto" data-act="browse-open" data-path="${au(d.parent)}">上一级</button>` : ""}</div>
    ${driveBtns ? `<div class="chips mb8">${driveBtns}</div>` : ""}
    <div class="pick-list" style="max-height:330px">${(d.dirs || []).length ? d.dirs.map((x) => `<button class="pick-item" style="width:100%;border:0;border-bottom:1px solid #f1f3f9;background:none;text-align:left" data-act="browse-open" data-path="${au(x.path)}">${IC.folder}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${e(x.name)}</span>${IC.arrow}</button>`).join("") : `<div class="empty" style="padding:26px">这个目录下没有可显示的子目录</div>`}</div>
    <p class="tiny faint mt8">当前路径：<span class="mono">${e(browseCur)}</span></p>`;
}
function scanModal(opt) {
  opt = opt || {};
  const cfg = st.cfg || {};
  const saved = (cfg.roots || []).map((r) => r.path || r).filter(Boolean);
  const preset = (opt.roots || []).filter(Boolean);
  const extSet = new Set((cfg.exts || []).map((x) => String(x).toLowerCase()));
  const common = EXT_COMMON;
  const extra = Array.from(extSet).filter((x) => common.indexOf(x) < 0);
  const allExt = common.concat(extra);
  common.forEach((x) => extSet.add(x));
  const pickRoots = preset;
  st.pick = pickRoots.slice();
  let scope;
  if (preset.length) {
    scope = `<div class="field"><label>扫描位置</label><label class="opt-line"><input type="radio" name="scope" value="pick" checked> 临时目录</label><div class="help-box" id="scan-pick-box"><span id="scan-picked">${e(pickRoots.join("；"))}</span> <button type="button" data-act="scan-pick">重新选择</button></div></div>`;
    if (saved.length) scope += `<div class="field"><label class="opt-line"><input type="radio" name="scope" value="saved"> 使用已保存的 ${saved.length} 个常用目录</label></div>`;
    scope += `<div class="field"><label class="opt-line"><input type="radio" name="scope" value="full"> 扫描整块磁盘 / 用户目录</label></div>`;
  } else {
    scope = `<div class="field"><label>扫描位置</label>
      ${saved.length ? `<label class="opt-line"><input type="radio" name="scope" value="saved" checked> 已保存的 ${saved.length} 个常用目录</label>` : ""}
      <label class="opt-line ${saved.length ? "mt8" : ""}"><input type="radio" name="scope" value="full" ${saved.length ? "" : "checked"}> 整块磁盘 / 用户目录（一键全盘）</label>
      <label class="opt-line mt8"><input type="radio" name="scope" value="pick"> 临时选择目录</label>
      <div class="help-box" id="scan-pick-box" style="${saved.length ? "display:none" : ""}"><span id="scan-picked">尚未选择</span> <button type="button" data-act="scan-pick">选择目录</button>
      <label class="opt-line mt8"><input type="checkbox" name="remember" checked> 同时保存为常用目录</label></div>
      </div>`;
  }
  const extHtml = allExt.map((x) => `<label class="chip" style="cursor:pointer"><input type="checkbox" name="ext" value="${e(x)}" ${extSet.has(x) ? "checked" : ""} style="margin-right:4px;accent-color:var(--amber-2)">${e(x)}</label>`).join("");
  const skipCount = (cfg.skip_paths || []).length;
  return openModal({
    title: "一键扫描本机文件",
    sub: "扫描只建立索引，不会上传、移动或修改任何文件。压缩包会一并收录，暂不提供在线解压。",
    wide: true,
    body: `<form id="scanForm" data-form="scan">
      ${scope}
      <div class="field"><label>收录的文件类型</label><div class="chips">${extHtml}</div></div>
      <div class="form-grid"><div class="field full"><label>补充扩展名 <small>空格或逗号分隔，可留空</small></label><input class="input" name="more" placeholder=".epub .aac .flac"></div></div>
      <div class="alert alert-info">${IC.info}<div><b>全盘扫描会跳过系统目录、隐藏目录${skipCount ? `和 ${skipCount} 个免扫路径` : ""}</b>，但文件很多时仍可能需要几分钟。你可以在任务卡中查看进度，扫描期间不影响其他操作。</div></div>
      <div class="form-note">扫描后文件会进入「文件库」，原路径保持不变。之后才能对目录或文件执行迁出；云端文件可通过虚拟磁盘按需读取。</div>
    </form>`,
    foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" type="submit" form="scanForm">${IC.scan} 开始扫描</button>`,
  });
}

/* ---------------- drive ---------------- */
async function viewDrive() {
  let d = null;
  try { d = await api.drive(); } catch (_) { d = st.status && st.status.drive; }
  st.drive = d || {};
  d = st.drive;
  const win = (st.info && st.info.platform === "win32");
  const mounted = !!d.mounted;
  const running = !!d.running;
  const cloud = d.cloud !== false;
  const state = mounted ? '<span class="tag green">已挂载</span>' : running ? '<span class="tag amber">服务就绪</span>' : '<span class="tag">未启动</span>';
  const steps = win ? `<ol class="mount-steps">
      <li>保持存储熊在托盘运行。安装程序会自动启用 Windows 的 WebDAV 客户端（WebClient）。</li>
      <li>点击「挂载为网络盘」，存储熊会把${cloud ? "云端盘" : "本机索引镜像"}映射到空闲盘符。</li>
      <li>在「此电脑」中打开 <b>${e(d.letter || "网络盘")}</b>${cloud ? "，根目录只显示各云存储的桶文件夹；进入桶文件夹后可拖入文件上传，双击文件从云端读取。" : "，可浏览常用目录与云端副本文件。"}</li>
      <li>挂载失败时点「一键修复 WebDAV」，在 Windows 弹窗中选「是」，随后会自动重试；无需输入命令。</li>
    </ol>` : `<ol class="mount-steps">
      <li>确认存储熊正在运行，且「WebDAV 服务」显示已就绪。</li>
      <li>${(st.info && st.info.platform) === "darwin" ? "打开 Finder → 前往 → 连接服务器，输入下方地址。" : "在文件管理器中使用「连接服务器 / 其他位置」，或运行 <code>gio mount dav://127.0.0.1:" + Number(d.port || 0) + "/dav/</code>。"}</li>
      <li>用户名与密码使用本页显示的专用凭据。凭据只保存在本机。</li>
      <li>连接成功后${cloud ? "会看到云存储桶文件夹，桶内可上传、新建文件夹和下载" : "会出现只读目录，可浏览本地索引目录与云端文件"}。</li>
    </ol>`;
  return `<div class="view-inner">
    ${banner()}
    <div class="sec-head"><div><h3>虚拟磁盘</h3><p>${cloud ? "云端盘只显示存储熊上传过的文件，可拖入上传与按需读取。" : "本机索引只读镜像，把扫描目录与云端副本挂成网络盘。"}</p></div><button class="btn btn-ghost" data-act="drive-refresh">${IC.refresh} 刷新状态</button></div>
    <div class="card drive-hero mb16">
      <div class="drive-glyph">${IC.drive}</div>
      <div style="flex:1;min-width:0"><div class="row" style="gap:8px;margin-bottom:5px"><h3 style="font-size:18px">${e(d.letter || (win ? "虚拟网络盘" : "WebDAV 磁盘"))}</h3>${state}</div>
        <p class="muted small" style="margin:0;line-height:1.7">${running ? "本机 WebDAV 服务正在 127.0.0.1 上监听，不会暴露到局域网或公网。" : "服务尚未启动。启动后仅监听本机回环地址，外部设备无法连接。"}</p></div>
      <div class="row">
        <button class="btn ${running ? "btn-ghost" : "btn-primary"}" data-act="drive-${running ? "stop" : "start"}">${running ? "停止服务" : "启动服务"}</button>
        ${win ? (mounted ? `<button class="btn btn-ghost" data-act="drive-unmount">卸载网络盘</button>` : `<button class="btn btn-primary" data-act="drive-mount" ${running ? "" : "disabled"}>挂载为网络盘</button>`) : `<button class="btn btn-primary" data-act="drive-mount" ${running ? "" : "disabled"}>查看连接方法</button>`}
      </div>
    </div>
    ${cloud ? `<div class="alert alert-info mb16">${IC.info}<div><b>这是一块云端盘。</b>根目录只显示自动生成的「厂商-Bucket」文件夹，根目录不允许新建或上传。进入桶文件夹后，拖入文件即上传到云端，双击文件从云端读取；暂不支持删除和改名，同名上传会由资源管理器提示是否覆盖。只显示存储熊上传过的对象，桶里其他来源的文件不会出现。</div></div>` : `<div class="alert alert-warn mb16">${IC.warn}<div><b>这是一块只读镜像盘。</b>可以把文件复制出来、直接打开，但写入、改名、删除不会同步到原文件或云端。需要整理文件时，请回到文件库操作。仅显示已扫描的目录结构与已索引的文件。</div></div>`}
    <div class="split">
      <div>
        <div class="card card-pad mb16">
          <div class="card-title-row"><div><h3>连接信息</h3><p>地址与凭据仅对本机有效。</p></div>${d.url ? `<button class="btn btn-sm btn-ghost" data-act="drive-copy" data-kind="url">${IC.copy} 复制地址</button>` : ""}</div>
          <dl class="kv">
            <dt>服务状态</dt><dd>${running ? '<span class="tag green">已就绪</span>' : '<span class="tag">未启动</span>'}</dd>
            <dt>WebDAV 地址</dt><dd>${d.url ? `<span class="copy-val">${e(d.url)}</span><button class="btn btn-sm btn-icon btn-ghost" data-act="drive-copy" data-kind="url" title="复制">${IC.copy}</button>` : "—"}</dd>
            <dt>用户名</dt><dd>${d.user ? `<span class="copy-val">${e(d.user)}</span><button class="btn btn-sm btn-icon btn-ghost" data-act="drive-copy" data-kind="user" title="复制">${IC.copy}</button>` : "—"}</dd>
            <dt>密码</dt><dd>${d.pass ? `<span class="copy-val">••••••••</span><button class="btn btn-sm btn-icon btn-ghost" data-act="drive-copy" data-kind="pass" title="复制密码">${IC.copy}</button>` : "—"}</dd>
            <dt>挂载盘符</dt><dd>${e(d.letter || "自动选择")}</dd>
          </dl>
          ${win ? `<form data-form="drive-letter" class="row mt16" style="align-items:flex-end"><div class="field" style="margin:0"><label>指定盘符</label><input class="input" name="letter" maxlength="2" value="${e((d.letter || "").replace(/:$/, ""))}" placeholder="Z" style="width:80px"></div><button class="btn btn-sm" type="submit">保存盘符</button><span class="tiny faint">留空则自动选择空闲盘符</span></form>` : ""}
        </div>
        <div class="card card-pad">
          <div class="setting-row"><div class="setting-info"><b>云端盘模式</b><p>只显示存储熊上传过的云端文件，可在桶文件夹内拖入上传、新建文件夹。关闭后切换为本机索引只读镜像。</p></div><button class="switch ${cloud ? "on" : ""}" data-act="drive-cloud" aria-label="切换云端盘模式"></button></div>
          <div class="setting-row"><div class="setting-info"><b>开机后自动挂载（Windows）</b><p>启动存储熊时自动连接网络盘。电脑重启后请确保登录的是同一个系统账号。</p></div><button class="switch ${d.auto ? "on" : ""}" data-act="drive-auto" aria-label="切换自动挂载"></button></div>
          <div class="setting-row"><div class="setting-info"><b>本机与隐私</b><p>服务只监听 127.0.0.1，使用随机生成的专用密码。删除存储熊数据目录会重置这组凭据。</p></div><span class="tag green">本机</span></div>
        </div>
      </div>
      <div>
        <div class="card card-pad">
          <div class="card-title-row"><div><h3>${win ? "Windows 挂载步骤" : "macOS / Linux 连接步骤"}</h3><p>${win ? "首次使用可能需要启用 WebClient 服务。" : "使用系统内置的 WebDAV 客户端即可。"}</p></div><span class="tag">${win ? "Windows" : (st.info && st.info.platform === "darwin" ? "macOS" : "Linux")}</span></div>
          ${steps}
          ${win ? `<div class="form-note mt12"><b>挂载失败？</b>点下面的一键修复，存储熊会自动处理 WebClient、HTTP 基本认证和旧映射，不需要你在命令行执行 NET USE。修复需要一次 Windows 管理员授权。</div>
          <div class="row mt12"><button class="btn btn-sm btn-ghost" data-act="drive-repair">一键修复 WebDAV</button><span class="tiny faint">只在挂载失败时使用，不会修改你的文件。</span></div>` : `<div class="form-note mt12"><b>提示：</b>本机地址仅在这台电脑上有效。系统文件管理器对 WebDAV 的兼容性不同，若无法认证，可先启动服务再重试。</div>`}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------------- phone ---------------- */
async function viewPhone() {
  return `<div class="view-inner">
    ${banner()}
    <div class="sec-head"><div><h3>手机访问</h3><p>连接手机的能力正在开发中，当前版本暂不开放。</p></div><span class="tag amber">开发中</span></div>
    <div class="card card-pad mb16">
      <div class="empty" style="padding:26px 8px">
        <div class="e-ic">${IC.phone}</div>
        <b>连接手机正在开发</b>
        <p style="max-width:560px;margin:6px auto 16px">手机只读浏览电脑目录的功能还没有上线。当前版本请使用虚拟磁盘或文件库访问文件；上线后会继续保持「手机只能读电脑，电脑不能读手机」的单向边界。</p>
        <div class="row" style="justify-content:center"><button class="btn btn-primary" data-act="nav" data-view="drive">${IC.drive} 使用虚拟磁盘</button><button class="btn btn-ghost" data-act="nav" data-view="files">${IC.folder} 打开文件库</button></div>
      </div>
    </div>
    <div class="grid g2">
      <div class="card card-pad">
        <div class="card-title-row"><div><h3>计划中的能力</h3><p>开发完成后会在这里开放。</p></div><span class="tag indigo">Beta</span></div>
        <div class="steps">
          <div class="step"><div class="step-no">01</div><div><b>同账号只读浏览</b><p>手机登录后查看这台电脑已授权的目录与云端副本。</p></div></div>
          <div class="step"><div class="step-no">02</div><div><b>单向隐私边界</b><p>电脑端不会出现手机目录，也无法访问其他电脑的索引。</p></div></div>
          <div class="step"><div class="step-no">03</div><div><b>按需取回文件</b><p>电脑在线时，为仅云端的文件生成限时只读链接。</p></div></div>
        </div>
      </div>
      <div class="card card-pad" style="background:linear-gradient(145deg,#fffdf8,#fff)">
        <div class="card-title-row"><div><h3>现在可以做什么</h3><p>不依赖手机功能。</p></div>${IC.shield}</div>
        <p class="small muted" style="line-height:1.85;margin:0">用 Windows 客户端把云端桶或索引目录挂成虚拟盘，或直接在文件库中打开、创建限时链接、迁出与迁回。云密钥仍然只保存在本机，服务器不会收到。</p>
        <div class="form-note mt12"><b>说明：</b>功能完成前，客户端会把这个入口保持为「开发中」，不再展示手机地址与登录说明。</div>
      </div>
    </div>
  </div>`;
}

/* ---------------- settings ---------------- */
async function viewSettings() {
  try { st.info = await api.appInfo(); } catch (_) {}
  const info = st.info || {};
  const s = st.status || {};
  const u = s.user || {};
  const cfg = st.cfg || {};
  const roots = (cfg.roots || []).map((r) => (typeof r === "string" ? { path: r, label: "" } : r));
  const skips = (cfg.skip_paths || []).map((r) => (typeof r === "string" ? { path: r, label: "" } : r));
  const auto = !!info.autoStart;
  return `<div class="view-inner">
    ${banner()}
    <div class="sec-head"><div><h3>设置与帮助</h3><p>账号、设备、扫描目录与本机数据。</p></div><button class="btn btn-ghost" data-act="open-manual">${IC.help} 使用手册</button></div>
    <div class="split">
      <div>
        <div class="card card-pad mb16">
          <div class="card-title-row"><div><h3>账号</h3><p>同一账号管理多台电脑。</p></div><span class="tag green">已登录</span></div>
          <dl class="kv">
            <dt>昵称</dt><dd>${e(u.name || "未填写")}</dd>
            <dt>邮箱</dt><dd>${e(u.email || "—")}</dd>
            <dt>服务器</dt><dd><span class="copy-val">${e(cfg.server || info.publicUrl || "")}</span></dd>
            <dt>电脑 ID</dt><dd><span class="mono tiny">${e(cfg.device_id || (s.device && s.device.id) || "")}</span><button class="btn btn-sm btn-icon btn-ghost" data-copy="${e(cfg.device_id || "")}" data-label="电脑 ID" title="复制">${IC.copy}</button></dd>
          </dl>
          <div class="row mt16"><button class="btn btn-ghost" data-act="settings-sync">${IC.refresh} 同步云端元数据</button><button class="btn btn-ghost" data-act="acct-logout">退出登录</button></div>
        </div>
        <div class="card card-pad mb16">
          <div class="card-title-row"><div><h3>这台电脑</h3><p>设备名称用于区分多台电脑。</p></div><span class="tag">${e(info.platform || "")}</span></div>
          <form data-form="settings-name" class="row" style="align-items:flex-end"><div class="field" style="flex:1;margin:0"><label>电脑名称</label><input class="input" name="device_name" maxlength="60" value="${e(cfg.device_name || (s.device && s.device.name) || "")}" required></div><button class="btn btn-sm" type="submit">保存</button></form>
          <div class="setting-row mt16"><div class="setting-info"><b>开机自动启动</b><p>${info.dev ? "开发模式下不修改系统自启动项。" : "登录系统后在托盘静默启动。状态来自当前用户的 Windows 启动项，可在任务管理器 → 启动应用中核对。"}</p></div><button class="switch ${auto ? "on" : ""}" data-act="settings-auto" aria-label="切换自动启动"></button></div>
          <div class="setting-row"><div class="setting-info"><b>本机数据目录</b><p class="mono tiny">${e(info.dataDir || "")}</p></div><div class="row"><button class="btn btn-sm btn-ghost" data-act="open-data">打开</button><button class="btn btn-sm btn-ghost" data-act="open-logs">日志</button></div></div>
        </div>
        ${(info.platform || "") === "win32" ? `<div class="card card-pad mb16">
          <div class="card-title-row"><div><h3>资源管理器右键</h3><p>选中文件即可上传并创建分享链接。</p></div><span class="tag">Windows</span></div>
          <div class="setting-row"><div class="setting-info"><b>显示「快速创建链接」</b><p>写入当前用户注册表，不需要管理员权限。链接创建后始终写入剪贴板。</p></div><button class="switch ${cfg.quick_menu !== false ? "on" : ""}" data-act="quick-menu" aria-label="切换右键菜单"></button></div>
          <div class="setting-row"><div class="setting-info"><b>创建后发送系统通知</b><p>关闭后只写剪贴板，不弹系统消息；失败提示仍会保留。</p></div><button class="switch ${cfg.quick_notify !== false ? "on" : ""}" data-act="quick-notify" aria-label="切换系统通知"></button></div>
          <div class="field mt12"><label>快速创建链接使用的云存储 <small>可指定，也可自动选择</small></label><select class="select" data-quick-provider>
            <option value="" ${!cfg.quick_link_provider ? "selected" : ""}>自动选择（到期时间优先，其次剩余容量）</option>
            ${(st.providers || []).map((p) => `<option value="${e(p.id)}" ${cfg.quick_link_provider === p.id ? "selected" : ""}>${e(p.label)}${p.has_key ? "" : "（缺少密钥）"}</option>`).join("")}
          </select></div>
          <div class="form-note mt12"><b>自动规则：</b>优先选择到期时间更晚的云存储，未填写到期时间视为无限；到期时间相同时，比较剩余容量（额度 - 已用），余量大的优先。剪贴板写入不可关闭。</div>
        </div>` : ""}
        <div class="card card-pad">
          <div class="card-title-row"><div><h3>扫描目录与扩展名</h3><p>扫描只索引，不上传文件。</p></div><button class="btn btn-sm btn-ghost" data-act="settings-root-add">${IC.plus} 添加目录</button></div>
          ${roots.length ? `<div style="margin-bottom:12px">${roots.map((r) => `<div class="root-item">${IC.folder}<span class="path" title="${e(r.path)}">${e(r.path)}</span><span class="tag">${e(r.label || "目录")}</span><button class="btn btn-sm btn-icon btn-ghost" title="移除" data-act="settings-root-del" data-path="${au(r.path)}">${IC.trash}</button></div>`).join("")}</div>` : `<div class="banner-tip">${IC.info}<span>还没有常用目录。可以添加，也可以直接使用「一键扫描」的整盘模式。</span></div>`}
          <form data-form="settings-ext"><div class="field"><label>收录的扩展名 <small>空格分隔</small></label><input class="input" name="exts" value="${e((cfg.exts || []).join(" "))}" placeholder=".pdf .mp3 .mp4"></div><div class="row"><button class="btn btn-sm" type="submit">保存扩展名</button><button class="btn btn-sm btn-ghost" type="button" data-act="settings-ext-reset">恢复默认</button></div></form>
          <div class="panel-head mt16"><div><h3>免扫路径</h3><p>扫描任何上级目录时，都会完全跳过这些路径下的文件与子目录。</p></div><div class="row"><button class="btn btn-sm btn-ghost" data-act="apps-exclude">${IC.scan} 从应用选择</button><button class="btn btn-sm btn-ghost" data-act="skip-add">${IC.plus} 添加路径</button></div></div>
          ${skips.length ? `<div>${skips.map((r) => `<div class="root-item">${IC.shield}<span class="path" title="${e(r.path)}">${e(r.path)}</span><span class="tag amber">免扫</span><button class="btn btn-sm btn-icon btn-ghost" title="移除" data-act="skip-del" data-path="${au(r.path)}">${IC.trash}</button></div>`).join("")}</div>` : `<div class="banner-tip">${IC.info}<span>还没有免扫路径。可添加缓存、应用数据等不需要收录的位置。</span></div>`}
          <p class="tiny faint" style="margin:10px 0 0">移除常用目录或免扫路径不会删除已建立的文件索引，也不会改动本地文件。</p>
        </div>
      </div>
      <div>
        <div class="card card-pad mb16">
          <div class="card-title-row"><div><h3>帮助与文档</h3><p>所有页面均可公网直接访问。</p></div></div>
          <div class="setting-row"><div class="setting-info"><b>小白使用手册</b><p>从申请 Bucket、填写密钥到迁出与迁回的完整步骤。</p></div><button class="btn btn-sm btn-ghost" data-act="open-manual">打开</button></div>
          <div class="setting-row"><div class="setting-info"><b>产品介绍页</b><p>功能说明、原理与常见问题。</p></div><button class="btn btn-sm btn-ghost" data-act="open-site">打开</button></div>
          <div class="setting-row"><div class="setting-info"><b>隐私说明与服务条款</b><p>先看清楚密钥、文件与日志如何处理。</p></div><div class="row"><button class="btn btn-sm btn-ghost" data-act="open-privacy">隐私</button><button class="btn btn-sm btn-ghost" data-act="open-terms">条款</button></div></div>
        </div>
        <div class="card card-pad mb16">
          <div class="card-title-row"><div><h3>安全边界</h3><p>存储熊的设计前提。</p></div>${IC.shield}</div>
          <div class="steps">
            <div class="step done"><div class="step-no">✓</div><div><b>云密钥只留本机</b><p>AccessKey / SecretKey 不上传服务器；Windows 使用 DPAPI 加密。服务器只同步索引、设备和迁移日志。</p></div></div>
            <div class="step"><div class="step-no">…</div><div><b>手机只读访问（开发中）</b><p>功能上线后会保持单向只读：手机可读电脑，电脑不能读取手机或其他电脑。</p></div></div>
            <div class="step done"><div class="step-no">✓</div><div><b>虚拟盘仅监听本机</b><p>WebDAV 服务绑定 127.0.0.1；云端盘只在桶文件夹内上传，根目录与删除、改名操作仍被禁止。</p></div></div>
          </div>
          <div class="form-note mt12"><b>保持更新：</b>请定期查看日志目录；如密钥可能泄露，请立即到云厂商控制台禁用该 AccessKey，并在存储熊中更新配置。</div>
        </div>
        <div class="card card-pad">
          <div class="panel-head"><div><h3>关于</h3><p>本地代理 ${e(info.version || s.version || "")} · 数据仅存于本机与你的云存储。</p></div><span class="tag indigo">存储熊</span></div>
          <div class="row"><button class="btn btn-sm btn-ghost" data-act="settings-drive">${IC.drive} 虚拟磁盘</button><button class="btn btn-sm btn-ghost" data-act="settings-update" ${info.dev ? "disabled" : ""}>${IC.refresh} 检查更新</button><button class="btn btn-sm btn-ghost" data-act="phone-guide">${IC.phone} 手机访问（开发中）</button></div>
          <p class="tiny faint" style="line-height:1.7;margin:12px 0 0">使用手册与产品文案由 AI 辅助创作并经人工整理。对象存储兼容性以各云厂商公开文档与你实际创建的 Bucket 为准。</p>
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------------- forms ---------------- */
function buttonBusy(btn, on, text) {
  if (!btn) return;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = spinner() + " " + (text || "处理中");
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}

async function submitProvider(f, btn) {
  const d = providerData();
  if (!d.label || !d.endpoint || !d.bucket) throw new Error("请填写名称、Endpoint 与 Bucket");
  if (!/^https?:\/\//i.test(d.endpoint)) throw new Error("Endpoint 需要以 http:// 或 https:// 开头");
  buttonBusy(btn, true, "保存中");
  try {
    if (f.dataset.id) await api.updateProvider(Object.assign({}, d, { id: f.dataset.id }));
    else await api.saveProvider(d);
    closeModalEl(f);
    await refreshAll();
    await render();
    toast(f.dataset.id ? "云存储已更新" : "云存储已添加", "ok");
  } finally { buttonBusy(btn, false); }
}

async function submitStitch(f, btn) {
  const pids = $$('input[name="providers"]:checked', f).map((x) => x.value);
  const name = String(f.elements.name.value || "").trim();
  if (pids.length < 2) throw new Error("拼接至少需要两家云存储");
  if (!name) throw new Error("请填写组合名称");
  buttonBusy(btn, true, "保存中");
  try {
    await api.saveStitch({ id: f.dataset.id || "", name, providers: pids, strategy: "round_robin" });
    closeModalEl(f);
    await refreshAll();
    await render();
    toast("拼接组合已保存", "ok");
  } finally { buttonBusy(btn, false); }
}

async function submitArchive(f, btn) {
  const paths = String(f.elements.paths.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!paths.length) throw new Error("请选择或填写要迁出的文件");
  const dest = f.elements.dest.value;
  if (!dest) throw new Error("请选择迁出目标");
  const d = Object.assign({ paths, move: !!f.elements.move.checked }, parseDest(dest));
  buttonBusy(btn, true, "提交中");
  try {
    const r = await api.archive(d);
    localStorage.setItem("sb.dest", dest);
    closeModalEl(f);
    st.sel.clear();
    track(r.job_id, "迁出文件", { onDone: (job) => {
      const rr = job.result || {};
      const er = jobErr(job);
      if (er) toast(`已迁出 ${Number(rr.files) || 0} 个文件，另有清理提示：${er}`, "info", "迁出完成，有提示");
    } });
  } finally { buttonBusy(btn, false); }
}

async function submitRestore(f, btn) {
  const scope = String(f.elements.scope.value || "");
  const o = {
    keep_cloud: !!f.elements.keep_cloud.checked,
    overwrite: !!f.elements.overwrite.checked,
  };
  if (scope.slice(0, 2) === "p:") o.provider_id = scope.slice(2);
  else if (scope.slice(0, 4) === "log:") o.log_id = scope.slice(4);
  else if (scope === "paths") o.paths = Array.from(st.sel);
  else o.all = true;
  buttonBusy(btn, true, "提交中");
  try {
    const r = await api.restore(o);
    closeModalEl(f);
    if (o.paths) st.sel.clear();
    track(r.job_id, "迁回文件", { onDone: (job) => {
      const rr = job.result || {};
      const er = jobErr(job);
      if (er) toast(`已迁回 ${Number(rr.files) || 0} 个文件；${er}`, "info", "迁回完成，有清理提示");
    } });
  } finally { buttonBusy(btn, false); }
}

async function submitScan(f, btn) {
  const scope = (f.querySelector('input[name="scope"]:checked') || {}).value;
  if (!scope) throw new Error("请选择扫描位置");
  let roots = [];
  if (scope === "pick") roots = st.pick.slice();
  if (scope === "pick" && !roots.length) throw new Error("请先选择要扫描的目录");
  const exts = $$('input[name="ext"]:checked', f).map((x) => x.value);
  const more = String(f.elements.more.value || "").split(/[\s,，]+/).map((x) => x.trim()).filter(Boolean)
    .map((x) => x.startsWith(".") ? x : "." + x);
  const all = Array.from(new Set(exts.concat(more)));
  if (!all.length) throw new Error("请至少选择一种文件类型");
  const remember = !!(f.elements.remember && f.elements.remember.checked);
  buttonBusy(btn, true, "准备中");
  try {
    if (scope === "pick" && remember) {
      const cur = ((st.cfg && st.cfg.roots) || []).map((r) => r.path || r);
      const merged = Array.from(new Set(cur.concat(roots)));
      await api.saveConfig({ roots: merged });
    }
    const r = await api.scan({ full: scope === "full", roots: scope === "pick" ? roots : [], exts: all });
    closeModalEl(f);
    track(r.job_id, "扫描媒体文件", { silent: false });
    toast("扫描已开始，可继续使用其他页面", "info");
  } finally { buttonBusy(btn, false); }
}

async function submitExt(f, btn) {
  const raw = String(f.elements.exts.value || "").split(/[\s,，]+/).map((x) => x.trim()).filter(Boolean);
  const exts = raw.map((x) => (x.startsWith(".") ? x : "." + x).toLowerCase());
  if (!exts.length) throw new Error("请至少保留一个扩展名");
  buttonBusy(btn, true, "保存中");
  try {
    st.cfg = await api.saveConfig({ exts });
    await refreshAll();
    await render();
    toast("扩展名已保存", "ok");
  } finally { buttonBusy(btn, false); }
}

document.addEventListener("submit", async (ev) => {
  const f = ev.target.closest("form[data-form]");
  if (!f || f.dataset.form === "auth") return;
  ev.preventDefault();
  const btn = f.querySelector('button[type="submit"]') || (f.id && document.querySelector(`button[form="${f.id}"]`));
  try {
    if (f.dataset.form === "files-search") {
      const q = String(f.elements.q.value || "").trim();
      if (q.length > 80) throw new Error("搜索词不能超过 80 个字符");
      st.q = q; st.path = ""; st.provider = ""; st.filter = "all"; st.status = "all"; st.sel.clear();
      if (st.view !== "files") setView("files"); else render();
    } else if (f.dataset.form === "provider") {
      await submitProvider(f, btn);
    } else if (f.dataset.form === "stitch") {
      await submitStitch(f, btn);
    } else if (f.dataset.form === "archive") {
      await submitArchive(f, btn);
    } else if (f.dataset.form === "downloads") {
      await submitDownloads(f, btn);
    } else if (f.dataset.form === "restore") {
      await submitRestore(f, btn);
    } else if (f.dataset.form === "scan") {
      await submitScan(f, btn);
    } else if (f.dataset.form === "settings-name") {
      const name = String(f.elements.device_name.value || "").trim();
      if (!name) throw new Error("电脑名称不能为空");
      buttonBusy(btn, true, "保存中");
      try { await api.saveConfig({ device_name: name }); await refreshAll(); await render(); toast("电脑名称已更新", "ok"); } finally { buttonBusy(btn, false); }
    } else if (f.dataset.form === "settings-ext") {
      await submitExt(f, btn);
    } else if (f.dataset.form === "drive-letter") {
      const raw = String(f.elements.letter.value || "").trim().toUpperCase().replace(/:$/, "");
      if (raw && !/^[A-Z]$/.test(raw)) throw new Error("请输入单个盘符字母，例如 Z");
      if (raw === "C") throw new Error("请勿使用系统盘 C:");
      buttonBusy(btn, true, "保存中");
      try { await api.driveConfig({ letter: raw }); await refreshAll(); await render(); toast("盘符设置已保存", "ok"); } finally { buttonBusy(btn, false); }
    }
  } catch (err) {
    toast(errMsg(err), "error");
  }
});

/* ---------------- actions ---------------- */
async function doCopy(text, label) {
  if (!text) { toast("没有可复制的内容", "error"); return; }
  try { await api.copy(String(text)); toast((label || "内容") + "已复制", "ok"); } catch (err) { toast(errMsg(err), "error"); }
}

const OFFICE_VIEW = new Set([".docx", ".xlsx", ".pptx"]);
const OFFICE_LEGACY = new Set([".doc", ".xls", ".ppt", ".wps", ".et", ".dps"]);
const WPS_NATIVE = new Set([".wps", ".et", ".dps"]);
const EXT_COMMON = [".pdf", ".mp3", ".mp4", ".m4a", ".wav", ".flac", ".mkv", ".avi", ".mov", ".webm",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".wps", ".et", ".dps",
  ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".zst",
  ".tgz", ".tbz2", ".txz", ".cab", ".iso"];

function legacyOfficeHelp(path) {
  const m = String(path || "").match(/\.[^./\\]+$/);
  const ext = m ? m[0].toLowerCase() : "";
  const wps = WPS_NATIVE.has(ext);
  const title = wps ? "WPS 原生格式暂不支持预览" : "旧版 Office 格式暂不支持预览";
  const sub = wps
    ? `${e(ext)} 是 WPS 的原生格式，内置预览只支持 docx / xlsx / pptx。`
    : "doc / xls / ppt 是旧版二进制格式，内置预览只支持 docx / xlsx / pptx。";
  const target = wps ? "在 WPS 中另存为" : "在 Office 或 WPS 中另存为";
  openModal({
    title,
    sub,
    body: `<p class="confirm-text">系统会调用本机默认的 Microsoft Office 或 WPS 打开。云端文件只会下载到临时目录，<b>修改临时副本不会自动回传</b>；如需修改原件，请先迁回或另存为新格式。</p>
      <div class="form-note">提示：如果希望以后能直接预览和编辑回传，请${target} docx / xlsx / pptx。</div>`,
    foot: `<button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" data-act="legacy-open" data-path="${au(path)}">用本机 Office / WPS 打开</button>`,
  });
}

async function doOpenEntry(path) {
  if (!path) return;
  const m = String(path).match(/\.[^./\\]+$/);
  const ext = m ? m[0].toLowerCase() : "";
  if (OFFICE_VIEW.has(ext)) {
    try { await api.preview(path); } catch (err) { toast(errMsg(err), "error", "无法预览"); }
    return;
  }
  if (OFFICE_LEGACY.has(ext)) {
    legacyOfficeHelp(path);
    return;
  }
  try {
    const r = await api.open(path);
    track(r.job_id, "打开文件", { refresh: false });
  } catch (err) { toast(errMsg(err), "error", "打开失败"); }
}

async function doFetch(path) {
  if (!path) return;
  try {
    const r = await api.fetch(path);
    track(r.job_id, "从云端取回");
  } catch (err) { toast(errMsg(err), "error"); }
}

async function doShare(path) {
  if (!path) return;
  try {
    const r = await api.share({ path });
    track(r.job_id, "创建分享链接", {
      onDone: (job) => {
        const u = job.result || {};
        if (!u.url) { toast("没有取得有效链接", "error"); return; }
        openModal({
          title: "文件链接已创建",
          sub: "任何拿到链接的人都能打开文件，直到链接过期。请勿公开分享敏感内容。",
          body: `<div class="field"><label>限时访问链接</label><div class="phone-link-box"><span>${e(u.url)}</span></div></div>
            <dl class="kv"><dt>云存储</dt><dd>${e(providerLabel(u.provider_id))}</dd><dt>过期时间</dt><dd>${fmtTime(u.expires_at)}</dd><dt>文件</dt><dd><span class="copy-val">${e(path)}</span></dd></dl>
            <div class="form-note mt12">链接由云存储的预签名机制生成，不经过存储熊服务器转发文件内容。过期后重新创建即可。</div>`,
          foot: `<button class="btn btn-ghost" data-copy="${e(u.url)}" data-label="链接">复制链接</button><button class="btn btn-ghost" data-act="share-open" data-url="${e(u.url)}">浏览器打开</button><button class="btn btn-primary" data-act="close-modal">完成</button>`,
        });
      },
    });
  } catch (err) { toast(errMsg(err), "error"); }
}

function mountHelp(err) {
  openModal({
    title: "网络盘挂载没有成功",
    sub: "不用输入任何命令：点“一键修复并重试”，剩下的交给存储熊。",
    body: `<p class="confirm-text">${e(errMsg(err))}</p>
      <ol class="mount-steps mt12">
        <li>点下方「一键修复并重试」。Windows 弹出管理员授权时选择「是」，修复完成后会自动再挂载一次。</li>
        <li>修复会启动 MRxDAV 网络重定向器和 WebClient、设置 HTTP 基本认证并重新启动服务，不会改动你的文件。</li>
        <li>如果提示需要重启电脑，请重启后再点「挂载为网络盘」；仍失败可以换一个盘符（如 Z）。</li>
      </ol>
      <div class="form-note mt12">公司电脑的组策略或安全软件可能禁止 WebDAV，这种情况需要管理员放行。挂载只在本机 127.0.0.1 进行，不会把文件或密钥暴露到局域网。</div>`,
    foot: `<button class="btn btn-ghost" data-act="drive-goto">去换盘符</button><button class="btn btn-ghost" data-act="drive-retry">仅重试</button><button class="btn btn-primary" data-act="drive-repair">一键修复并重试</button>`,
  });
}

function manualDriveHelp(r) {
  openModal({
    title: "使用 WebDAV 连接",
    sub: "当前系统不支持自动映射盘符，请使用系统文件管理器连接本机 WebDAV。",
    body: `<dl class="kv"><dt>地址</dt><dd><span class="copy-val">${e(r.url || "")}</span><button class="btn btn-sm btn-icon btn-ghost" data-copy="${e(r.url || "")}" data-label="地址">${IC.copy}</button></dd><dt>用户名</dt><dd><span class="copy-val">${e(r.user || "")}</span></dd><dt>密码</dt><dd><span class="copy-val">${e(r.pass || "")}</span><button class="btn btn-sm btn-icon btn-ghost" data-copy="${e(r.pass || "")}" data-label="密码">${IC.copy}</button></dd></dl><div class="form-note mt12">${e(r.hint || "")}。仅限本机使用。</div>`,
    foot: `<button class="btn btn-primary" data-act="close-modal">知道了</button>`,
  });
}

function repairMountHelp(err) {
  const detail = errMsg(err);
  openModal({
    title: "修复已完成，但重新挂载仍失败",
    sub: "WebDAV 组件已经修好，这次是网络盘没有挂上，不需要重复修复。",
    body: `<p class="confirm-text">${e(detail)}</p>
      <ol class="mount-steps mt12">
        <li>如果提示盘符被占用，请点「去换盘符」，或在「虚拟磁盘」页卸载原有网络盘后再挂载。</li>
        <li>如果提示 WebClient 正在启动，请等几秒后点「再挂载一次」。</li>
        <li>如果仍失败，重启电脑后再点「挂载为网络盘」。修复结果已经保存，不需要再次授权管理员。</li>
      </ol>
      <div class="form-note mt12">修复日志和本次挂载错误可以点「复制诊断」一并保存。挂载仍只在本机 127.0.0.1 进行。</div>`,
    foot: `<button class="btn btn-ghost" data-copy="${e(detail)}" data-label="挂载诊断">复制诊断</button><button class="btn btn-ghost" data-act="open-logs">打开日志</button><button class="btn btn-ghost" data-act="drive-goto">去换盘符</button><button class="btn btn-primary" data-act="drive-remount">再挂载一次</button>`,
  });
}

async function remountAfterRepair() {
  const m = openModal({
    title: "正在重新挂载网络盘",
    sub: "WebDAV 组件已经修复，正在等待 Windows 客户端完成启动。",
    body: `<div class="row" style="align-items:center;gap:10px">${spinner()}<b>正在重新连接本机网络盘…</b></div>
      <div class="form-note mt16">通常几秒内完成。如果 Windows 刚重启过 WebClient，第一次连接可能需要稍等。</div>`,
  });
  try {
    await sleep(1800);
    const r = await api.driveAction("mount");
    m.close();
    await refreshAll().catch(() => {});
    await render();
    if (r && r.manual) { manualDriveHelp(r); return; }
    toast("网络盘已重新挂载", "ok");
  } catch (err) {
    m.close();
    const d = await api.drive().catch(() => null);
    if (d) st.drive = d;
    await refreshAll().catch(() => {});
    await render();
    repairMountHelp(err);
  }
}

async function repairDrive() {
  const m = openModal({
    title: "正在一键修复 WebDAV",
    sub: "Windows 会弹出一次管理员授权窗口，请点击「是」。没看到时请检查任务栏。",
    body: `<div class="row" style="align-items:center;gap:10px">${spinner()}<b>正在启动 MRxDAV 和 WebClient，并重新连接网络盘…</b></div>
      <div class="form-note mt16">通常需要十几秒，请不要关闭存储熊。修复完成后会自动重新挂载；若系统提示需要重启，请重启电脑后再挂载。</div>`,
  });
  let r;
  try {
    r = await api.repairDrive();
  } catch (err) {
    m.close();
    const detail = errMsg(err);
    openModal({
      title: "一键修复没有完成",
      sub: "不用敲命令，可以按下面的顺序再试。",
      body: `<p class="confirm-text">${e(detail)}</p>
        <ol class="mount-steps mt12">
          <li>如果刚刚关掉了管理员授权弹窗，请再点一次修复，并在系统弹窗中选择「是」。</li>
          <li>如果安全软件拦截了修复程序，请暂时允许，或重启电脑后重试。</li>
          <li>仍然失败时，点「复制诊断」把信息发给部署者，或打开日志目录查看 <code>repair-webdav.log</code>。</li>
        </ol>`,
      foot: `<button class="btn btn-ghost" data-act="open-logs">打开日志</button><button class="btn btn-ghost" data-copy="${e(detail)}" data-label="诊断信息">复制诊断</button><button class="btn btn-primary" data-act="drive-repair">再试一次</button>`,
    });
    return;
  }
  m.close();
  await refreshAll().catch(() => {});
  await render();
  if (r && r.restart) {
    openModal({
      title: "修复完成，还需要重启电脑",
      sub: "系统组件已经启用，但 Windows 要重启后才生效。",
      body: `<p class="confirm-text">重启电脑后再打开存储熊，点击「挂载为网络盘」即可。之后如果仍然失败，可以在「虚拟磁盘」页再点一次「一键修复 WebDAV」。</p>`,
      foot: `<button class="btn btn-primary" data-act="close-modal">知道了</button>`,
    });
    return;
  }
  toast("WebDAV 组件已修复，正在重新挂载", "ok");
  await remountAfterRepair();
}

async function doDrive(action) {
  const names = { start: "WebDAV 服务已启动", stop: "WebDAV 服务已停止", mount: "挂载操作完成", unmount: "网络盘已卸载" };
  try {
    const r = await api.driveAction(action);
    if (action === "mount" && r && r.manual) {
      await refreshAll(); await render();
      manualDriveHelp(r);
      return;
    }
    await refreshAll();
    await render();
    toast(names[action] || "操作完成", "ok");
  } catch (err) {
    if (action === "mount") { await refreshAll().catch(() => {}); mountHelp(err); }
    else toast(errMsg(err), "error");
  }
}

async function addRoots(paths) {
  const merged = ((st.cfg && st.cfg.roots) || []).map((r) => r.path || r).concat(paths);
  st.cfg = await api.saveConfig({ roots: Array.from(new Set(merged)) });
  await refreshAll();
  await render();
  toast("常用目录已更新", "ok");
}

async function delRoot(path) {
  if (!path) return;
  const roots = ((st.cfg && st.cfg.roots) || []).map((r) => r.path || r).filter((x) => x !== path);
  st.cfg = await api.saveConfig({ roots });
  await refreshAll();
  await render();
  toast("目录已移除，索引仍保留", "ok");
}

async function addSkips(paths) {
  const cur = ((st.cfg && st.cfg.skip_paths) || []).map((r) => r.path || r);
  const merged = Array.from(new Set(cur.concat(paths || []).filter(Boolean)));
  st.cfg = await api.saveConfig({ skip_paths: merged });
  await refreshAll();
  await render();
  toast("免扫路径已更新", "ok");
}

async function delSkip(path) {
  if (!path) return;
  const skips = ((st.cfg && st.cfg.skip_paths) || []).map((r) => r.path || r).filter((x) => x !== path);
  st.cfg = await api.saveConfig({ skip_paths: skips });
  await refreshAll();
  await render();
  toast("免扫路径已移除", "ok");
}

async function appsExcludeModal() {
  const m = openModal({
    title: "从应用选择免扫目录",
    sub: "自动读取 Windows 已安装应用的位置；选中后，其安装目录及内部所有内容都不会被扫描。",
    wide: true,
    body: `<div id="apps-body"><div class="loading-block">${spinner()} 正在读取应用列表</div></div>`,
    foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-ghost" data-act="apps-select-all">全选应用</button><button class="btn btn-primary" data-act="apps-add">加入免扫</button>`,
  });
  const box = m.root.querySelector("#apps-body");
  let apps = [];
  try { apps = (await api.apps()).apps || []; } catch (err) {
    if (box) box.innerHTML = `<div class="alert alert-danger">${IC.warn}<div>${e(errMsg(err))}</div></div>`;
    return;
  }
  st.apps = apps;
  if (!box) return;
  if (!apps.length) {
    box.innerHTML = `<div class="empty" style="padding:24px 8px"><div class="e-ic">${IC.folder}</div><b>没有找到可加入的应用目录</b><p>当前系统或这套 Windows 安装没有提供应用位置。可以直接添加具体路径。</p><button class="btn btn-sm" data-act="skip-add">${IC.plus} 手动添加路径</button></div>`;
    return;
  }
  box.innerHTML = `<div class="form-note">列表来自 Windows 卸载信息。选择应用会把它识别到的安装目录全部加入免扫；应用保存在其他位置的数据，请用「添加路径」单独选择。</div>
    <div class="pick-list mt12" style="max-height:390px">${apps.map((a, i) => `<label class="pick-item" style="align-items:flex-start">
      <input type="checkbox" name="app" value="${i}">
      <span style="flex:1;min-width:0"><b>${e(a.name)}${a.version ? ` <span class="tag">${e(a.version)}</span>` : ""}</b>
      <span class="tiny faint" style="display:block;margin-top:3px">${e(a.publisher || "未知发布者")}</span>
      ${a.dirs.map((d) => `<span class="mono tiny faint" style="display:block;margin-top:3px;word-break:break-all">${e(d.path)}</span>`).join("")}</span>
    </label>`).join("")}</div>`;
}

function showPhoneGuide() {
  openModal({
    title: "手机访问正在开发",
    wide: true,
    body: `<div class="empty" style="padding:18px 8px 8px"><div class="e-ic">${IC.phone}</div><b>连接手机暂未开放</b><p style="max-width:520px;margin:6px auto 0">手机只读浏览电脑目录的功能正在开发中。当前版本请使用虚拟磁盘或文件库访问文件；功能上线前不会开放手机登录入口。</p></div>
    <div class="form-note mt16"><b>计划边界：</b>手机只能读取电脑授权内容，电脑端不会出现手机目录，也不会访问其他电脑的索引。云密钥始终只保存在本机。</div>`,
    foot: `<button class="btn btn-primary" data-act="close-modal">知道了</button>`,
  });
}

function showShareLink(url) {
  openModal({ title: "打开外部链接", body: `<div class="confirm-text">将在系统浏览器中打开：<br><span class="inline-code" style="word-break:break-all">${e(url)}</span></div>`, foot: `<button class="btn btn-ghost" data-act="close-modal">取消</button><button class="btn btn-primary" data-act="share-open" data-url="${e(url)}">打开</button>` });
}

document.addEventListener("click", async (ev) => {
  const pre = ev.target.closest("[data-preset]");
  if (pre) { ev.preventDefault(); applyPreset(pre.dataset.preset); return; }
  const el = ev.target.closest("[data-act]");
  if (el) {
    const act = el.dataset.act;
    const id = el.dataset.id || "";
    const path = el.dataset.path ? un(el.dataset.path) : "";
    try {
      if (act === "nav") {
        const v = el.dataset.view;
        if (v === "files" && st.view !== "files") { st.q = ""; st.path = ""; st.provider = ""; st.filter = "all"; st.status = "all"; st.sel.clear(); }
        setView(v);
      } else if (act === "auth-mode") {
        showAuth(el.dataset.mode === "register" ? "register" : "login");
      } else if (act === "close-modal") {
        closeModalEl(el);
      } else if (act === "open-manual") {
        await api.openExternal(siteUrl("/manual"));
      } else if (act === "open-site") {
        await api.openExternal(siteUrl("/"));
      } else if (act === "open-privacy") {
        await api.openExternal(siteUrl("/privacy"));
      } else if (act === "open-terms") {
        await api.openExternal(siteUrl("/terms"));
      } else if (act === "relogin") {
        showAuth("login");
      } else if (act === "scan-modal") {
        scanModal();
      } else if (act === "files-browse" || act === "files-root-pick") {
        openBrowse(st.path || "");
      } else if (act === "files-reset") {
        st.q = ""; st.path = ""; st.provider = ""; st.filter = "all"; st.status = "all"; st.sel.clear(); render();
      } else if (act === "files-up") {
        st.path = st.parent || ""; st.q = ""; st.provider = ""; st.sel.clear(); render();
      } else if (act === "files-filter-clear") {
        st.provider = ""; st.filter = "all"; st.status = "all"; st.sel.clear(); render();
      } else if (act === "provider-clear") {
        st.provider = ""; render();
      } else if (act === "enter-dir") {
        st.path = path; st.q = ""; st.provider = ""; st.sel.clear(); render();
      } else if (act === "open-entry") {
        await doOpenEntry(path);
      } else if (act === "legacy-open") {
        closeModalEl(el);
        const r = await api.open(path);
        track(r.job_id, "用本机 Office / WPS 打开", { refresh: false });
      } else if (act === "fetch-entry") {
        await doFetch(path);
      } else if (act === "share-entry") {
        await doShare(path);
      } else if (act === "reveal-entry") {
        await api.reveal(path);
      } else if (act === "archive-entry") {
        archiveModal([path]);
      } else if (act === "sel-clear") {
        st.sel.clear(); syncSel();
      } else if (act === "sel-archive") {
        archiveModal(Array.from(st.sel));
      } else if (act === "sel-restore") {
        restoreModal({ paths: Array.from(st.sel) });
      } else if (act === "provider-add") {
        providerModal();
      } else if (act === "provider-help") {
        providerHelp();
      } else if (act === "provider-edit") {
        const p = st.providers.find((x) => x.id === id); if (p) providerModal(p);
      } else if (act === "provider-form-test") {
        const f = $("#provForm");
        if (!f) return;
        const d = providerData();
        if (!d.endpoint || !d.bucket) { toast("请先填写 Endpoint 与 Bucket", "error"); return; }
        if (!f.dataset.id && (!d.access_key || !d.secret_key)) { toast("请先填写 AccessKey 与 SecretKey", "error"); return; }
        if (f.dataset.id && !d.access_key) delete d.access_key;
        if (f.dataset.id && !d.secret_key) delete d.secret_key;
        const box = $("#provTest");
        buttonBusy(el, true, "测试中");
        if (box) { box.textContent = ""; box.className = "test-state mt8 tiny"; }
        try {
          const r = await api.testProvider(d);
          if (box) { box.className = "test-state mt8 tiny key-state"; box.innerHTML = "连接正常，用时 " + Number(r.ms || 0) + " ms"; }
          toast("连接正常，Endpoint 与 Bucket 匹配", "ok");
        } catch (err) {
          if (box) { box.className = "test-state mt8 tiny warn-text"; box.textContent = errMsg(err); }
          toast(errMsg(err), "error", "连接测试失败");
        } finally { buttonBusy(el, false); }
      } else if (act === "provider-test") {
        buttonBusy(el, true, "测试");
        try {
          const r = await api.testProvider({ id });
          toast("连接正常，用时 " + Number(r.ms || 0) + " ms", "ok");
        } finally { buttonBusy(el, false); }
      } else if (act === "provider-balance") {
        const p = st.providers.find((x) => x.id === id) || {};
        buttonBusy(el, true, "查询中");
        try {
          balanceModal(p, await api.providerBalance(id));
        } catch (err) {
          balanceError(p, err);
        } finally { buttonBusy(el, false); }
      } else if (act === "provider-balance-recharge") {
        await api.openExternal("https://console.volcengine.com/finance/");
      } else if (act === "provider-del") {
        const p = st.providers.find((x) => x.id === id) || {};
        const n = Number(p.archived_files || 0);
        const ok = await confirmBox({
          title: "删除云存储配置",
          text: n ? `「${p.label || "云存储"}」仍有 ${n} 个仅云端文件。删除配置后，这些文件将失去访问密钥，可能无法再取回。\n\n确认仍要删除？` : `删除「${p.label || "云存储"}」的本机配置与服务器记录？云端已有对象不会被自动删除。`,
          ok: "删除", danger: true,
        });
        if (!ok) return;
        await api.deleteProvider(id, n > 0);
        st.providers = st.providers.filter((x) => x.id !== id);
        await refreshAll(); await render(); toast("云存储配置已删除", "ok");
      } else if (act === "provider-renew") {
        const p = st.providers.find((x) => x.id === id) || {};
        if (!p.renew_url) { toast("还没有填写续费网址，可在编辑中补充", "info"); providerModal(p); return; }
        await api.openExternal(p.renew_url);
      } else if (act === "provider-files") {
        st.provider = id; st.filter = "all"; st.status = "cloud"; st.q = ""; st.path = ""; st.sel.clear(); setView("files");
      } else if (act === "provider-restore") {
        const p = st.providers.find((x) => x.id === id) || {};
        restoreModal({ provider_id: id, paths: [] });
        if (!p.archived_files) toast("这家云存储没有云端副本", "info");
      } else if (act === "stitch-add") {
        stitchModal();
      } else if (act === "stitch-edit") {
        const s = st.stitches.find((x) => x.id === id); if (s) stitchModal(s);
      } else if (act === "stitch-del") {
        const s = st.stitches.find((x) => x.id === id) || {};
        if (await confirmBox({ title: "删除拼接组合", text: `删除「${s.name || "拼接"}」？已迁出的文件不受影响。`, ok: "删除", danger: true })) {
          await api.deleteStitch(id); await refreshAll(); await render(); toast("拼接已删除", "ok");
        }
      } else if (act === "downloads-archives") {
        await downloadsArchives();
      } else if (act === "archive-open") {
        archiveModal(st.sel.size ? Array.from(st.sel) : []);
      } else if (act === "restore-open") {
        restoreModal({});
      } else if (act === "restore-log") {
        restoreModal({ log_id: id });
      } else if (act === "log-view") {
        await logView(id);
      } else if (act === "archive-pick") {
        const f = $("#archForm");
        const xs = await api.chooseFiles();
        if (f && xs && xs.length) {
          const ta = f.elements.paths;
          const cur = String(ta.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          ta.value = Array.from(new Set(cur.concat(xs))).join("\n");
        }
      } else if (act === "archive-dirs") {
        const f = $("#archForm");
        const xs = await api.chooseDirs();
        if (f && xs && xs.length) {
          const ta = f.elements.paths;
          const cur = String(ta.value || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          ta.value = Array.from(new Set(cur.concat(xs))).join("\n");
        }
      } else if (act === "scan-pick") {
        const xs = await api.chooseDirs();
        if (xs && xs.length) {
          st.pick = xs;
          const lab = $("#scan-picked");
          if (lab) lab.textContent = xs.join("；");
          const box = $("#scan-pick-box");
          if (box) box.style.display = "";
          const radio = $('input[name="scope"][value="pick"]');
          if (radio) radio.checked = true;
        }
      } else if (act === "browse-open") {
        const m = modals.find((x) => x.root.querySelector("#browse-body"));
        if (m) await browseGo(path, m);
      } else if (act === "browse-home") {
        const m = modals.find((x) => x.root.querySelector("#browse-body"));
        if (m) await browseGo("", m);
      } else if (act === "browse-native") {
        const xs = await api.chooseDirs();
        if (xs && xs.length) {
          const m = modals.find((x) => x.root.querySelector("#browse-body")); if (m) m.close();
          scanModal({ roots: xs });
        }
      } else if (act === "browse-root") {
        if (!browseCur) { toast("还没有选择目录", "error"); return; }
        const bm = modals.find((x) => x.root.querySelector("#browse-body"));
        if (bm) bm.close();
        await addRoots([browseCur]);
      } else if (act === "browse-scan") {
        if (!browseCur) { toast("还没有选择目录", "error"); return; }
        const m = modals.find((x) => x.root.querySelector("#browse-body")); if (m) m.close();
        scanModal({ roots: [browseCur] });
      } else if (act === "drive-start" || act === "drive-stop" || act === "drive-mount" || act === "drive-unmount") {
        await doDrive(act.slice(6));
      } else if (act === "drive-retry") {
        closeModalEl(el);
        await doDrive("mount");
      } else if (act === "drive-remount") {
        closeModalEl(el);
        await remountAfterRepair();
      } else if (act === "drive-goto") {
        closeModalEl(el);
        setView("drive");
      } else if (act === "drive-repair") {
        closeModalEl(el);
        await repairDrive();
      } else if (act === "drive-refresh") {
        await refreshAll(); await render();
      } else if (act === "drive-copy") {
        const d = st.drive || {};
        const val = el.dataset.kind === "url" ? d.url : el.dataset.kind === "user" ? d.user : d.pass;
        await doCopy(val, el.dataset.kind === "url" ? "WebDAV 地址" : el.dataset.kind === "user" ? "用户名" : "密码");
      } else if (act === "drive-cloud") {
        try {
          const want = !(st.drive && st.drive.cloud !== false);
          await api.driveConfig({ cloud: want });
          await refreshAll(); await render();
          toast(want ? "已切换为云端盘" : "已切换为本机索引只读镜像", "ok");
        } catch (err) {
          toast(errMsg(err), "error", "切换失败");
        }
      } else if (act === "drive-auto") {
        const d = st.drive || {};
        await api.driveConfig({ auto: !d.auto });
        await refreshAll(); await render(); toast(!d.auto ? "已开启自动挂载" : "已关闭自动挂载", "ok");
      } else if (act === "drive-manual") {
        openModal({ title: "手动连接 WebDAV", body: `<p class="confirm-text">${e((st.drive && st.drive.url) || "请先启动 WebDAV 服务")}</p>`, foot: `<button class="btn btn-primary" data-act="close-modal">关闭</button>` });
      } else if (act === "phone-copy") {
        await doCopy(siteUrl("/app"), "手机访问地址");
      } else if (act === "phone-open") {
        await api.openExternal(siteUrl("/app"));
      } else if (act === "phone-guide") {
        showPhoneGuide();
      } else if (act === "settings-root-add") {
        const xs = await api.chooseDirs();
        if (xs && xs.length) await addRoots(xs);
      } else if (act === "settings-root-del") {
        await delRoot(path);
      } else if (act === "skip-add") {
        const xs = await api.chooseDirs();
        if (xs && xs.length) await addSkips(xs);
      } else if (act === "skip-del") {
        await delSkip(path);
      } else if (act === "apps-exclude") {
        await appsExcludeModal();
      } else if (act === "apps-select-all") {
        const box = el.closest(".overlay");
        if (box) $$('input[name="app"]', box).forEach((x) => { x.checked = true; });
      } else if (act === "apps-add") {
        const box = el.closest(".overlay");
        const picked = box ? $$('input[name="app"]:checked', box).map((x) => st.apps[Number(x.value)]).filter(Boolean) : [];
        if (!picked.length) { toast("请至少选择一个应用", "error"); return; }
        const dirs = picked.flatMap((a) => (a.dirs || []).map((d) => d.path));
        closeModalEl(el);
        await addSkips(dirs);
      } else if (act === "settings-ext-reset") {
        st.cfg = await api.saveConfig({ exts: EXT_COMMON }); await refreshAll(); await render(); toast("已恢复默认扩展名", "ok");
      } else if (act === "quick-menu") {
        if (st.info && st.info.dev) { toast("开发模式下不写注册表，安装版可用", "info"); return; }
        try {
          const want = !(st.cfg && st.cfg.quick_menu !== false);
          st.cfg = await api.saveConfig({ quick_menu: want });
          const r = await api.quickMenu(want);
          await render();
          if (want && (!r || r.enabled === false)) toast("右键菜单写入失败，请检查安全软件", "error");
          else toast(want ? "已加入资源管理器右键菜单" : "已从右键菜单移除", "ok");
        } catch (err) {
          toast(errMsg(err), "error", "设置失败");
        }
      } else if (act === "quick-notify") {
        try {
          const want = !(st.cfg && st.cfg.quick_notify !== false);
          st.cfg = await api.saveConfig({ quick_notify: want });
          await render();
          toast(want ? "已开启系统通知" : "已关闭系统通知", "ok");
        } catch (err) {
          toast(errMsg(err), "error", "设置失败");
        }
      } else if (act === "settings-auto") {
        if (st.info && st.info.dev) { toast("开发模式下不修改系统自启动项", "info"); return; }
        try {
          const want = !(st.info && st.info.autoStart);
          const on = await api.setAutoStart(want);
          if (st.info) st.info.autoStart = on;
          await render();
          if (on !== want) toast(want ? "Windows 没有接受自启动设置，请检查安全软件" : "未能关闭自启动，请到任务管理器核对", "error");
          else toast(on ? "已开启开机启动" : "已关闭开机启动", "ok");
        } catch (err) {
          toast(errMsg(err), "error", "设置失败");
        }
      } else if (act === "autostart-yes") {
        closeModalEl(el);
        try {
          const on = await api.setAutoStart(true);
          if (st.info) st.info.autoStart = on;
          toast(on ? "已开启开机自动启动" : "Windows 没有接受自启动设置", on ? "ok" : "error");
        } catch (err) {
          toast(errMsg(err), "error", "设置失败");
        }
      } else if (act === "autostart-no") {
        closeModalEl(el);
      } else if (act === "settings-update") {
        buttonBusy(el, true, "检查中");
        try { await api.checkUpdate(); } catch (err) { toast(errMsg(err), "error", "检查更新失败"); } finally { buttonBusy(el, false); }
      } else if (act === "settings-sync") {
        buttonBusy(el, true, "同步中");
        try { await api.syncMeta(); await refreshAll(); await render(); toast("元数据已同步到服务器", "ok"); } finally { buttonBusy(el, false); }
      } else if (act === "open-logs") {
        await api.openFolder("logs");
      } else if (act === "open-data") {
        await api.openFolder("data");
      } else if (act === "settings-drive") {
        setView("drive");
      } else if (act === "acct-logout") {
        if (!(await confirmBox({ title: "退出登录", text: "退出后手机将无法访问这台电脑，云端副本与本地文件不受影响。", ok: "退出", danger: true }))) return;
        await api.logout();
        if (st.poll) { clearInterval(st.poll); st.poll = null; }
        st.status = null; st.providers = []; st.stitches = []; st.sel.clear();
        showAuth("login");
      } else if (act === "refresh-view") {
        await refreshAll(); await render();
      } else if (act === "share-open") {
        await api.openExternal(el.dataset.url || "");
      } else if (act === "reload-app") {
        location.reload();
      }
    } catch (err) {
      toast(errMsg(err), "error");
    }
    return;
  }
  const cp = ev.target.closest("[data-copy]");
  if (cp) {
    ev.preventDefault();
    await doCopy(cp.dataset.copy, cp.dataset.label || "内容");
  }
});

document.addEventListener("change", async (ev) => {
  const flt = ev.target.closest("[data-filter]");
  if (flt) {
    const k = flt.dataset.filter;
    if (k === "kind") st.filter = flt.value || "all";
    if (k === "status") st.status = flt.value || "all";
    if (k === "provider") st.provider = flt.value || "";
    st.sel.clear();
    render();
    return;
  }
  const qp = ev.target.closest("[data-quick-provider]");
  if (qp) {
    try {
      st.cfg = await api.saveConfig({ quick_link_provider: qp.value || "" });
      toast(qp.value ? "已指定快速链接使用的云存储" : "已改为自动选择", "ok");
    } catch (err) {
      toast(errMsg(err), "error");
      await render();
    }
    return;
  }
  const all = ev.target.closest("#sel-all");
  if (all) {
    st.entries.filter((x) => !x.is_dir).forEach((x) => { if (all.checked) st.sel.add(x.path); else st.sel.delete(x.path); });
    syncSel();
    return;
  }
  const cb = ev.target.closest(".entry-check");
  if (cb) {
    const path = un(cb.dataset.path);
    if (cb.checked) st.sel.add(path); else st.sel.delete(path);
    syncSel();
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && modals.length) {
    ev.preventDefault();
    modals[modals.length - 1].close();
  }
});

window.addEventListener("hashchange", () => {
  if (!st.status || !st.status.logged_in) return;
  const h = location.hash.replace(/^#\/?/, "");
  if (PAGE[h] && h !== st.view) setView(h);
});

api.onFilesChanged(() => {
  if (!st.status || !st.status.logged_in) return;
  refreshAll().then(render).catch(() => {});
});

boot().catch((err) => {
  const b = $("#boot");
  if (b) {
    b.classList.remove("hidden");
    b.innerHTML = `<div class="boot-mark"><img src="../../assets/tray.png" alt=""></div><p>${e(errMsg(err))}</p>`;
  }
});
