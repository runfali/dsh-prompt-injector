# dsh 0.2.0-rc.1 适配调研（本仓 0.2.0 适配轮）

对象：本机桌面端 `D:\DeepSeek Harness\`（`DeepSeek Harness.exe` `FileVersion = 0.2.0-rc.1`）。
本仓适配基线：dsh 0.1.7-rc.1（见 DSH-0.1.7-ADAPTATION.md）。

> 调研方式：0.2.0-rc.1 是二进制安装版，没有源码 diff 可读。本轮改走
> 「解包 `resources/app.asar` → 调用宿主真实判定函数 → 真机闸实测」三步取证，结论均可复现。

## 一、结论速览

| 面 | 结论 |
|---|---|
| 入口加载（`src/index.js` 真 import） | **未变** ✅ |
| `Config` 必须导出 + `.volatile()` 热编辑契约 | **未变** ✅ |
| `settings.configure({auto:false})` 接线 | **未变**（`dsh-settings/lib/index.js:370`、`:426`） ✅ |
| V4 写盘准入（`plugin:<包名>` 生产者 kind） | **未变**（`dsh-session-format-v3-to-v4/lib/index.js:92`） ✅ |
| `ctx.inject(['settings'])` 等待式注入 | **未变** ✅ |
| 兼容闸判定口径 | **未变**（仍只认 peerDependencies） ⚠️ |
| 兼容区间 | **必须新增 0.2.0 clause**（唯一必改项） ⚠️ |

## 二、取证方法（可复现）

0.2.0-rc.1 的宿主源码封在 `resources/app.asar` 内：

1. **解包 asar**：读头部 JSON → 按 `offset` 取内容区，导出 `dsh/node_modules/@deepseek-ai/*`
   与宿主自带 `semver@7.8.5`。
2. **调用宿主真实判定函数**：从解包产物 `import`
   `@deepseek-ai/dsh-app-boot/lib/index.js`，直接调
   `evaluatePluginCompatibility(manifest, {}, runtimeVersion)`（`:286`）——安装闸与启动闸共用它。
3. **真机闸实测**：`DeepSeek Harness.exe`（`ELECTRON_RUN_AS_NODE=1`）+ `dsh/lib/bin.js
   --profile web --dump-config`，stdout/stderr 分流捕获。

## 三、契约逐项比对

### 1. 设置面：**未变** ✅

| 项 | 0.2.0-rc.1 位置 | 结论 |
|---|---|---|
| `settings.configure(presentation, owner)` | `dsh-settings/lib/index.js:370` | 未变 |
| `auto` 默认值与 `autoGenerate` 判定 | `:426`（`?? true`） | 未变，故 `{auto:false}` 依旧关闭自动默认页 |
| 命名空间来源 = cordis 行 id（`prompt-injector`） | 仍按「active 且带 volatile 字段的 Config」枚举 | 未变 |
| `Config` 必须从模块导出 + 字段 `.volatile()` | 同 | 未变（`test/entry.test.mjs` 第 1 节守护） |

### 2. V4 写盘准入：**未变** ✅

`dsh-session-format-v3-to-v4/lib/index.js:92` 仍是 `return \`plugin:${plugin}\``，
且 `:118`、`:126` 仍拒绝裸 `kind: "plugin"`。本仓 `PROMPT_INJECTOR_SOURCE_KIND =
'plugin:dsh-prompt-injector'` 继续被准入接受（`test/v4-admission.test.mjs` 用宿主真实
`assertV4RowAdmission` / `encodeEvent` 驱动，含反向对照）。

### 3. 兼容闸：**判定口径不变，区间已过期** ⚠️（唯一必改项）

判定仍逐字是 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`
（`dsh-app-boot/lib/index.js:300`），且**只遍历 `peerDependencies` 里
`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的条目**（`:294`）。

**重要订正**：全树 grep 确认 0.2.0-rc.1 里**没有任何 `dsh.engines` 的消费者**。
`dsh.engines.dsh` 是声明性元数据，**闸从不读它**；决定插件生死的只有 `peerDependencies`
（`engines` 只影响 pnpm 安装期）。本仓两者同步更新并由测试守护逐字一致。

**失效证据**（真机启动闸 stderr，修复前）——本插件在 **web 与 desktop 两个 profile 同时失效**：

```
dsh: skipping profile bundle "dsh-prompt-injector": Error: Plugin dsh-prompt-injector@0.1.7-rc.1
is incompatible with dsh 0.2.0-rc.1: peerDependencies {"@deepseek-ai/dsh":">=0.1.2-alpha.3
<0.1.8 || >=0.1.5-alpha.1 <0.1.6 || >=0.1.7-alpha.0 <0.1.8", "@deepseek-ai/dsh-settings": …}.
```

**修复**：`dsh.engines.dsh` 与两个 peer（`@deepseek-ai/dsh`、`@deepseek-ai/dsh-settings`）
各追加 `|| >=0.2.0-alpha.0 <0.3.0`。

## 四、本轮最重要的发现：npm semver 有**两种模式**，本仓此前只建模了一种

本仓 `test/entry.test.mjs` 的手写判定器**逐字复刻的是严格模式**（默认选项），
而**真正决定加载**的宿主闸用的是 `includePrerelease: true`。两者在上界上一处分叉：

| | 规则 | 谁在用 |
|---|---|---|
| 严格模式（默认） | 纯比较器 **AND** 预发布可见性规则 | `pnpm install` |
| 宿主闸模式 | **纯比较器**，预发布可见性规则被整体绕过 | `dsh-app-boot:300`（决定加载） |

预发布可见性规则 = 「预发布版本只被区间内含同 `[major,minor,patch]` 元组的预发布所满足」。
在 `includePrerelease: true` 下该规则被绕过，于是**上界自身的预发布也被放行**：

| 运行时 | 严格模式（pnpm） | 宿主闸模式（加载） |
|---|---|---|
| `0.1.3-alpha.1` | ❌ | **✅** |
| `0.1.8-rc.1` | ❌ | **✅** |
| `0.2.0-rc.1` | ✅ | ✅ |
| `0.3.0-alpha.0` | ❌ | **✅** |
| `0.1.8` / `0.3.0` | ❌ | ❌ |

**推论（与上游计划书 §5 表述不符，以实测为准）**：上界 `<0.3.0` 拦的是 `0.3.0` **正式版**，
**不拦** `0.3.0-*` 预发布。「不误开 0.3.0」这句只在「正式版」意义上成立。
若需要连预发布一起拒，上界须写成 **`<0.3.0-0`**（`-0` 是 semver 规定的最小预发布标识符）。
本轮**保持 `<0.3.0`**（与家族其余插件的目标区间一致，且 0.3.0-* 出现时本来就该重新验证），
但把这个边界**写成断言钉住**，避免后人误以为已经完全封住 0.3。

验证方式：用宿主自带 semver 7.8.5 对 280 个版本逐个比对
`satisfies(v, range, { includePrerelease: true })` 与「纯比较器」模型 —— **零分歧**；
对 `0.1.3-alpha.1` / `0.1.8-rc.1` / `0.3.0-alpha.0` 三行另外用宿主真实
`evaluatePluginCompatibility` 复核，判定一致（ACCEPTED）。

## 五、改动清单

1. `package.json`：版本 `0.1.7-rc.1` → `0.2.0-rc.1`；`dsh.engines.dsh` 与两个 dsh peer
   各追加 `|| >=0.2.0-alpha.0 <0.3.0`；devDeps 升到 `@deepseek-ai/dsh@0.2.0-rc.1` +
   **`@deepseek-ai/dsh-settings@0.2.0-rc.1`（必须显式钉版本）**。
2. `pnpm-workspace.yaml`：`minimumReleaseAgeExclude` 从 0.1.7-rc.1 刷到 0.2.0-rc.1
   （267 条改写 + 11 条 0.2.0 新增包；`allowBuilds` 不动）。
3. `test/entry.test.mjs`：
   - 判定表从 14 行扩到 **20 行 × 2 列**（严格模式 + 宿主闸模式），两列都逐行实测后写死；
   - 新增 `satisfiesHost()`（宿主闸模式判定器，去掉可见性过滤那一步）；
   - 新增上界已知边界断言（`<0.3.0` 放行 `0.3.0-*`、拒 `0.3.0`）；
   - 新增 0.2.0 反证（旧三段区间不覆盖 `0.2.0-rc.1`）；
   - 交叉验证从「1 列」改为「2 列」，并把 semver 解析路径修正为 pnpm 实际落点
     （`node_modules/.pnpm/semver@<ver>/…`），**此前该步一直静默跳过**；
   - 版本号断言、`peer === engines` 一致性断言。
4. `README.zh-CN.md`：区间更新 + 两种模式差异说明 + `engines` 无消费者说明。

**未改**：`src/*`（注入链路、settings 接线、V4 kind）、`lib/client.js`、`cordis.patch.yml`
—— 契约点全部无漂移。

## 六、测试与验证

- `node --test test/*.test.mjs`：6 例全绿；`entry.test.mjs` 15 组断言
  （含 20 行判定表 × 2 模式与宿主真实 semver 交叉验证）；`smoke.mjs` 11 例、
  `entry-smoke.mjs` 4 例、`client-smoke.mjs` 14 项，全绿。
- **测试现已在 0.2.0-rc.1 开发依赖下运行**（devDeps 真升级，非仅改区间）。
- 真机闸：修复后 `--profile web --dump-config` 的 stderr 不再出现本插件的
  `skipping profile bundle`；**web profile 跳过数归零（10 loaded / 0 skipped）**。
- 宿主真实判定函数：`evaluatePluginCompatibility(<本仓 manifest>, {}, '0.2.0-rc.1')`
  → `undefined`（放行）。
- 边界（诚实缺口）：
  1. 判定表 20 行的**分叉行**（`0.1.3-alpha.1` / `0.1.8-rc.1` / `0.3.0-alpha.0` 在宿主闸下为
     true）是**推导 + 宿主真实 semver 实测**得出，未在真机上跑这些版本本身（那需要装对应的
     历史宿主）。已用宿主真实 `evaluatePluginCompatibility` 复核三行，判定一致。
  2. `lib/client.js`（设置卡）只做源码级比对，**未做浏览器端真机点击验证**——
     需你打开插件页确认设置卡可编辑、保存后每轮注入生效。
  3. 本插件**未测 desktop profile 的设置卡**（desktop 由 Electron 独占，CLI 拒绝 dump）；
     但 `dsh.client.platform: "web"` 的装载路径与 web 一致，理论同源。
  4. `pnpm install --force` 后 `node_modules/.pnpm` 仍残留 5 个 0.1.7-rc.1 目录
     （pnpm 不回收孤儿目录）；已确认**无任何 symlink 指向它们**，锁文件里 0.1.7-rc.1 引用数为 0，
     属无害残留。
