# 云函数公共代码

本目录是云函数公共逻辑的**唯一来源**，不要直接修改各函数下的 `_shared/` 副本。

## 为什么需要复制

CloudBase 按 `cloudfunctions/<fn>/` 目录独立打包上传，函数运行时无法 `require` 上级目录。
因此采用「单一来源 + 构建期复制」：

```
cloudfunctions/_shared/*.js          ← 唯一来源
cloudfunctions/adminApi/_shared/*.js ← 由脚本生成
cloudfunctions/toolsManage/_shared/*.js
...
```

## 使用

```bash
npm run sync:cloud        # 同步到所有云函数
node scripts/sync-cloud-shared.js --check   # 仅校验（CI / final-check 已包含）
```

修改公共代码后：

1. 运行 `npm run sync:cloud`；
2. `node scripts/final-check.js` 应输出「云函数公共代码已同步」；
3. 重新部署受影响的云函数（`tcb fn deploy --all --force -e <envId>`）。

## 当前内容

| 文件 | 导出 | 用途 |
| --- | --- | --- |
| `time.js` | `bjTime`、`todayKey`、`BJ_OFFSET_MS` | 北京时间格式化、自然日键 |
| `db.js` | `ensureCollection(db, name, tag)` | 集合不存在时自动创建 |
