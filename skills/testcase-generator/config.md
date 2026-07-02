# 移动看家测试 - 统一配置中心

&gt; 本文档存放所有执行配置、文件规范、工具参数。
&gt; 执行测试前请确保已阅读本文档。


## 📱 测试环境信息

### 设备信息
- **测试设备：** Android手机 (设备ID: S2D7N19618004597)

### 应用信息
- **移动爱家APP包名：** `com.cmri.universalapp`
- **启动命令：** `adb shell monkey -p com.cmri.universalapp -c android.intent.category.LAUNCHER 1`

### 工具信息
- **Midscene包：** `@midscene/android@1.7.6`


## 📁 文件与目录规范

### 临时文件管理

**【强制执行】禁止在workspace根目录保存临时调试文件！**

所有临时文件必须统一保存到 `temp/` 子目录：
- `temp/ui_dump/` - UI dump XML文件
- `temp/screenshots/` - 调试截图
- `temp/scripts/` - 临时测试脚本
- `temp/json/` - 参数配置JSON文件

**执行后自动清理：** 测试脚本执行完成后，自动删除 `temp/` 目录下所有临时文件。


## 🔧 工具配置

### 文本输入优化
涉及文本输入时，可调用手机上的ATX功能，提升输入的稳定性和准确性。

### Midscene超时配置
复杂任务（多步导航、长流程）需增加：
```bash
MIDSCENE_REPLANNING_CYCLE_LIMIT=30
```
默认值为20，根据任务复杂度调整为30-40。


## ⚙️ 执行参数配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 操作重试次数 | 3次 | 单步操作失败后的自动重试次数 |
| 页面加载超时 | 5秒 | 等待页面加载完成的最长时间 |
| 锚点回归尝试 | 2次 | 页面偏离后，尝试回归锚点的次数 |
| 硬重置次数 | 2次 | 锚点回归失败后，允许的App重启次数 |


## 📊 报告配置

- **Midscene执行报告目录：** `midscene_run/report/`
- **测试结果记录目录：** `memory/YYYY-MM-DD.md`
- **错误截图保存：** `temp/error_screenshots/`
