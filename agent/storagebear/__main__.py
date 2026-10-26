import argparse
import json
import os
import signal
import sys
import time
import urllib.request

from . import VERSION, util
from .agent import Agent
from .localapi import Api


def _alive(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % port, timeout=1.2) as r:
            j = json.loads(r.read().decode("utf-8"))
            return bool(j.get("ok") and j.get("app") == "StorageBear")
    except Exception:
        return False


def _running():
    r = util.load_json(util.path("runtime.json"), {})
    if not r:
        return None
    pid = int(r.get("pid") or 0)
    port = int(r.get("port") or 0)
    if pid and port and _alive(port):
        try:
            os.kill(pid, 0)
        except OSError:
            return None
        return r
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="storagebear", description="存储熊桌面代理")
    ap.add_argument("--port", type=int, default=int(os.environ.get("SB_LOCAL_PORT") or 0),
                    help="本地 API 端口，0 为自动")
    ap.add_argument("--home", default="", help="数据目录")
    ap.add_argument("--version", action="store_true")
    ap.add_argument("--repair-webdav", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--repair-dir", default="", help=argparse.SUPPRESS)
    ap.add_argument("--repair-out", default="", help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if a.version:
        print(VERSION)
        return 0
    if a.repair_webdav:
        from .drive import repair_child
        return repair_child(a.repair_dir, a.repair_out)
    if a.home:
        os.environ["SB_HOME"] = os.path.abspath(a.home)
    util.ensure()
    run = _running()
    if run:
        print(json.dumps({"ok": True, "already": True, "port": run.get("port"), "pid": run.get("pid")},
                         ensure_ascii=False), flush=True)
        return 0
    agent = Agent()
    api = Api(agent, a.port)
    stop = {"v": False}

    def sig(n, f):
        stop["v"] = True

    try:
        signal.signal(signal.SIGTERM, sig)
        signal.signal(signal.SIGINT, sig)
    except Exception:
        pass
    try:
        agent.start()
        api.start()
        print(json.dumps({"ok": True, "version": VERSION, "port": api.port, "pid": os.getpid()},
                         ensure_ascii=False), flush=True)
        while not stop["v"]:
            time.sleep(1)
    finally:
        api.stop()
        agent.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
