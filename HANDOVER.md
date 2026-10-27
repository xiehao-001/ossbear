# 存储熊 StorageBear 交接报告

- 交接时间：2026-10-27
- 当前版本：**0.2.5**（服务端 / 客户端 / 代理一致）
- 公开仓库：<https://github.com/xiehao-001/ossbear>（public，HTTPS/SSH：`git@github.com:xiehao-001/ossbear.git`）
- 线上入口：`http://47.100.27.233`（域名 `www.ai-xiehao.me` 备案中，暂以 IP 代替）

---

## 1. 产品与组件

存储熊把多家对象存储（火山引擎 TOS、阿里 OSS、腾讯 COS、华为 OBS 等）挂成一块 Windows 本地虚拟盘。

| 组件 | 语言 | 位置 | 说明 |
| --- | --- | --- | --- |
| 服务端 | C++17 / SQLite / libcurl | `/root/存储熊/server`（**不在公开仓库**） | 账号、验证码、同步任务、云存储配置、日志汇总；静态托管宣传页与安装包 |
| 本机代理 | Python 3.11 | 仓库 `agent/` | 扫描、云存储读写、WebDAV、迁移、本地 API；随安装包发布 |
| 桌面客户端 | Electron 31 | 仓库 `desktop/` | 登录、虚拟盘管理、Office/WPS 预览、一键修复挂载、快捷链接、诊断日志清理 |
| 宣传站 | 静态 HTML/CSS/JS | `/root/存储熊/server/web` | 首页 `/`、教程 `/guide`、手册 `/manual`、隐私 `/privacy`、条款 `/terms`、手机版 `/app`（开发中） |

**重要**：C++ 服务端源码当前只存在于本机 `/root/存储熊/server`，**尚未纳入公开仓库**。它负责鉴权与静态路由白名单，改动服务端逻辑前请确认这是不是预期状态（见第 9 节 TODO）。

---

## 2. 目录与关键文件

### 2.1 公开仓库（`/root/storagebear-github`，remote `git@github.com:xiehao-001/ossbear.git`）

```
agent/                    Python 本机代理
  storagebear/            agent.py drive.py jobs.py localapi.py localdb.py ops.py
                          presets.py remote.py s3.py scan.py util.py volc.py
  build.bat build.sh main.py storagebear.spec
desktop/                  Electron 客户端
  src/main.js             主进程：窗口、托盘、自动更新、IPC、修复挂载
  src/preload.js
  src/preview.js          预览窗口
  src/renderer/app.js     渲染进程主逻辑（登录、虚拟盘、文件、日志清理）
  src/renderer/index.html
  build/                  icon.ico、installer.nsh（NSIS 定制脚本）
  package.json            版本号 + electron-builder 配置（含 publish 更新源）
.github/workflows/build-windows.yml   Windows 打包 / 发布 / 保留策略
README.md RELEASING.md HANDOVER.md
```

### 2.2 服务器（不在仓库）

```
/root/存储熊/server/src/main.cpp     服务端全部逻辑（路由、鉴权、SQLite、静态托管）
/root/存储熊/server/src/http.cpp/.h   极简 HTTP 服务器
/root/存储熊/server/CMakeLists.txt
/root/存储熊/server/build/            cmake 构建目录
/root/存储熊/server/web/              宣传页源码（部署源）
/root/存储熊/server/web/assets/guide/ 教程脱敏截图 step01..step13 + pricing.png
/root/guide-images/                   教程原始截图 raw00..raw13 + 脱敏脚本 mask.py
```

### 2.3 线上部署路径

```
/opt/storagebear/storagebear           服务端二进制（root:root，可执行）
/opt/storagebear/storagebear.bak-*     历史二进制备份（0.1.2 / 0.1.5 / 0.1.6 / 0.1.7 / 0.1.9 / 0.2.4）
/opt/storagebear/web/                  宣传页与更新目录（storagebear:storagebear）
/opt/storagebear/web/updates/          安装包 / latest.yml / blockmap / SHA256.txt
/var/lib/storagebear/storagebear.db    SQLite 数据库（storagebear:storagebear，0600）
/etc/storagebear/resend.env            邮件与公网地址密钥（0600，root）
/etc/systemd/system/storagebear.service
/etc/systemd/system/storagebear.service.d/mail.conf
/www/server/panel/vhost/nginx/storagebear.conf          默认站点（IP）
/www/server/panel/vhost/nginx/www.ai-xiehao.me.conf     域名站点
```

---

## 3. 运行配置

### 3.1 systemd

