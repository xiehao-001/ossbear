import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

from .util import ua


class ApiError(Exception):
    def __init__(self, code, msg, data=None):
        Exception.__init__(self, msg)
        self.code = int(code or 0)
        self.msg = str(msg)
        self.data = data or {}


class Api:
    def __init__(self, base="", token="", did="", timeout=30):
        self.base = (base or "").rstrip("/")
        self.token = token or ""
        self.did = did or ""
        self.timeout = timeout
        self.ctx = ssl.create_default_context()

    def call(self, method, route, data=None, timeout=None):
        if not self.base:
            raise ApiError(0, "尚未连接服务器")
        url = self.base + route
        body = None
        headers = {"Accept": "application/json", "User-Agent": ua()}
        if data is not None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout, context=self.ctx) as r:
                raw = r.read(4 * 1024 * 1024)
        except urllib.error.HTTPError as e:
            raw = e.read(512 * 1024)
            try:
                j = json.loads(raw.decode("utf-8"))
            except Exception:
                j = {}
            raise ApiError(e.code, j.get("error") or ("请求失败 (%s)" % e.code), j)
        except urllib.error.URLError as e:
            raise ApiError(0, "无法连接服务器：%s" % (e.reason,))
        except Exception as e:
            raise ApiError(0, "网络请求失败：%s" % (e,), {"url": url})
        try:
            j = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(502, "服务器返回了无法解析的数据")
        if not isinstance(j, dict):
            raise ApiError(502, "服务器返回格式错误")
        if not j.get("ok", False):
            raise ApiError(500, j.get("error") or "请求失败", j)
        return j

    def login(self, email, password, dev):
        j = self.call("POST", "/api/auth/login", {"email": email, "password": password, "device": dev})
        self.token = j.get("token", "")
        return j

    def register(self, email, password, name, dev, code):
        j = self.call("POST", "/api/auth/register",
                      {"email": email, "password": password, "name": name, "device": dev, "code": code})
        self.token = j.get("token", "")
        return j

    def send_code(self, email):
        return self.call("POST", "/api/auth/register/code", {"email": email})

    def ping(self, name="", os_name=""):
        return self.call("POST", "/api/device/ping", {"name": name, "os": os_name})

    def begin(self):
        return self.call("POST", "/api/sync/begin", {"device_id": self.did})

    def push(self, sid, entries):
        return self.call("POST", "/api/sync/entries",
                         {"device_id": self.did, "sync_id": sid, "entries": entries}, timeout=60)

    def finish(self, sid, roots):
        return self.call("POST", "/api/sync/finish",
                         {"device_id": self.did, "sync_id": sid, "roots": roots}, timeout=60)

    def tasks(self):
        return self.call("GET", "/api/agent/tasks").get("tasks", [])

    def done(self, tid, result=None, error=""):
        return self.call("POST", "/api/tasks/%s/done" % urllib.parse.quote(tid, safe=""),
                         {"status": "failed" if error else "done", "result": result or {}, "error": error})

    def cloud(self, path, provider_id="", object_key="", link="", link_exp=0, archived=1):
        return self.call("POST", "/api/files/cloud", {
            "device_id": self.did, "path": path, "provider_id": provider_id, "object_key": object_key,
            "link": link, "link_exp": link_exp, "archived": archived
        })

    def put_provider(self, p):
        return self.call("POST", "/api/providers", {
            "id": p.get("id"), "code": p.get("code"), "label": p.get("label"),
            "endpoint": p.get("endpoint"), "region": p.get("region"), "bucket": p.get("bucket"),
            "quota_bytes": p.get("quota_bytes", 0), "used_bytes": p.get("used_bytes", 0),
            "expires_at": p.get("expires_at", 0), "renew_url": p.get("renew_url", ""),
            "enabled": p.get("enabled", True)
        })

    def del_provider(self, pid):
        return self.call("DELETE", "/api/providers/" + urllib.parse.quote(pid, safe=""))

    def put_stitch(self, s):
        return self.call("POST", "/api/stitches", {
            "id": s.get("id"), "name": s.get("name"), "providers": s.get("providers", []),
            "strategy": s.get("strategy", "round_robin")
        })

    def del_stitch(self, sid):
        return self.call("DELETE", "/api/stitches/" + urllib.parse.quote(sid, safe=""))

    def log(self, lid, provider_id, op, count, detail):
        return self.call("POST", "/api/logs", {
            "id": lid, "provider_id": provider_id, "op": op, "count": count,
            "detail": detail, "created_at": int(time.time())
        })

    def servers(self):
        return self.call("GET", "/api/config")
