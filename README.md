# dsh-prompt-injector

**通用每轮上下文注入插件**：在设置页管理一组提示词（可开关、可增删改），每一轮对话开始时，把每条启用中的提示词以「上下文注入 <标题>」notice 行注入模型上下文——与 dsh-mem0-plugins 的 `[mem0 requirement]` 提醒同构的注入机制，但完全可配置化。

## 为什么做

人设卡规则（"编码任务前消费图谱"、"事实问题先查 wiki"）只是文字约束，模型在长会话中会漏执行（2026-08-26 实测多次新会话仍不触发）。dsh-mem0-plugins 用 `agent/pre-step` 事件每轮注入提醒，效果可靠——本插件把同一机制**通用化**：任何纪律性提醒（记忆/图谱/wiki/安全红线/回复风格……）都能在 UI 上添加，不用为每条规则写一个插件。

典型用法：内置默认提示词「图谱·Wiki 提醒」（编码任务消费图谱 + 事实问题先查 wiki，**明确"不是每轮都要查、按情况决定"**——纯闲聊/算术跳过，不确定时宁可查一次）。

## 能力

- **每轮注入**：`agent/pre-step` 事件，有新的真人输入（且非琐碎、或关闭琐碎过滤）时，向本轮上下文追加**所有启用中的提示词**，每条一条 `form:'notice'` 消息，UI 折叠行直接可见「上下文注入 <标题>」。
- **设置页管理**（设置 → 插件 → 上下文注入）：
  - 总开关 `enabled`（开/关）
  - `skipTrivial` 琐碎轮跳过（好的/嗯/收到/继续…不注入，避免打扰；"继续帮我看看那个报错"这类实义输入照常注入）
  - 提示词列表：每条含标题 + 正文 + 行开关 + 删除；底部「＋ 添加提示词」随时新增
- **只提醒、不执行**：插件不调用任何图谱/wiki 命令，判断权在模型。提示词正文应写清楚"什么情况要执行、什么情况跳过"。
- **零侵入**：不改 dsh 源码；host 逻辑零额外依赖（纯逻辑在 `src/logic.js`），client 设置卡与 mem0 同契约。

## 配置

- 默认 `enabled: true`、`skipTrivial: true`、内置一条「图谱·Wiki 提醒」。
- 设置页用户层保存优先；也可直接在 `~/.dsh/profiles/web/cordis.patch.yml` 覆盖（见 `cordis.patch.yml` 注释）。

## 安装（发哥执行）

```bash
dsh plugin --profile web add /data/dsh-workspace/dsh-prompt-injector
# 重启 dsh
```

卸载：`dsh plugin --profile web remove dsh-prompt-injector`

> 取代说明：早先的 `dsh-graph-wiki-alert`（单用途静态提醒）已被本插件取代——内置默认提示词即其文本，且可增删改。已装 graph-wiki-alert 的可用本插件替换。

## 验收路径（安装重启后）

1. 新开会话发有实质内容的话 → 出现一行折叠的「上下文注入 图谱·Wiki 提醒」。
2. 设置页新增一条提示词（如"回答前先列 1-2-3 结构"）→ 保存 → 后续每轮多一行「上下文注入 <新标题>」。
3. 发「好的」「继续」→ 不出现提醒（琐碎过滤）。
4. 单测：`node --test test/smoke.mjs`（host 6 项）+ `node test/client-smoke.mjs`（client 7 项）。

## 实现

- `src/index.js`：Config（schemastery）+ `installSettingsSection` 设置注册 + `agent/pre-step` 注入 + `agent/created`/backfill 挂载（WeakSet 幂等，同 dsh-mem0-plugins installAgentHooks 模式）。
- `src/logic.js`：纯逻辑零依赖（默认提示词 / normPrompts 收敛 / isTrivialPrompt / makePromptMessage / shouldInject），便于单测。
- `lib/client.js`：设置卡（总开关 + 琐碎过滤开关 + 提示词列表编辑器），slot/翻译/样式对齐 mem0 卡（`PInj_` 前缀防冲突）。
- `test/`：host 单测 + client bundle 结构/渲染测试。

## 相关

- 注入机制同构参考：dsh-mem0-plugins（agent/pre-step + form:'notice'）
- 默认提示词涉及的通道：crg-mcp.service（5555）/ graphify-mcp.service（5566）/ gbrain-mcp.service（3131 + gmcp）——见 `code-review-graph-ops`、`gbrain-query` 技能