import datetime
import hashlib
import hmac
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


class S3Error(Exception):
    def __init__(self, status, msg, code=""):
        Exception.__init__(self, msg)
        self.status = int(status or 0)
        self.msg = str(msg)
        self.code = code


def _q(v):
    return urllib.parse.quote(str(v), safe="-_.~")


def _hm(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _etag(x):
    return x.strip().strip('"')


def _xml(raw):
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise ValueError("unsafe xml")
    return ET.fromstring(raw)


def _denied(msg, code):
    low = (code + " " + msg).lower()
    if "signature" in low or "accesskey" in low or "credential" in low:
        return "密钥或签名不匹配：请核对 AccessKey / SecretKey、Endpoint 与 Region。原始信息：%s" % msg
    return ("权限不足（403）：当前密钥不能操作这个 Bucket。请确认子账号已获得该 Bucket 的"
            "列出、读取与写入权限。原始信息：%s" % msg)


class S3:
    def __init__(self, conf):
        ep = (conf.get("endpoint") or "").strip()
        if not ep:
            raise S3Error(0, "对象存储 Endpoint 为空")
        if "://" not in ep:
            ep = "https://" + ep
        u = urllib.parse.urlsplit(ep)
        if u.scheme not in ("http", "https") or not u.hostname:
            raise S3Error(0, "Endpoint 格式无效")
        self.scheme = u.scheme
        self.host = u.hostname
        self.port = u.port
        self.base = u.path.rstrip("/")
        self.bucket = (conf.get("bucket") or "").strip()
        self.region = (conf.get("region") or "us-east-1").strip() or "us-east-1"
        self.ak = conf.get("access_key", "")
        self.sk = conf.get("secret_key", "")
        self.style = conf.get("style") or "path"
        if not self.bucket:
            raise S3Error(0, "Bucket 为空")
        if not self.ak or not self.sk:
            raise S3Error(0, "AccessKey / SecretKey 未填写")
        if self.style == "virtual":
            if self.port:
                self.netloc = "%s.%s:%s" % (self.bucket, self.host, self.port)
            else:
                self.netloc = "%s.%s" % (self.bucket, self.host)
        else:
            self.netloc = self.host + (":" + str(self.port) if self.port else "")
        self.timeout = int(conf.get("timeout", 60))
        self.ctx = ssl.create_default_context()

    def _key(self, key):
        return "/".join(_q(x) for x in str(key).split("/"))

    def _path(self, key):
        if self.style == "virtual":
            if key is None:
                return (self.base + "/") if self.base else "/"
            return self.base + "/" + self._key(key)
        base = self.base + "/" + _q(self.bucket)
        if key is None:
            return base
        return base + "/" + self._key(key)

    def _query(self, qs):
        return "&".join(_q(k) + "=" + _q(v) for k, v in sorted(qs, key=lambda x: (x[0], x[1])))

    def _url(self, key, qs):
        path = self._path(key)
        q = self._query(qs)
        return "%s://%s%s%s" % (self.scheme, self.netloc, path, ("?" + q) if q else ""), path, q

    def _sign(self, method, path, q, body_hash, when=None, headers=None):
        when = when or datetime.datetime.utcnow()
        amz = when.strftime("%Y%m%dT%H%M%SZ")
        day = when.strftime("%Y%m%d")
        hs = {"host": self.netloc, "x-amz-content-sha256": body_hash, "x-amz-date": amz}
        if headers:
            for k, v in headers.items():
                hs[k.lower()] = str(v).strip()
        names = sorted(k for k in hs if k in ("host", "x-amz-content-sha256", "x-amz-date") or
                       k.startswith("x-amz-") or k in ("content-type", "content-md5"))
        canon_h = "".join(k + ":" + hs[k] + "\n" for k in names)
        sh = ";".join(names)
        req = "\n".join([method, path or "/", q, canon_h, sh, body_hash])
        scope = "%s/%s/s3/aws4_request" % (day, self.region)
        sts = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(req.encode("utf-8")).hexdigest()])
        k = _hm(("AWS4" + self.sk).encode("utf-8"), day)
        k = _hm(k, self.region)
        k = _hm(k, "s3")
        k = _hm(k, "aws4_request")
        sig = hmac.new(k, sts.encode("utf-8"), hashlib.sha256).hexdigest()
        return ("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s"
                % (self.ak, scope, sh, sig)), amz, hs

    def _send(self, method, key, qs=None, data=b"", headers=None, timeout=None, want_headers=False):
        qs = qs or []
        url, path, q = self._url(key, qs)
        payload = data if isinstance(data, bytes) else data
        body_hash = hashlib.sha256(payload).hexdigest()
        auth, amz, hs = self._sign(method, path, q, body_hash, headers=headers)
        h = {"Authorization": auth, "x-amz-content-sha256": body_hash, "x-amz-date": amz}
        for k, v in hs.items():
            if k.startswith("content-") or k.startswith("x-amz-meta") or k == "x-amz-acl":
                h[k] = v
        if headers:
            for k, v in headers.items():
                h[k] = v
        h["Content-Length"] = str(len(payload)) if payload is not None else "0"
        req = urllib.request.Request(url, data=payload if method in ("PUT", "POST") else None, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout, context=self.ctx) as r:
                raw = r.read() if method != "HEAD" else b""
                return (raw, dict(r.headers)) if want_headers else raw
        except urllib.error.HTTPError as e:
            raw = e.read(256 * 1024)
            msg, code = "", ""
            try:
                root = _xml(raw)
                for el in root.iter():
                    tag = el.tag.split("}")[-1]
                    if tag == "Message":
                        msg = el.text or ""
                    elif tag == "Code":
                        code = el.text or ""
            except Exception:
                msg = raw.decode("utf-8", "replace")[:300]
            if not msg:
                msg = "对象存储请求失败 (%s %s)" % (e.code, method)
            if e.code == 403:
                msg = _denied(msg, code)
            raise S3Error(e.code, msg, code)
        except urllib.error.URLError as e:
            raise S3Error(0, "无法连接对象存储：%s" % (e.reason,))
        except Exception as e:
            raise S3Error(0, "对象存储请求失败：%s" % (e,))

    def bucket_path(self):
        return None

    def test(self):
        self._send("HEAD", None, timeout=20)
        return True

    def mkbucket(self):
        self._send("PUT", None, timeout=20)
        return True

    def head(self, key):
        _, hd = self._send("HEAD", key, timeout=20, want_headers=True)
        return hd

    def put_bytes(self, key, data, ctype="application/octet-stream"):
        self._send("PUT", key, data=data, headers={"Content-Type": ctype})
        return True

    def put_file(self, key, path, ctype="application/octet-stream"):
        size = os.path.getsize(path)
        if size <= 64 * 1024 * 1024:
            with open(path, "rb") as f:
                data = f.read()
            self._send("PUT", key, data=data, headers={"Content-Type": ctype}, timeout=600)
            return True
        return self._multi(key, path, ctype)

    def _multi(self, key, path, ctype):
        raw, hd = self._send("POST", key, [("uploads", "")], data=b"", headers={"Content-Type": ctype},
                             timeout=120, want_headers=True)
        upload_id = ""
        try:
            root = _xml(raw)
            for el in root.iter():
                if el.tag.split("}")[-1] == "UploadId":
                    upload_id = el.text or ""
                    break
        except Exception:
            pass
        if not upload_id:
            raise S3Error(0, "无法创建分片上传任务")
        parts = []
        n = 0
        try:
            with open(path, "rb") as f:
                while True:
                    data = f.read(16 * 1024 * 1024)
                    if not data:
                        break
                    n += 1
                    _, ph = self._send("PUT", key, [("partNumber", n), ("uploadId", upload_id)], data=data,
                                       headers={"Content-Type": ctype}, timeout=600, want_headers=True)
                    et = ph.get("ETag") or ph.get("etag") or ""
                    if not et:
                        raise S3Error(0, "分片上传缺少 ETag")
                    parts.append((n, _etag(et)))
            body = "<CompleteMultipartUpload>" + "".join(
                "<Part><PartNumber>%d</PartNumber><ETag>&quot;%s&quot;</ETag></Part>" % p for p in parts
            ) + "</CompleteMultipartUpload>"
            self._send("POST", key, [("uploadId", upload_id)], data=body.encode("utf-8"),
                       headers={"Content-Type": "application/xml"}, timeout=300)
        except Exception:
            try:
                self._send("DELETE", key, [("uploadId", upload_id)], timeout=60)
            except Exception:
                pass
            raise
        return True

    def get_bytes(self, key, limit=100 * 1024 * 1024):
        raw = self._send("GET", key, timeout=120)
        if len(raw) > limit:
            raise S3Error(0, "对象过大")
        return raw

    def download(self, key, dst, expires=3600):
        url = self.presign(key, expires)
        tmp = dst + ".sbpart"
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "StorageBear/0.1"})
            with urllib.request.urlopen(req, timeout=600, context=self.ctx) as r, open(tmp, "wb") as f:
                while True:
                    b = r.read(1024 * 1024)
                    if not b:
                        break
                    f.write(b)
            os.replace(tmp, dst)
        except urllib.error.HTTPError as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise S3Error(e.code, "云端下载失败 (%s)" % e.code)
        except urllib.error.URLError as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise S3Error(0, "云端下载失败：%s" % (e.reason,))
        return dst

    def delete(self, key):
        self._send("DELETE", key)
        return True

    def presign(self, key, expires=3600):
        expires = max(60, min(int(expires), 604800))
        when = datetime.datetime.utcnow()
        day = when.strftime("%Y%m%d")
        amz = when.strftime("%Y%m%dT%H%M%SZ")
        scope = "%s/%s/s3/aws4_request" % (day, self.region)
        qs = [
            ("X-Amz-Algorithm", "AWS4-HMAC-SHA256"),
            ("X-Amz-Credential", "%s/%s" % (self.ak, scope)),
            ("X-Amz-Date", amz),
            ("X-Amz-Expires", str(expires)),
            ("X-Amz-SignedHeaders", "host"),
        ]
        path = self._path(key)
        q = self._query(qs)
        payload = "UNSIGNED-PAYLOAD"
        canon = "\n".join(["GET", path, q, "host:" + self.netloc + "\n", "host", payload])
        sts = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canon.encode("utf-8")).hexdigest()])
        k = _hm(("AWS4" + self.sk).encode("utf-8"), day)
        k = _hm(k, self.region)
        k = _hm(k, "s3")
        k = _hm(k, "aws4_request")
        sig = hmac.new(k, sts.encode("utf-8"), hashlib.sha256).hexdigest()
        return "%s://%s%s?%s&X-Amz-Signature=%s" % (self.scheme, self.netloc, path, q, sig)
