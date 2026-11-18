# 工具箱（微信小程序 + 云开发 + 管理后台）

一个以「扫码 / 解码」为核心的多功能微信小程序，配套云函数与 Web 管理后台。
包含扫码识别、内容解码、自定义解码规则、扫码历史与回收站、连续扫码、二维码创建、注册码解析、互助工具等功能。

- 小程序 AppID：`wxba4a79e8e7f2c608`
- 云开发环境 ID：`wendi-d5gnswjf75b25aac0`
- 管理后台：Vue 3 + Vite + TDesign，部署在静态托管
- 云端 API：`https://wendi-d5gnswjf75b25aac0.service.tcloudbase.com/adminApi`

## 目录结构

```
omnitool/
├── app.js / app.json / app.wxss      # 小程序入口：启动装配与登录编排（业务实现在 utils）
├── pages/                            # 小程序页面
│   ├── home/                         # 首页（工具入口）
│   ├── scan/                         # 扫码工具（详见 pages/scan/README.md）
│   │   ├── scan.*                    # 入口：扫码 / 解码 / 设置
│   │   ├── settings/settings.*       # 扫码设置与自定义解码规则
│   │   ├── history/history.*         # 扫码历史
│   │   ├── recycleBin/recycleBin.*   # 回收站（云端存档）
│   │   ├── continuousScan/           # 连续扫码
│   │   ├── qrcode/                   # 二维码创建
│   │   ├── components/               # 扫码 / 解码面板
│   │   └── utils/scan-utils.js       # 扫码公共工具
│   ├── tool/                         # 互助工具（modules/ 已拆分模式、记录、账号、受助设置、口令任务）
│   ├── regcode/                      # 注册码生成与解析
│   ├── profile/                      # 我的
│   └── admin/data-manage.*           # 管理员数据管理
├── utils/                            # 小程序公共模块
│   ├── barcode.js                    # 条码识别与解码
│   ├── canvas-decoder.js             # Canvas 图像解码（image-decoder 底层）
│   ├── image-decoder.js              # 相册图片识别入口
│   ├── decode-rules.js               # 自定义解码规则引擎
│   ├── encode-utils.js               # 编码转换（Base64/URL/Unicode/HTML）
│   ├── permission.js                 # 用户权限缓存与云端同步（唯一写入口）
│   ├── qr-local.js                   # 本地二维码生成（Canvas 绘制，无网络依赖）
│   ├── vendor/qrcode-generator.js    # 二维码编码库（MIT，本地内置）
│   ├── tools.js                      # 工具路由与本地兜底清单
│   ├── history-store.js              # 扫码历史写入（唯一入口，自增版本号）
│   ├── settings-store.js             # 扫码设置持久化
│   ├── rule-service.js               # 自定义解码规则服务
│   └── user-session.js               # 用户信息映射与登出清理
├── cloudfunctions/                   # 云函数（独立部署）
│   ├── _shared/                      # 公共代码唯一来源（时间/集合/保留天数），由脚本同步副本
│   ├── adminApi/                     # 后台 HTTP API（含 CORS）
│   ├── userManage/                   # 用户 / VIP / 封禁
│   ├── toolsManage/                  # 工具清单读写
│   ├── syncScanHistory/              # 扫码历史同步与回收站
│   └── qrcodeGen/                    # 服务端二维码生成（已由本地生成替代，保留备用）
├── admin-web/                        # 管理后台（Vue 3 + Vite）
├── tests/                            # Jest 单元测试
├── scripts/                          # 校验 / 发布 / 运维脚本
├── miniprogram_npm/                  # 已裁剪的小程序 npm 产物（tdesign）
├── images/                           # 图标与提示音
├── cloudbaserc.json                  # 云函数部署配置
└── project.config.json               # 开发者工具项目配置
```

> `CODEBUDDY.md`、`.rules/`、`.codebuddy/` 为 AI 开发规则与生成物，不参与运行。

## 快速开始

### 0. 前置条件

- Node.js 18+（Jest 29）
- 微信开发者工具（已登录、开启服务端口）
- 云开发环境可用；本机安装 `tcb` CLI 并登录（`tcb login`）

### 1. 安装依赖

```bash
npm install                 # 根目录：仅测试与校验依赖
cd admin-web && npm install # 管理后台依赖
```

小程序 npm 产物已内置在 `miniprogram_npm/`；如需按 tdesign 清单重建，使用 `node scripts/fix-tdesign-npm.js`。

### 2. 运行小程序

1. 微信开发者工具「导入项目」选择本仓库根目录（`miniprogramRoot: "./"`）。
2. 确认 `app.js` 中 `wx.cloud.init({ env })` 与 `cloudbaserc.json` 的环境 ID 一致。
3. 编译预览即可；云函数需先部署（见下）。

### 3. 部署云函数

