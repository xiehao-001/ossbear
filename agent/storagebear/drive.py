import base64
import hmac
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import subprocess
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

REPAIR_PS = r"""
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$out = [ordered]@{
  ok = $false
  feature = ''
  service = ''
  start = ''
  basic = 0
  mrxdav = ''
  restart = $false
  errors = @()
}
$log = '__LOG__'
function Add-Log([string]$s) {
  try { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $s) -Encoding UTF8 } catch {}
}
try {
  Add-Log 'repair begin'
  $opt = Get-WindowsOptionalFeature -Online -FeatureName FS-WebDAV-Redirector -ErrorAction SilentlyContinue
  if ($null -eq $opt) {
    $out.errors += '未找到 WebDAV Redirector 组件'
    Add-Log 'feature not found'
  } else {
    $out.feature = [string]$opt.State
    Add-Log ('feature ' + $out.feature)
    if ($opt.State -ne 'Enabled') {
      $r = Enable-WindowsOptionalFeature -Online -FeatureName FS-WebDAV-Redirector -All -NoRestart -ErrorAction SilentlyContinue
      if ($r -and $r.RestartNeeded) { $out.restart = $true }
      $opt = Get-WindowsOptionalFeature -Online -FeatureName FS-WebDAV-Redirector -ErrorAction SilentlyContinue
      if ($opt) { $out.feature = [string]$opt.State }
      Add-Log ('feature now ' + $out.feature)
    }
  }
  $svc = Get-Service -Name WebClient -ErrorAction SilentlyContinue
  if ($null -eq $svc) {
    $out.errors += 'WebClient 服务不存在'
  } else {
    Set-Service -Name WebClient -StartupType Automatic -ErrorAction SilentlyContinue
    $key = 'HKLM:\SYSTEM\CurrentControlSet\Services\WebClient\Parameters'
    $regkey = 'HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters'
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    $reg = Join-Path $env:SystemRoot 'System32\reg.exe'
    & $reg add $regkey /v BasicAuthLevel /t REG_DWORD /d 2 /f | Out-Null
    if ($LASTEXITCODE -ne 0) { $out.errors += '写入 BasicAuthLevel 失败' }
    & $reg add $regkey /v FileSizeLimitInBytes /t REG_DWORD /d 4294967295 /f | Out-Null
    if ($LASTEXITCODE -ne 0) { $out.errors += '写入 FileSizeLimitInBytes 失败' }
    try {
      Restart-Service -Name WebClient -Force -ErrorAction Stop
    } catch {
      try { Start-Service -Name WebClient -ErrorAction Stop }
      catch { $out.errors += ('启动 WebClient 失败：' + $_.Exception.Message) }
    }
    for ($i = 0; $i -lt 10; $i++) {
      Start-Sleep -Milliseconds 400
      $svc = Get-Service -Name WebClient -ErrorAction SilentlyContinue
      if ($svc -and $svc.Status -eq 'Running') { break }
    }
    $dav = Get-Service -Name MRxDAV -ErrorAction SilentlyContinue
    if ($dav -and $dav.Status -ne 'Running') {
      try { Start-Service -Name MRxDAV -ErrorAction Stop } catch { $out.errors += 'MRxDAV 驱动没有启动' }
    }
    $svc = Get-Service -Name WebClient -ErrorAction SilentlyContinue
    if ($svc) {
      $out.service = [string]$svc.Status
      $wmi = Get-CimInstance Win32_Service -Filter "Name='WebClient'" -ErrorAction SilentlyContinue
      if ($wmi) { $out.start = [string]$wmi.StartMode }
    }
    try { $out.basic = [int](Get-ItemProperty -Path $key -Name BasicAuthLevel -ErrorAction Stop).BasicAuthLevel } catch {}
    $dav = Get-Service -Name MRxDAV -ErrorAction SilentlyContinue
    if ($dav) { $out.mrxdav = [string]$dav.Status }
    $out.ok = ($out.service -eq 'Running')
  }
} catch {
  $out.errors += $_.Exception.Message
  Add-Log ('repair error: ' + $_.Exception.Message)
}
try {
  $out | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath '__RESULT__' -Encoding UTF8
} catch {}
Add-Log ('repair end ok=' + $out.ok + ' restart=' + $out.restart)
if ($out.ok) { exit 0 }
if ($out.restart) { exit 3 }
exit 2
"""

