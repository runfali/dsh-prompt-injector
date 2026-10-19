# dsh 0.2.1-rc.2 适配（本仓 0.2.1 适配轮）

对象：本机桌面端 `D:\DeepSeek Harness\`（`DeepSeek Harness.exe` `FileVersion = 0.2.1-rc.2`）。
本仓适配基线：dsh 0.2.0-rc.1（见 [DSH-0.2.0-ADAPTATION.md](DSH-0.2.0-ADAPTATION.md)）。

> 取证方式：0.2.1-rc.2 是二进制安装版，无源码 diff。本轮解包
> `resources/app.asar`（头布局 `[4B][4B][4B headerSize][4B][header JSON]`，数据偏移
> **`16 + headerSize`**，不是 `8 + headerSize`）→ 得到 `D:\DSH\.diag\asar021\full`，
> 再**直接调用宿主自带的真闸函数**与逐包源码比对。

## 一、结论速览

| 面 | 结论 |
|---|---|
| 判定闸：真 manifest | **PASS**（`evaluatePluginCompatibility` 返回 `undefined`） ✅ |
| 判定闸：**语义已变** | `engines.dsh` 现在**独自决定**，peers 被忽略 ⚠️ |
| 兼容区间 | 补 `\|\| >=0.2.1-alpha.0 <0.3.0`（修 pnpm 严格模式） ⚠️ |
| `Config` 导出 + `.volatile()` | **未变** ✅ |
| `settings.configure({auto:false})` | **未变**（`dsh-settings/lib/index.js:370`、`:426`） ✅ |
| `configForms` / `slots` / `locale` 三服务 | **未变**（`ConfigForms` 仍 `super(ctx,"configForms")`） ✅ |
| `plugins.item` 槽位 | **未变** ✅（活体 Slots Inspect 已确认存在） |
| `agent/pre-step` waterfall + `kind:'enter'` + `messages` | **未变**（`dsh-agent-loop/lib/index.js:909`） ✅ |
| V4 写盘准入 `plugin:<包名>` | **未变**（`dsh-session-format-v3-to-v4/lib/index.js:92`） ✅ |
| `src/*` 与 `lib/client.js` | **零改动**（契约点全部无漂移） |

## 二、本轮最重要的发现：判定闸语义在 0.2.1 变了

0.2.0 的闸**只**遍历 `peerDependencies`；0.2.1 改为**先看 `engines.dsh`，有则独自决定、peers 被忽略**：

```js
// dsh-app-boot/lib/index.js:279  unmetRequirements()
const engines = Object.hasOwn(fields, "engines") ? objectOf$1(fields.engines, "Plugin manifest engines") : {};
if (Object.hasOwn(engines, "dsh")) {          // ← 0.2.1 新增：顶层 engines.dsh 存在即独自判定
  const range = engines.dsh;
  return satisfies(runtimeVersion, range) ? {} : { "engines.dsh": range };
}
if (!Object.hasOwn(fields, "peerDependencies")) return {};
// …否则逐条遍历 @deepseek-ai/dsh / @deepseek-ai/dsh-* peers
```

**对本仓的影响：无。** 本仓的 dsh 区间写在**嵌套**位置 `dsh.engines.dsh`
（`package.json` 的 `dsh` 字段下），不属于 `fields.engines`，所以实际仍由 peers 判定。
已用真闸实测确认：

```
manifest.engines      = {"node":"^22.19.0 || >=24.0.0"}   ← 无 dsh 键
hasOwn(engines,dsh)   = false
真 manifest → PASS
```

同时实测：**喂一个顶层 `engines.dsh` 会立刻改由它单独判定**（喂必失败值 → 返回
`requirements:{"engines.dsh":…}`）。守护测试已加断言钉住「本仓不得出现顶层 `engines.dsh`」。

> 这条同时订正了 0.2.0 适配文档里「`engines.dsh` 零消费者」的结论——**该结论在 0.2.1 已失效**。

## 三、0.2.1 子句修的是 pnpm 安装期，不是加载闸（本轮最易搞错的一条）

用宿主自带 `semver@7.8.5` 对候选版本跑两种模式，**旧区间**结果：

| 版本 | strict（pnpm 安装期） | host（宿主闸，决定加载） |
|---|---|---|
| `0.2.1-alpha.0` | ❌ | **✅** ← 分叉 |
| `0.2.1-rc.1` | ❌ | **✅** ← 分叉 |
| **`0.2.1-rc.2`** | ❌ | **✅** ← 分叉（本机运行版本） |
| `0.2.2-rc.1` | ❌ | **✅** ← 分叉 |
| `0.3.0` | ❌ | ❌ |

真闸函数对**旧区间**返回 `undefined`（PASS）——即**旧区间在 0.2.1 下本来就能加载**。
补 0.2.1 段解决的是 `pnpm install` 的严格模式失败。

**这与 0.2.0 那轮的成因不同，别照抄上一轮的叙事**：
0.2.0 的旧区间里**根本没有 `0.2.x` 段**，宿主闸也拒绝（真机打印
`skipping profile bundle "dsh-prompt-injector"`）；0.2.1 则是「闸放行、安装期拒」。

## 四、逐项契约比对（均以 0.2.1-rc.2 解包源码为准）

| 项 | 0.2.1 位置 | 结论 |
|---|---|---|
| `settings.configure(presentation, owner)` | `dsh-settings/lib/index.js:370` | 未变 |
| `auto` 默认 `?? true`（故 `{auto:false}` 仍关自动页） | `:426` | 未变 |
| 命名空间枚举 = 「active 且带 volatileForm 的 Config」，ns = 行 id | `:413-434` | 未变 |
| `ConfigForms` 服务键 `configForms` | `dsh-client-ui-settings/lib/client.js:1270` | 未变 |
| `slots.inject(key, callback)` / `register` | 活体 Slots Inspect + `dsh-client-ui-settings` 同款接线 | 未变 |
| `whileServed(namespaces, register)` | `dsh-client-ui-settings/lib/client.js` | 未变 |
| `plugins.item` 槽位存在 | 活体 `Slots.listSubTree` 已确认（`kind: list`，含 `label`/`order`） | 未变 |
| `agent/pre-step` waterfall 载荷 `{messages, turn, step, signal}` | `dsh-agent-loop/lib/index.js:909` | 未变 |
| 决策形状 `{kind:'enter', messages}` | 同上 `:916-919` | 未变 |
| V4 `plugin:${plugin}` 生产者 kind | `dsh-session-format-v3-to-v4/lib/index.js:92` | 未变 |

### 已核查但**不构成破坏**的 0.2.1 变化

- 0.2.1 移除了 `dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-store`
  等包（0.2.0 有、0.2.1 无），但 `slots` 服务本身仍在——活体客户端 Slots Inspect
  provider 正常工作即为证据。本插件只经 `ctx.slots` 用服务，不 import 这些包。
- 0.2.1 新增 `dsh-api-remote-access`、`dsh-plugin-market` 等 28 个包，与本插件无关。

## 五、改动清单

1. `package.json`：版本 `0.2.0-rc.1` → `0.2.1-rc.2`；`dsh.engines.dsh` 与两个 dsh peer
   各追加 `|| >=0.2.1-alpha.0 <0.3.0`；devDeps → `@deepseek-ai/dsh@0.2.1-rc.2` +
   `@deepseek-ai/dsh-settings@0.2.1-rc.2`。
2. `pnpm-workspace.yaml`：`minimumReleaseAgeExclude` 278 条从 `0.2.0-rc.1` 刷到
   `0.2.1-rc.2`（无 BOM、无行尾改动，已核）。
3. `test/entry.test.mjs`：
   - 版本号断言 → `0.2.1-rc.2`；
   - 判定表 20 行 → **26 行**（新增 `0.2.1-alpha.0` / `0.2.1-rc.1` / `0.2.1-rc.2` /
     `0.2.1` / `0.2.2` / `0.2.2-rc.1`）；
   - 新增 0.2.1 反证：**旧四段区间 strict 拒 0.2.1-rc.2 而 host 放行**；
   - 订正 0.2.0 轮写错的注释（「闸从不读 engines」→ 0.2.1 已变），
     并加断言：顶层 `engines.dsh` 不得出现。
4. `README.md` / `README.zh-CN.md`：区间更新 + 「0.2.1 子句修安装不修加载」说明。

**未改**：`src/*`、`lib/client.js`、`cordis.patch.yml` —— 契约点全部无漂移。

## 六、测试与验证

- `node --test test/*.test.mjs`：**6 pass / 0 fail / 0 skipped**（`entry.test.mjs` 16 组、
  26 行判定表 × 2 模式交叉验证）。
- `smoke.mjs` 11 pass / `entry-smoke.mjs` 4 pass / `client-smoke.mjs` 14 项，**全部 0 skipped**。
- 交叉验证**真的跑了**（26 行 × 2 模式与宿主真 semver 逐行一致），不是静默跳过。
- **devDeps 已真升级**到 0.2.1-rc.2（`node_modules` 内 dsh / dsh-settings 均为 0.2.1-rc.2，
  lockfile 内 `0.2.0-rc.1` 残留引用数 = 0）。
- 宿主真闸：`evaluatePluginCompatibility(<真 manifest>, {}, '0.2.1-rc.2')` → `undefined`（PASS）；
  负例（`>=0.1.7-alpha.0 <0.1.8`）→ 正确 REJECT（对照非空转）。
- **真机活体证据**：本会话即运行在 0.2.1-rc.2 上，插件的三条 notice
  （`Discipline: Skills First` / `Style: Answer First` / `Pre-check: Code Graph`）
  逐字出现在当前模型上下文中，与 `profiles/desktop/cordis.patch.yml:367` 起的
  live 配置**逐字一致** —— 这是「host 半在 0.2.1 上真实工作」的端到端证据。
- 客户端半：活体 Client `Slots` Inspect provider 可用（`plugins.item` 存在且
  `kind: list`，接受 `id`/`order`/`label`），且 `configForms`/`slots`/`locale` 三服务
  在 0.2.1 源码中均存在。

### 诚实缺口

1. `lib/client.js`（设置卡）本轮**仍未做浏览器端真机点击验证**——需打开插件页确认
   卡片可编辑、保存后每轮注入生效。**代码零改动**，且其依赖的四个契约点
   （`configForms` / `slots.inject` / `whileServed` / `plugins.item`）已逐个在 0.2.1
   源码或活体 Inspect 上核实。
2. 判定表的**分叉行**（`0.2.2-rc.1` / `0.3.0-alpha.0` / `0.1.8-rc.1`）为推导 + 宿主真
   semver 实测，未在真机装历史宿主复跑。
3. 本插件在 **web profile 也挂载**（`profiles/web/package.json` 有 `link:` 条目）；
   本轮真机证据取自 desktop profile（当前会话）。两 profile 共用同一份 `link:` 源码。
