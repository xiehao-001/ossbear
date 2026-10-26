import base64
import hmac
import http.server
import json
import os
import re
import secrets
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from email.utils import formatdate
from urllib.parse import quote, unquote, urlsplit
from xml.sax.saxutils import escape

from . import ops, util

DAV = "/dav"
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _q(p):
    return '"%s"' % str(p).replace('"', "")


def _repair_dir():
    base = os.environ.get("PUBLIC") or r"C:\Users\Public"
    d = os.path.join(base, "StorageBear", "Repair")
    try:
        os.makedirs(d, exist_ok=True)
        try:
            util.popen(["icacls", d, "/grant", "*S-1-5-32-544:(OI)(CI)M"], timeout=15)
        except Exception:
            pass
        probe = os.path.join(d, ".w")
        with open(probe, "w", encoding="utf-8") as f:
            f.write("1")
        os.remove(probe)
        return d
    except OSError:
        d = util.path("tmp")
        os.makedirs(d, exist_ok=True)
        return d


def _tail(path, n=800):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - n * 2))
            raw = f.read()
        return raw.decode("utf-8", "replace").strip()[-n:]
    except OSError:
        return ""


def _svc_state(sc, name="WebClient"):
    try:
        _, o, e = util.popen([sc, "query", name], timeout=15)
    except Exception:
        return ""
    t = (o + e).upper()
    for s in ("RUNNING", "STOPPED", "START_PENDING", "STOP_PENDING", "PAUSED"):
        if s in t:
            return s
    return ""


def _win_verify():
    root = os.environ.get("SystemRoot") or r"C:\Windows"
    sc = os.path.join(root, "System32", "sc.exe")
    rg = os.path.join(root, "System32", "reg.exe")
    v = {"service": "", "start": "", "basic": 0, "ok": False}
    v["service"] = _svc_state(sc) or "UNKNOWN"
    try:
        _, o, e = util.popen([sc, "qc", "WebClient"], timeout=15)
        t = (o + e).upper()
        for k in ("AUTO_START", "DEMAND_START", "DISABLED", "SYSTEM_START", "BOOT_START"):
            if k in t:
                v["start"] = k
                break
    except Exception:
        pass
    try:
        _, o, e = util.popen([rg, "query",
                              r"HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters",
                              "/v", "BasicAuthLevel"], timeout=15)
        m = re.search(r"REG_DWORD\s+0x([0-9a-fA-F]+)", o)
        if m:
            v["basic"] = int(m.group(1), 16)
    except Exception:
        pass
    v["ok"] = v["service"] == "RUNNING" and v["start"] == "AUTO_START" and v["basic"] == 2
    return v


def _elevate(exe, params, cwd, timeout=240):
    import ctypes
    from ctypes import wintypes

    class SEI(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("fMask", ctypes.c_ulong),
            ("hwnd", wintypes.HWND),
            ("lpVerb", wintypes.LPCWSTR),
            ("lpFile", wintypes.LPCWSTR),
            ("lpParameters", wintypes.LPCWSTR),
            ("lpDirectory", wintypes.LPCWSTR),
            ("nShow", ctypes.c_int),
            ("hInstApp", wintypes.HINSTANCE),
            ("lpIDList", ctypes.c_void_p),
            ("lpClass", wintypes.LPCWSTR),
            ("hkeyClass", wintypes.HKEY),
            ("dwHotKey", wintypes.DWORD),
            ("hIcon", wintypes.HANDLE),
            ("hProcess", wintypes.HANDLE),
        ]

    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    ole32 = ctypes.WinDLL("ole32")
    shell32.ShellExecuteExW.argtypes = [ctypes.POINTER(SEI)]
    shell32.ShellExecuteExW.restype = wintypes.BOOL
    k32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    k32.WaitForSingleObject.restype = wintypes.DWORD
    k32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    k32.GetExitCodeProcess.restype = wintypes.BOOL
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    k32.CloseHandle.restype = wintypes.BOOL
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    ole32.CoInitializeEx.restype = ctypes.c_long
    ole32.CoUninitialize.argtypes = []
    ole32.CoUninitialize.restype = None
    co = False
    h = None
    try:
        try:
            hr = ole32.CoInitializeEx(None, 2)
            co = hr in (0, 1)
        except Exception:
            pass
        sei = SEI()
        sei.cbSize = ctypes.sizeof(SEI)
        sei.fMask = 0x40 | 0x400
        sei.lpVerb = "runas"
        sei.lpFile = exe
        sei.lpParameters = params
        sei.lpDirectory = cwd
        sei.nShow = 0
        ctypes.set_last_error(0)
        if not shell32.ShellExecuteExW(ctypes.byref(sei)):
            return -int(ctypes.get_last_error() or 1), ""
        h = sei.hProcess
        if not h:
            return -999, ""
        w = int(k32.WaitForSingleObject(wintypes.HANDLE(h), int(timeout * 1000)))
        if w == 258:
            return -998, ""
        if w == 0xFFFFFFFF:
            return -997, ""
        code = wintypes.DWORD(0)
        if not k32.GetExitCodeProcess(wintypes.HANDLE(h), ctypes.byref(code)):
            return -997, ""
        return int(code.value), ""
    finally:
        if h:
            try:
                k32.CloseHandle(wintypes.HANDLE(h))
            except Exception:
                pass
        if co:
            try:
                ole32.CoUninitialize()
            except Exception:
                pass


