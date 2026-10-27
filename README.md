# 存储熊 StorageBear

把多家对象存储整理成一块 Windows 云端虚拟盘。本仓库包含 Windows Electron 客户端与随包发布的 Python 本机代理；C++ 服务端和运营网页不在本仓库内。

## 下载与更新

- 官网与使用手册：<http://47.100.27.233>（域名 `www.ai-xiehao.me` 正在 ICP 备案，恢复后以域名为准）
- 火山引擎 TOS 接入图文教程：<http://47.100.27.233/guide>
- Windows 最新版：<http://47.100.27.233/updates/StorageBear-Setup-latest.exe>
- 自动更新清单：<http://47.100.27.233/updates/latest.yml>

从 0.2.0 起，客户端不再依赖 GitHub Releases；GitHub Release 仅作为构建产物归档。从 0.2.5 起，客户端内置服务器地址（`desktop/src/main.js` 的 `SERVER` 常量），登录页不再要求填写服务器地址，更新检查固定走该地址的 `/updates/`。

## 目录

- `agent/`：Python 本机代理，负责扫描、云存储访问、WebDAV、迁移与本地 API。
- `desktop/`：Electron 客户端、托盘、预览窗口与安装器配置。
- `.github/workflows/`：Windows 打包、公开 Release 与保留策略。

## 本地开发

```bash
cd agent
python -m storagebear --port 0
```

```bash
cd desktop
npm install
npm start
```

安装包由 Windows runner 构建，Linux/macOS 不能直接产出 Windows NSIS 包。

## 发布与版本

版本规则、产物保留和发布步骤见 [RELEASING.md](RELEASING.md)。提交信息请说明用户可见变化、测试方式和影响范围。

接手本项目请先看 [HANDOVER.md](HANDOVER.md)：里面有部署拓扑、配置路径、发布流水线、运维命令与待办风险。

## 安全

仓库中不得出现 Resend Key、云存储 AccessKey、GitHub Token、服务器环境文件或其他密钥。密钥只保存在部署服务器和用户本机的加密存储中。发现误提交时请立即轮换密钥并清理历史。
