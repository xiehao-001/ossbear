import hashlib
import json
import mimetypes
import os
import re
import secrets
import time

from . import util
from .s3 import S3, S3Error

LINK_TTL = 6 * 86400
MANIFEST = "_storagebear/logs/%s.jsonl"
VIEW_EXT = set(util.OFFICE_VIEW)
LOCAL_EXT = set(util.OFFICE_LOCAL)


def _err(e):
    return str(getattr(e, "msg", e))[:300]


def _mime(path):
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


def _s3(agent, pid):
    p = agent.db.prov(pid, secret=True)
    if not p:
        raise RuntimeError("云存储配置不存在")
    if not p.get("access_key") or not p.get("secret_key"):
        raise RuntimeError("「%s」缺少 AccessKey / SecretKey" % p.get("label"))
    if not p.get("endpoint") or not p.get("bucket"):
        raise RuntimeError("「%s」缺少 Endpoint 或 Bucket" % p.get("label"))
    return S3(p)


def _ok(agent, pid):
    p = agent.db.prov(pid)
    return bool(p and p.get("enabled") and p.get("has_key") and p.get("endpoint") and p.get("bucket"))


def usable(agent):
    xs = agent.db.provs()
    out = []
    for p in xs:
        if _ok(agent, p["id"]):
            out.append(p["id"])
    return out


def pick(agent, opts, idx=0):
    opts = opts or {}
    pid = str(opts.get("provider_id") or "")
    if pid and _ok(agent, pid):
        return pid
    pids = []
    sid = str(opts.get("stitch_id") or "")
    if sid:
        st = agent.db.gets(sid)
        if st:
            pids = [x for x in st.get("providers") or [] if _ok(agent, x)]
    if not pids:
        pids = usable(agent)
    if not pids:
        raise RuntimeError("尚未配置可用的对象存储，请先在「云端」添加并填写密钥")
    if len(pids) == 1:
        return pids[0]
    used = {}
    for r in agent.db.q("SELECT provider_id,COALESCE(SUM(size),0) AS n FROM files "
                        "WHERE archived=1 AND object_key<>'' GROUP BY provider_id"):
        used[r["provider_id"]] = int(r["n"] or 0)
    return min(pids, key=lambda x: used.get(x, 0))


def key(path, prefix=""):
    base = util.safe_name(os.path.basename(path))
    h = hashlib.sha1(util.pkey(path).encode("utf-8")).hexdigest()[:20]
    pre = (prefix or "_storagebear/objects/%s" % time.strftime("%Y%m")).strip("/")
    return "%s/%s-%s" % (pre, h, base)


def link(s3, k):
    exp = util.now() + LINK_TTL
    return s3.presign(k, LINK_TTL), exp


def _like(p):
    p = p.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return p


def collect(db, paths):
    out = {}
    for raw in paths:
        p = util.native(raw)
        row = db.file(p)
        if row:
            out[row["pkey"]] = row
        if (row and row["is_dir"]) or os.path.isdir(p):
            k = util.pkey(p).rstrip("\\/") + os.sep
            for r in db.q("SELECT * FROM files WHERE is_dir=0 AND pkey LIKE ? ESCAPE '\\'", (_like(k) + "%",)):
                out[r["pkey"]] = r
        elif not row and os.path.isfile(p):
            db.put([{"path": p, "parent": os.path.dirname(p), "name": os.path.basename(p),
                     "size": os.path.getsize(p), "mtime": int(os.path.getmtime(p)),
                     "ext": util.ext(p), "kind": util.kind(util.ext(p))}])
            r = db.file(p)
            if r:
                out[r["pkey"]] = r
    return list(out.values())


def _rcloud(agent, path, pid, k, url, exp, archived, errors=None):
    try:
        agent.api.cloud(path, pid, k, url, exp, 1 if archived else 0)
    except Exception as e:
        if errors is not None:
            errors.append("%s: 服务器记录失败 %s" % (os.path.basename(path), _err(e)))
        else:
            util.log("cloud sync %s: %s" % (path, e))


