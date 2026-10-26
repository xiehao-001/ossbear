import os
import secrets
import time

from . import util
from .remote import ApiError

SKIP = {
    "system volume information", "$recycle.bin", "windows", "program files", "program files (x86)",
    "programdata", "appdata", "node_modules", ".git", "__pycache__", "$winreagent", "recovery",
    "perflogs", "config.msi", ".cache", ".local", "library",
}
if os.name != "nt":
    SKIP |= {"proc", "sys", "dev", "run"}
DEFAULT_EXT = ([".pdf", ".mp3", ".mp4", ".m4a", ".wav", ".flac", ".mkv", ".avi", ".mov", ".webm"]
               + util.OFFICE_EXT + util.ARCHIVE_EXT)


def _label(p):
    if os.name == "nt" and len(p) <= 3 and p[1:2] == ":":
        return p[0].upper() + " 盘"
    b = os.path.basename(os.path.normpath(p))
    return b or p


def _skips(agent):
    cfg = util.config()
    out = []
    for r in cfg.get("skip_paths") or []:
        p = r.get("path") if isinstance(r, dict) else r
        if p:
            out.append(util.pkey(p))
    return out


def _blocked(path, skips):
    p = util.pkey(path)
    return any(p == r or p.startswith(r + os.sep) for r in skips)


def _app_dir(raw):
    s = os.path.expandvars(str(raw or "").strip())
    if s.startswith('"'):
        s = s[1:].split('"', 1)[0]
    elif "," in s and s.rsplit(",", 1)[1].strip().isdigit():
        s = s.rsplit(",", 1)[0]
    s = s.strip().strip('"')
    if not s:
        return ""
    if os.path.isfile(s):
        s = os.path.dirname(s)
    if not os.path.isdir(s):
        return ""
    p = util.native(s)
    if os.path.dirname(p) == p:
        return ""
    root = util.pkey(os.environ.get("SystemRoot") or r"C:\Windows").rstrip("\\/")
    if util.pkey(p) == root or util.pkey(p).startswith(root + os.sep):
        return ""
    broad = {util.pkey(os.environ.get("ProgramFiles") or r"C:\Program Files"),
             util.pkey(os.environ.get("ProgramFiles(x86)") or r"C:\Program Files (x86)"),
             util.pkey(os.environ.get("ProgramData") or r"C:\ProgramData"),
             util.pkey(os.path.expanduser("~"))}
    if util.pkey(p) in broad:
        return ""
    return p


def apps():
    if os.name != "nt":
        return []
    import winreg
    roots = []
    for hive, flag in ((winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_64KEY),
                       (winreg.HKEY_LOCAL_MACHINE, winreg.KEY_WOW64_32KEY),
                       (winreg.HKEY_CURRENT_USER, winreg.KEY_WOW64_64KEY)):
        roots.append((hive, r"Software\Microsoft\Windows\CurrentVersion\Uninstall", flag))
    found = {}
    for hive, key, flag in roots:
        try:
            parent = winreg.OpenKey(hive, key, 0, winreg.KEY_READ | flag)
        except OSError:
            continue
        try:
            total = winreg.QueryInfoKey(parent)[0]
            for i in range(min(total, 1200)):
                try:
                    sub = winreg.OpenKey(parent, winreg.EnumKey(parent, i), 0, winreg.KEY_READ | flag)
                except OSError:
                    continue
                try:
                    def val(name):
                        try:
                            return winreg.QueryValueEx(sub, name)[0]
                        except OSError:
                            return ""
                    name = str(val("DisplayName") or "").strip()
                    if not name or val("SystemComponent") == 1 or val("ParentKeyName"):
                        continue
                    dirs = []
                    for raw in (val("InstallLocation"), val("DisplayIcon"), val("UninstallString")):
                        p = _app_dir(raw)
                        if p and not _blocked(p, [util.pkey(x["path"]) for x in dirs]):
                            dirs.append({"path": p, "label": os.path.basename(p) or name})
                    if not dirs:
                        continue
                    ent = found.setdefault(util.pkey(name), {
                        "name": name, "publisher": str(val("Publisher") or "")[:80],
                        "version": str(val("DisplayVersion") or "")[:40], "dirs": []})
                    seen = {util.pkey(x["path"]) for x in ent["dirs"]}
                    for d in dirs:
                        if util.pkey(d["path"]) not in seen:
                            ent["dirs"].append(d)
                            seen.add(util.pkey(d["path"]))
                finally:
                    sub.Close()
        finally:
            parent.Close()
    out = [x for x in found.values() if x["dirs"]]
    out.sort(key=lambda x: x["name"].lower())
    return out[:250]


def _top(roots):
    out = []
    for r in sorted(roots, key=lambda x: len(x["path"])):
        p = util.native(r["path"])
        if not os.path.isdir(p):
            continue
        if any(util.pkey(p) == util.pkey(x["path"]) or
               util.pkey(p).startswith(util.pkey(x["path"]).rstrip("\\/") + os.sep) for x in out):
            continue
        out.append({"path": p, "label": r.get("label") or _label(p)})
    return out


def roots(agent, full=False, extra=None):
    cfg = util.config()
    if extra:
        rs = [{"path": util.native(p), "label": _label(util.native(p))} for p in extra if p]
        return _top(rs)
    if full:
        rs = [{"path": p, "label": _label(p)} for p in util.drives()]
        home = os.path.expanduser("~")
        if os.name != "nt" and os.path.isdir(home):
            rs = [{"path": home, "label": "我的文件"}]
        return _top(rs)
    return _top(util.roots_from_cfg(cfg))


