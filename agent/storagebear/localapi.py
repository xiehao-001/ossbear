import hmac
import http.server
import json
import os
import secrets
import socketserver
import threading
import time
import traceback
from urllib.parse import parse_qs, unquote, urlsplit

from . import VERSION, scan, util
from .remote import ApiError
from .s3 import S3, S3Error

MAXBODY = 2 * 1024 * 1024


def _provs(agent):
    out = []
    now = util.now()
    for p in agent.db.provs():
        st = agent.db.one("SELECT COUNT(*) AS n,COALESCE(SUM(size),0) AS b FROM files "
                          "WHERE provider_id=? AND archived=1", (p["id"],)) or {}
        p["archived_files"] = int(st.get("n") or 0)
        p["archived_bytes"] = int(st.get("b") or 0)
        p["days_left"] = int((int(p.get("expires_at") or 0) - now) // 86400) if p.get("expires_at") else None
        out.append(p)
    return out


def _entry(r, labels):
    p = util.native(r["path"])
    is_dir = bool(r.get("is_dir"))
    return {"id": r.get("id") or "", "path": p, "parent": r.get("parent") or os.path.dirname(p),
            "name": r.get("name") or os.path.basename(p), "is_dir": is_dir,
            "size": int(r.get("size") or 0), "ext": r.get("ext") or "", "kind": r.get("kind") or "",
            "provider_id": r.get("provider_id") or "",
            "provider_label": labels.get(r.get("provider_id") or "", ""),
            "has_cloud": bool(r.get("object_key")), "archived": bool(r.get("archived")),
            "exists": os.path.isdir(p) if is_dir else os.path.isfile(p),
            "mtime": int(r.get("mtime") or 0), "size_h": util.fmt_size(r.get("size") or 0)}


def _ts(v):
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v or "").strip()
    if not s:
        return 0
    if s.isdigit():
        return int(s)
    for fmt, n in (("%Y-%m-%dT%H:%M:%S", 19), ("%Y-%m-%dT%H:%M", 16), ("%Y-%m-%d %H:%M:%S", 19),
                   ("%Y-%m-%d %H:%M", 16), ("%Y-%m-%d", 10), ("%Y/%m/%d", 10)):
        try:
            return int(time.mktime(time.strptime(s[:n], fmt)))
        except Exception:
            pass
    raise RuntimeError("时间格式无效")


class Api:
    def __init__(self, agent, port=0):
        self.agent = agent
        self.port = int(port or 0)
        self.token = os.environ.get("SB_LOCAL_TOKEN") or secrets.token_urlsafe(24)
        self.srv = None
        self.th = None

    def start(self):
        h = _handler(self.agent, self.token)
        try:
            self.srv = _Server(("127.0.0.1", self.port), h)
        except OSError:
            self.srv = _Server(("127.0.0.1", 0), h)
        self.port = self.srv.server_address[1]
        self.th = threading.Thread(target=self.srv.serve_forever, name="sb-api", daemon=True)
        self.th.start()
        util.save_json(util.path("runtime.json"), {
            "port": self.port, "token": self.token, "pid": os.getpid(), "version": VERSION,
            "started_at": util.now(), "url": "http://127.0.0.1:%d" % self.port})
        util.log("local api: 127.0.0.1:%d" % self.port)
        return self.info()

    def stop(self):
        srv = self.srv
        self.srv = None
        if srv:
            try:
                srv.shutdown()
                srv.server_close()
            except Exception:
                pass
        try:
            r = util.load_json(util.path("runtime.json"), {})
            if int(r.get("pid") or 0) == os.getpid():
                os.remove(util.path("runtime.json"))
        except OSError:
            pass

    def info(self):
        return {"port": self.port, "url": "http://127.0.0.1:%d" % self.port}


