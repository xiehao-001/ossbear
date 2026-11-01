# 存储熊 StorageBear 交接报告

- 交接时间：2026-10-27（2026-11-01 更新至 0.3.0）
- 当前版本：**0.3.0**（客户端 / 代理已在本地仓库推进；服务端二进制仍是 0.2.5，见第 8 节）
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

## 8. 本次已完成（0.3.0）

> 本次改动全部在本地工作副本 `C:\Users\dell\Desktop\存储熊本地开发\sb\storagebear-github` 完成，**尚未 push、尚未重新打包、服务器未部署**。

### 8.1 一键分享（右键，支持多选）

- 注册表从「快速创建链接」升级为「一键分享」：`desktop/src/main.js` 的 `QUICK_KEYS` 同时写 `*\shell\StorageBearQuickLink` 与 `Directory\shell\StorageBearQuickLink`，命令 `"<exe>" --quick-share "%1" %*`，`MultiSelectModel=Player` 允许一次选中多个文件/文件夹（旧键 `LEGACY_QUICK_KEY` 会在写入前被删除）。
- 新增 `agent/storagebear/pack.py`：把多个文件/文件夹打成一个包。优先 `zstandard`（`DEFAULT_LEVEL = 12`，多线程流式写入，边写边报进度）→ 缺模块时用系统自带 `C:\Windows\System32\tar.exe --zstd`（bsdtar 3.x 内置 libzstd，零依赖）→ 再不行回退 zip。包内保留相对目录结构，空目录也保留，临时包超过 1 天自动清理（`purge()`）。
- 新增 `Agent.sharepack()` / `sharepack_job()`（`agent/storagebear/agent.py`）：**单文件直接走原来的直传逻辑**（`quicklink`，不打包），多文件/文件夹才打包；对象键 `_storagebear/shares/YYYYMM/<包名>`，Content-Type `application/zstd`，链接沿用 `ops.link()` 的 6 天有效期。
- 新增本机接口：`POST /api/quick-share`（同步返回链接）、`POST /api/share-pack`（返回 job_id，前端可看进度）。
- 客户端 `runQuickShare()`：结果写剪贴板并弹系统通知，提示「N 项已打包成 xxx（原始 → 压缩）」或「单文件直传」，独立进程模式 1.8s 后自动退出。

### 8.2 盘间迁移（mklink）

- 新增右键菜单「存储熊：迁移到其它盘并创建链接」（`--quick-migrate`，同样支持多选）。
- 流程（`desktop/src/main.js` 的 `migrateOne()`）：校验（存在、非符号链接、非盘根、不在系统目录黑名单、不在存储熊数据目录）→ `robocopy /E /COPY:DAT` 复制到 `目标盘\StorageBearLinks\<源盘符>\<相对路径>` → 目录用 `fs.rmSync` 或文件比对大小后删除源 → `mklink /J`（目录联接）或 `mklink`（文件），链接失败自动把副本复制回去回滚。
- 目标盘选择：排除系统盘 C 与源盘，优先用户指定，否则选剩余空间最大的盘（`migrateTarget()`）。
- 黑名单 `MIGRATE_DENY`：`C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`、`C:\ProgramData`、`C:\$Recycle.Bin`、`C:\System Volume Information`、`C:\Recovery`、`C:\PerfLogs`；同时拒绝存储熊自身的 `%APPDATA%\StorageBear` 与 Electron `userData`。
- 设置页新增「盘间迁移（mklink）」卡片，可查看各盘剩余空间、一键选文件/文件夹发起迁移。

### 8.3 存储熊自身清理

- 新增 `agent/storagebear/housekeeping.py`：统计并清理 `tmp/`、`cache/`、`logs/`、临时分享包（`pack.purge()`），可选 `vacuum` 压缩 SQLite；`clean(types, days)` 返回释放的字节数与文件数并写日志。
- 新增接口 `GET /api/self-usage`、`POST /api/self-clean`。
- 客户端 `selfClean()` 额外清理 electron-updater 缓存（`storagebear-updater`、`userData/pending`、`temp/storagebear-updater`）与诊断日志；设置页新增「存储熊自身清理」卡片，显示各处占用并可一键清理。
- **只清理存储熊自己的痕迹**，不碰用户的索引文件、云端对象与其它目录。

### 8.4 Cloudflare R2 预设

- `agent/storagebear/presets.py` 与 `desktop/src/renderer/app.js` 的预设表新增 `cloudflare`：Endpoint `https://<账户ID>.r2.cloudflarestorage.com`、Region `auto`、路径样式。
- 手册第 4 节新增 R2 卡片，`/guide` 新增 `#r2` 章节；首页「兼容清单」补上 R2。

### 8.5 修复：设置页出现巨大黑色图形