`/etc/systemd/system/storagebear.service`：

```ini
User=storagebear
Environment=SB_PORT=8090
Environment=SB_BIND=127.0.0.1
Environment=SB_DATA=/var/lib/storagebear
Environment=SB_WEB=/opt/storagebear/web
ExecStart=/opt/storagebear/storagebear
Restart=on-failure
ProtectSystem=strict
ReadWritePaths=/var/lib/storagebear
```

drop-in `mail.conf` 以 `EnvironmentFile=-/etc/storagebear/resend.env` 注入邮件配置。

### 3.2 `/etc/storagebear/resend.env`（**只在服务器上，永不进仓库**）

| 变量 | 用途 |
| --- | --- |
| `RESEND_API_KEY` | Resend 邮件服务密钥 |
| `SB_MAIL_FROM` | 发件人地址 |
| `SB_PUBLIC_URL` | 公网根地址，当前 `http://47.100.27.233`，备案完成后改回 `http://www.ai-xiehao.me` |
| `SB_CODE_SALT` | 验证码哈希盐 |

改动方式：编辑该文件后 `systemctl restart storagebear`。备份：`resend.env.bak-*`。

### 3.3 Nginx

两个 vhost 都把 `/updates/` 直接 alias 到 `/opt/storagebear/web/updates/`（不经应用进程），其余路径反代到 `127.0.0.1:8090`：

```nginx
location ^~ /updates/ {
    alias /opt/storagebear/web/updates/;
    autoindex off;
    add_header Cache-Control "no-cache";
    types { text/yaml yml; application/octet-stream exe blockmap; }
}
```

`storagebear.conf` 是 `default_server`，`server_name 47.100.27.233 _`；域名 vhost 已预置 ACME 校验目录 `/www/wwwroot/letsencrypt`，备案通过后可直接签发证书。

### 3.4 数据库

SQLite `/var/lib/storagebear/storagebear.db`，表：`users / devices / providers / files / stitches / tasks / logs / sessions / email_codes`。当前数据量：用户 4、设备 2、云存储配置 1、文件 2432、日志 13。

---

## 4. 客户端内置服务器地址（备案期间）

0.2.5 起客户端**不再让用户填写服务器地址**：

- `desktop/src/main.js` 顶部常量：
  ```js
  const SERVER = "http://47.100.27.233";
  const PUBLIC = SERVER;
  const UPD_URL = PUBLIC + "/updates/";
  ```
- `sb:app-info` IPC 返回 `server` / `publicUrl`，渲染进程 `serverBase()` 读取后用于登录请求与站点链接。
- 渲染进程 `document.title` 与 `desktop/src/renderer/index.html` 的 `<title>` 统一为 **`存储熊 | storagebear`**。

**备案通过后切回域名的两处**（本次会话已把 `package.json` 的 `build.publish.url` 也保留为域名）：

1. `desktop/src/main.js`：`SERVER` 改为 `http://www.ai-xiehao.me`
2. `/etc/storagebear/resend.env`：`SB_PUBLIC_URL` 改为 `http://www.ai-xiehao.me`

改完需重新打包发布，并确认 `http://www.ai-xiehao.me/api/config` 返回新的 `public_url`。

---

## 5. 发布流水线

### 5.1 触发

推送 `vX.Y.Z` 标签即触发 [.github/workflows/build-windows.yml](.github/workflows/build-windows.yml)：Windows 2022 runner → `npm install`（带 npmmirror 镜像重试）→ `build-release.bat` → 计算 SHA256 → 创建公开 Release → 清理旧 Release → 上传 Actions 产物。

每个安装包约 96 MB，完整打包约 2 分钟。

### 5.2 发布后的手动步骤（服务器上）

```bash
# 1) 下载 4 个产物（github.com 直连不通时用 gh-proxy）
BASE=https://gh-proxy.com/https://github.com/xiehao-001/ossbear/releases/download/v0.2.5
curl -L -o StorageBear-Setup-0.2.5.exe            $BASE/StorageBear-Setup-0.2.5.exe
curl -L -o StorageBear-Setup-0.2.5.exe.blockmap   $BASE/StorageBear-Setup-0.2.5.exe.blockmap
curl -L -o latest.yml                              $BASE/latest.yml
curl -L -o SHA256.txt                              $BASE/SHA256.txt

# 2) 校验
sha256sum StorageBear-Setup-0.2.5.exe   # 与 SHA256.txt 一致
sha512sum StorageBear-Setup-0.2.5.exe   # 与 latest.yml 的 sha512 一致（base64）

# 3) 发布到更新目录并切软链
command cp -f StorageBear-Setup-0.2.5.exe StorageBear-Setup-0.2.5.exe.blockmap \
             latest.yml SHA256.txt /opt/storagebear/web/updates/
ln -sfn StorageBear-Setup-0.2.5.exe /opt/storagebear/web/updates/StorageBear-Setup-latest.exe
chown storagebear:storagebear /opt/storagebear/web/updates/*
```