def _exts(agent, extra=None):
    cfg = util.config()
    xs = extra if isinstance(extra, list) and extra else cfg.get("exts") or DEFAULT_EXT
    out = set(util.ARCHIVE_EXT)
    for x in xs:
        x = str(x).lower().strip()
        if x and not x.startswith("."):
            x = "." + x
        if 1 < len(x) <= 16 and x.count(".") == 1:
            out.add(x)
    return out or set(DEFAULT_EXT)


def _skip(name):
    n = name.lower()
    return n in SKIP or name.startswith(".")


def run(agent, job, opts):
    full = bool(opts.get("full"))
    roots_ = roots(agent, full, opts.get("roots"))
    if not roots_:
        raise RuntimeError("没有可扫描的目录，请先添加目录")
    skips = _skips(agent)
    roots_ = [r for r in roots_ if not _blocked(r["path"], skips)]
    if not roots_:
        raise RuntimeError("所选目录都在免扫路径中，请先调整设置里的免扫路径")
    exts = _exts(agent, opts.get("exts"))
    sid = secrets.token_hex(12)
    remote_ok = bool(agent.api.token)
    if remote_ok:
        try:
            sid = agent.api.begin().get("sync_id") or sid
        except Exception as e:
            remote_ok = False
            job.up(message="本地扫描中；服务器同步暂不可用：%s" % e)
    counts = {"dirs": 0, "files": 0, "skip": 0, "bytes": 0, "server_entries": 0}
    batch = []
    last = 0.0
    sync_err = ""

    def flush(force=False):
        nonlocal batch, last, remote_ok, sync_err
        if not batch and not force:
            return
        agent.db.put([{"path": x["path"], "parent": x["parent"], "name": x["name"], "is_dir": x["is_dir"],
                       "size": x["size"], "ext": x["ext"], "kind": x["kind"], "mtime": x["mtime"],
                       "scan_id": sid} for x in batch])
        if remote_ok and batch:
            ents = []
            for x in batch:
                ents.append({k: x[k] for k in (
                    "path", "parent", "name", "is_dir", "size", "ext", "kind", "mtime")})
            try:
                r = agent.api.push(sid, ents)
                counts["server_entries"] += int(r.get("accepted", 0))
            except Exception as e:
                sync_err = str(e)
                remote_ok = False
                job.up(message="本地已索引，服务器同步异常：%s" % e)
        batch = []
        last = time.time()

    try:
        for r in roots_:
            root = r["path"]
            if not os.path.isdir(root):
                continue
            try:
                walker = os.walk(root, topdown=True, followlinks=False, onerror=lambda e: None)
                for cur, dirs, files in walker:
                    keep = []
                    for d in dirs:
                        p = os.path.normpath(os.path.join(cur, d))
                        if _skip(d) or os.path.islink(p) or _blocked(p, skips):
                            counts["skip"] += 1
                            continue
                        keep.append(d)
                    dirs[:] = keep
                    for d in dirs:
                        p = os.path.normpath(os.path.join(cur, d))
                        try:
                            st = os.stat(p)
                            mtime = int(st.st_mtime)
                        except OSError:
                            mtime = 0
                        batch.append({"path": p, "parent": os.path.dirname(p), "name": d, "is_dir": True,
                                      "size": 0, "ext": "", "kind": "dir", "mtime": mtime})
                        counts["dirs"] += 1
                    for fn in files:
                        e = os.path.splitext(fn)[1].lower()
                        if e not in exts:
                            counts["skip"] += 1
                            continue
                        p = os.path.normpath(os.path.join(cur, fn))
                        if _blocked(p, skips):
                            counts["skip"] += 1
                            continue
                        try:
                            st = os.stat(p)
                            if not os.path.isfile(p):
                                continue
                        except OSError:
                            continue
                        batch.append({"path": p, "parent": os.path.dirname(p), "name": fn, "is_dir": False,
                                      "size": int(st.st_size), "ext": e, "kind": util.kind(e),
                                      "mtime": int(st.st_mtime)})
                        counts["files"] += 1
                        counts["bytes"] += int(st.st_size)
                    if len(batch) >= 400:
                        flush()
                    if time.time() - last > 0.8:
                        job.up(progress=0, total=0,
                               message="扫描 %d 个目录 / %d 个文件，当前：%s" %
                                       (counts["dirs"], counts["files"], cur[-80:]),
                               result=dict(counts))
                        last = time.time()
            except Exception as e:
                util.log("scan root %s: %s" % (root, e))
        flush(True)
        if remote_ok:
            try:
                agent.api.finish(sid, [{"path": r["path"], "label": r["label"]} for r in roots_])
            except Exception as e:
                sync_err = str(e)
        agent.db.done_scan(sid)
        cfg = util.config()
        cfg["last_scan"] = util.now()
        cfg["last_roots"] = [{"path": r["path"], "label": r["label"]} for r in roots_]
        cfg["last_sync_error"] = sync_err
        util.save_json(util.path("config.json"), cfg)
        util.log("scan done: %s sync_err=%s" % (counts, sync_err))
        result = dict(counts)
        result["roots"] = [{"path": r["path"], "label": r["label"]} for r in roots_]
        result["server_synced"] = remote_ok and not sync_err
        if sync_err:
            result["sync_error"] = sync_err
        return result
    except Exception:
        raise