LAUNCH_PS = r"""
$ErrorActionPreference = 'Stop'
try {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $p = Start-Process -FilePath $ps -Verb RunAs -WindowStyle Hidden -Wait -PassThru `
    -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '__CODE__')
  exit $p.ExitCode
} catch {
  Write-Output $_.Exception.Message
  exit 1223
}
"""


def _psq(p):
    return str(p).replace("'", "''")


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
            util.popen(["net", "start", "WebClient"], timeout=30)
            _, out, err = util.popen(["sc", "query", "WebClient"], timeout=15)
            return "RUNNING" in (out + err).upper()
        except Exception:
            return False

    def _unmap(self, letter):
        try:
            util.popen(["net", "use", letter + ":", "/delete", "/y"], timeout=30)
        except Exception:
            pass

    def repair(self):
        if os.name != "nt":
            raise RuntimeError("一键修复仅支持 Windows")
        tmp = util.path("tmp")
        os.makedirs(tmp, exist_ok=True)
        result = os.path.join(tmp, "repair-webdav.json")
        logf = util.path("logs", "repair-webdav.log")
        try:
            os.remove(result)
        except OSError:
            pass
        body = REPAIR_PS.replace("__LOG__", _psq(logf)).replace("__RESULT__", _psq(result))
        enc = base64.b64encode(body.encode("utf-16le")).decode("ascii")
        cmd = LAUNCH_PS.replace("__CODE__", enc)
        ps = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32",
                          "WindowsPowerShell", "v1.0", "powershell.exe")
        try:
            code, out, err = util.popen(
                [ps, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
                timeout=180)
        except subprocess.TimeoutExpired:
            raise RuntimeError("修复等待超时。请确认是否在管理员授权窗口点击了“是”，然后重试")
        text = (err or out or "").strip()
        res = None
        try:
            with open(result, "r", encoding="utf-8-sig") as f:
                x = json.load(f)
            res = x if isinstance(x, dict) else None
        except Exception:
            res = None
        if not res:
            util.log("repair-webdav: code=%s %s" % (code, text))
            low = text.lower()
            if code == 1223 or "cancel" in low or "取消" in text or "拒绝" in text:
                raise RuntimeError("已取消管理员授权。修复 Windows WebDAV 组件需要一次管理员权限，"
                                   "请重试并在系统弹窗中选择“是”")
            raise RuntimeError("自动修复没有完成，可能被安全软件拦截。请先重启电脑再试；"
                               "仍失败时请查看日志中的 repair-webdav.log")
        errs = res.get("errors") or []
        if isinstance(errs, str):
            errs = [errs]
        errs = [str(x) for x in errs if str(x).strip()]
        util.log("repair-webdav: ok=%s service=%s feature=%s basic=%s errors=%s" %
                 (res.get("ok"), res.get("service"), res.get("feature"), res.get("basic"), errs))
        if res.get("ok"):
            time.sleep(1)
            return {"repaired": True, "restart": bool(res.get("restart")),
                    "service": res.get("service") or "", "feature": res.get("feature") or "",
                    "basic": int(res.get("basic") or 0)}
        if res.get("restart") or res.get("feature") == "EnablePending":
            raise RuntimeError("WebDAV 组件已启用，但 Windows 需要重启后才会生效。请重启电脑，"
                               "再打开存储熊点击“挂载为网络盘”")
        msg = "；".join(errs) if errs else "WebClient 服务没有启动"
        raise RuntimeError("修复没有完全成功：%s。请重启电脑后重试，或查看 repair-webdav.log" % msg)

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
        self._webclient()
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
                    return self.info()
                errs.append(_neterr(out, err, code))
                self._unmap(letter)
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
