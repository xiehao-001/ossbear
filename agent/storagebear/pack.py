"""一键分享用的打包器。

单文件时上游直接上传，这里只处理「多个文件 / 文件夹」的情况：
优先用 zstd（无损、压缩比比 zip 高一大截）。运行时有三种可能：

1. 装了 ``zstandard`` 模块 —— 走 Python 直写，能报细粒度进度（首选）；
2. 没装模块但系统自带 bsdtar（Windows 10 1803+ 的 ``System32\\tar.exe``）
   —— 由 bsdtar 调用 libzstd 输出 ``.tar.zst``，零额外依赖；
3. 两者都没有 —— 回退 zip，保证功能始终可用。
"""

import locale
import os
import shutil
import subprocess
import tarfile
import time
import zipfile

from . import util

try:  # 可选依赖，缺失时用 bsdtar / zip
    import zstandard as _zstd
except Exception:  # pragma: no cover - 环境相关
    _zstd = None

DEFAULT_LEVEL = 12          # zstd 高层级：接近 --ultra 19 的体积，速度仍可接受
DEFAULT_LABEL = "存储熊分享"
_TAR = []                   # 缓存 bsdtar 探测结果，"" 表示不可用


def _tar_exe():
    """找系统自带的 bsdtar（必须带 libzstd；Git 的 GNU tar 不算）。"""
    if _TAR:
        return _TAR[0]
    root = os.environ.get("SystemRoot") or r"C:\Windows"
    cands = [os.path.join(root, "System32", "tar.exe"),
             os.path.join(root, "Sysnative", "tar.exe")]
    for exe in cands:
        if not os.path.isfile(exe):
            continue
        try:
            r = subprocess.run([exe, "--version"], capture_output=True, timeout=15)
            banner = (r.stdout or b"").decode("utf-8", "replace").lower()
        except Exception:
            continue
        if "bsdtar" in banner and "zstd" in banner:
            _TAR.append(exe)
            return exe
    _TAR.append("")
    return ""


def engine():
    """对外的引擎名：能用 zstd 就是 zstd，否则 zip。"""
    if _zstd is not None or _tar_exe():
        return "zstd"
    return "zip"


def _entries(paths):
    seen, out = set(), []
    for raw in paths or []:
        p = util.native(raw)
        if not p or not os.path.exists(p):
            continue
        k = util.pkey(p)
        if k in seen:
            continue
        seen.add(k)
        out.append(p)
    return out


def _base(items):
    """找一个足够宽的公共父目录，用于生成包内相对路径。"""
    dirs = [p if os.path.isdir(p) else os.path.dirname(p) for p in items]
    try:
        common = os.path.commonpath(dirs)
    except Exception:
        common = ""
    if not common:
        return dirs[0]
    # commonpath 可能返回 "C:\\" 这类盘根，降级到条目自身目录
    if os.path.dirname(common) == common:
        return dirs[0]
    return common


def _size(path):
    if os.path.isfile(path):
        try:
            return os.path.getsize(path)
        except OSError:
            return 0
    total = 0
    for root, _dirs, files in os.walk(path):
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
            except OSError:
                continue
    return total


def _label(items):
    if len(items) == 1:
        return util.safe_name(os.path.basename(items[0].rstrip("\\/")) or DEFAULT_LABEL, 60)
    return "%s-%d项" % (DEFAULT_LABEL, len(items))


def _report(job, done, total, name):
    if not job:
        return
    pct = 0 if total <= 0 else int(done * 100 / total)
    job.up(progress=max(0, min(99, pct)), message="正在压缩：%s" % util.safe_name(name, 48))


def build(paths, job=None, level=DEFAULT_LEVEL, out_dir="", label=""):
    items = _entries(paths)
    if not items:
        raise RuntimeError("没有可打包的文件或文件夹")
    base = _base(items)
    total = sum(_size(p) for p in items)
    out_dir = out_dir or util.path("tmp", "share")
    os.makedirs(out_dir, exist_ok=True)
    # 清掉上一次遗留的临时包（超过 1 天）
    now = time.time()
    try:
        for fn in os.listdir(out_dir):
            q = os.path.join(out_dir, fn)
            if os.path.isfile(q) and now - os.path.getmtime(q) > 86400:
                os.remove(q)
    except OSError:
        pass

    stamp = time.strftime("%Y%m%d-%H%M%S")
    prefix = util.safe_name(label, 60) if label else ""
    if not prefix or prefix == "file":
        prefix = _label(items)

    def fname(eng):
        return "%s-%s%s" % (prefix, stamp, ".zip" if eng == "zip" else ".tar.zst")

    if _zstd is not None:
        mode = "zstd"
    elif _tar_exe():
        mode = "zstd-cli"
    else:
        mode = "zip"
    name = fname(mode)
    dst = os.path.join(out_dir, name)
    done = [0]

    def arc(p):
        try:
            rel = os.path.relpath(p, base)
        except ValueError:
            rel = os.path.basename(p)
        return rel.replace("\\", "/")

    if mode == "zstd":
        _tar_zstd(dst, items, base, arc, level, job, total, done)
    elif mode == "zstd-cli":
        try:
            _tar_cli(dst, items, base, arc, level, job, total, done)
        except Exception as exc:  # 外部命令失败时退回 zip，别让分享功能整个挂掉
            util.log("pack: bsdtar 失败，回退 zip (%s)" % exc)
            try:
                os.remove(dst)
            except OSError:
                pass
            mode = "zip"
            name = fname(mode)
            dst = os.path.join(out_dir, name)
            done[0] = 0
            _zip(dst, items, base, arc, job, total, done)
    else:
        _zip(dst, items, base, arc, job, total, done)

    return {"path": dst, "name": name, "engine": engine(),
            "level": level if mode != "zip" else 9,
            "size": os.path.getsize(dst) if os.path.exists(dst) else 0,
            "bytes_in": total, "items": len(items), "root": base}


