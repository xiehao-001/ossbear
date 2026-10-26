(function () {
  const $ = (s) => document.querySelector(s);
  const docxHost = $("#docx");
  const xlsxHost = $("#xlsx");
  const pptxHost = $("#pptx");
  const sheetTabs = $("#sheets");
  const sheetBox = $("#sheet");
  const splash = $("#splash");
  const splashTitle = $("#splash-title");
  const splashText = $("#splash-text");
  const splashActs = $("#splash-acts");
  const editBtn = $("#edit");
  const saveBtn = $("#save");
  const closeBtn = $("#close");
  const badge = $("#badge");
  const toastEl = $("#toast");

  const state = { path: "", meta: null, busy: false, seq: 0, toastTimer: null };

  function msgOf(e) {
    let s = String((e && e.message) || e || "未知错误");
    s = s.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "");
    return s;
  }

  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (kind === "err" ? " err" : "");
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 4200);
  }

  function resetHosts() {
    docxHost.innerHTML = "";
    xlsxHost.classList.add("hidden");
    sheetTabs.innerHTML = "";
    sheetBox.innerHTML = "";
    pptxHost.innerHTML = "";
    docxHost.classList.add("hidden");
    pptxHost.classList.add("hidden");
    splashActs.innerHTML = "";
    splash.classList.remove("hidden", "error");
    splashTitle.textContent = "正在读取文件…";
    splashText.textContent = "云端文件会先取回本机，大文件可能需要一段时间";
  }

  function showError(text, allowEdit) {
    splash.classList.remove("hidden");
    splash.classList.add("error");
    splashTitle.textContent = "无法预览这个文件";
    splashText.textContent = text || "未知错误";
    splashActs.innerHTML = "";
    if (allowEdit) {
      const b = document.createElement("button");
      b.className = "btn primary";
      b.textContent = "用本机 Office / WPS 编辑";
      b.addEventListener("click", doEdit);
      splashActs.appendChild(b);
    }
    const c = document.createElement("button");
    c.className = "btn ghost";
    c.textContent = "关闭";
    c.addEventListener("click", () => bear.close());
    splashActs.appendChild(c);
  }

  function showHost(host) {
    splash.classList.add("hidden");
    host.classList.remove("hidden");
  }

  function bytesOf(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error("预览数据格式异常，请重新打开");
  }

  function updateMeta() {
    if (!state.meta) return;
    const m = state.meta;
    $("#fname").textContent = m.name;
    $("#fmeta").textContent = [m.size_h, m.provider_label, m.source === "cloud" ? "云端副本" : "本机文件"]
      .filter(Boolean).join(" · ");
    if (m.source === "cloud" || m.has_cloud) {
      badge.textContent = m.provider_label ? "已在 " + m.provider_label : "云端副本";
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
    document.title = m.name + " · 存储熊";
    editBtn.disabled = false;
  }

  async function renderDocx(bytes) {
    docxHost.innerHTML = "";
    showHost(docxHost);
    await docx.renderAsync(bytes.buffer, docxHost, null, {
      useBase64URL: true,
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
    });
  }

  function colName(n) {
    return XLSX.utils.encode_col(n);
  }

  function sheetTable(ws) {
    const box = document.createElement("div");
    if (!ws || !ws["!ref"]) {
      box.className = "sheet-note";
      box.textContent = "这个工作表是空的。";
      return box;
    }
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const maxRows = 400;
    const maxCols = 40;
    let cut = false;
    const e = { r: range.e.r, c: range.e.c };
    if (e.r - range.s.r + 1 > maxRows) { e.r = range.s.r + maxRows - 1; cut = true; }
    if (e.c - range.s.c + 1 > maxCols) { e.c = range.s.c + maxCols - 1; cut = true; }
    const sub = Object.assign({}, ws, { "!ref": XLSX.utils.encode_range({ s: range.s, e }) });
    const rows = XLSX.utils.sheet_to_json(sub, { header: 1, raw: false, defval: "", blankrows: true });
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "rowhead";
    hr.appendChild(corner);
    for (let c = range.s.c; c <= e.c; c += 1) {
      const th = document.createElement("th");
      th.textContent = colName(c);
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.slice(0, maxRows).forEach((row, ri) => {
      const tr = document.createElement("tr");
      const rh = document.createElement("td");
      rh.className = "rowhead";
      rh.textContent = String(range.s.r + ri + 1);
      tr.appendChild(rh);
      for (let c = range.s.c; c <= e.c; c += 1) {
        const td = document.createElement("td");
        const v = row[c - range.s.c];
        td.textContent = v === undefined || v === null ? "" : String(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    box.appendChild(table);
    if (cut) {
      const note = document.createElement("div");
      note.className = "sheet-note";
      note.textContent = "表格较大，预览只显示前 " + maxRows + " 行、前 " + maxCols + " 列；完整内容请用本机 Office / WPS 打开。";
      box.appendChild(note);
    }
    return box;
  }

  function renderXlsx(bytes) {
    const wb = XLSX.read(bytes, { type: "array" });
    const names = wb.SheetNames.slice(0, 8);
    if (!names.length) throw new Error("工作簿里没有工作表");
    sheetTabs.innerHTML = "";
    sheetBox.innerHTML = "";
    showHost(xlsxHost);
    xlsxHost.classList.remove("hidden");
    const pick = (name, btn) => {
      sheetTabs.querySelectorAll(".tab").forEach((x) => x.classList.remove("on"));
      btn.classList.add("on");
      sheetBox.innerHTML = "";
      sheetBox.appendChild(sheetTable(wb.Sheets[name]));
      sheetBox.scrollTop = 0;
      sheetBox.scrollLeft = 0;
    };
    names.forEach((name, i) => {
      const b = document.createElement("button");
      b.className = "tab" + (i === 0 ? " on" : "");
      b.textContent = name;
      b.addEventListener("click", () => pick(name, b));
      sheetTabs.appendChild(b);
    });
    sheetBox.appendChild(sheetTable(wb.Sheets[names[0]]));
    if (wb.SheetNames.length > 8) {
      const note = document.createElement("div");
      note.className = "sheet-note";
      note.textContent = "工作簿共有 " + wb.SheetNames.length + " 个工作表，预览只显示前 8 个。";
      sheetBox.appendChild(note);
    }
  }

  async function renderPptx(bytes) {
    pptxHost.innerHTML = "";
    showHost(pptxHost);
    const width = Math.max(360, Math.min(900, $("#stage").clientWidth - 70));
    const p = pptxPreview.init(pptxHost, {
      width,
      height: Math.round(width * 9 / 16),
      mode: "list",
    });
    await p.preview(bytes.buffer);
  }

  async function load(path) {
    state.path = String(path || "");
    state.meta = null;
    const seq = ++state.seq;
    editBtn.disabled = true;
    saveBtn.classList.add("hidden");
    resetHosts();
    $("#fname").textContent = state.path.split(/[\\/]/).pop() || "文档";
    $("#fmeta").textContent = "正在读取…";
    badge.classList.add("hidden");
    try {
      const r = await bear.load(state.path);
      if (seq !== state.seq) return;
      state.meta = r;
      updateMeta();
      const bytes = bytesOf(r.data);
      r.data = null;
      if (r.ext === ".docx") await renderDocx(bytes);
      else if (r.ext === ".xlsx") renderXlsx(bytes);
      else if (r.ext === ".pptx") await renderPptx(bytes);
      else throw new Error("该格式暂不支持预览");
      if (seq !== state.seq) return;
      splash.classList.add("hidden");
    } catch (e) {
      if (seq !== state.seq) return;
      const text = msgOf(e);
      $("#fmeta").textContent = "预览未完成";
      editBtn.disabled = false;
      showError(text, true);
    }
  }

  async function doEdit() {
    if (!state.path || state.busy) return;
    state.busy = true;
    editBtn.classList.add("busy");
    const old = editBtn.textContent;
    editBtn.textContent = "正在准备…";
    try {
      const r = await bear.edit(state.path);
      saveBtn.textContent = state.meta && !state.meta.has_cloud && state.meta.source === "local" ? "完成" : "完成并上传";
      saveBtn.classList.remove("hidden");
      toast(r.source === "cloud"
        ? "已交给本机 Office / WPS 打开临时副本。保存后回来点「完成并上传」。"
        : "已交给本机 Office / WPS 打开。保存后回来点「" + (state.meta && !state.meta.has_cloud ? "完成" : "完成并上传") + "」。", "ok");
    } catch (e) {
      toast("打开失败：" + msgOf(e), "err");
    } finally {
      state.busy = false;
      editBtn.classList.remove("busy");
      editBtn.textContent = old || "用本机 Office / WPS 编辑";
      editBtn.disabled = !state.path;
    }
  }

  async function doSave() {
    if (!state.path || state.busy) return;
    state.busy = true;
    saveBtn.classList.add("busy");
    const old = saveBtn.textContent;
    saveBtn.textContent = "正在上传…";
    try {
      const r = await bear.save(state.path);
      if (!r.changed) {
        const word = state.meta && !state.meta.has_cloud && state.meta.source === "local" ? "完成" : "完成并上传";
        toast("未检测到修改。请先在本机 Office / WPS 中保存文件，再点「" + word + "」。");
        return;
      }
      if (r.uploaded) {
        toast(r.message + (r.delete_error ? "（" + r.delete_error + "）" : ""), r.delete_error ? "err" : "ok");
      } else {
        toast(r.message || "本机文件已保存", "ok");
      }
      saveBtn.classList.add("hidden");
      await load(state.path);
    } catch (e) {
      toast("保存失败：" + msgOf(e), "err");
    } finally {
      state.busy = false;
      saveBtn.classList.remove("busy");
      saveBtn.textContent = old || "完成并上传";
    }
  }

  editBtn.addEventListener("click", doEdit);
  saveBtn.addEventListener("click", doSave);
  closeBtn.addEventListener("click", () => bear.close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") bear.close();
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) bear.openExternal(href).catch(() => {});
  });
  window.addEventListener("resize", () => {
    if (!state.meta || state.meta.ext !== ".pptx") return;
    const p = state.path;
    if (state.busy) return;
    clearTimeout(window.__rb);
    window.__rb = setTimeout(() => { load(p); }, 500);
  });

  bear.onPath((p) => { load(p); });
})();
