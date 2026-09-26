# dsh 0.1.7-rc.1 适配说明（dsh-prompt-injector）

对象：本机全局 `@deepseek-ai/dsh@0.1.7-rc.1`。本仓适配基线：0.1.5-rc.1。

## 契约比对结论（与门卫插件适配轮共享的通用结论，此处只列与本插件相关的差异）

### 1. 宿主 settings 模型重做（唯一硬破坏）⚠️

| 项 | 0.1.5-rc.1 | 0.1.7-rc.1 |
|---|---|---|
| 命名空间注册 | `settings.installSection(owner, ns, schema, entry, hooks)`（setSource/onChange 回调维持 current()） | **已移除**。`settings.describe()` 直接枚举「active 且含 volatile 字段 Config」的入口；`ns = cordis 行 id` |
| 可热编辑字段 | 整段 schema 即 scope | 字段必须 `.volatile()`；volatile-only 变更经 loader `_commitVolatile` **原地提交**（不重启 fiber），其余字段变更走 fiber 重启 |
| apply 收到的值 | 普通值 | **volatile 字段是 `{get()}` 活引用**（cosmokit `createVolatile` 协议） |
| 展示策略 | installSection 即卡片 | 默认按 schema 自动生成页；`settings.configure({auto:false}, fiber)` 关闭 |
| 宿主设置服务面 | — | `configure` / `describe` / `update` / `replace` / `mutate`（SettingsForms） |

### 2. 浏览器 settings 通道（第二处硬破坏）⚠️

| 项 | 0.1.5-rc.1 | 0.1.7-rc.1 |
|---|---|---|
| scope 服务 | `settingsScope`（`bind({namespace})`） | **已移除** → `configForms.get(ns)`（ConfigFormController） |
| scope API | getSnapshot/set/unset/subscribe | 同名同形 + `mutate(ops, revision)`；快照多 `base/revision/mode`（PIForm 只读 status/value/user/writable，兼容） |
| 设置卡槽位 | `settings.plugin.item`（设置页，keyed，key=NS） | **已移除** → `plugins.item`（插件页，list，`id`=行 id，`label` thunk，`order`） |
| 注册时机 | 直接注册 | `configForms.whileServed([NS], register)` 门控：宿主开始服务 ns 才注册，停服自动摘除 |
| hooks→props | `hooks.promptInjector` → `usePromptInjector` | 不变（PropsSlotHooks `use${Capitalize<N>{'}'}`） |

### 3. 兼容校验强制化（同门卫适配轮）⚠️

- `peerDependencies` 里的 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 条目在安装 preflight
  （插件管理器）与启动 preflight（profile 兼容检查）被消费，
  `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`。
- 本仓 peer 区间（`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-settings` 同款）：
  `>=0.1.2-alpha.3 <0.1.8 || >=0.1.5-alpha.1 <0.1.6 || >=0.1.7-alpha.0 <0.1.8`
  —— dsh 侧 includePrerelease 放行 0.1.2-alpha.3~0.1.7 全段；pnpm 严格 semver 下
  0.1.5-rc.* 与 0.1.7-rc.* 各需同元组预发布下界；上界 <0.1.8 先验证再放行。
- schemastery peer 收紧为 `~3.18.4`：`.volatile()` 是 3.18.4 新增 API（3.18.2 没有），
  与 dsh 0.1.7 自身的依赖声明对齐。
- 用宿主自带 semver + dsh-app-boot `evaluatePluginCompatibility` 实测：
  0.1.2-rc.1 / 0.1.5-rc.1 / 0.1.7-rc.1 ✅；0.1.8 ❌（正确拒绝）。

### 4. 注入链契约（agent 半）：零漂移 ✅

- `agent/pre-step` payload `{agent, messages, signal, step}`、decision `{kind:'enter', messages}`
  追加形态不变（dsh-agent 源码级复核，宿主自用的 modelSwitchNotice 同链路）。
- `agent/created`（`{agent, source}`）+ `agents.list()` 补挂不变（dsh-agent AgentsService）。
- `session/event` 载荷 `[session, event]`、`compaction/summary` 事件 `data`
  嵌套形状不变（dsh-session append / dsh-compaction-basic 源码级复核）。
