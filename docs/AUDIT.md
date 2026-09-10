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


---

# 第六轮（2026-09-10 —— dsh 0.1.5-rc.1 适配）

背景：宿主从 0.1.2-rc.1 升到 **0.1.5-rc.1**（对宿主真实安装目录内的包逐一读源码，安装时间为 2026-09-10 14:57）。本轮按 dsh-plugin-audit 的「适配类改动增量四面」（声明与版本一致性 / 发布面收敛 / 依赖卫生 / 探针保真度）+ 契约级源码对照执行。

**结论：代码本体零改动（注入链路与 client 契约在 0.1.5-rc.1 无漂移）；改动集中在声明面与测试面 —— 2 项发现（P2 声明缺陷、P1 测试盲区）全部修复并配反证。**

## 一、契约级源码对照（逐文件读 0.1.5-rc.1 真实宿主，非记忆）

| 契约 | 结论 | 证据（0.1.5-rc.1 绝对行号） |
|---|---|---|
| `settings.installSection(owner, ns, schema, entry, hooks)` | **不变**（register(base=entry) → hooks.setSource(() => scope.get()) → 卸载回落 effect（isUnloading(owner)）→ hooks.onChange() 同步首发 → scope.watch 持续通知）；且 dsh-settings 与本仓升级前的旧副本**逐字节相同** | dsh-settings/lib/index.js:327-343；diff 结果 DSH-SETTINGS-BYTE-IDENTICAL |
| 命名空间 kebab-case 校验 | 不变 | dsh-settings/lib/index.js:84（NAMESPACE_PATTERN） |
| `agent/pre-step` waterfall 载荷 `{messages, turn, step, signal}` + fallback `{kind:'enter', messages}` | 不变 | dsh-agent-loop/lib/index.js:894-901 |
| `agent/created` 载荷 `{agent}`；`agents.list()` 返回所有 live agent；服务名 agents | 不变 | dsh-agent/lib/index.js:543-550、581-583、299 |
| `session/event` 二参 `(session, event)`，event = `{type, seq, time, data}` | 不变（append() 内原样派发，无变换） | dsh-session/lib/index.js:1181-1202 |
| compaction/summary 事件类型 + 字段嵌 data 层 | 不变（真机实证，见第四节） | dsh-session/lib/index.js:92；本机隔离实例事件流 |
| `session/disposed` 载荷 = `(session)` | 不变 | dsh-session/lib/index.js:1505-1510 |
| client：settingsScope.bind({namespace}) / locale.register(ns,{zh,en}) / slots.inject("settings.plugin.item") / exports.inject 短服务名 | 不变 | dsh-client-ui-settings/lib/client.js:1169-1176、dsh-client-locale/lib/client.js:1256/1357-1414、dsh-client-ui-settings-plugins/lib/client.js:1785+ |
| 折叠行三要素 form:'notice' + source.kind:'plugin' + summary | 不变（KNOWN_FORMS 含 notice；kind==='plugin' → role 'inject'、label = source.plugin；前缀取自翻译键 message.contextInjection） | dsh-client-ui-chat/lib/client.js:772-802、4180-4228、2655/2761 |
| combo URL 下发形态（__DSH_BOOT__.entries + /plugins/??<id>/client.js&rev=） | 不变（真机 200 + 28 KB + 工厂在列） | 本机隔离实例 curl 实测 |

**唯一与「压实路径」相关的结构性变化（不是本插件缺陷，但决定真机验证方式）**：0.1.5-rc.1 的 web profile 把宿主层 compaction-basic / command-compact / tool-result-pruner 三条 **disabled**，压实改为**挂在 agent preset 的 cordis:group isolate 内**（dsh-web-app/cordis.patch.yml:427-433 对照 dsh-agent-presets/presets/standard/agent.cordis.yml:127-156）。minimal preset 明确写着「Context compaction is absent」，其 commands/list 不含 compact。→ **验证 postCompaction 必须选带压实的 preset（standard/ptc/cordis）；否则不是插件不生效，而是宿主没挂压实。**

## 二、发现与修复

### P2-1（声明缺陷，已修复）dsh.engines.dsh 单区间不覆盖目标版本

原区间 `>=0.1.2-alpha.3 <0.2.0`。按 npm semver 预发布规则（预发布只被「区间内含同 [M,m,p] 元组预发布」的区间满足），它**覆盖不了 0.1.5-rc.1**——「声明适配 0.1.5 却不被自己的声明覆盖」；同款陷阱此前已在姊妹仓命中过。