def _repair_msg(res, v, logf, code):
    errs = (res or {}).get("errors") or []
    if isinstance(errs, str):
        errs = [errs]
    errs = [str(x) for x in errs if str(x).strip()]
    msg = "；".join(errs) if errs else "WebClient 服务没有进入运行状态"
    state = []
    if res:
        if res.get("service"):
            state.append("服务 " + str(res.get("service")))
        if res.get("start"):
            state.append("启动类型 " + str(res.get("start")))
        if res.get("basic"):
            state.append("BasicAuthLevel " + str(res.get("basic")))
    elif v:
        state.append("服务 " + str(v.get("service") or "未知"))
        state.append("启动类型 " + str(v.get("start") or "未知"))
        state.append("BasicAuthLevel " + str(v.get("basic") or 0))
    if state:
        msg += "\n现场状态：" + " / ".join(state)
    if code and int(code) > 0:
        msg += "\n修复进程退出码：" + str(int(code))
    tail = _tail(logf, 700)
    if tail:
        msg += "\n最近日志：\n" + tail
    return msg


def repair_child(directory="", out=""):
    if os.name != "nt":
        return 2
    d = directory or _repair_dir()
    try:
        os.makedirs(d, exist_ok=True)
    except OSError:
        pass
    out = out or os.path.join(d, "repair-webdav.json")
    logf = os.path.join(d, "repair-webdav.log")
    res = {"ok": False, "feature": "", "service": "", "start": "", "basic": 0,
           "mrxdav": "", "restart": False, "errors": []}

    def add(s):
        try:
            with open(logf, "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + str(s) + "\n")
        except OSError:
            pass

    def err(s):
        res["errors"].append(str(s))
        add("error: " + str(s))

    root = os.environ.get("SystemRoot") or r"C:\Windows"
    dism = os.path.join(root, "System32", "dism.exe")
    rg = os.path.join(root, "System32", "reg.exe")
    sc = os.path.join(root, "System32", "sc.exe")
    key = r"HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters"
    add("repair begin dir=%s" % d)
    try:
        code, o, e = util.popen([dism, "/Online", "/Enable-Feature",
                                 "/FeatureName:FS-WebDAV-Redirector", "/All", "/NoRestart"], timeout=240)
        txt = (o + "\n" + e).strip()
        add("dism exit=%s %s" % (code, txt[-700:]))
        if code == 0:
            res["feature"] = "Enabled"
        elif code == 3010:
            res["feature"] = "EnablePending"
            res["restart"] = True
        else:
            err("启用 WebDAV 组件失败（DISM 退出码 %s）" % code)
    except Exception as ex:
        err("启用 WebDAV 组件失败：%s" % ex)

    for name, val in (("BasicAuthLevel", "2"), ("FileSizeLimitInBytes", "4294967295")):
        try:
            code, o, e = util.popen([rg, "add", key, "/v", name, "/t", "REG_DWORD", "/d", val, "/f"], timeout=30)
            if code != 0:
                err("写入 %s 失败（退出码 %s）" % (name, code))
        except Exception as ex:
            err("写入 %s 失败：%s" % (name, ex))
    try:
        _, o, e = util.popen([rg, "query", key, "/v", "BasicAuthLevel"], timeout=15)
        m = re.search(r"REG_DWORD\s+0x([0-9a-fA-F]+)", o)
        res["basic"] = int(m.group(1), 16) if m else 0
    except Exception:
        pass
    add("basic auth level=%s" % res["basic"])

    try:
        code, o, e = util.popen([sc, "config", "WebClient", "start=", "auto"], timeout=30)
        add("sc config exit=%s %s" % (code, (o + e).strip()[:200]))
    except Exception as ex:
        err("设置 WebClient 自动启动失败：%s" % ex)
    try:
        util.popen([sc, "stop", "WebClient"], timeout=30)
    except Exception:
        pass
    for _ in range(20):
        if _svc_state(sc) in ("STOPPED", ""):
            break
        time.sleep(0.5)
    if _svc_state(sc) == "RUNNING":
        res["restart"] = True
        err("WebClient 服务没有停止，注册表设置可能未生效，需要重启电脑")
    for _ in range(3):
        try:
            util.popen([sc, "start", "WebClient"], timeout=45)
        except Exception as ex:
            err("启动 WebClient 失败：%s" % ex)
        for _ in range(16):
            if _svc_state(sc) == "RUNNING":
                break
            time.sleep(0.4)
        if _svc_state(sc) == "RUNNING":
            break
        time.sleep(1)

    res["service"] = _svc_state(sc) or "UNKNOWN"
    if res["service"] != "RUNNING":
        err("WebClient 服务没有运行（%s）" % res["service"])
    try:
        _, o, e = util.popen([sc, "qc", "WebClient"], timeout=15)
        t = (o + e).upper()
        for k in ("AUTO_START", "DEMAND_START", "DISABLED", "SYSTEM_START", "BOOT_START"):
            if k in t:
                res["start"] = k
                break
        if res["start"] != "AUTO_START":
            err("WebClient 启动类型不是自动（%s）" % (res["start"] or "未知"))
    except Exception as ex:
        err("读取 WebClient 启动类型失败：%s" % ex)
    try:
        util.popen([sc, "start", "MRxDAV"], timeout=20)
        res["mrxdav"] = _svc_state(sc, "MRxDAV") or "UNKNOWN"
    except Exception:
        pass

    res["ok"] = (res["service"] == "RUNNING" and res["start"] == "AUTO_START"
                 and res["basic"] == 2)
    if res["service"] != "RUNNING" and res["feature"] == "Enabled":
        res["restart"] = True
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        os.replace(tmp, out)
    except OSError as ex:
        add("write result failed: %s" % ex)
    add("repair end ok=%s restart=%s service=%s start=%s basic=%s errors=%s" %
        (res["ok"], res["restart"], res["service"], res["start"], res["basic"], res["errors"]))
    if res["ok"] and not res["restart"]:
        return 0
    if res["restart"]:
        return 3
    return 2


def _roots(agent):
    cfg = agent.cfg or {}
    raw = []
    for key in ("roots", "last_roots"):
        xs = cfg.get(key)
        if isinstance(xs, list):
            raw.extend(xs)
    out = {}
    for r in raw:
        if isinstance(r, str):
            p, label = r, ""
        elif isinstance(r, dict):
            p, label = r.get("path", ""), r.get("label", "")
        else:
            continue
        if not p:
            continue
        p = util.native(p)
        if not os.path.isdir(p):
            continue
        if os.name == "nt" and len(p) <= 3 and p[1:2] == ":":
            base = p[0].upper() + "盘"
        else:
            base = util.safe_name(label or os.path.basename(p) or p[0:1], 40)
        name = base
        n = 2
        while name in out:
            name = "%s (%d)" % (base, n)
            n += 1
        out[name] = p
    if not out:
        home = os.path.expanduser("~")
        if os.path.isdir(home):
            out["我的文件"] = util.native(home)
    return out


def _date(t):
    return formatdate(int(t or 0), usegmt=True)


def _attr(v):
    return escape(str(v or ""), {'"': "&quot;"})


def _neterr(out, err, code):
    text = (err or out or "").strip()
    low = text.lower()
    hit = re.search(r"(?:system error|系统错误)\s*[:：]?\s*(\d+)", text, re.I)
    hints = {
        67: "Windows 的 WebClient 服务未运行，或系统没有启用 WebDAV 客户端。点「一键修复并重试」，按提示允许一次管理员授权即可。",
        85: "盘符已被占用，请在「虚拟磁盘」页换一个盘符，或先卸载原来的网络盘。",
        1219: "该盘符已被其他账号连接。请先断开原有连接，再回到存储熊挂载。",
        1244: "当前登录账号无权映射网络驱动器。请用管理员账号安装并启动存储熊。",
    }
    if hit:
        n = int(hit.group(1))
        if n in hints:
            return hints[n]
        return "Windows 返回错误 %d：%s" % (n, text)
    if "net use" in low:
        return "Windows 拒绝了挂载参数，请重新选择盘符后再试。"
    return text or "挂载失败（%s）" % code


class Drive:
    def __init__(self, agent):
        self.agent = agent
        self.srv = None
        self.th = None
        self.port = 0
        self.lk = threading.Lock()

    def _conf(self):
        c = util.config()
        return {
            "user": c.get("drive_user") or "",
            "pass": c.get("drive_pass") or "",
            "port": int(c.get("drive_port") or 0),
            "letter": c.get("drive_letter") or "",
            "auto": bool(c.get("drive_auto", False)),
        }

    def start(self):
        with self.lk:
            if self.srv:
                return self.info()
            c = util.config()
            if not c.get("drive_user") or not c.get("drive_pass"):
                c["drive_user"] = "storagebear"
                c["drive_pass"] = util.password(20)
                util.save_json(util.path("config.json"), c)
            user, pw = c["drive_user"], c["drive_pass"]
            port = int(c.get("drive_port") or 0)
            agent = self.agent
            handler = _handler(agent, user, pw)
            try:
                self.srv = _Server(("127.0.0.1", port), handler)
            except OSError:
                self.srv = _Server(("127.0.0.1", 0), handler)
            self.port = self.srv.server_address[1]
            if int(c.get("drive_port") or 0) != self.port:
                c["drive_port"] = self.port
                util.save_json(util.path("config.json"), c)
            self.th = threading.Thread(target=self.srv.serve_forever, name="sb-dav", daemon=True)
            self.th.start()
            util.log("dav: http://127.0.0.1:%d%s" % (self.port, DAV))
            if c.get("drive_auto") and os.name == "nt":
                try:
                    self.mount()
                except Exception as e:
                    util.log("auto mount: %s" % e)
            self.agent.cfg = c
            return self.info()

    def stop(self):
        with self.lk:
            srv, self.srv, self.th = self.srv, None, None
        if srv:
            try:
                srv.shutdown()
                srv.server_close()
            except Exception:
                pass
        self.port = 0
        return self.info()

    def url(self):
        return "http://127.0.0.1:%d%s/" % (self.port, DAV) if self.port else ""

    def _letter(self, val=None):
        raw = self._conf().get("letter") if val is None else val
        letter = str(raw or (util.free_drive() if val is None else "") or "").strip().upper()
        for ch in letter:
            if "A" <= ch <= "Z":
                return ch
        return ""

    def _webclient(self):
        if os.name != "nt":
            return False
        try:
            util.popen(["sc", "start", "MRxDAV"], timeout=20)
            util.popen(["net", "start", "WebClient"], timeout=30)
            for _ in range(15):
                _, out, err = util.popen(["sc", "query", "WebClient"], timeout=15)
                if "RUNNING" in (out + err).upper():
                    time.sleep(1.2)
                    return True
                time.sleep(0.4)
        except Exception:
            pass
        return False

    def _unmap(self, letter):
        try:
            util.popen(["net", "use", letter + ":", "/delete", "/y"], timeout=30)
        except Exception:
            pass

    def _clean(self):
        if os.name != "nt":
            return
        try:
            _, out, err = util.popen(["net", "use"], timeout=20)
        except Exception:
            return
        port = ":%d" % int(self.port or 0)
        for line in (out + "\n" + err).splitlines():
            low = line.lower()
            if "127.0.0.1" not in low:
                continue
            if port not in low and "dav" not in low:
                continue
            m = re.search(r"\b([A-Za-z]):\s", line)
            if m:
                util.log("dav: cleanup stale %s: %s" % (m.group(1).upper(), line.strip()[:160]))
                self._unmap(m.group(1).upper())

    def repair(self):
        if os.name != "nt":
            raise RuntimeError("一键修复仅支持 Windows")
        d = _repair_dir()
        logf = os.path.join(d, "repair-webdav.log")
        result = os.path.join(d, "repair-%s.json" % secrets.token_hex(6))
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            pass
        try:
            with open(logf, "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + "parent: repair requested\n")
        except OSError:
            pass
        exe = sys.executable
        if getattr(sys, "frozen", False):
            params = "--repair-webdav --repair-dir %s --repair-out %s" % (_q(d), _q(result))
            cwd = os.path.dirname(exe)
        else:
            params = "-m storagebear --repair-webdav --repair-dir %s --repair-out %s" % (_q(d), _q(result))
            cwd = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        code, _ = _elevate(exe, params, cwd, 420)
        res = None
        try:
            with open(result, "r", encoding="utf-8-sig") as f:
                x = json.load(f)
            res = x if isinstance(x, dict) else None
        except Exception:
            res = None
        try:
            os.remove(result)
        except OSError:
            pass
        try:
            shutil.copyfile(logf, util.path("logs", "repair-webdav.log"))
        except (OSError, shutil.Error):
            pass
        v = _win_verify()
        if code == -1223:
            raise RuntimeError("已取消管理员授权。修复需要一次管理员权限，请重试并在系统弹窗中选择“是”。")
        if code == -5:
            raise RuntimeError("系统拒绝了管理员授权。请确认当前账号可以提升权限，或联系电脑管理员。")
        if code == -2:
            raise RuntimeError("找不到修复程序。请重新安装存储熊后再试。")
        if code == -998:
            raise RuntimeError("修复等待超时（7 分钟）。请检查任务栏是否有待处理的管理员授权窗口，处理后重试。")
        if code < 0 and code not in (-999, -998):
            raise RuntimeError("无法启动管理员修复进程（错误 %d）。请重启电脑后重试。" % abs(code))
        if res is None:
            if code == 3:
                raise RuntimeError("WebDAV 组件已启用，但 Windows 需要重启后才会生效。请重启电脑，"
                                   "再打开存储熊点击“挂载为网络盘”")
            if v["ok"]:
                util.log("repair-webdav: verified without result")
                return {"repaired": True, "restart": False, "service": v["service"],
                        "feature": "", "basic": v["basic"]}
            raise RuntimeError("自动修复没有完成。\n" + _repair_msg(None, v, logf, code))
        errs = res.get("errors") or []
        if isinstance(errs, str):
            errs = [errs]
        errs = [str(x) for x in errs if str(x).strip()]
        util.log("repair-webdav: ok=%s service=%s start=%s feature=%s basic=%s errors=%s" %
                 (res.get("ok"), res.get("service"), res.get("start"), res.get("feature"),
                  res.get("basic"), errs))
        if res.get("ok"):
            return {"repaired": True, "restart": bool(res.get("restart")),
                    "service": res.get("service") or "", "feature": res.get("feature") or "",
                    "basic": int(res.get("basic") or 0)}
        if v["ok"]:
            return {"repaired": True, "restart": bool(res.get("restart")),
                    "service": v["service"], "feature": res.get("feature") or "",
                    "basic": v["basic"]}
        if res.get("restart") or res.get("feature") == "EnablePending":
            raise RuntimeError("WebDAV 组件已启用，但 Windows 需要重启后才会生效。请重启电脑，"
                               "再打开存储熊点击“挂载为网络盘”")
        raise RuntimeError("修复没有完全成功。\n" + _repair_msg(res, v, logf, code))

    def mounted(self):
        if os.name != "nt":
            return False
        letter = self._letter()
        if not letter:
            return False
        try:
            import ctypes
            return ctypes.windll.kernel32.GetDriveTypeW(ctypes.c_wchar_p(letter + ":\\")) == 4
        except Exception:
            return False

    def info(self):
        c = self._conf()
        return {
            "running": bool(self.srv), "url": self.url(), "user": c["user"], "pass": c["pass"],
            "port": self.port or c["port"], "letter": c["letter"], "mounted": self.mounted(),
            "auto": c["auto"],
        }

    def _need(self):
        if not self.srv:
            self.start()
        return self.info()

    def mount(self):
        info = self._need()
        if os.name != "nt":
            return {"manual": True, "url": info["url"], "user": info["user"],
                    "pass": info["pass"],
                    "hint": "macOS 可在 Finder「连接服务器」输入该地址；Linux 可用 gio mount dav://…"}
        letters = []
        for l in (self._letter(), self._letter(util.free_drive())):
            if l and l not in letters:
                letters.append(l)
        if not letters:
            raise RuntimeError("没有可用的盘符，请在「虚拟磁盘」页指定一个未被占用的盘符")
        dests = [info["url"], "\\\\127.0.0.1@%d\\%s" % (self.port, DAV.strip("/"))]
        errs = []
        for attempt in range(4):
            ready = self._webclient()
            if not ready:
                errs.append("WebClient 服务没有进入运行状态。请点「一键修复 WebDAV」后重试。")
            self._clean()
            for letter in letters:
                self._unmap(letter)
                for dest in dests:
                    code, out, err = util.popen(
                        ["net", "use", letter + ":", dest, info["pass"], "/user:" + info["user"], "/persistent:no"],
                        timeout=60)
                    if code == 0:
                        c = util.config()
                        c["drive_letter"] = letter + ":"
                        util.save_json(util.path("config.json"), c)
                        self.agent.cfg = c
                        util.log("dav: mounted %s -> %s" % (letter + ":", dest))
                        return self.info()
                    msg = _neterr(out, err, code)
                    errs.append(msg)
                    util.log("dav: mount attempt %d %s %s -> %s" % (attempt + 1, letter + ":", dest, msg.replace("\n", " ")[:300]))
                    self._unmap(letter)
            if attempt < 3:
                time.sleep(2.5)
        raise RuntimeError("\n\n".join(x for i, x in enumerate(errs) if x and x not in errs[:i]))

    def unmount(self):
        if os.name != "nt":
            return self.info()
        letter = self._letter()
        if letter:
            self._unmap(letter)
        return self.info()


def _handler(agent, user, pw):
    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "StorageBearDAV/0.1"

        def log_message(self, fmt, *args):
            pass

        def _auth(self):
            got = self.headers.get("Authorization", "")
            if not got.startswith("Basic "):
                return False
            try:
                u, p = base64.b64decode(got[6:]).decode("utf-8").split(":", 1)
            except Exception:
                return False
            return hmac.compare_digest(u, user) and hmac.compare_digest(p, pw)

        def _send(self, code, body=b"", ctype="text/plain; charset=utf-8", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("DAV", "1, 2")
            self.send_header("MS-Author-Via", "DAV")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body and self.command != "HEAD":
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def _deny(self):
            self.close_connection = True
            self._send(401, b"StorageBear", extra={"WWW-Authenticate": 'Basic realm="StorageBear"', "Connection": "close"})

        def _drain(self):
            try:
                n = int(self.headers.get("Content-Length") or 0)
                if 0 < n <= 1024 * 1024:
                    self.rfile.read(n)
            except Exception:
                pass

        def _parts(self):
            u = urlsplit(self.path)
            path = unquote(u.path)
            if not path.startswith(DAV):
                return None
            rest = path[len(DAV):].strip("/")
            if not rest:
                return []
            parts = rest.split("/")
            for p in parts:
                if not p or p in (".", "..") or "/" in p or "\\" in p or "\x00" in p:
                    return None
            return parts

        def _at(self, parts):
            roots = _roots(agent)
            if not parts:
                return None, "root", None
            alias = parts[0]
            root = roots.get(alias)
            if not root:
                return None, "missing", None
            p = util.native(os.path.join(root, *parts[1:])) if len(parts) > 1 else util.native(root)
            if os.name == "nt":
                if util.pkey(p) != util.pkey(root) and not util.pkey(p).startswith(
                        util.pkey(root).rstrip("\\/") + "\\"):
                    return None, "missing", None
            else:
                if p != root and not p.startswith(root.rstrip("/") + "/"):
                    return None, "missing", None
            if len(parts) == 1:
                return {"path": p, "name": alias, "is_dir": 1, "size": 0,
                        "mtime": int(os.path.getmtime(p)) if os.path.isdir(p) else 0,
                        "kind": "dir"}, "dir", root
            r = agent.db.file(p)
            if r:
                return r, "dir" if r["is_dir"] else "file", root
            if os.path.isdir(p):
                return {"path": p, "name": parts[-1], "is_dir": 1, "size": 0,
                        "mtime": int(os.path.getmtime(p)), "kind": "dir"}, "dir", root
            return None, "missing", None

        def _href(self, parts, is_dir):
            h = DAV + "/" + "/".join(quote(x, safe="") for x in parts)
            if not parts:
                h = DAV + "/"
            if is_dir and not h.endswith("/"):
                h += "/"
            return h

        def _prop(self, parts, row, kind):
            href = self._href(parts, kind == "dir")
            name = parts[-1] if parts else ""
            if kind == "dir":
                body = ['<D:response><D:href>%s</D:href><D:propstat><D:prop>' % escape(href),
                        '<D:displayname>%s</D:displayname><D:resourcetype><D:collection/></D:resourcetype>' %
                        _attr(name),
                        '<D:getlastmodified>%s</D:getlastmodified>' % _date(row.get("mtime"))]
                body.append('</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>')
                return "".join(body)
            mtime = int(row.get("mtime") or 0)
            size = int(row.get("size") or 0)
            p = row.get("path") or ""
            if os.path.isfile(p):
                size = os.path.getsize(p)
                mtime = int(os.path.getmtime(p))
            ctype = ops._mime(p)
            etag = '"%x-%x"' % (size, mtime)
            return ('<D:response><D:href>%s</D:href><D:propstat><D:prop>'
                    '<D:displayname>%s</D:displayname><D:resourcetype/>'
                    '<D:getcontentlength>%d</D:getcontentlength>'
                    '<D:getlastmodified>%s</D:getlastmodified>'
                    '<D:getetag>%s</D:getetag><D:getcontenttype>%s</D:getcontenttype>'
                    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
                    % (escape(href), _attr(name), size, _date(mtime), etag, _attr(ctype)))

        def do_OPTIONS(self):
            self._drain()
            if not self._auth():
                return self._deny()
            self._send(200, b"", extra={"Allow": "OPTIONS, GET, HEAD, PROPFIND"})

        def do_PROPFIND(self):
            self._drain()
            if not self._auth():
                return self._deny()
            parts = self._parts()
            if parts is None:
                return self._send(404)
            row, kind, _ = self._at(parts)
            if kind == "missing":
                return self._send(404)
            depth = (self.headers.get("Depth") or "1").lower()
            xml = ['<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">']
            if kind == "root":
                if depth != "0":
                    for alias in _roots(agent):
                        r = {"path": "", "mtime": 0}
                        xml.append(self._prop([alias], r, "dir"))
                xml.append("</D:multistatus>")
                return self._send(207, "".join(xml).encode("utf-8"), 'application/xml; charset="utf-8"')
            xml.append(self._prop(parts, row, kind))
            if kind == "dir" and depth != "0":
                try:
                    kids = agent.db.kids(row["path"])
                except Exception:
                    kids = []
                for k in kids:
                    if k["is_dir"]:
                        xml.append(self._prop(parts + [k["name"]], k, "dir"))
                    else:
                        xml.append(self._prop(parts + [k["name"]], k, "file"))
            xml.append("</D:multistatus>")
            self._send(207, "".join(xml).encode("utf-8"), 'application/xml; charset="utf-8"')

        def _range(self, size):
            h = self.headers.get("Range") or ""
            m = RANGE.match(h.strip())
            if not m:
                return 0, size - 1, False
            a, b = m.group(1), m.group(2)
            if not a and not b:
                return None
            if not a:
                n = int(b or 0)
                if n <= 0:
                    return None
                a = max(0, size - n)
                b = size - 1
            else:
                a = int(a)
                b = int(b) if b else size - 1
                b = min(b, size - 1)
            if a > b or a >= size:
                return None
            return a, b, True

        def do_HEAD(self):
            self._drain()
            if not self._auth():
                return self._deny()
            parts = self._parts()
            row, kind, _ = self._at(parts) if parts is not None else (None, "missing", None)
            if kind != "file":
                return self._send(405 if kind == "dir" else 404)
            self._head(row)

        def _head(self, row):
            p = row.get("path") or ""
            size = int(row.get("size") or 0)
            mtime = int(row.get("mtime") or 0)
            if os.path.isfile(p):
                st = os.stat(p)
                size, mtime = st.st_size, int(st.st_mtime)
            self.send_response(200)
            self.send_header("Content-Type", ops._mime(p))
            self.send_header("Content-Length", str(size))
            self.send_header("Last-Modified", _date(mtime))
            self.send_header("ETag", '"%x-%x"' % (size, mtime))
            self.send_header("DAV", "1, 2")
            self.end_headers()

        def do_GET(self):
            self._drain()
            if not self._auth():
                return self._deny()
            parts = self._parts()
            row, kind, _ = self._at(parts) if parts is not None else (None, "missing", None)
            if kind != "file":
                return self._send(405 if kind == "dir" else 404)
            p = row.get("path") or ""
            if os.path.isfile(p):
                return self._file(row)
            if row.get("object_key"):
                return self._cloud(row)
            return self._send(404)

        def _file(self, row):
            p = row["path"]
            st = os.stat(p)
            size = st.st_size
            r = self._range(size)
            if r is None:
                return self._send(416, extra={"Content-Range": "bytes */%d" % size})
            a, b, partial = r
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", ops._mime(p))
            self.send_header("Content-Length", str(b - a + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Last-Modified", _date(st.st_mtime))
            self.send_header("ETag", '"%x-%x"' % (size, int(st.st_mtime)))
            if partial:
                self.send_header("Content-Range", "bytes %d-%d/%d" % (a, b, size))
            self.end_headers()
            try:
                with open(p, "rb") as f:
                    f.seek(a)
                    left = b - a + 1
                    while left > 0:
                        chunk = f.read(min(256 * 1024, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, OSError) as e:
                util.log("dav get %s: %s" % (p, e))

        def _cloud(self, row):
            pid = row.get("provider_id") or ""
            try:
                s3 = ops._s3(agent, pid)
                url = s3.presign(row["object_key"], 900)
            except Exception as e:
                return self._send(502, ("云端文件暂不可用：%s" % e).encode("utf-8"))
            rng = self.headers.get("Range")
            req = urllib.request.Request(url, headers={"Range": rng} if rng else {})
            try:
                resp = urllib.request.urlopen(req, timeout=120, context=s3.ctx)
            except urllib.error.HTTPError as e:
                return self._send(e.code if e.code in (403, 404, 416) else 502,
                                  ("云端读取失败 (%s)" % e.code).encode("utf-8"))
            except Exception as e:
                return self._send(502, ("云端连接失败：%s" % e).encode("utf-8"))
            try:
                code = 206 if getattr(resp, "status", 200) == 206 else 200
                length = resp.headers.get("Content-Length") or str(int(row.get("size") or 0))
                self.send_response(code)
                self.send_header("Content-Type", resp.headers.get("Content-Type") or ops._mime(row["path"]))
                self.send_header("Content-Length", length)
                self.send_header("Accept-Ranges", "bytes")
                if resp.headers.get("Content-Range"):
                    self.send_header("Content-Range", resp.headers["Content-Range"])
                self.end_headers()
                while True:
                    b = resp.read(256 * 1024)
                    if not b:
                        break
                    self.wfile.write(b)
            except (BrokenPipeError, ConnectionResetError) as e:
                util.log("dav cloud %s: %s" % (row["path"], e))
            finally:
                try:
                    resp.close()
                except Exception:
                    pass

        def _ro(self):
            self._send(405, b"read-only")

        do_PUT = _ro
        do_DELETE = _ro
        do_MKCOL = _ro
        do_MOVE = _ro
        do_COPY = _ro
        do_PROPPATCH = _ro
        do_LOCK = _ro
        do_UNLOCK = _ro

    return H


try:
    _Base = http.server.ThreadingHTTPServer
except AttributeError:
    class _Base(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
        allow_reuse_address = True


class _Server(_Base):
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except OSError:
            pass
        super().server_bind()

    def handle_error(self, request, client_address):
        util.log("dav error from %s" % (client_address,))
