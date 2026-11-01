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

## 0.3.0 新增

- **资源管理器右键：一键分享**——选中一个或多个文件、文件夹即可生成 6 天有效的下载链接。单文件直接上传；多文件/文件夹先用 zstd 打包（`agent/storagebear/pack.py`：优先 `zstandard` 模块，其次系统自带 `tar.exe --zstd`，都没有时回退 zip），链接自动写入剪贴板。
- **资源管理器右键：迁移到其它盘并创建链接**——把 C 盘的大文件/大文件夹搬到 D、E 盘，并在原位置留下 mklink 链接（目录用 `/J` 目录联接），路径不变；系统目录有黑名单，复制失败会用副本回滚。
- **存储熊自身清理**——设置页可查看并清理 `tmp/`、`cache/`、`logs/`、临时分享包、更新器缓存与诊断日志，不碰用户文件与云端对象。
- **Cloudflare R2 预设**——Endpoint 必须带账户 ID、Region 固定 `auto`、访问样式选路径样式。

接入教程（含申请 AccessKey 的 13 步与 R2 步骤）见 <http://47.100.27.233/guide>，手册见 <http://47.100.27.233/manual>。

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