第 13 张截图里「还没有常用目录」「免扫路径」两处出现巨大黑圆和黑色尖顶块，原因是 `desktop/src/renderer/app.js` 的图标全是无 `width/height` 的内联 `<svg viewBox="0 0 24 24">`，而 `style.css` 只给部分容器（`.nav-item svg` 等）写了尺寸规则，`.banner-tip`、`.root-item` 没有任何规则：SVG 默认 `fill: black`、宽度撑满容器、高度按 viewBox 比例，于是 `IC.info` 的圆形变成直径约 340px 的黑色实心圆，`IC.shield` 变成被裁切的黑色盾形。

修复：`desktop/src/renderer/style.css` 在 `img { max-width: 100%; }` 之后加全局兜底 `svg { width:16px; height:16px; flex:none; fill:none; stroke:currentColor; ... }`，并补 `.banner-tip svg`、`.root-item svg` 的具体尺寸（已用截图核对）。

### 8.6 手册与宣传站

- `/manual` 更新：第 6 节补「资源管理器右键：一键分享」「迁移到其它盘」，第 9 节补「盘间迁移（mklink）」，新增「存储熊自身清理」一节，第 4 节补 R2 与密钥申请指引。
- `/guide` 补齐「申请密钥」的完整 13 步（IAM 用户 → 权限策略 → AccessKey → 建桶 → Endpoint/Region → 填进存储熊）与 Cloudflare R2 申请步骤。
- 首页新增功能卡 08「右键一步：打包分享、盘间搬家」。

### 8.7 版本号

- 已同步提升到 **0.3.0**：`agent/storagebear/__init__.py`、`desktop/package.json`、`desktop/package-lock.json`（顶层与 `packages[""]`）、`build-release.bat`、宣传站所有页面。
- **未完成**：服务端 `main.cpp` 的版本字段仍是 0.2.5，需要重新编译部署，否则 `/api/config` 返回的版本号会与新客户端不一致，发布前必须一并处理。

### 8.8 验证情况

- `node --check` 通过：`desktop/src/main.js`、`desktop/src/renderer/app.js`、`desktop/src/preload.js`。
- `python -m py_compile` 通过：`agent/storagebear/{pack,housekeeping,agent,localapi,presets}.py`。
- 代理接口在本机实测（`SB_HOME` 指向临时目录，端口 18099）：`/api/self-usage`、`/api/self-clean`（删除测试垃圾文件成功）、`/api/quick-share`（无云存储时返回可读中文错误）、`/api/share-pack`（job 状态可见）。
- `pack.py` 单测：目录 + 中文文件名 → `.tar.zst`，解包内容与目录结构完全一致；禁用 `zstandard` 后走 bsdtar 仍产出 zstd（内容一致）；两者都不可用时回退 zip。
- **未验证**：Windows 实机上的 mklink 迁移（需要管理员或开发者模式的真实卷）、右键菜单实际注册效果、真实云存储上传分享包。这三项需要在实机回归时逐条确认。

### 8.9 实机验证补充（2026-11-01）

在本机 Windows（非管理员账户、未开开发者模式）上逐项实测了迁移用到的系统命令：

| 场景 | 命令 | 结果 |
| --- | --- | --- |
| 目录迁移，路径含中文与空格 | `robocopy /E /COPY:DAT` + `mklink /J` | robocopy 退出码 1（已成功复制）、junction 创建成功，链接内文件与子目录都能正常读取 |
| 单文件、同卷 | `mklink /H`（硬链接，带中文与空格） | 成功，不需要管理员权限 |
| 单文件、跨盘 C → E | `mklink /H` | 失败：`The system cannot move the file to a different disk drive`（硬链接不能跨卷，符合预期） |
| 单文件、跨盘 C → E | `mklink`（符号链接） | 失败：`You do not have sufficient privilege`（非管理员账户且未开开发者模式） |

结论与改动：单文件迁移改为**先试硬链接、失败再退回符号链接**（`desktop/src/main.js` 的 `makeLink()`）。因此目录迁移对普通用户完全可用；只有「跨盘搬单个文件」才需要一次管理员权限或开发者模式。手册里相关描述已同步。

同轮修掉的两个问题：

1. 右键菜单命令只写了 `"%1" %*`，而 `%*` 会按空格重新切分参数，带空格的路径（如 `D:\新建 文件夹`）会被拆成多个不存在的路径。已改为 ` "%1" %*`（`MULTI_ARG` 常量），与 Windows 自带菜单一致。
2. 源文件已移到目标盘之后创建链接失败时，原提示只说「需要管理员权限」；现在会说明「硬链接与符号链接都不可用，跨盘符号链接需要管理员权限或开发者模式」，并保持自动复制回滚。

**仍未验证**：真实云存储上的分享包上传与 6 天下载链接；多选右键菜单在资源管理器中的实际表现（需安装打包后的版本）。