def _tar_zstd(dst, items, base, arc, level, job, total, done):
    fh = open(dst, "wb")
    zw = _zstd.ZstdCompressor(level=max(1, min(19, int(level))),
                              threads=int(os.cpu_count() or 1) + 1).stream_writer(fh, closefd=False)
    try:
        with tarfile.open(fileobj=zw, mode="w|") as tf:
            for p in items:
                _report(job, done[0], total, os.path.basename(p.rstrip("\\/")))
                if os.path.isdir(p):
                    for root, _dirs, files in os.walk(p):
                        for fn in files:
                            q = os.path.join(root, fn)
                            try:
                                tf.add(q, arcname=arc(p) + "/" + os.path.relpath(q, p).replace("\\", "/"),
                                       recursive=False)
                            except OSError:
                                continue
                            try:
                                done[0] += os.path.getsize(q)
                            except OSError:
                                pass
                            _report(job, done[0], total, fn)
                    # 空目录也保留
                    if not os.listdir(p):
                        try:
                            tf.add(p, arcname=arc(p), recursive=False)
                        except OSError:
                            pass
                else:
                    try:
                        tf.add(p, arcname=arc(p), recursive=False)
                    except OSError:
                        continue
                    try:
                        done[0] += os.path.getsize(p)
                    except OSError:
                        pass
    finally:
        try:
            zw.close()
        except Exception:
            pass
        try:
            fh.close()
        except Exception:
            pass


def _tar_cli(dst, items, base, arc, level, job, total, done):
    """用系统 bsdtar 直接产出 .tar.zst（libzstd 内置，零额外依赖）。

    bsdtar 拿不到逐文件的进度，所以只在开始/结束时更新任务状态；
    文件列表通过 stdin 传入，避开 Windows 命令行长度上限。
    """
    exe = _tar_exe()
    if not exe:
        raise RuntimeError("找不到支持 zstd 的 tar.exe")
    lvl = max(1, min(19, int(level)))
    names = [arc(p) for p in items if arc(p)]
    if not names:
        raise RuntimeError("没有可打包的内容")
    _report(job, 0, total, names[0])
    if job:
        job.up(progress=2, message="正在用 zstd 打包 %d 项…" % len(items))
    cmd = [exe, "--zstd", "--options", "zstd:compression-level=%d" % lvl,
           "-cf", dst, "-C", base]
    payload = None
    # 路径直接走命令行最可靠（Windows 用 UTF-16 传参）；太长时才退到 -T 列表，
    # 列表由 bsdtar 按 ANSI 代码页解析，因此要用系统首选编码写出。
    if sum(len(n) + 3 for n in names) < 30000:
        cmd += names
    else:
        enc = locale.getpreferredencoding(False) or "utf-8"
        try:
            payload = ("\n".join(names) + "\n").encode(enc)
        except UnicodeEncodeError:
            raise RuntimeError("文件数量过多，且部分文件名含系统编码不支持的字符")
        cmd += ["-T", "-"]
    r = subprocess.run(cmd, input=payload, capture_output=True)
    if r.returncode != 0:
        msg = (r.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError("tar 退出码 %s：%s" % (r.returncode, msg[:300] or "未知错误"))
    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        raise RuntimeError("tar 没有产出压缩包")
    done[0] = total
    _report(job, total, total, "")


def _zip(dst, items, base, arc, job, total, done):
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in items:
            _report(job, done[0], total, os.path.basename(p.rstrip("\\/")))
            if os.path.isdir(p):
                for root, _dirs, files in os.walk(p):
                    for fn in files:
                        q = os.path.join(root, fn)
                        try:
                            zf.write(q, arc(p) + "/" + os.path.relpath(q, p).replace("\\", "/"))
                        except OSError:
                            continue
                        try:
                            done[0] += os.path.getsize(q)
                        except OSError:
                            pass
                        _report(job, done[0], total, fn)
                if not os.listdir(p):
                    try:
                        zf.writestr(arc(p) + "/", b"")
                    except Exception:
                        pass
            else:
                try:
                    zf.write(p, arc(p))
                except OSError:
                    continue
                try:
                    done[0] += os.path.getsize(p)
                except OSError:
                    pass


def purge(out_dir="", days=1):
    """清掉临时分享包，返回释放的字节数。"""
    out_dir = out_dir or util.path("tmp", "share")
    cutoff = time.time() - max(0, int(days)) * 86400
    freed = 0
    if not os.path.isdir(out_dir):
        return 0
    for root, _dirs, files in os.walk(out_dir):
        for fn in files:
            q = os.path.join(root, fn)
            try:
                if os.path.getmtime(q) >= cutoff:
                    continue
                freed += os.path.getsize(q)
                os.remove(q)
            except OSError:
                continue
    try:
        if not os.listdir(out_dir):
            shutil.rmtree(out_dir, ignore_errors=True)
    except OSError:
        pass
    return freed
