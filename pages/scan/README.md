# 扫码工具模块

扫码 / 解码 / 设置 / 历史 / 回收站 / 连续扫码 / 二维码创建，全部集中在本目录，便于维护与扩展。

## 目录结构

```
pages/scan/
├── scan.*                          # 入口页：扫码 / 解码 / 设置 三个页签
├── settings/settings.*             # 扫码设置：提示音、震动、自动复制、历史上限、解码规则
├── history/history.*               # 扫码历史：排序、详情、清空（清空前入回收站）
├── recycleBin/recycleBin.*         # 回收站：云端存档的已清空记录，可恢复/彻底删除
├── continuousScan/continuousScan.* # 连续扫码：批量扫描、整体复制/导出
├── qrcode/qrcode.*                 # 二维码创建：文本/链接等内容生成二维码
├── utils/
│   └── scan-utils.js               # 公共工具（时间、类型标签、规则合并、复制、提示音）
└── components/
    ├── scan-panel/                 # 扫码面板（相机/相册/统计/结果弹窗）
    └── decode-panel/               # 解码面板（文本解析、编码转换、统计看板）
```

路由约定：入口为 `/pages/scan/scan`，其余页面为 `/pages/scan/<目录>/<目录>`（如 `/pages/scan/history/history`）。

## 数据流

```
扫码（相机 / 相册 / scanCode）
  → barcode.decodeBarcode() 识别与解析
  → app.decodeWithRule() 应用自定义规则
  → mergeCustomRuleResults() 合并展示字段
  → app.saveScanHistory() 写入本地历史（按 code 去重）
  → 结果面板 / 历史 / 回收站
```

- 历史数据只存在 `app.globalData.scanHistory`，并同步到本地 Storage。
- 每次增删改都会自增 `app.globalData.scanHistoryVersion`，统计面板据此判断是否需要重算。
- 清空历史会先调用云函数 `syncScanHistory` 存档到回收站，再清本地。

## 公共工具（utils/scan-utils.js）

| 方法 | 说明 |
| --- | --- |
| `formatDateTime(date)` | `YYYY-MM-DD HH:mm:ss`，非法日期返回空串 |
| `formatDate(date)` | `YYYY-MM-DD` |
| `parseDateTime(input)` | 解析时间文本/时间戳为本地 `Date`，失败返回 `null` |
| `getTodayRange(now)` | 今日 `[start, end)` 时间戳，用于统计 |
| `getWeekStart(now)` | 本周起始（周日 00:00）时间戳 |
| `getRecordTs(record)` | 记录时间戳，优先 `timestamp`，回退解析 `time` |
| `getTypeLabel(type)` | 列表类型标签（EAN/QR/URL/WiFi/Card/TEL/Mail） |
| `formatRelativeTime(input)` | 刚刚 / N分钟前 / N小时前 / 昨天 / MM-DD |
| `mergeCustomRuleResults(decoded, results)` | 合并自定义规则结果到解码对象 |
| `fallbackDecoded(code)` | 解码失败时的兜底结果（原文展示） |
| `isCancelError(err)` | 判断扫码失败是否为用户取消 |
| `copyText(text, successText)` | 复制文本，返回 `Promise<boolean>` |
| `playBeep()` / `disposeBeep()` | 复用单实例播放/释放扫码提示音 |

约定：所有方法对空值、非法日期、脏数据返回安全默认值，页面层不需要重复判空。

## 错误与边界处理约定

1. **扫码结果为空**：不写入历史，提示「未识别到内容」，避免污染历史与统计。
2. **解码异常**：捕获后用 `fallbackDecoded()` 降级展示原文，功能不中断。
3. **用户取消扫码**：用 `isCancelError()` 判断，不弹错误提示。
4. **连续扫码失败**：连续 3 次非取消失败后自动停止，避免无限重试。
5. **异步回调**：定时器统一在 `onUnload` 清理；提示音单实例在卸载时释放。

## 可视化规范

**设计方向**：暖色杂志式数据排版，与后台 `admin-web/src/style.css` 同一套品牌 token。

| Token | 值 | 用途 |
| --- | --- | --- |
| 墨色 | `#2B1D18` | 标题、坐标轴、主数值 |
| 赤陶 | `#C0553D` | 强调、今日数据、主按钮 |
| 琥珀 | `#F2B04E` | 深色底数字、非今日柱状 |
| 米白 | `#FDF9F2` / 卡片白 `#FFFFFF` | 页面与卡片 |
| 描边 | `#EFE3D5` | 分隔线、卡片描边 |
| 次要文字 | `#7D695F` / `#A08D82` | 标签、注释 |

**排版层级**：主指标 60–64rpx（等宽数字）→ 次指标 32rpx → 区块标题 24–26rpx → 标签 22–24rpx → 注释 20rpx。

**图表规则**：

1. 必须有单位与时间范围（如「近 7 天 · 单位：次」），标题行内展示。
2. 柱状图必须带基线、横向刻度与日期轴；刻度上限取整到 1/2/5 × 10^n。
3. 今日数据使用赤陶色强调，历史数据使用琥珀色，零值保留浅色短柱。
4. 数值标注只在 `count > 0` 时出现，避免噪声。
5. 空数据展示「近 7 天暂无扫码记录」，不绘制假数据。

**结构一致性**：结果详情统一为「区块标题 + 固定标签列（170rpx）+ 自由值列」；原始码值使用等宽字体块并带赤陶左侧强调线。

## 扩展指南

- **新增页面**：放在本目录（扁平命名 `xxx.js/json/wxml/wxss`），并在 `app.json` 注册 `/pages/scan/xxx`。
- **新增统计维度**：在 `decode-panel.computeStats()` 中基于 `scanHistory` 扩展，注意保持 O(n) 单次遍历。
- **新增快捷复制**：直接调用 `scanUtils.copyText()`，不要重复写 `wx.setClipboardData`。
- **新增时间展示**：优先使用 `scanUtils` 的格式化方法，避免各页面实现不一致。
- **修改历史结构**：任何写入 `app.globalData.scanHistory` 的位置都要自增 `scanHistoryVersion`。

## 验证

```bash
node scripts/final-check.js     # 语法 / 页面 / 组件 / 跳转 / 图片 / 云函数配置
node scripts/verify-refs.js     # wxml 模块与 js 引用
npx jest                        # 单元测试（含 tests/scan-utils.test.js）
```