### 8.10 发布记录（2026-11-01）

| 项目 | 状态 |
| --- | --- |
| 仓库 main | `9331e29`（含 `d9e9b60 feat: 0.3.0` 与迁移修复），已推送到 `git@github.com:xiehao-001/ossbear.git` |
| 标签 | `v0.3.0` 已推送，GitHub Actions 运行 #25 全部步骤成功 |
| 安装包 | `StorageBear-Setup-0.3.0.exe`（97,240,672 字节，SHA256 `923563F439FD10433F72324E53AB90C625A779078B206F871E6F1ECC71F1EA14`） |
| 更新源 | `/opt/storagebear/web/updates/` 已放入 0.3.0 安装包 / blockmap / latest.yml / SHA256.txt，`StorageBear-Setup-latest.exe` 软链指向 0.3.0；sha512 与 GitHub Release 资产实测一致 |
| 公开 Release | v0.3.0、v0.2.5、v0.2.4 三个，符合「保留最新 3 个」策略（v0.2.0 的 Release 待删，需要带 Token 的 `gh`，服务器上没有可用 Token） |
| 服务端 | `src/main.cpp` 版本号改为 0.3.0 后重新编译部署；`/api/config` 返回 `version=0.3.0`、`public_url=http://47.100.27.233`；`systemctl is-active storagebear` = active |
| 宣传站 | `/`、`/guide`、`/manual`、`/app`、`/privacy`、`/terms`、`/assets/guide/*.png` 全部 200，版本号均为 0.3.0；`/root/存储熊/server/web` 部署前已备份为 `web.bak-20261101-203904` |

发布后仍需人工确认：装一次 0.3.0 安装包，检查设置页两张新卡片、右键菜单两项是否出现，以及从 0.2.5 自动更新到 0.3.0 是否正常。

**上机反馈（2026-11-01 21:49，0.3.0）**：

1. `--quick-share` 崩溃：`ReferenceError: runQuickLink is not defined`（`main.js:1020`）。`second-instance` 分支里仍调用旧函数名与旧 `quickArg()`，任何一次右键分享只要主程序已在运行就会弹这个错误框。
2. 迁移失败但**数据是安全的**：`mklink /J` 报「文件名、目录名或卷标语法不正确」，随后的回滚把内容完整复制回原位置（`E:\StorageBearLinks\...` 里会留下同名副本）。原因是该路径含中文与括号/空格时，`cmd /c` 的命令行按系统代码页解析，与应用进程的 UTF-8 参数编码不一致。

### 8.11 0.3.1（2026-11-01，只修 bug）

版本策略依用户要求：**修 bug 只加第三位，加功能加第二位，大版本不动**。

| # | 修复 | 文件 |
| --- | --- | --- |
| 1 | `second-instance` 用回 `quickParse()` + `runQuickShare` / `runQuickMigrate`，右键分享在主程序已运行时不再报 `runQuickLink is not defined` | `desktop/src/main.js` |
| 2 | `makeLink()` 不再经 `cmd /c mklink`，改用 `fs.symlinkSync(dst, src, "junction")`（目录）/ `"file"`（文件）：V8 直接传 UTF-16 路径，中文、空格、括号、全角标点都不会因代码页转换失败 | `desktop/src/main.js` |
| 3 | 单文件先试 `fs.linkSync` 硬链接，失败再退回符号链接（同卷免管理员） | `desktop/src/main.js` |
| 4 | 右键命令 ` "%1" %*` 给追加参数补引号，带空格的路径不再被 `%*` 拆开 | `desktop/src/main.js` |

实机验证（本机 Windows，非管理员账户）：

- `fs.symlinkSync(..., "junction")` 对 `教康论文`（中文）与 `教学论文 (2026版) 最终稿\子目录（含括号）`（中文 + 空格 + 括号 + 全角）均成功，链接内文件可正常读取；
- 同卷 `fs.linkSync` 硬链接成功；跨盘硬链接按预期失败并自动退回符号链接；
- 删除验收用的目录联接后，用户原件（64 个文件 / 180.8 MB）与 `E:\StorageBearLinks\C\Users\dell\Desktop\教康论文` 副本数量、大小一致，抽样 PDF 的 SHA256 一致。

版本号已同步 0.3.1：`agent/storagebear/__init__.py`、`desktop/package.json`、`desktop/package-lock.json`（顶层与 `packages[""]`）、`build-release.bat`、宣传站页面。



### 8.12 0.3.1 发布记录（2026-11-01）

