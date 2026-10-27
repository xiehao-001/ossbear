# 存储熊 StorageBear

把多家对象存储整理成一块 Windows 云端虚拟盘。本仓库包含 Windows Electron 客户端与随包发布的 Python 本机代理；C++ 服务端和运营网页不在本仓库内。

## 下载与更新

- 官网与使用手册：<http://www.ai-xiehao.me>
- Windows 最新版：<http://www.ai-xiehao.me/updates/StorageBear-Setup-latest.exe>
- 自动更新清单：<http://www.ai-xiehao.me/updates/latest.yml>

从 0.2.0 起，客户端不再依赖 GitHub Releases；更新检查使用**当前登录服务器**的 `/updates/`，默认回退到官网 `http://www.ai-xiehao.me/updates/`。GitHub Release 仅作为构建产物归档。

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

## 安全

仓库中不得出现 Resend Key、云存储 AccessKey、GitHub Token、服务器环境文件或其他密钥。密钥只保存在部署服务器和用户本机的加密存储中。发现误提交时请立即轮换密钥并清理历史。
