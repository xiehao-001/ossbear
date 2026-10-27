# 发布流程与版本规则

## 版本号

采用 [SemVer 2.0.0](https://semver.org/lang/zh-CN/)：

- 当前处于 `0.x` 预稳定阶段：不兼容变更或成组的新功能提升次版本号，例如 `0.2.0 → 0.3.0`。
- 向后兼容的缺陷修复、文档与构建修复提升修订号，例如 `0.2.0 → 0.2.1`。
- 稳定公开发行后从 `1.0.0` 开始；之后不兼容变更提升主版本号。
- Git 标签固定为 `vMAJOR.MINOR.PATCH`。标签只新增，不移动、不删除；不使用强制推送。
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

- 客户端更新源：当前登录服务器的 `/updates/`，默认回退到 `http://www.ai-xiehao.me/updates/`。
- 构建配置：`desktop/package.json` 的 `build.publish` 使用 generic provider。
- 运行时配置：`desktop/src/main.js` 先使用默认地址，读取 `/api/config` 后切换到实际登录服务器地址。
- 不再把 GitHub Releases 作为客户端更新源。

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
