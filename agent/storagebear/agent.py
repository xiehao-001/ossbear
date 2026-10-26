import os
import platform
import secrets
import socket
import threading
import time

from . import VERSION, ops, scan, util
from .drive import Drive
from .jobs import Jobs
from .localdb import DB
from .remote import Api, ApiError


def devid():
    return "pc" + secrets.token_hex(8)


def devname():
    try:
        n = socket.gethostname()
    except Exception:
        n = ""
    return (n or platform.node() or "我的电脑")[:60]


class Agent:
    def __init__(self):
        util.ensure()
        self.cfg = util.config()
        self.drive = Drive(self)
        self.db = DB()
        self.jobs = Jobs()
        self.lk = threading.RLock()
        self.stop_evt = threading.Event()
        self.th = None
        self.auth_error = ""
        self.task_note = ""
        d = self.cfg
        if not d.get("device_id"):
            d["device_id"] = devid()
        if not d.get("device_name"):
            d["device_name"] = devname()
        d.setdefault("server", "")
        d.setdefault("user", {})
        d.setdefault("token", "")
        util.save_json(util.path("config.json"), d)
        self.api = Api(d.get("server", ""), d.get("token", ""), d["device_id"])

    def start(self):
        self.drive.start()
        with self.lk:
            if self.th:
                return
            self.th = threading.Thread(target=self._beat, name="sb-agent", daemon=True)
            self.th.start()
        util.log("agent start v%s device=%s" % (VERSION, self.cfg["device_id"]))

    def stop(self):
        self.stop_evt.set()
        self.drive.stop()
        self.jobs.stop()
        self.db.close()

    def dev(self):
        return {"id": self.cfg["device_id"], "name": self.cfg.get("device_name") or devname(),
                "type": "pc", "os": (platform.system() + " " + platform.release())[:60]}

    def save(self, **kw):
        with self.lk:
            self.cfg.update(kw)
            util.save_json(util.path("config.json"), self.cfg)
        return self.cfg

    def login(self, server, email, password):
        base = (server or "").strip().rstrip("/")
        if not base:
            raise RuntimeError("请填写服务器地址")
        if not util.is_http(base):
            base = "https://" + base
        api = Api(base, "", self.cfg["device_id"])
        j = api.login(email, password, self.dev())
        with self.lk:
            self.api = api
            self.api.did = self.cfg["device_id"]
            self.cfg["server"] = base
            self.cfg["token"] = j.get("token", "")
            self.cfg["user"] = j.get("user") or {}
            self.cfg["auth_at"] = util.now()
            self.auth_error = ""
            util.save_json(util.path("config.json"), self.cfg)
        self.start()
        self.meta()
        return self.status()

    def register(self, server, email, password, name, code):
        base = (server or "").strip().rstrip("/")
        if not base:
            raise RuntimeError("请填写服务器地址")
        if not util.is_http(base):
            base = "https://" + base
        api = Api(base, "", self.cfg["device_id"])
        j = api.register(email, password, name, self.dev(), code)
        with self.lk:
            self.api = api
            self.cfg["server"] = base
            self.cfg["token"] = j.get("token", "")
            self.cfg["user"] = j.get("user") or {}
            self.cfg["auth_at"] = util.now()
            self.auth_error = ""
            util.save_json(util.path("config.json"), self.cfg)
        self.start()
        self.meta()
        return self.status()

    def send_code(self, server, email):
        base = (server or "").strip().rstrip("/")
        if not base:
            raise RuntimeError("请填写服务器地址")
        if not util.is_http(base):
            base = "https://" + base
        return Api(base, "", self.cfg["device_id"]).send_code(email)

    def logout(self):
        try:
            if self.api.token:
                self.api.call("POST", "/api/auth/logout", {})
        except Exception:
            pass
        with self.lk:
            self.api = Api(self.cfg.get("server", ""), "", self.cfg["device_id"])
            self.cfg["token"] = ""
            self.cfg["user"] = {}
            self.auth_error = ""
            util.save_json(util.path("config.json"), self.cfg)
        return self.status()

    def _beat(self):
        ping_at = 0.0
        fail = 0
        while not self.stop_evt.wait(3):
            if not self.api.token:
                ping_at = 0.0
                continue
            try:
                t = time.time()
                if t - ping_at > 45:
                    self.api.ping(self.dev()["name"], self.dev()["os"])
                    ping_at = t
                for task in self.api.tasks():
                    self._task(task)
                self.auth_error = ""
                fail = 0
            except ApiError as e:
                if e.code == 401:
                    self.auth_error = "登录已失效，请重新登录"
                    self.stop_evt.wait(120)
                    ping_at = time.time()
                else:
                    fail += 1
                    util.log("heartbeat: %s" % e)
                    if fail > 2:
                        self.stop_evt.wait(min(60, 10 * fail))
            except Exception as e:
                fail += 1
                util.log("heartbeat: %s" % e)
                if fail > 2:
                    self.stop_evt.wait(min(60, 10 * fail))

    def _task(self, t):
        tid = t.get("id")
        self.task_note = "处理请求 %s" % (t.get("kind") or "")
        try:
            r = ops.serve(self, t)
            self.api.done(tid, r)
            self.task_note = ""
        except Exception as e:
            util.log("task %s: %s" % (tid, e))
            self.task_note = ""
            try:
                self.api.done(tid, error=str(getattr(e, "msg", e))[:300])
            except Exception as ex:
                util.log("task done: %s" % ex)

    def meta(self):
        if not self.api.token:
            return
        err = ""
        for p in self.db.provs():
            try:
                self.api.put_provider(p)
            except Exception as e:
                err = str(e)
        for s in self.db.stitches():
            try:
                self.api.put_stitch(s)
            except Exception as e:
                err = str(e)
        self.save(meta_error=err, meta_at=util.now())

    def scand(self, opts):
        return self.jobs.add("scan", lambda job: scan.run(self, job, opts or {}))

    def archive(self, opts):
        if not (opts or {}).get("paths"):
            raise RuntimeError("请选择要迁出的文件或目录")
        return self.jobs.add("archive", lambda job: ops.archive(self, job, opts or {}))

    def restore(self, opts):
        o = opts or {}
        if not (o.get("log_id") or o.get("provider_id") or o.get("paths") or o.get("all")):
            raise RuntimeError("请选择迁出日志、云存储或具体文件")
        return self.jobs.add("restore", lambda job: ops.restore(self, job, o))

    def share(self, path, provider_id=""):
        if not str(path or "").strip():
            raise RuntimeError("缺少文件路径")
        p = util.native(path)
        r = self.db.file(p)
        if not os.path.isfile(p) and not (r and r.get("object_key")):
            raise RuntimeError("文件不存在")

        def fn(job):
            job.up(message="正在上传并创建链接")
            return ops.serve(self, {"kind": "upload", "payload": {
                "path": p, "file_id": (r or {}).get("id", ""), "provider_id": provider_id}})
        return self.jobs.add("share", fn)

    def fetch(self, path):
        if not str(path or "").strip():
            raise RuntimeError("缺少文件路径")
        p = util.native(path)

        def fn(job):
            job.up(message="正在从云端取回")
            q = ops.resolve(self, p)
            return {"path": q}
        return self.jobs.add("fetch", fn)

    def link(self, path):
        if not str(path or "").strip():
            raise RuntimeError("缺少文件路径")
        return ops.viewlink(self, path)

    def downloads(self):
        return ops.downloads(self)

    def preview(self, path):
        if not str(path or "").strip():
            raise RuntimeError("缺少文件路径")
        return ops.preview(self, path)

    def edit(self, path):
        if not str(path or "").strip():
            raise RuntimeError("缺少文件路径")
        return ops.editfile(self, path)

    def saveEdit(self, path):
        if not str(path or "").strip():
            raise RuntimeError("缺少文件路径")
        return ops.saveedit(self, path)

    def open(self, path):
        if not str(path or "").strip():
            raise RuntimeError("缺少文件路径")
        p = util.native(path)

        def fn(job):
            job.up(message="正在打开文件")
            q = ops.openable(self, p)
            util.openpath(q)
            return {"path": q, "temporary": q != p}
        return self.jobs.add("open", fn)

    def reveal(self, path):
        p = util.native(path)
        target = p if os.path.exists(p) else os.path.dirname(p)
        if not os.path.isdir(target):
            target = os.path.dirname(target) or target
        if os.name == "nt":
            if os.path.isfile(p):
                util.popen(["explorer", "/select,", p], wait=False)
            else:
                util.popen(["explorer", target], wait=False)
        elif platform.system() == "Darwin":
            util.popen(["open", "-R", p] if os.path.isfile(p) else ["open", target], wait=False)
        else:
            util.openpath(target)
        return {"path": target}

    def savep(self, d, test=False):
        pid = d.get("id") or ("pv" + secrets.token_hex(6))
        d["id"] = pid
        if test:
            from .s3 import S3
            conf = dict(d)
            if not conf.get("access_key"):
                old = self.db.prov(pid, secret=True) or {}
                conf["access_key"] = old.get("access_key", "")
                conf["secret_key"] = conf.get("secret_key") or old.get("secret_key", "")
            S3(conf).test()
        p = self.db.savep(d)
        if self.api.token:
            try:
                self.api.put_provider(p)
            except Exception as e:
                util.log("provider sync: %s" % e)
        return p

    def delp(self, pid, force=False):
        n = self.db.one("SELECT COUNT(*) AS n FROM files WHERE provider_id=? AND archived=1 AND object_key<>''",
                        (pid,))
        if n and n["n"] and not force:
            raise RuntimeError("该云存储仍有 %d 个云端文件，请先迁回或确认强制删除" % n["n"])
        self.db.delp(pid)
        if self.api.token:
            try:
                self.api.del_provider(pid)
            except Exception as e:
                util.log("provider delete: %s" % e)

    def balance(self, pid):
        p = self.db.prov(pid, secret=True)
        if not p:
            raise RuntimeError("云存储不存在")
        if p.get("code") != "volcengine":
            raise RuntimeError("余额查询目前只支持火山引擎（Beta）")
        from .volc import query_balance
        return query_balance(p.get("access_key", ""), p.get("secret_key", ""))

    def savestitch(self, d):
        s = self.db.stitch(d)
        if self.api.token:
            try:
                self.api.put_stitch(s)
            except Exception as e:
                util.log("stitch sync: %s" % e)
        return s

    def delstitch(self, sid):
        self.db.delstitch(sid)
        if self.api.token:
            try:
                self.api.del_stitch(sid)
            except Exception as e:
                util.log("stitch delete: %s" % e)

    def pubcfg(self):
        c = self.cfg
        return {"server": c.get("server", ""), "roots": c.get("roots") or [],
                "exts": c.get("exts") or scan.DEFAULT_EXT, "device_name": c.get("device_name"),
                "device_id": c.get("device_id"), "drive_auto": bool(c.get("drive_auto")),
                "drive_letter": c.get("drive_letter", ""), "last_scan": c.get("last_scan", 0),
                "last_roots": c.get("last_roots") or [], "meta_error": c.get("meta_error", "")}

    def status(self):
        try:
            rc = self.db.counts()
        except Exception:
            rc = {}
        return {"version": VERSION, "logged_in": bool(self.api.token and self.cfg.get("user")),
                "user": self.cfg.get("user") or {}, "device": self.dev(), "server": self.cfg.get("server", ""),
                "auth_error": self.auth_error, "task_note": self.task_note, "counts": rc,
                "drive": self.drive.info(), "last_scan": self.cfg.get("last_scan", 0),
                "last_sync_error": self.cfg.get("last_sync_error", ""),
                "meta_error": self.cfg.get("meta_error", ""), "jobs": self.jobs.busy(),
                "scanning": any(j.get("kind") == "scan" for j in self.jobs.busy())}

    def devices(self):
        if not self.api.token:
            return []
        return self.api.call("GET", "/api/devices").get("devices", [])

    def remote(self, route, data=None):
        if not self.api.token:
            raise RuntimeError("尚未登录")
        return self.api.call("GET" if data is None else "POST", route, data)

    def summary(self):
        local = self.db.counts()
        rem = None
        if self.api.token:
            try:
                rem = self.api.call("GET", "/api/summary")
            except Exception as e:
                util.log("summary: %s" % e)
        return {"local": local, "remote": rem or {}, "providers": self.db.provs(),
                "stitches": self.db.stitches(), "logs": self.db.logs(limit=10)}