def _handler(agent, token):
    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "StorageBearLocal/" + VERSION

        def log_message(self, fmt, *args):
            pass

        def _send(self, code, obj):
            raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _auth(self):
            got = self.headers.get("X-SB-Token") or ""
            if not got:
                a = self.headers.get("Authorization", "")
                if a.startswith("Bearer "):
                    got = a[7:]
            return bool(got) and hmac.compare_digest(got, token)

        def _body(self):
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise RuntimeError("请求长度无效")
            if n < 0 or n > MAXBODY:
                raise RuntimeError("请求体过大")
            raw = self.rfile.read(n) if n else b""
            if not raw.strip():
                return {}
            try:
                j = json.loads(raw.decode("utf-8"))
            except Exception:
                raise RuntimeError("JSON 格式错误")
            if not isinstance(j, dict):
                raise RuntimeError("请求体必须是对象")
            return j

        def do_GET(self):
            self._go("GET")

        def do_POST(self):
            self._go("POST")

        def do_DELETE(self):
            self._go("DELETE")

        def _go(self, method):
            try:
                u = urlsplit(self.path)
                path = unquote(u.path)
                if path == "/api/ping":
                    return self._send(200, {"ok": True, "app": "StorageBear", "version": VERSION})
                if not self._auth():
                    return self._send(401, {"ok": False, "error": "本地接口未授权"})
                qs = {k: v[-1] for k, v in parse_qs(u.query, keep_blank_values=True).items()}
                data = self._body() if method in ("POST", "DELETE") else {}
                code, out = self.route(method, path, qs, data)
                out = dict(out)
                out.setdefault("ok", True)
                self._send(code, out)
            except ApiError as e:
                util.log("local api remote error: %s" % e)
                code = e.code if 400 <= int(e.code or 0) < 500 else 400
                self._send(code, {"ok": False, "error": e.msg, "data": e.data})
            except (RuntimeError, S3Error) as e:
                self._send(400, {"ok": False, "error": str(getattr(e, "msg", e))})
            except Exception as e:
                util.log("local api error: %s\n%s" % (e, traceback.format_exc()))
                self._send(500, {"ok": False, "error": "本地服务异常：%s" % e})
            self.close_connection = True

        def route(self, method, path, qs, data):
            a = agent
            parts = [x for x in path.split("/") if x]
            if method == "GET" and path == "/api/status":
                return 200, a.status()
            if method == "POST" and path == "/api/login":
                return 200, a.login(data.get("server", ""), data.get("email", ""), data.get("password", ""))
            if method == "POST" and path == "/api/register":
                return 200, a.register(data.get("server", ""), data.get("email", ""), data.get("password", ""),
                                       data.get("name", ""), data.get("code", ""))
            if method == "POST" and path == "/api/register/code":
                return 200, a.send_code(data.get("server", ""), data.get("email", ""))
            if method == "POST" and path == "/api/logout":
                return 200, a.logout()
            if path == "/api/config":
                if method == "GET":
                    return 200, a.pubcfg()
                if method == "POST":
                    return 200, self._cfg(data)
            if path == "/api/browse":
                return 200, self._browse(qs.get("path") or "")
            if path == "/api/providers":
                if method == "GET":
                    return 200, {"providers": _provs(a)}
                if method == "POST":
                    d = dict(data)
                    if "expires_at" in d:
                        d["expires_at"] = _ts(d["expires_at"])
                    p = a.savep(d, bool(d.pop("test", False)))
                    return 200, {"provider": p}
            if method == "POST" and path == "/api/providers/test":
                return 200, self._test(dict(data))
            if len(parts) == 3 and parts[:2] == ["api", "providers"]:
                if method == "DELETE":
                    a.delp(parts[2], bool(int(qs.get("force") or 0)))
                    return 200, {"deleted": parts[2]}
                if method == "POST":
                    d = dict(data)
                    d["id"] = parts[2]
                    if "expires_at" in d:
                        d["expires_at"] = _ts(d["expires_at"])
                    return 200, {"provider": a.savep(d, bool(d.pop("test", False)))}
            if path == "/api/stitches":
                if method == "GET":
                    return 200, {"stitches": a.db.stitches()}
                if method == "POST":
                    pids = data.get("providers") or []
                    if not isinstance(pids, list) or not pids:
                        raise RuntimeError("请至少选择一个云存储")
                    for x in pids:
                        if not a.db.prov(x):
                            raise RuntimeError("云存储不存在")
                    return 200, {"stitch": a.savestitch(data)}
            if len(parts) == 3 and parts[:2] == ["api", "stitches"] and method == "DELETE":
                a.delstitch(parts[2])
                return 200, {"deleted": parts[2]}
            if method == "GET" and path == "/api/files":
                return 200, self._files(qs)
            if method == "GET" and path == "/api/logs":
                out = {"logs": a.db.logs(qs.get("provider_id") or "", int(qs.get("limit") or 50))}
                if qs.get("remote") and a.api.token:
                    try:
                        out["remote"] = a.api.call("GET", "/api/logs?limit=%d" % min(200, int(qs.get("limit") or 50))
                                                   ).get("logs", [])
                    except Exception as e:
                        out["remote_error"] = str(e)
                return 200, out
            if len(parts) == 3 and parts[:2] == ["api", "logs"] and method == "GET":
                r = a.db.getlog(parts[2])
                if not r:
                    raise RuntimeError("日志不存在")
                return 200, {"log": r}
            if method == "POST" and path == "/api/scan":
                return 200, {"job_id": a.scand(data)}
            if method == "GET" and path == "/api/jobs":
                return 200, {"jobs": a.jobs.list(40)}
            if len(parts) == 3 and parts[:2] == ["api", "jobs"] and method == "GET":
                j = a.jobs.get(parts[2])
                if not j:
                    raise RuntimeError("任务不存在")
                return 200, {"job": j}
            if method == "POST" and path == "/api/archive":
                return 200, {"job_id": a.archive(data)}
            if method == "POST" and path == "/api/restore":
                return 200, {"job_id": a.restore(data)}
            if method == "POST" and path == "/api/share":
                return 200, {"job_id": a.share(data.get("path", ""), data.get("provider_id", ""))}
            if method == "POST" and path == "/api/open":
                return 200, {"job_id": a.open(data.get("path", ""))}
            if method == "POST" and path == "/api/fetch":
                return 200, {"job_id": a.fetch(data.get("path", ""))}
            if method == "POST" and path == "/api/reveal":
                return 200, a.reveal(data.get("path", ""))
            if method == "GET" and path == "/api/devices":
                return 200, {"devices": a.devices()}
            if method == "GET" and path == "/api/summary":
                return 200, a.summary()
            if method == "POST" and path == "/api/sync/meta":
                a.meta()
                return 200, a.status()
            if path == "/api/drive":
                return 200, a.drive.info()
            if method == "POST" and path == "/api/drive/start":
                return 200, a.drive.start()
            if method == "POST" and path == "/api/drive/stop":
                return 200, a.drive.stop()
            if method == "POST" and path == "/api/drive/mount":
                return 200, a.drive.mount()
            if method == "POST" and path == "/api/drive/unmount":
                return 200, a.drive.unmount()
            if method == "POST" and path == "/api/drive/config":
                kw = {}
                if "auto" in data:
                    kw["drive_auto"] = bool(data.get("auto"))
                if "letter" in data:
                    letter = str(data.get("letter") or "").strip().upper()
                    if letter and not (len(letter) in (1, 2) and letter[0].isalpha()):
                        raise RuntimeError("盘符无效")
                    kw["drive_letter"] = (letter[0] + ":") if letter else ""
                a.save(**kw)
                return 200, a.drive.info()
            raise RuntimeError("接口不存在：%s" % path)

        def _cfg(self, data):
            a = agent
            kw = {}
            if "roots" in data:
                raw = data.get("roots") or []
                if not isinstance(raw, list) or len(raw) > 60:
                    raise RuntimeError("目录列表无效")
                out = []
                seen = set()
                for r in raw:
                    p = r.get("path") if isinstance(r, dict) else r
                    label = r.get("label", "") if isinstance(r, dict) else ""
                    if not p:
                        continue
                    p = util.native(p)
                    if not os.path.isdir(p):
                        raise RuntimeError("目录不存在：%s" % p)
                    k = util.pkey(p)
                    if k in seen:
                        continue
                    seen.add(k)
                    out.append({"path": p, "label": util.safe_name(label, 40) or os.path.basename(p) or p})
                kw["roots"] = out
            if "exts" in data:
                xs = data.get("exts") or []
                if not isinstance(xs, list):
                    raise RuntimeError("扩展名列表无效")
                out = []
                for x in xs[:80]:
                    x = str(x).lower().strip()
                    if x and not x.startswith("."):
                        x = "." + x
                    if 1 < len(x) <= 16 and x.count(".") == 1 and " " not in x:
                        out.append(x)
                kw["exts"] = out or scan.DEFAULT_EXT
            if "device_name" in data:
                n = str(data.get("device_name") or "").strip()[:60]
                if n:
                    kw["device_name"] = n
            if "drive_auto" in data:
                kw["drive_auto"] = bool(data.get("drive_auto"))
            a.save(**kw)
            return a.pubcfg()

        def _test(self, d):
            if d.get("id"):
                old = agent.db.prov(d["id"], secret=True) or {}
                for k, v in old.items():
                    d.setdefault(k, v)
            for k in ("endpoint", "bucket", "region", "style"):
                if not d.get(k) and k != "region":
                    raise RuntimeError("缺少 %s" % k)
            t0 = time.time()
            S3(d).test()
            return {"ok": True, "ms": int((time.time() - t0) * 1000)}

        def _browse(self, path):
            p = util.native(path) if path else ""
            if not p:
                if os.name == "nt":
                    ds = util.drives()
                    p = ds[0] if ds else os.path.expanduser("~")
                else:
                    p = os.path.expanduser("~")
            if os.path.isfile(p):
                p = os.path.dirname(p)
            if not os.path.isdir(p):
                raise RuntimeError("目录不存在")
            dirs = []
            try:
                for e in os.scandir(p):
                    try:
                        if not e.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    if e.name.startswith(".") or e.name.startswith("$"):
                        continue
                    dirs.append({"name": e.name, "path": util.native(e.path)})
            except PermissionError:
                raise RuntimeError("没有权限访问该目录")
            dirs.sort(key=lambda x: x["name"].lower())
            parent = os.path.dirname(p)
            return {"path": p, "parent": parent if parent and parent != p else "",
                    "dirs": dirs, "drives": util.drives() if os.name == "nt" else [],
                    "home": util.native(os.path.expanduser("~")), "sep": os.sep}

        def _files(self, qs):
            a = agent
            labels = {p["id"]: p.get("label") or "" for p in a.db.provs()}
            p = qs.get("path")
            if p:
                p = util.native(p)
                if os.path.isfile(p):
                    r = a.db.file(p)
                    return {"path": p, "parent": os.path.dirname(p),
                            "entries": [_entry(r, labels)] if r else []}
                rows = a.db.kids(p)
                return {"path": p, "parent": os.path.dirname(p),
                        "entries": [_entry(r, labels) for r in rows]}
            q = (qs.get("q") or "").strip()[:120]
            if q:
                rows = a.db.search(q, min(300, max(10, int(qs.get("limit") or 80))))
                return {"q": q, "entries": [_entry(r, labels) for r in rows]}
            kind = qs.get("kind") or ""
            if kind:
                if kind == "cloud":
                    rows = a.db.arch(qs.get("provider_id") or "")
                    if qs.get("limit"):
                        rows = rows[:min(1000, max(1, int(qs.get("limit"))))]
                    return {"kind": "cloud", "entries": [_entry(r, labels) for r in rows]}
                paths = [x for x in (qs.get("paths") or "").split("|") if x] if qs.get("paths") else None
                rows = a.db.media(min(1000, max(1, int(qs.get("limit") or 200))), paths)
                return {"kind": kind, "entries": [_entry(r, labels) for r in rows]}
            roots = a.cfg.get("roots") or []
            return {"roots": roots, "entries": []}

    return H


try:
    _Base = http.server.ThreadingHTTPServer
except AttributeError:
    class _Base(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True


class _Server(_Base):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        util.log("local api error from %s\n%s" % (client_address, traceback.format_exc()))