```bash
tcb fn deploy --all --force -e wendi-d5gnswjf75b25aac0
```

`cloudbaserc.json` 已声明 5 个函数及其运行时（Nodejs16.13）、超时与依赖安装策略。
首次部署 `adminApi` 需确认其 HTTP 访问路径为 `/adminApi`。

### 4. 管理后台

```bash
cd admin-web
npm run dev     # 本地开发
npm run build   # 产出 dist
```

部署到静态托管：

```bash
cd admin-web
tcb hosting deploy dist / -e wendi-d5gnswjf75b25aac0
```

也可以使用一键脚本：`node scripts/release.js`（本地构建 + 上传 + 部署 adminApi + 索引检查）。

## 功能与路径

| 功能 | 路径 |
| --- | --- |
| 首页 / 工具入口 | `/pages/home/home` |
| 扫码工具（扫码 / 解码 / 设置） | `/pages/scan/scan` |
| 扫码设置与解码规则 | `/pages/scan/settings/settings` |
| 扫码历史 | `/pages/scan/history/history` |
| 回收站 | `/pages/scan/recycleBin/recycleBin` |
| 连续扫码 | `/pages/scan/continuousScan/continuousScan` |
| 二维码创建 | `/pages/scan/qrcode/qrcode` |
| 互助工具 | `/pages/tool/tool` |
| 注册码解析 | `/pages/regcode/regcode` |
| 我的 | `/pages/profile/profile` |
| 管理员数据管理 | `/pages/admin/data-manage` |

## 云函数职责

| 函数 | 职责 | 调用方 |
| --- | --- | --- |
| `userManage` | 登录身份、用户信息、VIP/封禁、角色校验 | 小程序、后台 |
| `toolsManage` | 工具清单读写、排序、上下线 | 小程序、后台 |
| `syncScanHistory` | 扫码历史同步、回收站存档/恢复/彻底删除 | 小程序、后台 |
| `qrcodeGen` | 服务端生成二维码（保留备用；小程序端已改为本地生成） | 无 |
| `adminApi` | 后台 HTTP API（登录、用户、工具、日志），统一 CORS | 管理后台 |

## 数据存储

- 本地：`scanHistory`、`settings`、`customRules`、权限缓存（Storage）。
- 云端集合：`tool_records`（扫码记录，含 `owner_openid + date` 复合索引）、`users`（用户与角色）、审计日志集合。
- 历史清空不会直接丢弃：先经 `syncScanHistory.recycle` 存档到回收站，再清本地。
- 历史版本号 `app.globalData.scanHistoryVersion` 用于统计缓存失效，任何增删改都要自增。

## 质量保障

```bash
npm run check      # 全量校验（10 项）：语法、页面/组件、跳转、JSON、引用、图片、云函数配置与公共代码同步
npm run verify     # wxml 模块引用与 js 相对引用校验
npm run sync:cloud # 修改 cloudfunctions/_shared 后同步副本到各云函数
npm test           # Jest 单测（含覆盖率阈值）
npm run build:admin# 构建管理后台
node scripts/verify-e2e.js   # 线上静态页、构建产物、API CORS 冒烟
```

微信开发者工具 CLI（需开启服务端口）：

```bash
cli preview --project <仓库路径>
```

## 发布流程

1. `npm run check && npm test` 通过。
2. `node scripts/release.js`：构建后台 → 上传静态托管 → 部署 `adminApi` → 确认索引。
3. 云端函数有改动时：`tcb fn deploy --all --force -e <envId>`。
4. 微信开发者工具上传小程序版本并提交审核。

## 约定

- **命名**：页面目录 camelCase；工具函数 camelCase；常量 UPPER_SNAKE。
- **公共能力优先复用**：扫码相关用 `pages/scan/utils/scan-utils.js`，权限相关用 `utils/permission.js`，不要在各页面重复实现。
- **路由唯一来源**：工具跳转以 `utils/tools.js#TOOL_ROUTES` 为准，云端配置的 url 仅作兜底。
- **文档索引**：扫码模块 `pages/scan/README.md`（可视化规范与扩展指南）、云函数 `cloudfunctions/README.md`、管理后台 `admin-web/README.md`。

## 已知说明

- `project.config.json` 已将 `admin-web/`、`cloudfunctions/`、`tests/`、`scripts/` 排除在小程序打包之外。
- `miniprogram_npm/tdesign-miniprogram` 为按需裁剪产物，新增 tdesign 组件后需重新构建 npm。
- 根 `package.json` 不再声明 `wx-server-sdk`，云函数依赖由各自的 `package.json` 管理。
- 覆盖率统计仅包含可纯逻辑测试的 `utils/*`；`image-decoder`、`canvas-decoder`、`qrcode` 依赖 Canvas 绘制，不纳入统计。