### 5.3 版本规则（SemVer）

- `0.x` 阶段：不兼容变更或成组新功能 → 提升次版本（0.2.5 → 0.3.0）；缺陷修复/文档/构建修复 → 提升修订号（0.2.5 → 0.2.6）。
- 正式发行后从 `1.0.0` 开始，不兼容变更提升主版本。
- 标签固定 `vMAJOR.MINOR.PATCH`，**只新增，不移动、不删除**，不使用强制推送。
- 改版本号必须同步：`agent/storagebear/__init__.py`、`desktop/package.json`、`desktop/package-lock.json`（**只改顶层 `version` 与 `packages[""].version`，不要全局替换，否则会破坏依赖锁定**）、`build-release.bat`、服务端 `main.cpp` 的 `v["version"]`、宣传页各页版本号。
- 推荐：`npm version --no-git-tag-version X.Y.Z`。

### 5.4 保留策略

- 预稳定阶段：GitHub Release 与官网 `/updates/` 只保留**当前次版本最新的 3 个安装包**。
- 工作流内置「保留当前次版本最新 3 个 Release」步骤（`continue-on-error: true`，失败需人工补做）。该步骤按 `v<主>.<次>.` 前缀筛选 Release，保留版本号最大的 3 个。
- 稳定下载链接 `/updates/StorageBear-Setup-latest.exe` 是软链，不参与计数。
- 删除旧产物前先确认新安装包与 `latest.yml` 已上传且可下载。
- Git 标签始终保留，删 Release 不删 Tag。

**当前实际状态（0.2.5 发布后）**：`/updates/` 与 GitHub Release 均为 0.2.5 / 0.2.4 / 0.2.0 三个，恰好达到上限——因为 0.2.1～0.2.3 打包失败没有产生 Release，窗口由 0.2.0 补齐。若希望严格按「最新三个补丁号」滚动（0.2.5/0.2.4/0.2.3），需手动删除 0.2.0 的安装包与 Release；工作流在下个版本会自动补上 0.2.6，届时保留 0.2.6/0.2.5/0.2.4。

### 5.5 更新源

- 客户端运行时通过 `autoUpdater.setFeedURL({ provider: "generic", url: UPD_URL })` 指向**当前内置服务器**的 `/updates/`。
- `latest.yml` 里的 `url` 是相对文件名，所以同一份 `latest.yml` 对 IP 和域名都可用。
- GitHub Release 仅作构建产物归档，不再是客户端更新源。

---

## 6. 宣传页与教程

- 教程页：`http://47.100.27.233/guide`，13 步接入（火山引擎 TOS），按原始截图文件名顺序编排，末尾附选购建议（**建议购买标准存储，并使用按量购买/按量付费**）与免责说明（**个人经验，不构成商业意见**）。
- 截图脱敏脚本：`/root/guide-images/mask.py`，`JOBS` 列表把 `rawNN.png` 映射为 `stepNN.png` / `pricing.png` 并给出要涂黑的像素框。已遮盖内容：账号昵称、账号 ID、余额、积分、IAM 登录账号、IAM 用户名、AccessKey ID、Secret Access Key、Bucket 名称、应用账号数字。
- **改动教程页后必须同步两件事**：
  1. 把 `/root/存储熊/server/web/` 整个目录 `command cp -rf . /opt/storagebear/web/` 并 `chown -R storagebear:storagebear /opt/storagebear/web`；
  2. 若新增了页面路由，还要在 `main.cpp` 的 `staticFile()` 里加白名单（例：`else if (p == "/guide" || p == "/guide/") p = "/guide.html";`），否则新页面 404。
- 静态页路由白名单目前支持：`/`、`/manual`、`/guide`、`/app`、`/privacy`、`/terms`。

---

## 7. 常用运维命令