| 项目 | 状态 |
| --- | --- |
| 仓库 | `a7467fc fix: 0.3.1 ...` 已推送 main；标签 `v0.3.1` |
| 打包 | Actions 运行 #26 全部成功，`StorageBear-Setup-0.3.1.exe` 97,240,815 字节，SHA256 `59773102F7085C64B1DE86B45F1E0AE5B5166BD3B7F298E31BFDF450CDD98A48`，sha512 与 latest.yml 实测一致 |
| 更新源 | `/updates/` 已放到 0.3.1，`StorageBear-Setup-latest.exe` → 0.3.1；公网 `http://47.100.27.233/updates/latest.yml` 返回 `version: 0.3.1` |
| 服务端 | 版本号改 0.3.1 后重新编译部署，`/api/config` 返回 `version=0.3.1`，服务 active（旧二进制备份 `storagebear.bak-0.2.5`） |
| 宣传站 | `/`、`/manual`、`/privacy`、`/terms` 版本号均为 0.3.1；`/root/存储熊/server/web` 与仓库 `server-web/` 已同步 |

升级方式：0.3.0 客户端托盘菜单点「检查更新」即可增量下载（约 11 MB），或直接下载安装包覆盖安装。

---

## 9. 本次已完成（0.2.5）

1. 客户端登录界面移除「服务器地址」输入框，服务器地址内置为 `http://47.100.27.233`。
2. 窗口标题与页面 `<title>` 统一为 `存储熊 | storagebear`。
3. 宣传站新增 `/guide` 接入教程页（13 步 + 选购建议 + 免责声明），首页/手册/页脚均已加入口；服务端静态路由已放行 `/guide`。
4. 14 张教程截图完成脱敏并逐张目视复核。
5. 宣传页与客户端文案更新为「域名备案期间使用 IP」。
6. 版本号统一提升到 0.2.5（服务端二进制已重新编译部署，`SB_PUBLIC_URL` 已切到 IP）。
7. v0.2.5 标签推送后 GitHub Actions 打包成功，已校验 SHA256/SHA512 并发布到 `/updates/`；`StorageBear-Setup-latest.exe` 软链指向 0.2.5。

验证：`http://47.100.27.233/`、`/manual`、`/guide`、`/guide.css`、`/assets/guide/*.png` 全部 200；`/api/config` 返回 `version=0.2.5`、`public_url=http://47.100.27.233`；`/updates/latest.yml` 返回 0.2.5 且 `sha512` 与实际安装包一致；`/updates/StorageBear-Setup-latest.exe` 返回 96670364 字节。

---

## 10. 待办与风险

| 事项 | 说明 | 优先级 |
| --- | --- | --- |
| 域名备案 | `www.ai-xiehao.me` 备案中，备案通过后按第 4 节切回域名并签发 HTTPS 证书（vhost 已预留 ACME 路径） | 高 |
| C++ 服务端未入库 | 服务端源码只在 `/root/存储熊/server`，公开仓库缺一半代码；确认是有意还是遗漏 | 高 |
| 更新源域名不一致 | `desktop/package.json` 的 `build.publish.url` 仍是域名（仅影响 `latest.yml` 生成，运行时被 `setFeedURL` 覆盖），备案后需一并统一 | 中 |
| 手机版 `/app` | 仍是「开发中」占位页 | 中 |
| 右键菜单迁移未实测 | mklink 需要目录联接权限（junction 通常免管理员，文件符号链接需要管理员或开发者模式） | 中 |
| Windows 实机回归 | 0.2.5 的安装、升级、虚拟盘挂载、快速链接尚未在 Windows 实机逐项验证（本次只验证了服务端与页面） | 中 |
| v0.2.0 Release 未删 | 需带 Token 的 `gh release delete v0.2.0`，服务器无可用 Token | 低 |
| 只保留三个安装包 | `/updates/` 与 GitHub Release 现为 0.2.5 / 0.2.4 / 0.2.0（0.2.1～0.2.3 打包失败无产物），已达上限；如需严格补丁滚动窗口要手动删 0.2.0，见 5.4 | 低 |
| GitHub 直连受限 | 本机 `github.com` 443 超时，`api.github.com` 可用；大文件走 `gh-proxy.com`；`gh` CLI 未安装 | 低 |
| 备份 | `/opt/storagebear/storagebear.bak-*` 已积累 6 个旧二进制，可按需清理 | 低 |

---

## 11. 安全约束（务必遵守）

- 仓库公开，**任何密钥都不得进仓库**：Resend Key、云存储 AccessKey/SecretKey、GitHub Token、SSH 私钥、服务器 `.env`、用户数据库、安装包签名材料。
- 密钥只存在于部署服务器（`/etc/storagebear/resend.env`、数据库 `providers` 表）与用户本机加密存储。
- 发布用 GitHub 自动注入的 `GITHUB_TOKEN`，不新增长期自定义发布 Token。
- 提交前自查：`grep -rnE "re_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|BEGIN [A-Z ]*PRIVATE KEY|password\s*=\s*['\"]" .`
- 发现密钥误提交：立即在对应平台**轮换密钥**，再清理提交历史并通知协作者。