def archive(agent, job, opts):
    paths = opts.get("paths") or []
    if not paths:
        raise RuntimeError("请选择要迁出的文件或目录")
    move = opts.get("move", True)
    rows = [r for r in collect(agent.db, paths) if not r.get("is_dir")]
    rows = [r for r in rows if not (r.get("archived") and r.get("object_key"))]
    if not rows:
        raise RuntimeError("所选范围内没有可迁出的文件")
    lid = "lg" + secrets.token_hex(8)
    total = len(rows)
    done = 0
    size_sum = 0
    entries = []
    errors = []
    clients = {}
    job.up(total=total, progress=0, message="准备迁出 %d 个文件" % total)
    for r in rows:
        p = util.native(r["path"])
        if not os.path.isfile(p):
            errors.append("%s: 本地文件已不存在" % p)
            done += 1
            job.up(progress=done, total=total)
            continue
        pid = ""
        try:
            if opts.get("stitch_id"):
                pid = pick(agent, opts, done)
            elif r.get("provider_id") and _ok(agent, r["provider_id"]):
                pid = r["provider_id"]
            else:
                pid = pick(agent, opts, done)
            if pid not in clients:
                clients[pid] = _s3(agent, pid)
            s3 = clients[pid]
            k = r.get("object_key") if r.get("provider_id") == pid and r.get("object_key") else key(p)
            s3.put_file(k, p, _mime(p))
            url, exp = link(s3, k)
            agent.db.cloud(p, pid, k, url, exp, 1)
            _rcloud(agent, p, pid, k, url, exp, True, errors)
            entries.append({"path": p, "key": k, "provider_id": pid, "size": int(r.get("size") or 0),
                            "mtime": int(r.get("mtime") or 0)})
            size_sum += int(r.get("size") or 0)
            if move:
                try:
                    os.remove(p)
                except OSError as e:
                    errors.append("%s: 已上传但删除本地失败 %s" % (p, e))
        except Exception as e:
            errors.append("%s: %s" % (p, _err(e)))
        done += 1
        job.up(progress=done, total=total, message="已迁出 %d / %d" % (done - len(errors), total))
    mans = {}
    if entries:
        groups = {}
        for e in entries:
            groups.setdefault(e["provider_id"], []).append(e)
        for pid, es in groups.items():
            try:
                mk = MANIFEST % lid
                raw = "\n".join(json.dumps(x, ensure_ascii=False) for x in es) + "\n"
                s3 = clients.get(pid) or _s3(agent, pid)
                s3.put_bytes(mk, raw.encode("utf-8"), "application/x-ndjson")
                mans[pid] = mk
            except Exception as e:
                errors.append("日志上传失败：%s" % _err(e))
    detail = {"manifests": mans, "manifest": next(iter(mans.values()), ""), "files": len(entries),
              "bytes": size_sum, "moved": bool(move),
              "providers": sorted(set(e["provider_id"] for e in entries))}
    if errors:
        detail["errors"] = errors[:30]
    agent.db.log(lid, opts.get("provider_id") or "", "archive", len(entries), detail)
    if agent.api.token:
        try:
            agent.api.log(lid, opts.get("provider_id") or "", "archive", len(entries), detail)
        except Exception as e:
            util.log("log sync: %s" % e)
    result = {"log_id": lid, "files": len(entries), "bytes": size_sum, "errors": errors[:30]}
    if mans:
        result["manifest"] = next(iter(mans.values()))
        result["manifests"] = mans
    if not entries:
        raise RuntimeError("没有文件成功迁出：" + (errors[0] if errors else "未知错误"))
    return result


