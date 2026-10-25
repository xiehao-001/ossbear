import base64
import ctypes
import json
import os
import platform
import secrets
import subprocess
import sys
import threading
import time

from . import VERSION

APP = "StorageBear"
_lock = threading.Lock()


def home():
    env = os.environ.get("SB_HOME")
    if env:
        p = os.path.abspath(env)
    elif os.name == "nt":
        p = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), APP)
    elif sys.platform == "darwin":
        p = os.path.expanduser("~/Library/Application Support/" + APP)
    else:
        p = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "storagebear")
    os.makedirs(p, exist_ok=True)
    return p


def path(*parts):
    return os.path.join(home(), *parts)


def ensure():
    for p in (home(), path("cache"), path("logs"), path("tmp")):
        os.makedirs(p, exist_ok=True)


def now():
    return int(time.time())


def log(msg):
    line = time.strftime("%Y-%m-%d %H:%M:%S") + " " + str(msg) + "\n"
    try:
        if sys.stderr:
            sys.stderr.write(line)
            sys.stderr.flush()
    except Exception:
        pass
    try:
        with _lock:
            f = path("logs", "agent.log")
            if os.path.exists(f) and os.path.getsize(f) > 2 * 1024 * 1024:
                try:
                    os.replace(f, f + ".1")
                except OSError:
                    pass
            with open(f, "a", encoding="utf-8") as fp:
                fp.write(line)
    except Exception:
        pass


def load_json(p, default):
    try:
        with open(p, "r", encoding="utf-8") as f:
            x = json.load(f)
            return x if isinstance(x, dict) else default
    except Exception:
        return default


def save_json(p, data, private=True):
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if private:
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
    os.replace(tmp, p)


def config():
    return load_json(path("config.json"), {})


def setcfg(d):
    c = config()
    c.update(d)
    save_json(path("config.json"), c)
    return c


def env(name, default=""):
    v = os.environ.get(name)
    return v if v else default


def ua():
    return "%s-Agent/%s (%s; Python %s)" % (APP, VERSION, platform.system(), platform.python_version())


def native(p):
    p = os.path.abspath(os.path.expanduser(str(p)))
    return os.path.normpath(p)


def pkey(p):
    p = native(p)
    return p.lower() if os.name == "nt" else p


def ext(p):
    return os.path.splitext(p)[1].lower()


def kind(e):
    e = e.lower()
    if e == ".pdf":
        return "pdf"
    if e in (".mp3", ".m4a", ".wav", ".flac", ".aac", ".ogg", ".wma"):
        return "audio"
    if e in (".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm"):
        return "video"
    if e in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"):
        return "image"
    if e in (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".json", ".csv"):
        return "doc"
    return "other"


def fmt_size(n):
    n = float(n or 0)
    for u in ("B", "KB", "MB", "GB", "TB", "PB"):
        if n < 1024 or u == "PB":
            return ("%.1f %s" % (n, u)) if u != "B" else ("%d B" % n)
        n /= 1024


def openpath(p):
    if os.name == "nt":
        os.startfile(p)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", p])
    else:
        subprocess.Popen(["xdg-open", p], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _text(raw):
    for enc in ("utf-8", "gbk", "mbcs"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            pass
    return raw.decode("utf-8", "replace")


def popen(args, wait=True, timeout=60):
    kw = {}
    if os.name == "nt":
        kw["creationflags"] = 0x08000000
    if wait:
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, **kw)
        return p.returncode, _text(p.stdout), _text(p.stderr)
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)


def drives():
    out = []
    if os.name == "nt":
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
            if mask & (1 << i):
                root = c + ":\\"
                try:
                    if ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(root)) in (2, 3):
                        out.append(root)
                except Exception:
                    out.append(root)
    else:
        out.append(os.path.expanduser("~"))
    return out


def free_drive():
    if os.name != "nt":
        return ""
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    for c in "ZYXWVUTSRQPONMLKJIHG":
        if not (mask & (1 << (ord(c) - 65))):
            return c + ":"
    return ""


def dpapi(data, protect=True):
    if os.name != "nt":
        return None
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]
    buf = ctypes.create_string_buffer(data, len(data))
    src = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    dst = Blob()
    fn = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    desc = ctypes.c_wchar_p(APP) if protect else None
    if not fn(ctypes.byref(src), desc, None, None, None, 1, ctypes.byref(dst)):
        raise OSError("DPAPI failed")
    try:
        return ctypes.string_at(dst.pbData, dst.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(dst.pbData)


def protect(text):
    if not text:
        return ""
    raw = text.encode("utf-8")
    try:
        enc = dpapi(raw, True)
        if enc is not None:
            return "dpapi:" + base64.b64encode(enc).decode("ascii")
    except Exception as e:
        log("DPAPI encrypt failed: %s" % e)
    return "b64:" + base64.b64encode(raw).decode("ascii")


def unprotect(text):
    if not text:
        return ""
    try:
        if text.startswith("dpapi:"):
            raw = dpapi(base64.b64decode(text[6:]), False)
            return raw.decode("utf-8") if raw else ""
        if text.startswith("b64:"):
            return base64.b64decode(text[4:]).decode("utf-8")
    except Exception as e:
        log("secret decrypt failed: %s" % e)
    return ""


def password(n=18):
    a = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(a) for _ in range(n))


def safe_name(name, limit=100):
    s = "".join(c for c in str(name) if c not in '\\/:*?"<>|\r\n\t').strip().strip(".")
    return (s or "file")[:limit]


def is_http(url):
    return url.startswith("http://") or url.startswith("https://")


def roots_from_cfg(c):
    roots = c.get("roots")
    if not isinstance(roots, list):
        roots = []
    out = []
    seen = set()
    for r in roots:
        if isinstance(r, str):
            p, label = r, ""
        elif isinstance(r, dict):
            p, label = r.get("path", ""), r.get("label", "")
        else:
            continue
        if not p:
            continue
        p = native(p)
        if p in seen or not os.path.isdir(p):
            continue
        seen.add(p)
        out.append({"path": p, "label": label or os.path.basename(p) or p})
    return out
