# 云函数

小程序与管理后台的云端能力，按函数独立部署。

- 环境 ID：`wendi-d5gnswjf75b25aac0`
- 运行时：`Nodejs16.13`
- 部署配置：根目录 `cloudbaserc.json`（函数清单、超时、依赖安装策略）

## 部署

```bash
npm run sync:cloud                          # 同步公共代码到各函数（必做）
tcb login                                   # 首次使用
tcb fn deploy --all --force -e wendi-d5gnswjf75b25aac0
tcb fn deploy userManage --force -e wendi-d5gnswjf75b25aac0   # 单函数
```

- `adminApi`、`qrcodeGen` 配置了 `installDependency: true`，由云端安装依赖。
- 各函数目录内的 `package.json` 为唯一依赖来源；根目录不声明云函数依赖。
- 首次部署 `adminApi` 后，确认 HTTP 访问路径为 `/adminApi`。

## 本地调试

```bash
tcb fn invoke qrcodeGen -e wendi-d5gnswjf75b25aac0 -d '{"text":"hello"}'
tcb fn invoke syncScanHistory -e wendi-d5gnswjf75b25aac0 -d '{}'
```

事件函数入参为 `event`；`adminApi` 同时支持 HTTP POST 与云端调用，请求体格式为 `{ action, token?, ...params }`。

## 通用约定

1. **返回结构**：成功 `{ success: true, ...data }`；失败 `{ success: false, error: '可直接展示的原因' }`。
2. **用户身份**：通过 `cloud.getWXContext().OPENID` 获取，不信任前端传入的 openid。
3. **时间**：统一使用北京时间字符串 `YYYY-MM-DD HH:mm:ss`（各函数内的 `bjTime`），不存本地时区 Date。
4. **集合**：写入前用 `ensureCollection` 懒创建，避免首次调用报集合不存在。
5. **鉴权**：`adminApi` 使用自建 token（bcrypt 哈希存储，12 小时有效，单会话，新登录踢旧会话）。
6. **CORS**：`adminApi` 统一返回 `Access-Control-Allow-Origin: *`，仅允许 `POST` 与 `OPTIONS`。

## 函数与动作

| 函数 | 触发方式 | 主要动作 |
| --- | --- | --- |
| `userManage` | 小程序 / 后台 | `getInfo`、`updateProfile`、`checkPermission`、`listUsers`、`setRole`、`deleteUser` |
| `toolsManage` | 小程序 | `list`、`getAccount/saveAccount/clearAccount`、`setHelpPause/setHelpQuota`、`getCommands/saveCommand/drawCommand/updateCommandStatus/confirmReceive`、`getRecords`、`saveDailyStats` |
| `syncScanHistory` | 小程序 / 后台 | `recycle`、`getRecycled`、`restoreRecycled`、`restoreAllRecycled`、`deleteRecycled`、`clearRecycled`、`getRetention`、`setRetention`、`insertTestData` |
| `qrcodeGen` | 无（保留备用） | 入参 `{ text, errorLevel }`，返回 `{ success, dataUrl }`；小程序端已改为本地 Canvas 生成，不再调用 |
| `adminApi` `user.list` | 管理后台 Web | 每个用户返回 `retentionDays`（有效保留天数，口径同 `_shared/retention.js`） |
| `adminApi` | HTTP POST | `admin.init`、`auth.login`、`auth.changePassword`、`account.list`、`user.list/detail/setRole/setVip/ban`、`tool.list/save/publish/delete/reorder`、`log.list/export` |

## 数据集合

| 集合 | 用途 |
| --- | --- |
| `users` | 小程序用户、角色、VIP、封禁状态 |
| `admin_users` | 后台账号、bcrypt 密码哈希、会话 token |
| `audit_logs` | 后台写操作审计（before/after 快照、IP） |
| `tools` | 工具清单与展示配置 |
| `tool_records` | 互助/扫码类记录（`owner_openid + date` 复合索引） |
| `tool_accounts` | 互助账号与额度配置 |
| `scan_recycle_bin` | 已清空扫码记录的云端存档 |

## 公共代码（_shared）

云函数按目录独立打包，无法引用上级目录，因此公共逻辑采用「单一来源 + 复制副本」：

```
cloudfunctions/_shared/time.js      ← 唯一来源（bjTime / todayKey）
cloudfunctions/_shared/db.js        ← 唯一来源（ensureCollection）
cloudfunctions/_shared/retention.js ← 唯一来源（calcRetentionDays：管理员/VIP/普通用户）
cloudfunctions/<fn>/_shared/        ← 由脚本生成，勿手改
```

`userManage.listUsers` 支持 `page / pageSize（10-100）/ keyword`，并在每个用户上返回 `retentionDays`（有效保留天数），后台列表无需再逐个查询。

修改后执行 `npm run sync:cloud`，`node scripts/final-check.js` 会校验副本是否一致（⑩）。

## 注意事项

- 公共逻辑不要再写回各函数；统一放 `cloudfunctions/_shared/` 并同步。
- 不要依赖根目录 `node_modules`；依赖写在各自 `package.json`。
- 部署后可用 `tcb fn list -e <envId>` 确认状态，`tcb fn invoke` 做冒烟验证。
- 涉及用户身份的接口必须校验 `cloud.getWXContext().OPENID`，后台接口必须校验 token。