def _manifest(agent, log):
    detail = log.get("detail") or {}
    if isinstance(detail, str):
        try:
            detail = json.loads(detail)
        except Exception:
            detail = {}
    out = []
    mans = detail.get("manifests")
    if not isinstance(mans, dict):
        mans = {}
        mk = detail.get("manifest") or ""
        if mk and log.get("provider_id"):
            mans[log["provider_id"]] = mk
    for pid, mk in mans.items():
        if not mk or not _ok(agent, pid):
            raise RuntimeError("缺少日志所属云存储的密钥，无法读取云端日志")
        raw = _s3(agent, pid).get_bytes(mk, 200 * 1024 * 1024).decode("utf-8", "replace")
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                x = json.loads(line)
            except Exception:
                continue
            if x.get("path") and x.get("key"):
                x["provider_id"] = x.get("provider_id") or pid
                out.append(x)
    if out:
        return out
    rows = agent.db.arch()
    return [{"path": r["path"], "key": r["object_key"], "provider_id": r["provider_id"],
             "size": r["size"], "mtime": r["mtime"]} for r in rows]


def _log(agent, lid):
    r = agent.db.getlog(lid)
    if r:
        return r
    if agent.api.token:
        try:
            j = agent.api.call("GET", "/api/logs?limit=200")
            for x in j.get("logs", []):
                if x.get("id") == lid:
                    return x
        except Exception:
            pass
    raise RuntimeError("找不到迁出日志")


def restore(agent, job, opts):
    lid = str(opts.get("log_id") or "")
    if lid:
        log = _log(agent, lid)
        entries = _manifest(agent, log)
        pid_default = log.get("provider_id") or ""
    else:
        pid = str(opts.get("provider_id") or "")
        paths = opts.get("paths") or []
        if paths:
            rows = [r for r in collect(agent.db, paths) if r.get("archived") and r.get("object_key")]
        elif pid or opts.get("all"):
            rows = agent.db.arch(pid)
        else:
            raise RuntimeError("请选择迁出日志、云存储或具体文件")
        entries = [{"path": r["path"], "key": r["object_key"], "provider_id": r["provider_id"],
                    "size": r["size"], "mtime": r["mtime"]} for r in rows]
        pid_default = pid
    if not entries:
        raise RuntimeError("没有可迁回的文件")
    keep = bool(opts.get("keep_cloud"))
    skip = not bool(opts.get("overwrite"))
    clients = {}
    errors = []
    done = 0
    total = len(entries)
    moved = 0
    job.up(total=total, progress=0, message="准备迁回 %d 个文件" % total)
    for e in entries:
        p = util.native(e["path"])
        pid = e.get("provider_id") or pid_default
        try:
            if not pid or not _ok(agent, pid):
                raise RuntimeError("云存储密钥缺失")
            if pid not in clients:
                clients[pid] = _s3(agent, pid)
            s3 = clients[pid]
            if skip and os.path.isfile(p) and os.path.getsize(p) == int(e.get("size") or 0):
                moved += 1
                agent.db.cloud(p, pid, e["key"], "", 0, 0)
                done += 1
                job.up(progress=done, total=total)
                continue
            s3.download(e["key"], p)
            agent.db.cloud(p, pid, e["key"], "", 0, 0)
            _rcloud(agent, p, pid, e["key"], "", 0, False, errors)
            if not keep:
                try:
                    s3.delete(e["key"])
                except Exception as ex:
                    errors.append("%s: 已迁回但删除云端副本失败 %s" % (p, _err(ex)))
            try:
                os.utime(p, (int(e.get("mtime") or time.time()),) * 2)
            except OSError:
                pass
            moved += 1
        except Exception as ex:
            errors.append("%s: %s" % (os.path.basename(p), _err(ex)))
        done += 1
        job.up(progress=done, total=total, message="已迁回 %d / %d" % (moved, total))
    rl = "lr" + secrets.token_hex(8)
    detail = {"log_id": lid, "files": moved, "keep_cloud": keep, "restored_from": pid_default}
    if errors:
        detail["errors"] = errors[:30]
    agent.db.log(rl, pid_default, "restore", moved, detail)
    if agent.api.token:
        try:
            agent.api.log(rl, pid_default, "restore", moved, detail)
        except Exception as e:
            util.log("log sync: %s" % e)
    result = {"log_id": rl, "files": moved, "errors": errors[:30]}
    if not moved:
        raise RuntimeError("没有文件成功迁回：" + (errors[0] if errors else "未知错误"))
    return result


