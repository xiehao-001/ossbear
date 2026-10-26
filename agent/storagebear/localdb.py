import json
import os
import sqlite3
import threading

from .util import kind, native, pkey, now, protect, unprotect, path, safe_name as util_safe


class DB:
    def __init__(self):
        self.lk = threading.RLock()
        self.h = sqlite3.connect(path("index.db"), check_same_thread=False, timeout=15)
        self.h.row_factory = sqlite3.Row
        with self.lk:
            self.h.execute("PRAGMA journal_mode=WAL")
            self.h.execute("PRAGMA synchronous=NORMAL")
            self.h.executescript("""
CREATE TABLE IF NOT EXISTS providers(
 id TEXT PRIMARY KEY, code TEXT NOT NULL DEFAULT '', label TEXT NOT NULL,
 endpoint TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', bucket TEXT NOT NULL DEFAULT '',
 style TEXT NOT NULL DEFAULT 'path', access_enc TEXT NOT NULL DEFAULT '', secret_enc TEXT NOT NULL DEFAULT '',
 quota_bytes INTEGER NOT NULL DEFAULT 0, used_bytes INTEGER NOT NULL DEFAULT 0,
 expires_at INTEGER NOT NULL DEFAULT 0, renew_url TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files(
 pkey TEXT PRIMARY KEY, path TEXT NOT NULL, parent TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
 is_dir INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, ext TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL DEFAULT '', provider_id TEXT NOT NULL DEFAULT '', object_key TEXT NOT NULL DEFAULT '',
 link TEXT NOT NULL DEFAULT '', link_exp INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
 mtime INTEGER NOT NULL DEFAULT 0, scan_id TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent);
CREATE INDEX IF NOT EXISTS idx_files_scan ON files(scan_id);
CREATE INDEX IF NOT EXISTS idx_files_prov ON files(provider_id,archived);
CREATE TABLE IF NOT EXISTS logs(
 id TEXT PRIMARY KEY, provider_id TEXT NOT NULL DEFAULT '', op TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stitches(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, providers TEXT NOT NULL DEFAULT '[]',
 strategy TEXT NOT NULL DEFAULT 'round_robin', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clouddrive(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 provider_id TEXT NOT NULL, parent TEXT NOT NULL DEFAULT '', path TEXT NOT NULL,
 name TEXT NOT NULL, is_dir INTEGER NOT NULL DEFAULT 0, object_key TEXT NOT NULL DEFAULT '',
 size INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(provider_id, path)
);
CREATE INDEX IF NOT EXISTS idx_cd_parent ON clouddrive(provider_id,parent);
""")
            self.h.commit()

    def close(self):
        with self.lk:
            try:
                self.h.close()
            except Exception:
                pass

    def q(self, sql, args=()):
        with self.lk:
            return [dict(r) for r in self.h.execute(sql, args).fetchall()]

    def one(self, sql, args=()):
        x = self.q(sql, args)
        return x[0] if x else None

    def x(self, sql, args=()):
        with self.lk:
            self.h.execute(sql, args)
            self.h.commit()

    def many(self, sql, rows):
        with self.lk:
            self.h.executemany(sql, rows)
            self.h.commit()

    def provs(self, secret=False):
        rows = self.q("SELECT * FROM providers ORDER BY label COLLATE NOCASE")
        if secret:
            for r in rows:
                r["access_key"] = unprotect(r.pop("access_enc", ""))
                r["secret_key"] = unprotect(r.pop("secret_enc", ""))
            return rows
        for r in rows:
            has = bool(r.get("access_enc") and r.get("secret_enc"))
            r.pop("access_enc", None)
            r.pop("secret_enc", None)
            r["has_key"] = has
        return rows

    def prov(self, pid, secret=False):
        r = self.one("SELECT * FROM providers WHERE id=?", (pid,))
        if not r:
            return None
        if secret:
            r["access_key"] = unprotect(r.pop("access_enc", ""))
            r["secret_key"] = unprotect(r.pop("secret_enc", ""))
        else:
            has = bool(r.get("access_enc") and r.get("secret_enc"))
            r.pop("access_enc", None)
            r.pop("secret_enc", None)
            r["has_key"] = has
        return r

    def savep(self, d):
        pid = d.get("id") or os.urandom(8).hex()
        old = self.one("SELECT * FROM providers WHERE id=?", (pid,)) or {}
        t = now()
        ak = d.get("access_key")
        sk = d.get("secret_key")
        if ak is None or ak == "":
            aenc = old.get("access_enc", "")
        else:
            aenc = protect(str(ak))
        if sk is None or sk == "":
            senc = old.get("secret_enc", "")
        else:
            senc = protect(str(sk))
        style = d.get("style") or old.get("style") or "path"
        if style not in ("path", "virtual"):
            style = "path"
        row = (
            pid, str(d.get("code", old.get("code", ""))), str(d.get("label") or old.get("label") or "云存储"),
            str(d.get("endpoint", old.get("endpoint", ""))).strip(),
            str(d.get("region", old.get("region", ""))).strip(),
            str(d.get("bucket", old.get("bucket", ""))).strip(), style, aenc, senc,
            int(d.get("quota_bytes", old.get("quota_bytes", 0)) or 0),
            int(d.get("used_bytes", old.get("used_bytes", 0)) or 0),
            int(d.get("expires_at", old.get("expires_at", 0)) or 0),
            str(d.get("renew_url", old.get("renew_url", "")) or ""),
            1 if d.get("enabled", old.get("enabled", 1)) else 0,
            int(old.get("created_at", t)), t,
        )
        self.x("INSERT INTO providers(id,code,label,endpoint,region,bucket,style,access_enc,secret_enc,quota_bytes,used_bytes,expires_at,renew_url,enabled,created_at,updated_at) "
               "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,label=excluded.label,"
               "endpoint=excluded.endpoint,region=excluded.region,bucket=excluded.bucket,style=excluded.style,"
               "access_enc=excluded.access_enc,secret_enc=excluded.secret_enc,quota_bytes=excluded.quota_bytes,"
               "used_bytes=excluded.used_bytes,expires_at=excluded.expires_at,renew_url=excluded.renew_url,"
               "enabled=excluded.enabled,updated_at=excluded.updated_at", row)
        return self.prov(pid)

    def delp(self, pid):
        self.x("DELETE FROM providers WHERE id=?", (pid,))

    def file(self, p):
        return self.one("SELECT * FROM files WHERE pkey=?", (pkey(p),))

    def put(self, items):
        if not items:
            return
        t = now()
        rows = []
        for it in items:
            p = native(it["path"])
            parent = native(it.get("parent") or os.path.dirname(p))
            e = it.get("ext") or os.path.splitext(p)[1].lower()
            k = it.get("kind") or ("dir" if it.get("is_dir") else kind(e))
            rows.append((
                pkey(p), p, parent, it.get("name") or os.path.basename(p), 1 if it.get("is_dir") else 0,
                int(it.get("size", 0) or 0), e.lower(), k, it.get("scan_id", ""), int(it.get("mtime", 0) or 0), t,
            ))
        with self.lk:
            self.h.executemany(
                "INSERT INTO files(pkey,path,parent,name,is_dir,size,ext,kind,scan_id,mtime,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(pkey) DO UPDATE SET path=excluded.path,parent=excluded.parent,"
                "name=excluded.name,is_dir=excluded.is_dir,size=excluded.size,ext=excluded.ext,kind=excluded.kind,"
                "scan_id=excluded.scan_id,mtime=excluded.mtime,updated_at=excluded.updated_at", rows)
            self.h.commit()

    def cloud(self, p, provider_id="", object_key="", link="", link_exp=0, archived=1):
        f = self.file(p)
        t = now()
        if f:
            self.x("UPDATE files SET provider_id=?,object_key=?,link=?,link_exp=?,archived=?,updated_at=? WHERE pkey=?",
                   (provider_id, object_key, link, int(link_exp), 1 if archived else 0, t, pkey(p)))
        else:
            p = native(p)
            self.put([{"path": p, "parent": os.path.dirname(p), "name": os.path.basename(p),
                       "size": os.path.getsize(p) if os.path.isfile(p) else 0,
                       "mtime": int(os.path.getmtime(p)) if os.path.exists(p) else 0,
                       "kind": kind(os.path.splitext(p)[1])}])
            self.x("UPDATE files SET provider_id=?,object_key=?,link=?,link_exp=?,archived=?,updated_at=? WHERE pkey=?",
                   (provider_id, object_key, link, int(link_exp), 1 if archived else 0, t, pkey(p)))

    def cloud_clear(self, p):
        self.x("UPDATE files SET provider_id='',object_key='',link='',link_exp=0,archived=0,updated_at=? "
               "WHERE pkey=?", (now(), pkey(p)))

    def cd_list(self, provider_id, parent=""):
        return self.q("SELECT * FROM clouddrive WHERE provider_id=? AND parent=? "
                      "ORDER BY is_dir DESC,name COLLATE NOCASE", (provider_id, parent or ""))

    def cd_get(self, provider_id, path):
        return self.one("SELECT * FROM clouddrive WHERE provider_id=? AND path=?", (provider_id, path))

    def cd_add(self, provider_id, path, name, is_dir, object_key="", size=0, mtime=0):
        t = now()
        parent = path.rsplit("/", 1)[0] if "/" in path else ""
        self.x("INSERT INTO clouddrive(provider_id,parent,path,name,is_dir,object_key,size,mtime,created_at,updated_at) "
               "VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider_id,path) DO UPDATE SET "
               "parent=excluded.parent,name=excluded.name,is_dir=excluded.is_dir,object_key=excluded.object_key,"
               "size=excluded.size,mtime=excluded.mtime,updated_at=excluded.updated_at",
               (provider_id, parent, path, name, 1 if is_dir else 0, object_key, int(size or 0),
                int(mtime or 0), t, t))

    def cd_mkdirs(self, provider_id, path):
        parts = [x for x in str(path or "").split("/") if x]
        cur = ""
        for name in parts:
            cur = name if not cur else cur + "/" + name
            old = self.cd_get(provider_id, cur)
            if old and not old.get("is_dir"):
                raise RuntimeError("路径中已存在同名文件：%s" % cur)
            if not old:
                self.cd_add(provider_id, cur, name, 1, "", 0, now())

    def cd_keys(self, provider_id):
        return {r["object_key"] for r in self.q(
            "SELECT object_key FROM clouddrive WHERE provider_id=? AND object_key<>''", (provider_id,))}

    def cd_seed(self, agent, pids):
        pids = list(pids or [])
        if not pids:
            return
        qs = ",".join("?" for _ in pids)
        rows = self.q("SELECT provider_id,object_key,name,size,mtime FROM files "
                      "WHERE is_dir=0 AND object_key<>'' AND provider_id IN (" + qs + ")", pids)
        for pid in pids:
            keys = self.cd_keys(pid)
            root = self.q("SELECT name FROM clouddrive WHERE provider_id=? AND parent=''", (pid,))
            names = {str(r["name"]).lower() for r in root}
            for r in rows:
                if r["provider_id"] != pid or r["object_key"] in keys:
                    continue
                name = util_safe(r.get("name") or "file")
                if "." in name:
                    stem, dot = name.rsplit(".", 1)
                else:
                    stem, dot = name, ""
                n = 2
                while name.lower() in names:
                    name = "%s (%d)%s" % (stem, n, ("." + dot) if dot else "")
                    n += 1
                self.cd_add(pid, name, name, 0, r["object_key"], r.get("size") or 0, r.get("mtime") or 0)
                names.add(name.lower())
                keys.add(r["object_key"])

    def cd_del_key(self, object_key):
        if object_key:
            self.x("DELETE FROM clouddrive WHERE object_key=?", (object_key,))

    def touch_key(self, object_key, size, mtime):
        if object_key:
            self.x("UPDATE files SET size=?,mtime=?,updated_at=? WHERE object_key=?",
                   (int(size or 0), int(mtime or 0), now(), object_key))

    def cd_del_provider(self, provider_id):
        self.x("DELETE FROM clouddrive WHERE provider_id=?", (provider_id,))

    def done_scan(self, sid):
        with self.lk:
            self.h.execute("DELETE FROM files WHERE scan_id<>? AND object_key=''", (sid,))
            self.h.commit()

    def kids(self, parent):
        return self.q("SELECT * FROM files WHERE parent=? ORDER BY is_dir DESC,name COLLATE NOCASE", (native(parent),))

    def search(self, q, limit=80):
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        return self.q("SELECT * FROM files WHERE is_dir=0 AND (name LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') "
                      "ORDER BY name COLLATE NOCASE LIMIT ?", (like, like, int(limit)))

    def media(self, limit=0, paths=None):
        sql = "SELECT * FROM files WHERE is_dir=0 AND kind IN ('pdf','audio','video')"
        args = []
        if paths:
            marks = ",".join("?" for _ in paths)
            sql += " AND pkey IN (" + marks + ")"
            args = [pkey(x) for x in paths]
        sql += " ORDER BY archived DESC,updated_at DESC"
        if limit:
            sql += " LIMIT ?"
            args.append(int(limit))
        return self.q(sql, args)

    def find(self, kind="", status="", provider_id="", limit=500):
        sql = "SELECT * FROM files WHERE is_dir=0"
        args = []
        if kind and kind != "all":
            sql += " AND kind=?"
            args.append(kind)
        if status == "local":
            sql += " AND archived=0 AND object_key=''"
        elif status == "cloud":
            sql += " AND archived=1"
        elif status == "both":
            sql += " AND archived=0 AND object_key<>''"
        if provider_id:
            sql += " AND provider_id=?"
            args.append(provider_id)
        sql += " ORDER BY archived DESC,updated_at DESC LIMIT ?"
        args.append(max(1, min(1000, int(limit or 500))))
        return self.q(sql, args)

    def arch(self, provider_id=""):
        sql = "SELECT * FROM files WHERE is_dir=0 AND archived=1 AND object_key<>''"
        args = []
        if provider_id:
            sql += " AND provider_id=?"
            args.append(provider_id)
        return self.q(sql, args)

    def counts(self):
        r = self.one("SELECT SUM(CASE WHEN is_dir=0 THEN 1 ELSE 0 END) AS n, "
                     "COALESCE(SUM(CASE WHEN is_dir=0 THEN size ELSE 0 END),0) AS bytes, "
                     "COALESCE(SUM(CASE WHEN archived=1 THEN 1 ELSE 0 END),0) AS archived "
                     "FROM files") or {}
        return {"files": int(r.get("n") or 0), "bytes": int(r.get("bytes") or 0),
                "archived": int(r.get("archived") or 0)}

    def pages(self, size=400):
        off = 0
        while True:
            rows = self.q("SELECT * FROM files ORDER BY pkey LIMIT ? OFFSET ?", (int(size), off))
            if not rows:
                break
            for r in rows:
                yield r
            if len(rows) < size:
                break
            off += size

    def log(self, lid, provider_id, op, count, detail):
        data = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
        self.x("INSERT OR REPLACE INTO logs(id,provider_id,op,count,detail,created_at) VALUES(?,?,?,?,?,?)",
               (lid, provider_id, op, int(count), data, now()))
        return lid

    def logs(self, provider_id="", limit=100):
        sql = "SELECT id,provider_id,op,count,created_at FROM logs"
        args = []
        if provider_id:
            sql += " WHERE provider_id=?"
            args.append(provider_id)
        sql += " ORDER BY created_at DESC LIMIT ?"
        args.append(int(limit))
        return self.q(sql, args)

    def getlog(self, lid):
        r = self.one("SELECT * FROM logs WHERE id=?", (lid,))
        if r:
            try:
                r["detail"] = json.loads(r["detail"])
            except Exception:
                r["detail"] = {}
        return r

    def stitch(self, d):
        sid = d.get("id") or os.urandom(8).hex()
        ps = d.get("providers") or []
        self.x("INSERT INTO stitches(id,name,providers,strategy,created_at) VALUES(?,?,?,?,?) "
               "ON CONFLICT(id) DO UPDATE SET name=excluded.name,providers=excluded.providers,strategy=excluded.strategy",
               (sid, str(d.get("name") or "云存储拼接")[:60], json.dumps(ps), str(d.get("strategy") or "round_robin"),
                int((self.one("SELECT created_at FROM stitches WHERE id=?", (sid,)) or {}).get("created_at") or now())))
        return self.gets(sid)

    def gets(self, sid):
        r = self.one("SELECT * FROM stitches WHERE id=?", (sid,))
        if r:
            try:
                r["providers"] = json.loads(r["providers"])
            except Exception:
                r["providers"] = []
        return r

    def stitches(self):
        rows = self.q("SELECT * FROM stitches ORDER BY created_at")
        for r in rows:
            try:
                r["providers"] = json.loads(r["providers"])
            except Exception:
                r["providers"] = []
        return rows

    def delstitch(self, sid):
        self.x("DELETE FROM stitches WHERE id=?", (sid,))
