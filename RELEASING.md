# 发布流程与版本规则

## 版本号

采用 [SemVer 2.0.0](https://semver.org/lang/zh-CN/)：

- 当前处于 `0.x` 预稳定阶段：不兼容变更或成组的新功能提升次版本号，例如 `0.2.0 → 0.3.0`。
- 向后兼容的缺陷修复、文档与构建修复提升修订号，例如 `0.2.0 → 0.2.1`。
- 稳定公开发行后从 `1.0.0` 开始；之后不兼容变更提升主版本号。
- Git 标签固定为 `vMAJOR.MINOR.PATCH`。标签只新增，不移动、不删除；不使用强制推送。
- 修改 `desktop/package.json` 与 `desktop/package-lock.json` 的版本号时，**不要全局替换 `0.x.y`**：只需改顶层 `version` 和 `packages[""].version`，否则会误改依赖版本/范围，导致 `npm install` 失败。推荐使用 `npm version --no-git-tag-version X.Y.Z`。
- 发布前必须同步以下位置：`agent/storagebear/__init__.py`、`desktop/package.json`、`desktop/package-lock.json`、`build-release.bat`、服务端版本号与网页文档版本号。

## 发布步骤

1. 从最新 `main` 开始，完成代码与测试。
2. 更新版本号，提交信息写清楚用户可见变化、风险和验证方式。
3. 创建并推送 `vX.Y.Z` 标签。
4. GitHub Actions 自动构建 Windows 安装包、`latest.yml`、blockmap 和 SHA256，并创建公开 Release。
5. 下载并校验 Release 资产，发布到官网更新目录：
   - `/opt/storagebear/web/updates/`（由 Nginx 的 `/updates/` 直接提供，不经过应用代理）
   - 保留 `latest.yml`、当前 installer、blockmap 和 `SHA256.txt`
   - `StorageBear-Setup-latest.exe` 指向当前版本，供宣传页固定链接使用
6. 在 Windows 实机验证安装、升级、虚拟盘和快速链接。
7. 检查 `http://www.ai-xiehao.me/updates/latest.yml` 与安装包可访问。

## 产物保留

- 预稳定阶段：GitHub Release 与官网 `/updates/` 只保留当前次版本最新的 3 个安装包（例如 `0.2.4`、`0.2.3`、`0.2.2`）。
- 工作流会在发布后清理当前次版本的旧 Release；Git 标签保留。
- 正式版发行后另行确定长期保留策略。
- 稳定下载链接 `/updates/StorageBear-Setup-latest.exe` 不参与计数。
- 删除旧产物前先确认新安装包和 `latest.yml` 已上传并可下载。

## 更新源

- 客户端更新源：内置服务器的 `/updates/`。`desktop/src/main.js` 顶部的 `SERVER` 常量是唯一来源，`PUBLIC`、`UPD_URL` 与渲染进程的 `serverBase()` 都由它派生。
- **备案期间**：`SERVER` 写死为服务器 IP `http://47.100.27.233`（`www.ai-xiehao.me` 尚在 ICP 备案，无法解析）。
- **备案完成、域名启用 HTTPS 后**：把 `SERVER` 改回 `https://www.ai-xiehao.me`，并同步修改服务端 `/etc/storagebear/resend.env` 的 `SB_PUBLIC_URL`；登录页不再需要用户填写服务器地址，届时可移除 `SERVER` 常量的临时说明。
- 构建配置：`desktop/package.json` 的 `build.publish` 使用 generic provider。
- 不再把 GitHub Releases 作为客户端更新源，也不再按登录服务器动态切换更新源。

## 宣传页

- 宣传页、手册与接入教程的源文件在服务器工作区 `/root/存储熊/server/web/`，部署目标 `/opt/storagebear/web/`（由 Nginx 直接提供）。
- 教程截图在 `/root/guide-images/raw*.png`，脱敏脚本为 `/root/guide-images/mask.py`，导出到 `server/web/assets/guide/`；发布前必须确认账号、账号 ID、AccessKey/Secret、桶名均已不透明遮挡。
- 页面新增路由需要在服务端 `src/main.cpp` 的 `staticFile()` 里登记（例如 `/guide → /guide.html`），否则会返回 404。

## 密钥与仓库边界

- 仓库只允许源码、构建配置和文档。
- 以下内容永远不进入 Git：Resend Key、SMTP/API 密钥、云厂商 AccessKey/SecretKey、GitHub Token、SSH 私钥、服务器 `.env`、用户数据库和安装包私密签名材料。
- 构建使用 GitHub 自动提供的 `GITHUB_TOKEN` 创建 Release；不要新增长期有效的自定义发布 Token。
- 发现密钥被提交时：立即在对应平台轮换密钥，再清理提交历史并通知协作者。

## 发布说明模板

```text
发布 X.Y.Z：<一句话用户可见变化>

- <变更 1>
- <变更 2>

验证：
- <Windows 版本与测试路径>
- <更新源/安装包校验>

风险与回滚：
- <已知限制或回滚方式>
```
