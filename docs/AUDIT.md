# Audit Log — dsh-prompt-injector

审计记录（2026-08-26，三轮全量 + 一轮定向复核）。分级：P0=阻断加载/功能失效；P1=显著正确性缺陷；P2=改进项；P3=记录在案。

## 结论

**P0=0 / P1=0 / P2=0**（连续两轮审计零 P0/P1/P2，达到停止线）。当前按需审计模式：大改动后审改动面 + 定期专项。

## 第一轮（git 78aec58）

**P1 ×1**
- `normPrompts([])` 空数组回退默认提示词——用户在 UI 删光并保存后（client 已正确落盘 `prompts: []`）每轮仍注入默认「图谱·Wiki 提醒」。修：显式空数组保持为空（注入零条），仅非数组/undefined 用默认。

**P2 ×3**
- 英文界面硬编码中文"条"（"Enabled · 2 条"）→ `card.promptCount` 参数化翻译键（`t(key, {n})`，dsh-client-locale 源码确认 `{name}` 占位符契约）
- `inject` 冗余声明 `'settings'`（`installSettingsSection` 内部已自管 `ctx.inject(['settings'])`；`SettingsProvider` 构造 `super(ctx, 'settings')` 实证服务名存在）→ 精简为 `['agents']`
- 空正文行静默不注入 → 行内警示「正文为空，此行保存后不会注入」

**P3 记录**：parseFieldValue 丢弃 title+text 双空行、重复 id 致 React key 冲突、plan() 对外部配置键序差异恒 dirty（保存即归一化）、promptCount 含停用条目、catch 二次 next（次轮升级修复）。

**健康面实证**：注入链路/backfill/apply 同步与 dsh-mem0-plugins 同构；slot 契约（hooks→usePromptInjector/actions/翻译键 28 键/ GROUPS 白名单）；`isTrivialPrompt` 无 ReDoS（200KB≈6.7ms）；CSS 花括号平衡；form 保存链路行为模拟正确。

## 第二轮（git 5625131）

**P0 ×1（最大发现）**
- `src/index.js` 写 `import { z }`，而 `@deepseek-ai/schemastery` 仅 default export（`export { Schema as default }`）——ESM 静态分析期直接抛 `does not provide an export named 'z'`，**host 模块整体无法加载、插件装而不生效**。测试盲区：`node --check` 只查语法；smoke 只测零依赖 logic.js；client-smoke 只测 client——三路全绕开 host entry 真实加载路径。修：`import z`；新增 `test/entry-smoke.mjs` 直接 import index.js 的加载冒烟（该测试比修复本身更值钱）。

**P2 ×2**
- pre-step catch 二次调用 `next()` 重放下游链节（双副作用隐患，继承上游模式）→ 拆两段：下游抛错向上传播不重放；注入逻辑抛错回退原决策。
- PromptsEditor 只读会话（writable=false）控件未禁用 → 全部控件（输入/开关/删除/添加）禁用。

**测试固化**：entry-smoke 3 项（加载契约/apply 驱动/pre-step 端到端注入：freshUser 注入、空正文过滤、工具步/琐碎轮跳过）；client-smoke 9 项（+form 保存链路、只读态 9 处禁用）。依赖安装 + `package-lock.json` + `.gitignore`。

## 第三轮（git daaaa9c）

复核无新 P0/P1/P2。源码级核查 dsh-settings `resolve`/`write`/`publish` 路径：用户层非法配置（手改 yaml）在 resolve 校验阶段被拒、保留上次好值并 warn、不污染其他 namespace；write 队列异常不破坏 provider；resolved 缓存 commit 时更新、spec() 每轮读到最新。修正 README Features 表 "host logic has zero runtime dependencies" 措辞（零依赖的仅是 logic.js）。补齐 client-smoke discard/保存失败路径测试（scopeStub 模拟真实 commit）。

## 第四轮（git 待定）

定向复核无新 P0/P1/P2。`node --test` 无参全量 12 文件级通过 + client-smoke 10 项；git fsck 干净；package.json 补 `repository` 字段（开源准备）。

## 第五轮（git 待定，2026-09-02 —— dsh 0.1.2-alpha.3 适配后按需审计）

背景：适配 5 commits（4610266..4934502，settings 接线迁移）+ C 组 trigger 双模（b2d1263，当时未走审计循环）后按需审计。

**P2 ×1**
- `normPrompts` 重复 id 不去重——用户手写 yaml 两条同 id：client 行 key 冲突（React 渲染错位）+ postCompaction 代际记账共享（一条注入后另一条同代被误判已注入而丢失）。修：`usedIds` 去重，重复追加序号（a → a-2 → a-3，序号碰撞链推进）；UI 添加的行用 randomUUID 不受影响。回归测试含碰撞链（c/c-2/c-2-2/c-3）。

**契约级核对（alpha.3 宿主源码实证，非记忆）**
- `settingsNamespace()`/`installSettingsSection()` 已从 dsh-settings 删除（grep 零命中）；`settings.installSection(owner, ns, schema, entry, hooks)` 实证 lib/index.js:327——register(base=entry) → setSource(scope.get) → 卸载回落 effect（isUnloading(owner) 检查）→ onChange 同步首发 → watch 持续通知
- `register()` 校验 ns 为小写连字符标识符（'prompt-injector' 合法）；重复注册抛错
- `agent/pre-step` waterfall 载荷 {messages, turn, step, signal}、fallback {kind:'enter', messages}——注入器 return 形态兼容；`session/event` 二参 (session, event)={type,seq,time,data}；compaction/summary 事件仍在（dsh-compaction invariant 实证）
- client 侧：settingsScope/locale/slots 服务名在（dsh-client-locale 实证 bind 用法）；settings.plugin.item slot 注册端在 dsh-cordis-client-runner + dsh-client-ui-settings-plugins；`dsh.client.inject` 字段可选（optionalStringArray + inject !== void 0），删除安全；platform 必须 string（"web" 保留）
- jsx/jsxs stub 均正确传 props（技能记载的经典盲区已防）

**P3 记录**
- 插件热卸载后已挂 agent 的 pre-step 监听残留（agent.ctx.on 未保存 disposer；与 dsh-mem0-plugins backfill 模式同构共享，运维边缘场景，暂不修）
- makePromptMessage 不截断正文（超长自填内容信任用户输入；与 mem0 工具回执输出硬化不同源，记录在案）

**健康面**：测试 15 + 14 全绿（新增重复 id 回归）；反向对照旧代码 0/4 炸、新代码 4/4 绿；适配前后 entry-smoke 契约形状一致。

## 当前测试基线（全绿）

- `node --test test/smoke.mjs test/entry-smoke.mjs`（11 + 4）
- `node test/client-smoke.mjs`（14 项：locale/slot/渲染/保存链路/只读态/discard/失败路径/交互回归/trigger 三态）
- README 双语 10 章节一一对应；默认提示词与代码一致性核对通过