- `session/disposed`（载荷 `[session]`）不变。
- 注入形态 `user / form:'notice' / summary=标题` 不变；**但 `source.kind` 必须改**——
  当时此处记为「`kind:'plugin'` 不变」是**错的**（0.1.7 会话格式升 V4，V4 原生准入
  拒绝 `kind:'plugin'`，且校验在写盘路径上 → 加提示词后每轮「本轮运行失败」）。
  现为 `kind:'plugin:dsh-prompt-injector'`。完整根因、证据与回归守护见
  [docs/AUDIT.md 第七轮](AUDIT.md#第七轮2026-09-25--dsh-017-rc1-真机故障v4-source-kind)。

## 改动清单

1. `src/index.js`：删除 installSection 接线；Config 三个可编辑字段加 `.volatile()`；
   `ctx.inject(['settings'])` 改为注册 `{auto:false}` 展示策略；新增 `readField()`
   统一解引用（volatile 引用 `.get()`，普通值透传，两种宿主形状兼容）。
2. `lib/client.js`：`settingsScope.bind` → `ctx.configForms.get(NS)`；设置卡从
   `settings.plugin.item`（keyed/key）迁到 `plugins.item`（list/id + label thunk + order）；
   注册包进 `configForms.whileServed([NS], ...)`；inject 声明 `settingsScope` → `configForms`。
3. `package.json`：版本 0.1.7-rc.1；`dsh.engines.dsh` 三 clause；peer 新增
   `@deepseek-ai/dsh`（兼容闸必读）、`@deepseek-ai/dsh-settings` 区间同款、
   schemastery 收紧 `~3.18.4`。
4. `test/entry.test.mjs`：版本守卫 0.1.7-rc.1；engines 判定表加 0.1.7-rc.1/0.1.7（含）
   与 0.1.8/0.1.8-rc.1（排除）行；peer 断言加 dsh peer 与 0.1.7-rc.1 覆盖；
   settings 桩改 `configure({auto:false})` 契约；4c 用例改传 volatile `{get()}` 引用。
5. `test/client-smoke.mjs`：configForms 桩（get/whileServed）、plugins.item 槽位断言
   （id/order/label thunk）、locale.bind 桩。
6. `pnpm-workspace.yaml`：allowBuilds 落定 false（测试无需原生构建）、
   minimumReleaseAgeExclude 刷到 0.1.7-rc.1 + schemastery 3.18.4。
7. devDeps：`@deepseek-ai/dsh@0.1.7-rc.1`（entry 真实加载用宿主同版副本）。
8. README/README.zh-CN：环境要求与兼容区间说明更新。

## 测试

- `pnpm test`：entry.test 13 组（判定表 14 行）+ smoke.mjs 11 例 + client-smoke 14 项 —— 全绿。
- 真实加载：entry.test 直接 import 宿主入口，在仓库本地 `@deepseek-ai/dsh@0.1.7-rc.1` +
  `dsh-settings@0.1.7-rc.1` + `schemastery@3.18.4` 副本上跑通（schemastery 3.18.2 无
  `.volatile` 会当场炸出，正是该测试的职责）。
- 安装 preflight 模拟（dsh-app-boot evaluatePluginCompatibility）：0.1.7-rc.1 ✅。


## 追加轮（真机回归发现的第二处硬破坏）：slots.inject 回调形态 ⚠️

首轮适配后真机验证发现：插件页里插件只有开关行、点不进详情页（截图证据）。

根因：0.1.5 的 `ctx.slots.inject(name, function* () { yield register(...) })` 是 **generator 形态**；
0.1.7 改为 **「返回 disposer 的普通函数」**（`dsh-client-ui-renderer` 的
`inject(key, callback)` 实现把 callback 直接交给 `ctx.effect(callback)`，
callback 的返回值即注册 disposer）。传 generator 会被当普通回调调用——
`register` 永不执行，槽位条目不存在 → 插件管理页 `ledger.items` 没有本插件 →
没有可点击的详情入口。0.1.7 全部官方/第三方存活插件（settings-agent-loop、
theme、locale、@linxin666 三件）都是 `() => register(...)` 箭头形态，无一例外。

修复（对齐官方 agent-loop 接线）：

```js
ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("plugins.item",
  () => ctx.slots.register({ name: "plugins.item", id: NS, order: 30, label, locale, inject }, Card))
))
```

同轮对齐的两处渲染细节：

1. **双视图卡片**：插件页对槽位有 `${'{'}view: 'summary' | 'page'{'}'}` 两种渲染
   （列表卡描述区 / 详情页配置区，ownerProps spread 进组件 props，renderer
   `renderEntry` 源码级确认）。官方卡片 summary 返回一行描述字符串、page 返回
   表单。本卡改为同款分支：`view === 'summary'` → `t("card.description")`；
   page/未传 → 完整表单（根元素 `<li>` → `<div>`，详情页非列表语境）。
2. **详情页匹配**：`ItemDetail` 用 `renderSlot(..., { only: item.id })` 过滤条目，
   注册 `id` 必须等于宿主行 id（`prompt-injector`）——首轮已对，本轮加断言固化。

测试：client-smoke 的 slots 桩同步改新契约（`inject(key, cb) → cb() 返回注册值`），
全套 13 组 + 11 例 + 14 项全绿。


## 第三轮（真机回归 P1）：Config 未导出导致命名空间不可见 ⚠️

症状（用户截图）：插件页里插件行能进详情页，但配置区只有启用/停用，没有设置卡。

完整链条（源码级溯源）：

1. `dsh-settings` `describe()` 枚举命名空间的唯一插件侧条件：
   `schema(entry) = entry.fiber.runtime.Config`（cordis `runtime = { Config: plugin.Config }`，
   `plugin` 即模块导出对象经 `unwrapExports` 透传）→ `volatileForm(schema) !== undefined`。
2. `Config` 未从模块导出 → `runtime.Config === undefined` → `schema(entry)` 返回 undefined →
   入口被 describe() 过滤 → ns 不在设置视图。
3. client 半 `configForms.whileServed([NS], ...)` 依赖 mirror 视图（describe 结果）里出现 ns 才注册 →
   永不注册 → `plugins.item` 槽位无条目 → 插件页无配置入口（只有宿主自动渲染的启用/停用行）。

修复：`export const Config`（0.1.7 的 settings 命名空间来源）。entry.test 加守护断言：
Config 必须导出且三个可编辑字段必须 `.volatile()`。

### 附带确认（0.1.7 生效路径纪律）

- link 插件的 **host 半代码变更不能热生效**：dsh-hmr 监听的是 dsh 安装目录模块；profile patch
  touch 只在 config 值实际变化时触发 fiber 重启（`equalExceptVolatile` 短路）。因此 host 半
  修复后必须重启 dsh。
- client 半变更（lib/client.js）随页面刷新生效（client-modules graph rev 变化）。