def resolve(agent, path):
    p = util.native(path)
    if os.path.isfile(p):
        return p
    r = agent.db.file(p)
    if not (r and r.get("object_key")):
        raise RuntimeError("本地与云端索引中都没有该文件")
    pid = r.get("provider_id") or ""
    if not _ok(agent, pid):
        raise RuntimeError("文件在云端，但对应云存储密钥不可用")
    job_note = "正在从云端取回 %s" % os.path.basename(p)
    util.log(job_note)
    _s3(agent, pid).download(r["object_key"], p)
    agent.db.cloud(p, pid, r["object_key"], "", 0, 0)
    _rcloud(agent, p, pid, r["object_key"], "", 0, False)
    return p


def downloads(agent):
    d = util.downloads()
    if not os.path.isdir(d):
        raise RuntimeError("没有找到下载目录")
    try:
        entries = list(os.scandir(d))
    except PermissionError:
        raise RuntimeError("没有权限读取下载目录")
    out = []
    for e in entries:
        try:
            if not e.is_file(follow_symlinks=False):
                continue
            ext = util.ext(e.name)
            if ext not in util.ARCHIVE_EXT:
                continue
            st = e.stat()
            p = util.native(e.path)
            r = agent.db.file(p)
            out.append({"name": e.name, "path": p, "ext": ext, "size": int(st.st_size),
                        "size_h": util.fmt_size(st.st_size), "mtime": int(st.st_mtime),
                        "indexed": bool(r), "has_cloud": bool(r and r.get("object_key")),
                        "archived": bool(r and r.get("archived") and r.get("object_key"))})
        except OSError:
            continue
    out.sort(key=lambda x: x["mtime"], reverse=True)
    total = len(out)
    return {"path": d, "archives": out[:200], "total": total,
            "bytes": sum(x["size"] for x in out)}


def viewlink(agent, path):
    p = util.native(path)
    r = agent.db.file(p)
    if not (r and r.get("object_key") and _ok(agent, r.get("provider_id"))):
        if os.path.isfile(p):
            return {"mode": "local", "path": p}
        raise RuntimeError("文件不在本机，也没有可用的云端副本")
    url = _s3(agent, r["provider_id"]).presign(
        r["object_key"], 1800, disposition="inline", ctype=_mime(p))
    return {"mode": "url", "url": url, "expires_at": util.now() + 1800,
            "provider_id": r["provider_id"], "name": os.path.basename(p), "ext": util.ext(p)}


def openable(agent, path):
    p = util.native(path)
    if os.path.isfile(p):
        return p
    r = agent.db.file(p)
    if not (r and r.get("object_key")):
        raise RuntimeError("本地与云端索引中都没有该文件")
    if not _ok(agent, r.get("provider_id")):
        raise RuntimeError("文件在云端，但对应云存储密钥不可用")
    d = util.path("tmp", "open")
    os.makedirs(d, exist_ok=True)
    now = util.now()
    try:
        for fn in os.listdir(d):
            q = os.path.join(d, fn)
            if os.path.isfile(q) and now - os.path.getmtime(q) > 2 * 86400:
                os.remove(q)
    except OSError:
        pass
    h = hashlib.sha1(util.pkey(p).encode("utf-8")).hexdigest()[:12]
    q = os.path.join(d, "%s-%s" % (h, util.safe_name(os.path.basename(p), 100)))
    _s3(agent, r["provider_id"]).download(r["object_key"], q)
    util.log("open temp: %s -> %s" % (p, q))
    return q


def _view_ext(path):
    ext = util.ext(path)
    if ext in LOCAL_EXT:
        raise RuntimeError("%s 暂不支持内置预览，请用本机 Office 或 WPS 打开" % ext)
    if ext not in VIEW_EXT:
        raise RuntimeError("该格式暂不支持预览")
    return ext