```bash
# 服务
systemctl status storagebear --no-pager
systemctl restart storagebear
journalctl -u storagebear -f
curl -s http://127.0.0.1:8090/api/config     # 版本、public_url、邮件是否就绪

# 重新编译服务端
cd /root/存储熊/server/build && cmake .. && make -j4
command cp -f /root/存储熊/server/build/storagebear /opt/storagebear/storagebear
systemctl restart storagebear

# 宣传页
command cp -rf /root/存储熊/server/web/. /opt/storagebear/web/
chown -R storagebear:storagebear /opt/storagebear/web

# Nginx
nginx -t && systemctl reload nginx

# 数据库
sqlite3 /var/lib/storagebear/storagebear.db ".tables"
sqlite3 /var/lib/storagebear/storagebear.db "select count(*) from files;"

# 仓库
cd /root/storagebear-github && git status && git log --oneline -10
git push origin main && git push origin v0.2.5
```

提交信息请写清**用户可见变化、验证方式、影响范围**，方便协作者接手；**任何密钥（Resend Key、云存储 AccessKey、GitHub Token、服务器 .env）都不得进入仓库**。

---

## 8. 本次已完成（0.2.5）

1. 客户端登录界面移除「服务器地址」输入框，服务器地址内置为 `http://47.100.27.233`。
2. 窗口标题与页面 `<title>` 统一为 `存储熊 | storagebear`。
3. 宣传站新增 `/guide` 接入教程页（13 步 + 选购建议 + 免责声明），首页/手册/页脚均已加入口；服务端静态路由已放行 `/guide`。
4. 14 张教程截图完成脱敏并逐张目视复核。
5. 宣传页与客户端文案更新为「域名备案期间使用 IP」。
6. 版本号统一提升到 0.2.5（服务端二进制已重新编译部署，`SB_PUBLIC_URL` 已切到 IP）。
7. v0.2.5 标签推送后 GitHub Actions 打包成功，已校验 SHA256/SHA512 并发布到 `/updates/`；`StorageBear-Setup-latest.exe` 软链指向 0.2.5。

验证：`http://47.100.27.233/`、`/manual`、`/guide`、`/guide.css`、`/assets/guide/*.png` 全部 200；`/api/config` 返回 `version=0.2.5`、`public_url=http://47.100.27.233`；`/updates/latest.yml` 返回 0.2.5 且 `sha512` 与实际安装包一致；`/updates/StorageBear-Setup-latest.exe` 返回 96670364 字节。

---

## 9. 待办与风险

| 事项 | 说明 | 优先级 |
| --- | --- | --- |
| 域名备案 | `www.ai-xiehao.me` 备案中，备案通过后按第 4 节切回域名并签发 HTTPS 证书（vhost 已预留 ACME 路径） | 高 |
| C++ 服务端未入库 | 服务端源码只在 `/root/存储熊/server`，公开仓库缺一半代码；确认是有意还是遗漏 | 高 |
| 更新源域名不一致 | `desktop/package.json` 的 `build.publish.url` 仍是域名（仅影响 `latest.yml` 生成，运行时被 `setFeedURL` 覆盖），备案后需一并统一 | 中 |
| 手机版 `/app` | 仍是「开发中」占位页 | 中 |
| Windows 实机回归 | 0.2.5 的安装、升级、虚拟盘挂载、快速链接尚未在 Windows 实机逐项验证（本次只验证了服务端与页面） | 中 |
| 只保留三个安装包 | `/updates/` 与 GitHub Release 现为 0.2.5 / 0.2.4 / 0.2.0（0.2.1～0.2.3 打包失败无产物），已达上限；如需严格补丁滚动窗口要手动删 0.2.0，见 5.4 | 低 |
| GitHub 直连受限 | 本机 `github.com` 443 超时，`api.github.com` 可用；大文件走 `gh-proxy.com`；`gh` CLI 未安装 | 低 |
| 备份 | `/opt/storagebear/storagebear.bak-*` 已积累 6 个旧二进制，可按需清理 | 低 |

---

## 10. 安全约束（务必遵守）

- 仓库公开，**任何密钥都不得进仓库**：Resend Key、云存储 AccessKey/SecretKey、GitHub Token、SSH 私钥、服务器 `.env`、用户数据库、安装包签名材料。
- 密钥只存在于部署服务器（`/etc/storagebear/resend.env`、数据库 `providers` 表）与用户本机加密存储。
- 发布用 GitHub 自动注入的 `GITHUB_TOKEN`，不新增长期自定义发布 Token。
- 提交前自查：`grep -rnE "re_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|BEGIN [A-Z ]*PRIVATE KEY|password\s*=\s*['\"]" .`
- 发现密钥误提交：立即在对应平台**轮换密钥**，再清理提交历史并通知协作者。