- 修：`dsh.engines.dsh: ">=0.1.2-alpha.3 <0.2.0 || >=0.1.5-alpha.1 <0.1.6"`；**peerDependencies 里的同名区间一并加析取**（两处同款陷阱，第二处最易漏）。
- 守护：test/entry.test.mjs 内置 10 行判定表（0.1.2-alpha.3 ✅ / 0.1.2-rc.1 ✅ / 0.1.5-alpha.1 ✅ / 0.1.5-alpha.2 ✅ / **0.1.5-rc.1 ✅** / 0.1.5 ✅ / 0.1.6 ✅ / 0.1.3-alpha.1 ❌ / 0.2.0 ❌ / 0.0.1 ❌），不引 semver 依赖，并与宿主真实 semver.satisfies **逐行交叉验证 10/10**。
- 反证：区间改回旧值 → 立即红；恢复即绿。

### P1-1（测试盲区，已修复）三路测试全绕开「真入口加载 / 键集合一致」

1. **真入口加载**：node --check 只查语法、smoke.mjs 只 import 零依赖 logic.js、client-smoke.mjs 只测浏览器半——本仓 P0 先例（import { z } from '@deepseek-ai/schemastery'）正是从这里溜过去的。新增 test/entry.test.mjs，首件事即 await import('../src/index.js')，断言 apply / 命名空间 / inject 面恰为 ['agents']。
2. **键集合一致（本轮新增角度，与 mem0 Round 5 的 P1 同族）**：设置卡键与 host schema 键不等 = 「设置页调不到该开关」且完全静默。断言 host Config 键集合 === client FIELDS 键集合 === ['enabled','prompts','skipTrivial']，PromptSchema 键集合 === ['enabled','id','text','title','trigger']；且 trigger 枚举字面量与**归一化方向**在 src/index.js / src/logic.js / lib/client.js 三处一致（方向反了会静默回落 everyTurn）。
- 反证：client FIELDS 删 skipTrivial → 红；反转 client 归一化方向 → 红；反转 logic.js 方向 → 红（经端到端注入断言捕获）；版本号回落 → 红；全部恢复即绿。

### 顺带收敛（非缺陷）

