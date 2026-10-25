import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from . import util


class Job:
    def __init__(self, kind):
        self.lk = threading.Lock()
        self.d = {
            "id": uuid.uuid4().hex, "kind": kind, "state": "queued", "progress": 0, "total": 0,
            "message": "", "result": {}, "error": "", "created_at": int(time.time()),
            "started_at": 0, "finished_at": 0,
        }

    def up(self, **kw):
        with self.lk:
            self.d.update(kw)

    def get(self):
        with self.lk:
            return dict(self.d)


class Jobs:
    def __init__(self):
        self.lk = threading.Lock()
        self.items = {}
        self.ex = ThreadPoolExecutor(max_workers=3)

    def add(self, kind, fn):
        j = Job(kind)
        with self.lk:
            self.items[j.d["id"]] = j
            if len(self.items) > 40:
                old = sorted(self.items.values(), key=lambda x: x.get()["created_at"])[:-40]
                for x in old:
                    self.items.pop(x.d["id"], None)

        def run():
            j.up(state="running", started_at=int(time.time()), message="正在执行")
            try:
                r = fn(j)
                j.up(state="done", progress=100, finished_at=int(time.time()),
                     message="已完成", result=r or {})
            except Exception as e:
                util.log("job %s failed: %s" % (j.d["kind"], e))
                j.up(state="failed", finished_at=int(time.time()), error=str(e), message="失败")

        self.ex.submit(run)
        return j.d["id"]

    def get(self, jid):
        with self.lk:
            j = self.items.get(jid)
        return j.get() if j else None

    def list(self, limit=20):
        with self.lk:
            xs = [x.get() for x in self.items.values()]
        return sorted(xs, key=lambda x: x["created_at"], reverse=True)[:limit]

    def busy(self):
        with self.lk:
            xs = [x.get() for x in self.items.values()]
        return [x for x in xs if x["state"] in ("queued", "running")]

    def stop(self):
        self.ex.shutdown(wait=False)
