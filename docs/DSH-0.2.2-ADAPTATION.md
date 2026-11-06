# dsh 0.2.2-rc.1 适配（本仓 0.2.2 适配轮）

对象：本机桌面端 `D:\DeepSeek Harness\`。
判据（两处，只有这两处作数）：`resources/app.asar/dsh/package.json` 的
`name=@deepseek-ai/dsh-desktop-runtime` / `version=0.2.2-rc.1`，与同树
`@deepseek-ai/dsh-app-boot` 包版本 `0.2.2-rc.1`。

> ⚠️ 安装根目录下的 `version` 文件是 `44.7.0`（Electron 版本），**不是 dsh 版本**；
> exe 的 `VersionInfo.FileVersion` 同理。别再拿它跟 package.json 比。

本仓适配基线：dsh 0.2.1-rc.2（见 [DSH-0.2.1-ADAPTATION.md](DSH-0.2.1-ADAPTATION.md)）。

> 取证方式：0.2.2-rc.1 是二进制安装版，无源码 diff。本轮经 Electron `fs` 感知层
> （`ELECTRON_RUN_AS_NODE=1` + `DeepSeek Harness.exe`）从 `resources/app.asar` 抽出
> 相关包到 `D:\DSH\_host-022rc1\`，再逐包比对契约点。注意 `fs.cpSync` 不能读 asar
> （`ENOENT … not found in D:\…\app.asar`），必须手写 `readdirSync` + `readFileSync` 递归拷贝。

## 一、结论速览

| 面 | 0.2.2-rc.1 实测 | 结论 |
|---|---|---|
| 判定闸读取顺序 | 顶层 `engines.dsh` 存在则独自判定，否则逐条 peer | **未变**（`dsh-app-boot/lib/index.js:1097-1116`） |
| 闸的 semver 模式 | `satisfies(rt, range, { includePrerelease: true })` | **未变**（`:1094`） |
| 真 manifest 判定 | `evaluatePluginCompatibility → undefined` | **PASS** |
| `agent/pre-step` waterfall | `{messages, ...position, signal, modelSelection}` → `{kind:"enter", messages}` | **未变**（`dsh-agent-loop/lib/index.js:685-697`） |
| `session/event` / `session/disposed` | `(session, event)` / `(session)` 二参与单参 | **未变**（`dsh-session/lib/index.js:1944-1956`） |
| `settings.configure({auto:false}, fiber)` | 仍是 `configure(presentation, owner = this.ctx.fiber)` | **未变**（`dsh-settings/lib/index.js:228`、`:370`） |
| `configForms.whileServed` + `slots.inject/register` + `plugins.item` | 官方 `ui-settings-shell` 用同一形态接线 | **未变**（`dsh-client-ui-settings-shell/lib/client.js:290-297`） |
| `@deepseek-ai/schemastery` | 宿主自带 **3.19.0**；`dsh-settings` peer 要求 `~3.19.0` | **变了** ⚠️ 本仓 peer 原为 `~3.18.4` |
| `src/*`、`lib/client.js` | 业务代码 | **零改动** |

## 二、本轮唯一的真问题：schemastery 3.19.0

`pnpm install` 升级 devDeps 后报：

```text
✕ unmet peer @deepseek-ai/schemastery
  Installed: 3.18.4
  Wanted:
    ~3.19.0:
      @deepseek-ai/dsh-settings@0.2.2-rc.1
```

根因：0.2.2 起宿主内置 schemastery **3.19.0**，`dsh-settings` 的 peer 同步抬到 `~3.19.0`；
而本仓 peer 写死 `~3.18.4`，且该 peer 被 pnpm 自动装成 3.18.4 当夹具 —— **测的是旧夹具**（这正是
「peer 自动安装会偷偷装旧版」这条老坑）。

处置（两条一起做）：

1. peer 区间放宽为 `~3.18.4 || ~3.19.0`（仍兼容 0.1.7 / 0.2.0 / 0.2.1 的 3.18 线）；
2. **显式 pin 进 devDependencies**：`@deepseek-ai/schemastery: 3.19.0`，让测试跑在宿主真实版本上。

升级后复跑全部测试：`Config.dict[key].meta.volatile === true` 仍然成立（`.volatile()` 契约未变），
`pnpm peers check` → **No peer dependency issues found**。

## 三、判定闸：补的是 pnpm 严格模式，不是加载

与 0.2.1 那轮**同形态**（别再写成「加载被拒」）：

| 区间 | `0.2.2-rc.1` strict（pnpm） | host（决定加载） |
|---|---|---|
| 旧五段区间 | ❌ | **✅** |
| 新区间（补 `>=0.2.2-alpha.0 <0.3.0`） | ✅ | ✅ |

所以 `package.json` 的两处区间（`peerDependencies` 的 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-settings`
与 `dsh.engines.dsh`）各追加 `|| >=0.2.2-alpha.0 <0.3.0`，四串逐字一致。

## 四、验证证据（全部实跑）

- `npm test`：**18 组 + 6 V4 + 11 logic + 4 entry-smoke + 14 client**，全绿，**skip = 0**；
- 判定表 **27 行**（新增 `0.2.2-alpha.0` / `0.2.2-rc.1` 两行，后者由分叉行转为两列一致）；
- 新增反证：**旧五段区间 strict 拒 0.2.2-rc.1 而 host 放行**；
- **新增宿主真闸函数检查**（`test/entry.test.mjs` 第 3b 节）：从 `node_modules/.pnpm` 解析出
  `@deepseek-ai/dsh-app-boot`，调用 `getDshRuntimeVersion()` 与
  `evaluatePluginCompatibility(pkg, {}, runtime)` → `undefined`（PASS）；并加**真负例**
  （同一真闸对 `0.3.0` 必须返回 `requirements`，否则该检查恒绿、什么也没验）；
- devDeps 已真升级：`node_modules` 内 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-settings` 均为 `0.2.2-rc.1`，
  `@deepseek-ai/schemastery` 为 `3.19.0`。

### 真机活体证据

写这份文档的这个会话正跑在 0.2.2-rc.1 上，而插件是 `link:` 安装（读的就是仓库里的 `src/`）：
上下文中每轮出现的四条注入行（`Pre-check: Code Graph`、`Pre-check: Wiki`、
`answer-me-with-html gate`、`Memory Save Check`）就是本插件 `agent/pre-step` 注入的产物 —— 
**host 半在 0.2.2-rc.1 上工作正常**，不是靠版本号推断。

## 五、改动清单

- `package.json`：版本 `0.2.1-rc.2` → `0.2.2-rc.1`；四处 dsh 区间追加 `|| >=0.2.2-alpha.0 <0.3.0`；
  schemastery peer 放宽到 `~3.18.4 || ~3.19.0`；devDeps → `dsh` / `dsh-settings` `0.2.2-rc.1` +
  `schemastery 3.19.0`（显式 pin）；
- `pnpm-workspace.yaml`：`minimumReleaseAgeExclude` 追加 0.2.2-rc.1 系列（278 条，按 0.2.1 的包名镜像）；
- `test/entry.test.mjs`：版本断言、判定表 +2 行、0.2.2 反证、peer 断言 +1 版本、第 3b 节真闸检查、
  订正「闸只读 peers」的过时注释（0.2.1 起顶层 `engines.dsh` 优先；本仓是嵌套位故 peers 仍生效）；
- `README.md` / `README.zh-CN.md`：区间串、已验证版本、schemastery 双段说明、闸语义订正；
- `src/*` 与 `lib/client.js`：**零改动**。

## 六、后续动作

- 声明改动（版本 / 区间 / peer）在**下一次加载或预检**时生效；本插件是 link 安装，
  源码没动，**不需要重启**也不影响当前实例；
- 若要让 0.2.2 的声明真正进入 profile 的预检链路，下一次重启自然生效；
- 顺手体检（不在本仓范围，另行处理）：profile `desktop` 的五个官方实验插件仍钉 `0.2.1-rc.5` 字面量，
  宿主已升到 `0.2.2-rc.1` —— 那是「精确 peer 字面量每轮宿主升级必复发」的已知项。