- 版本号 0.1.2-rc.1 → **0.1.5-rc.1**（跟宿主发布号，家族惯例）；新增 scripts.test（node --test test/*.test.mjs && node test/smoke.mjs && node test/client-smoke.mjs）。
- 开发依赖升级到 0.1.5-rc.1 真实依赖（@deepseek-ai/dsh-settings；schemastery 保持 ^3.18.2，diff -r 确认新旧宿主副本逐字节相同），package-lock.json 重生成（18 包、零原生编译）。
- pnpm-workspace.yaml 的 minimumReleaseAgeExclude 白名单从 0.1.2-alpha.3 刷到 0.1.5-rc.1（10 条）。
- README 双语（环境要求 / 开发与测试 / 结构三节）、docs/EVIDENCE.md（环境表与 manifest 声明段）同步。

## 三、测试证据（**全部在 0.1.5-rc.1 真实依赖下运行**）

| 测试 | 结果 |
|---|---|
| node --test test/entry.test.mjs（新增） | **13 组 ✓**（真入口加载 / manifest 声明 / engines 10 行判定表 + 反证 + 宿主 semver 交叉验证 / peer 区间 / apply 端到端四分支 / 键集合与 trigger 三处一致 / 依赖卫生） |
| node --test test/entry-smoke.mjs | **4/4 ✓**（apply 驱动 + pre-step 端到端 + postCompaction 代际 7 步） |
| node --test test/smoke.mjs | **11/11 ✓** |
| node test/client-smoke.mjs | **14/14 ✓**（bundle 加载 / locale 33 键 / slot 契约 / 渲染 / 保存链路 / 只读态 / trigger 三态 / 交互回归） |
| npm test | 全绿（三套按序） |

## 四、隔离实例真机 E2E（独立 `DSH_HOME=<probe-home>`，独立端口 `<probe-port>`，**绝不碰已部署实例**）

隔离 home 只放**已部署实例 `.credentials.yaml` / `settings.yaml` 的副本**（0600；副本内 `agent-presets.default` 改为 standard，因为 minimal preset 不含压实）；全程复核已部署实例的 settings 文件 mtime 未变、其端口正常。

| 项 | 结果 |
|---|---|
| DSH_HOME=… dsh plugin --profile headless add <仓库路径> | ✅ 一步装好（走 dsh.bundle.patch） |
| 组合树挂载 | ✅ --dump-config 末层出现 `# == dsh-prompt-injector` → - id: prompt-injector / name: dsh-prompt-injector |
| headless 真机注入 | ✅ dsh --profile headless '计算 3*7，只回复数字' → 21；会话日志 seq 10 = 插件 user 消息，source={kind:'plugin', plugin:'dsh-prompt-injector', form:'notice', summary:'Pre-check: Graph/Wiki'} |
| web 实例起服 | ✅ DSH_HOME=… dsh --profile web --port `<probe-port>` --no-open |
| 设置命名空间注册 | ✅ settings/describe 含 prompt-injector，resolved 值即用户真实配置（两条：graph-wiki=everyTurn、压缩后=postCompaction） |
| 前端下发 | ✅ __DSH_BOOT__.entries 含 {"id":"dsh-prompt-injector","url":"/plugins/??dsh-prompt-injector/client.js&rev=…-44"}；combo URL HTTP **200**、28 037 字节、含工厂 id 与 PromptInjectorCard / PInj_card |
| **每轮注入真机链路** | ✅ turn 1/3/6 各注入一条 summary='Pre-check: Graph/Wiki' |
| **压缩后注入（postCompaction）** | ✅ /compact（走 commands/execute，真机返回 Compacted 5 history items (~656 tokens)）→ compaction/start(seq26) / compaction/summary(seq27) / compaction/end(seq29) → **下一实义轮（turn 2, seq38）注入一次** summary='Pre-check: Context Compressed'（正文 = 用户提示词文本，source.form='notice'） |
| **同代不重复** | ✅ turn 3（seq52）只注入 everyTurn 行 |
| **新代再注入 + 琐碎轮不拦** | ✅ 第二次 /compact（seq72）→ turn 5 输入「嗯」（琐碎）：everyTurn 被 skipTrivial 正确拦下、postCompaction 照常放行（seq82）；turn 6 只剩 everyTurn |
| **失败/空路径不注入** | ✅ 空会话 /compact → 「No compactable history yet.」，**无 compaction/summary 事件 ⇒ 零注入** = 正确语义（勿当 bug） |
| 已部署实例零影响核实 | ✅ 其 `$DSH_HOME/settings.yaml` mtime 全程未变；其 profile 的 bundles 未被改动；其服务端口全程正常 |

### 探针保真度记录（防假证据）

- **RPC 参数必须按 typert 描述符逐参数命名**：session/create 与 session/prompt 的参数是 request（不是字段平铺），commands/execute 是 agentId + line + submittedAttachments（缺一即 gateway/arguments-invalid）。首轮平铺字段报错是**探针写错**，不是插件缺陷。
- **首页 token 换 cookie 需跟随 303**：首跳 303 → 带 cookie jar 重放才 200。
- **后台实例必须 setsid + 重定向 stdin**：nohup … & 会随发起 shell 退出被回收（表现为端口立刻消失）。
- **DSH_HOME 必须显式前缀**：漏写会让 dsh 去读默认 home（而非隔离 home），若默认 home 属主不可写则报 `EACCES … profiles/web/cordis.yml`（看似插件问题，实为环境变量漏传）。
- **`pkill -f "port <probe-port>"` 会自杀**（匹配到发起命令自身 cmdline）→ 改用 `ps -eo pid,args | grep '[p]ort <probe-port>'` 精确取 PID。

## 五、停止线判定

| 轮次 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Round 6（本轮） | 0 | 1 项修复（P1-1 缺真入口/键集合守护） | 1 项修复（P2-1 engines 区间不覆盖目标版本；peer 同款一并修） | 0 |

两项发现均配回归 + **反向验证**（改回旧值/反转方向立即变红、恢复即绿），修复后全量复跑绿 + 隔离实例真机 E2E 通过。

**已知可接受缺口（诚实记录）**：
- 设置卡在隔离实例中未逐控件点击验证（本轮验证到「命名空间注册 + client bundle 下发 + 卡片工厂在列」；交互层回归仍由 client-smoke.mjs 的 14 项本地断言承担）。
- 已部署实例本轮**未挂载本插件**（其 profile bundles 在本轮升级宿主时被裁剪，只剩 `node_modules` 悬空 symlink；`settings.yaml` 里的 `prompt-injector:` 段仍在，属孤儿配置、不生效）。适配验收全程在隔离实例完成，**未擅自改动已部署实例**；重新挂载仍是标准的 `dsh plugin add` + 重启。