def _sha(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _edit_state(path):
    d = util.path("tmp", "edit")
    os.makedirs(d, exist_ok=True)
    now = util.now()
    try:
        for fn in os.listdir(d):
            q = os.path.join(d, fn)
            try:
                if os.path.isfile(q) and now - os.path.getmtime(q) > 2 * 86400:
                    os.remove(q)
            except OSError:
                pass
    except OSError:
        pass
    h = hashlib.sha1(util.pkey(path).encode("utf-8")).hexdigest()[:12]
    return d, h, os.path.join(d, h + ".json")


def preview(agent, path):
    p = util.native(path)
    ext = _view_ext(p)
    r = agent.db.file(p) or {}
    local = os.path.isfile(p)
    q = openable(agent, p)
    size = os.path.getsize(q)
    pid = r.get("provider_id") or ""
    return {"name": os.path.basename(p), "path": p, "file": q, "ext": ext, "size": size,
            "size_h": util.fmt_size(size), "source": "local" if local else "cloud",
            "provider_id": pid,
            "provider_label": (agent.db.prov(pid) or {}).get("label") or "" if pid else "",
            "has_cloud": bool(r.get("object_key"))}


def editfile(agent, path):
    p = util.native(path)
    ext = _view_ext(p)
    r = agent.db.file(p) or {}
    d, h, stp = _edit_state(p)
    work = os.path.join(d, h + "-" + util.safe_name(os.path.basename(p), 100))
    if os.path.isfile(p):
        work = p
        source = "local"
    elif r.get("object_key") and _ok(agent, r.get("provider_id")):
        _s3(agent, r["provider_id"]).download(r["object_key"], work)
        source = "cloud"
    else:
        raise RuntimeError("本地与云端都没有该文件")
    snap = {"orig": p, "work": work, "source": source, "sha1": _sha(work),
            "size": os.path.getsize(work), "mtime": int(os.path.getmtime(work)),
            "provider_id": r.get("provider_id") or "", "object_key": r.get("object_key") or "",
            "archived": int(r.get("archived") or 0), "created_at": util.now()}
    util.save_json(stp, snap)
    util.openpath(work)
    util.log("edit open: %s -> %s" % (p, work))
    return {"path": work, "orig": p, "source": source, "name": os.path.basename(p), "ext": ext,
            "size": snap["size"], "size_h": util.fmt_size(snap["size"]), "opened": True}


def _vkey(p, old_key):
    base = old_key or key(p)
    root, ext = os.path.splitext(base)
    root = re.sub(r"(?:-v\d{14}-[0-9a-f]{6})+$", "", root)
    return "%s-v%s-%s%s" % (root, time.strftime("%Y%m%d%H%M%S"), secrets.token_hex(3),
                            ext or util.ext(p))


def saveedit(agent, path):
    p = util.native(path)
    ext = _view_ext(p)
    d, h, stp = _edit_state(p)
    snap = util.load_json(stp, None)
    if not snap or util.pkey(snap.get("orig") or "") != util.pkey(p):
        raise RuntimeError("没有找到编辑记录，请先从预览窗口点击「用本机 Office / WPS 编辑」")
    work = util.native(snap.get("work") or "")
    if not os.path.isfile(work):
        raise RuntimeError("编辑临时文件已不存在，请重新打开")
    digest = _sha(work)
    if digest == snap.get("sha1"):
        return {"changed": False, "uploaded": False, "path": p,
                "message": "未检测到修改。请在本机 Office / WPS 中保存文件后再点「完成并上传」。"}
    size = os.path.getsize(work)
    if size <= 0:
        raise RuntimeError("文件内容为空，已取消上传")
    r = agent.db.file(p) or {}
    old_key = r.get("object_key") or snap.get("object_key") or ""
    old_pid = r.get("provider_id") or snap.get("provider_id") or ""
    has_cloud = bool(old_key and _ok(agent, old_pid))
    mtime = int(os.path.getmtime(work))
    if snap.get("source") == "local" and not has_cloud:
        agent.db.put([{"path": p, "parent": os.path.dirname(p), "name": os.path.basename(p),
                       "is_dir": False, "size": size, "ext": ext, "kind": util.kind(ext),
                       "mtime": mtime}])
        snap.update({"sha1": digest, "size": size, "mtime": mtime, "saved_at": util.now()})
        util.save_json(stp, snap)
        return {"changed": True, "uploaded": False, "path": p, "size": size,
                "size_h": util.fmt_size(size), "message": "本机文件已保存；该文件尚未迁出到云端。"}
    pid = old_pid if has_cloud else pick(agent, {})
    s3 = _s3(agent, pid)
    new_key = _vkey(p, old_key if pid == old_pid else "")
    s3.put_file(new_key, work, _mime(p))
    arch = 1 if not os.path.isfile(p) else 0
    agent.db.put([{"path": p, "parent": os.path.dirname(p), "name": os.path.basename(p),
                   "is_dir": False, "size": size, "ext": ext, "kind": util.kind(ext),
                   "mtime": mtime}])
    agent.db.cloud(p, pid, new_key, "", 0, arch)
    old_del = ""
    if old_key and old_key != new_key:
        if old_pid and _ok(agent, old_pid):
            try:
                _s3(agent, old_pid).delete(old_key)
            except Exception as e:
                old_del = _err(e)
        else:
            old_del = "原云存储密钥不可用，旧对象未删除"
    lid = "sv" + secrets.token_hex(8)
    detail = {"path": p, "provider_id": pid, "old_provider_id": old_pid, "old_key": old_key,
              "new_key": new_key, "size": size, "bytes": size, "source": snap.get("source"),
              "edited_at": util.now()}
    if old_del:
        detail["old_delete_error"] = old_del
    agent.db.log(lid, pid, "save", 1, detail)
    snap.update({"sha1": digest, "size": size, "mtime": mtime, "provider_id": pid,
                 "object_key": new_key, "archived": arch, "saved_at": util.now()})
    try:
        util.save_json(stp, snap)
    except Exception as e:
        util.log("edit state: %s" % e)
    util.log("edit save: %s -> %s" % (p, new_key))
    return {"changed": True, "uploaded": True, "path": p, "provider_id": pid,
            "provider_label": (agent.db.prov(pid) or {}).get("label") or "",
            "key": new_key, "old_key": old_key, "size": size, "size_h": util.fmt_size(size),
            "log_id": lid, "delete_error": old_del,
            "message": "已上传新版本并更新云端记录" + ("；旧对象删除失败" if old_del else "")}


def serve(agent, t):
    pl = t.get("payload") or {}
    kind = t.get("kind")
    if kind != "upload":
        raise RuntimeError("不支持的任务类型：%s" % kind)
    p = util.native(pl.get("path") or "")
    r = agent.db.file(p)
    fid = pl.get("file_id") or (r.get("id") if r else "")
    arch = int((r or {}).get("archived") or 0)
    if r and r.get("object_key") and r.get("provider_id") and _ok(agent, r["provider_id"]):
        pid = r["provider_id"]
        k = r["object_key"]
        s3 = _s3(agent, pid)
        try:
            s3.head(k)
        except Exception:
            if not os.path.isfile(p):
                raise
            s3.put_file(k, p, _mime(p))
    else:
        if not os.path.isfile(p):
            try:
                p = resolve(agent, p)
                r = agent.db.file(p)
                arch = int((r or {}).get("archived") or 0)
            except Exception:
                raise RuntimeError("文件已不在本机，且没有可用的云端副本")
        pid = pick(agent, {"provider_id": (r or {}).get("provider_id")})
        s3 = _s3(agent, pid)
        k = (r or {}).get("object_key") if (r or {}).get("provider_id") == pid else ""
        if not k:
            k = key(p, "_storagebear/links")
            s3.put_file(k, p, _mime(p))
    url, exp = link(s3, k)
    agent.db.cloud(p, pid, k, url, exp, arch)
    _rcloud(agent, p, pid, k, url, exp, arch)
    return {"file_id": fid, "url": url, "expires_at": exp, "provider_id": pid}
