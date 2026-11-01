"""存储熊自身的磁盘清理。

只碰程序自己的运行痕迹（临时文件、缓存、旧日志、临时分享包、数据库空闲页），
绝不触碰用户的原文件、扫描索引之外的内容。
"""

import os
import shutil
import time

from . import util

# name -> (解析函数, 说明)
def _targets():
    return {
        "tmp": util.path("tmp"),
        "cache": util.path("cache"),
        "logs": util.path("logs"),
    }


def _walk_size(p):
    total, files = 0, 0
    if os.path.isfile(p):
        try:
            return os.path.getsize(p), 1
        except OSError:
            return 0, 0
    if not os.path.isdir(p):
        return 0, 0
    for root, _dirs, names in os.walk(p):
        for fn in names:
            try:
                total += os.path.getsize(os.path.join(root, fn))
                files += 1
            except OSError:
                continue
    return total, files


def usage(extra=None):
    out, total, count = {}, 0, 0
    for name, p in _targets().items():
        b, n = _walk_size(p)
        out[name] = {"path": p, "bytes": b, "files": n}
        total += b
        count += n
    for name, p in (extra or {}).items():
        b, n = _walk_size(p)
        out[name] = {"path": p, "bytes": b, "files": n}
        total += b
        count += n
    return {"targets": out, "total": total, "files": count}


def _clear_dir(p):
    freed, count = 0, 0
    if not os.path.isdir(p):
        return freed, count
    for name in os.listdir(p):
        q = os.path.join(p, name)
        b, n = _walk_size(q)
        try:
            if os.path.isdir(q) and not os.path.islink(q):
                shutil.rmtree(q, ignore_errors=True)
            else:
                os.remove(q)
        except OSError:
            continue
        freed += b
        count += n
    return freed, count


def _trim_logs(p, days):
    freed, count = 0, 0
    if not os.path.isdir(p):
        return freed, count
    cutoff = time.time() - max(1, int(days)) * 86400
    keep = {"agent.log", "desktop.log"}
    for root, _dirs, names in os.walk(p):
        for fn in names:
            q = os.path.join(root, fn)
            if os.path.dirname(q) == p and fn in keep:
                continue  # 正在写的日志留给轮转
            try:
                if os.path.getmtime(q) >= cutoff:
                    continue
                freed += os.path.getsize(q)
                os.remove(q)
                count += 1
            except OSError:
                continue
    return freed, count


def clean(types=None, days=7, extra=None):
    """types 为空表示全部；返回每项释放量与总释放量。"""
    names = list((types or ["tmp", "cache", "logs"]))
    names = [n for n in names if n in ("tmp", "cache", "logs", "share", "vacuum")]
    freed_total, files_total, detail = 0, 0, {}
    base = _targets()
    for n in names:
        if n == "logs":
            b, c = _trim_logs(base["logs"], days)
        elif n == "vacuum":
            b, c = _vacuum(extra or {})
        elif n == "share":
            from . import pack
            b, c = pack.purge(), 0
        else:
            b, c = _clear_dir(base[n])
        detail[n] = {"bytes": b, "files": c}
        freed_total += b
        files_total += c
    util.log("self-clean %s: freed %s bytes / %d files" % (",".join(names), freed_total, files_total))
    return {"types": names, "detail": detail, "bytes": freed_total, "files": files_total, "days": days}


def _vacuum(extra):
    db = (extra or {}).get("db") or ""
    if not db or not os.path.isfile(db):
        return 0, 0
    before = os.path.getsize(db)
    import sqlite3
    try:
        con = sqlite3.connect(db, timeout=15)
        try:
            con.execute("VACUUM")
        finally:
            con.close()
    except Exception as e:
        util.log("vacuum failed: %s" % e)
        return 0, 0
    after = os.path.getsize(db) if os.path.exists(db) else 0
    return max(0, before - after), 0
