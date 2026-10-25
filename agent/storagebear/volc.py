import datetime
import hashlib
import hmac
import json
import ssl
import urllib.error
import urllib.request

from . import VERSION

HOST = "billing.volcengineapi.com"
SERVICE = "billing"
REGION = "cn-beijing"
VERSION_API = "2022-01-01"
FIELDS = ("AccountID", "AvailableBalance", "CashBalance", "CreditLimit", "FreezeAmount", "ArrearsBalance")


class VolcError(Exception):
    def __init__(self, status, msg, code=""):
        Exception.__init__(self, msg)
        self.status = int(status or 0)
        self.msg = str(msg)
        self.code = str(code or "")


def _hm(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _sign(ak, sk, method, path, query, body, when):
    xdate = when.strftime("%Y%m%dT%H%M%SZ")
    day = when.strftime("%Y%m%d")
    body_hash = hashlib.sha256(body).hexdigest()
    canon = "\n".join([method, path, query, "host:" + HOST, "x-date:" + xdate, "",
                       "host;x-date", body_hash])
    scope = "%s/%s/%s/request" % (day, REGION, SERVICE)
    sts = "\n".join(["HMAC-SHA256", xdate, scope, hashlib.sha256(canon.encode("utf-8")).hexdigest()])
    k = _hm(sk.encode("utf-8"), day)
    k = _hm(k, REGION)
    k = _hm(k, SERVICE)
    k = _hm(k, "request")
    sig = hmac.new(k, sts.encode("utf-8"), hashlib.sha256).hexdigest()
    auth = "HMAC-SHA256 Credential=%s/%s, SignedHeaders=host;x-date, Signature=%s" % (ak, scope, sig)
    return auth, xdate


def _error(status, raw):
    msg, code = "", ""
    try:
        j = json.loads(raw.decode("utf-8"))
        err = ((j.get("ResponseMetadata") or {}).get("Error") or {})
        msg, code = err.get("Message") or "", err.get("Code") or ""
    except Exception:
        msg = raw.decode("utf-8", "replace")[:300]
    if status == 403:
        return VolcError(403, "权限不足（403）：当前 AccessKey 没有费用中心查询余额的权限。"
                              "请在火山引擎「访问控制 IAM」中给子账号授予 QueryBalanceAcct（billing）"
                              "权限，或改用主账号密钥。", code or "AccessDenied")
    return VolcError(status, msg or "火山引擎请求失败（%s）" % status, code)


def query_balance(ak, sk):
    if not ak or not sk:
        raise VolcError(0, "请先填写火山引擎的 AccessKey 与 SecretKey", "MissingKey")
    query = "Action=QueryBalanceAcct&Version=" + VERSION_API
    when = datetime.datetime.utcnow()
    auth, xdate = _sign(ak, sk, "GET", "/", query, b"", when)
    req = urllib.request.Request(
        "https://%s/?%s" % (HOST, query), method="GET",
        headers={"Host": HOST, "X-Date": xdate, "Authorization": auth,
                 "Accept": "application/json", "User-Agent": "StorageBear-Agent/%s" % VERSION})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ssl.create_default_context()) as r:
            raw = r.read(1024 * 1024)
    except urllib.error.HTTPError as e:
        raise _error(e.code, e.read(1024 * 1024))
    except urllib.error.URLError as e:
        raise VolcError(0, "无法连接火山引擎费用中心：%s" % (e.reason,))
    except Exception as e:
        raise VolcError(0, "火山引擎余额查询失败：%s" % e)
    try:
        j = json.loads(raw.decode("utf-8"))
    except Exception:
        raise VolcError(0, "余额响应解析失败")
    if (j.get("ResponseMetadata") or {}).get("Error"):
        raise _error(200, raw)
    res = j.get("Result") or {}
    if not res:
        raise VolcError(0, "余额响应为空")
    out = {k: res.get(k, "") for k in FIELDS}
    out["ok"] = True
    return out
