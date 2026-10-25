PRESETS = [
    {"code": "aliyun", "name": "阿里云 OSS", "endpoint": "https://s3.oss-cn-hangzhou.aliyuncs.com",
     "region": "cn-hangzhou", "style": "path", "color": "#ff6a00",
     "note": "按 OSS 控制台的 S3 兼容 Endpoint 与地域填写。"},
    {"code": "tencent", "name": "腾讯云 COS", "endpoint": "https://cos.ap-guangzhou.myqcloud.com",
     "region": "ap-guangzhou", "style": "virtual", "color": "#1d7dfa",
     "note": "使用 COS 的 S3 兼容访问方式。"},
    {"code": "huawei", "name": "华为云 OBS", "endpoint": "https://obs.cn-north-4.myhuaweicloud.com",
     "region": "cn-north-4", "style": "virtual", "color": "#cf0a2c",
     "note": "以 OBS 控制台的 S3 兼容 Endpoint 为准。"},
    {"code": "volcengine", "name": "火山引擎 TOS", "endpoint": "https://tos-s3-cn-beijing.volces.com",
     "region": "cn-beijing", "style": "virtual", "color": "#1664ff",
     "note": "TOS 需使用带 -s3- 的端点，只支持虚拟主机样式。"},
    {"code": "tianyi", "name": "天翼云 OOS", "endpoint": "", "region": "cn-shanghai",
     "style": "virtual", "color": "#db0e2e", "note": "从 OOS 控制台获取 S3 兼容 Endpoint。"},
    {"code": "minio", "name": "MinIO / 自建", "endpoint": "http://127.0.0.1:9000",
     "region": "us-east-1", "style": "path", "color": "#c72c48", "note": "自建 S3 兼容存储与本地测试。"},
    {"code": "custom", "name": "其他 S3 兼容存储", "endpoint": "", "region": "us-east-1",
     "style": "path", "color": "#6b7280", "note": "填写标准 S3 兼容端点。"},
]


def get(code):
    for p in PRESETS:
        if p["code"] == code:
            return p
    return PRESETS[-1]
