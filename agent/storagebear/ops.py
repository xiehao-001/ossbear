import hashlib
import json
import mimetypes
import os
import secrets
import time

from . import util
from .s3 import S3, S3Error

LINK_TTL = 6 * 86400
MANIFEST = "_storagebear/logs/%s.jsonl"


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
