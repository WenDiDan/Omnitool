# 管理后台

扫码工具配套的 Web 管理端：用户与 VIP/封禁管理、工具配置、互助记录、审计日志。

- 技术栈：Vue 3 + Vite 5 + TDesign Vue Next + Axios
- 后端：云函数 `adminApi`（HTTP POST `/adminApi`）
- 部署：CloudBase 静态网站托管

## 目录

```
admin-web/
├── src/
│   ├── App.vue           # 布局与路由
│   ├── main.js           # 入口
│   ├── api.js            # 请求封装、token 注入、会话失效处理
│   ├── labels.js         # 角色 / 状态文案映射
│   ├── useIsMobile.js    # 窄屏判断
│   ├── style.css         # 全局样式与 TDesign 主题变量
│   └── views/
│       ├── Login.vue     # 登录 / 初始化管理员
│       ├── Layout.vue    # 侧边导航与页头
│       ├── Users.vue     # 用户管理
│       ├── Tools.vue     # 工具配置（拖拽排序、行内编辑、统计筛选）
│       ├── Mutual.vue    # 互助账号与记录
│       └── Logs.vue      # 审计日志与快照
├── index.html
├── vite.config.js
└── package.json
```

## 开发与构建

```bash
cd admin-web
npm install
npm run dev      # 本地开发，默认 5173
npm run build    # 产出 dist
npm run preview  # 预览构建产物
```

也可在仓库根目录执行 `npm run build:admin`。

### API 地址

默认指向 `https://wendi-d5gnswjf75b25aac0.service.tcloudbase.com/adminApi`，
可通过环境变量覆盖：

```bash
VITE_API_BASE=https://<envId>.service.tcloudbase.com/adminApi npm run build
```

## 鉴权

- 登录成功后 token 存 `localStorage.admin_token`，用户信息存 `localStorage.admin_user`。
- 所有请求由 `api.js` 自动注入 `token`；后端返回会话失效时统一清理并跳转登录页。
- 后端为自建 token：bcrypt 哈希、12 小时有效、单会话（新登录踢旧会话）。

## 页面与数据

| 页面 | 数据来源 |
| --- | --- |
| 用户管理 | `user.list` / `user.setVip` / `user.setRole` / `user.ban` |
| 工具配置 | `tool.list` / `tool.save` / `tool.publish` / `tool.reorder` / `tool.delete` |
| 互助管理 | `userManage.listUsers` 与互助记录（`toolsManage`） |
| 审计日志 | `log.list` / `log.export` |

统计卡与列表计数均基于接口返回数据计算，不额外请求指标接口。

## 样式规范

- 暖赤陶主题，token 定义在 `style.css` 的 `:root`：`--brand #c0553d`、`--amber #e8a44c`、`--bg-page #f9f4eb`、`--text-1 #2b1d18`、`--line #efe3d5`。
- 与小程序端（`pages/scan/README.md` 的可视化规范）共用同一套色板与层级。
- TDesign 主色已通过 `--td-brand-color-*` 覆盖，不要单独硬编码其他品牌色。
- 统计卡：数字 + 单位 + 比例条 + 选中态；列表上方先给总量说明。

## 部署

```bash
npm run build
tcb hosting deploy dist / -e wendi-d5gnswjf75b25aac0
```

或在仓库根目录执行 `node scripts/release.js`（构建 + 上传 + 部署 `adminApi` + 索引确认）。

发布后建议执行 `node scripts/verify-e2e.js`，确认首页、静态资源与 API 跨域均正常。
