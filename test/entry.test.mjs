/**
 * dsh-prompt-injector 宿主入口契约测试（entry 测试）。
 *
 * 目的（dsh-plugin-audit「测试盲区」纪律）：node --check 只查语法、smoke.mjs
 * 只驱动零依赖 logic.js、client-smoke.mjs 只测浏览器半——三路都绕开宿主入口的
 * 真实加载路径。本文件直接 import('../src/index.js')，任何导入名错误 / 顶层求值
 * 异常 / 导出形状漂移都会在真实加载期当场炸出（本仓 P0 先例：
 * `import { z } from '@deepseek-ai/schemastery'` 而 schemastery 只有 default
 * export，整包无法加载、插件装而不生效，而当时全部测试全绿）。
 *
 * 另守护三项声明契约：
 * - 宿主注入面：inject 必须只命名真实存在的服务（写错服务名插件会永远 pending）；
 * - dsh.engines.dsh 区间必须覆盖声明适配的目标版本（npm semver 预发布规则：
 *   预发布只被「区间内含同 [major,minor,patch] 元组预发布」的区间满足，
 *   单区间 >=0.1.2-alpha.3 <0.2.0 不覆盖 0.1.5-rc.1）；
 * - 设置卡文案与 host schema 默认值一致（设置页是用户判断行为的唯一界面）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const PASS = []
const ok = (label) => { PASS.push(label); console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// ---------------------------------------------------------------------------
// 1. 真实入口加载（P0 守卫）
// ---------------------------------------------------------------------------
const mod = await import('../src/index.js')
assert.equal(typeof mod.apply, 'function', 'src/index.js 必须导出 apply 函数')
assert.equal(typeof mod.PROMPT_INJECTOR_NAMESPACE, 'string', 'src/index.js 必须导出设置命名空间常量')
assert.equal(mod.PROMPT_INJECTOR_NAMESPACE, 'prompt-injector', '设置命名空间必须是 prompt-injector（小写连字符标识符，dsh-settings NAMESPACE_PATTERN 校验）')
assert.ok(Array.isArray(mod.inject), 'inject 必须是数组')
for (const svc of mod.inject) assert.equal(typeof svc, 'string', 'inject 项必须是字符串')
assert.deepEqual([...mod.inject].sort(), ['agents'], 'inject 面必须恰为 agents（settings 经 apply 内 ctx.inject 等待式注入，不写进顶层声明）')
ok('宿主入口真实 import 成功（apply / 命名空间 / inject 面齐备）')

// ---------------------------------------------------------------------------
// 2. 设置命名空间 schema：可交叉验证的默认值表
// ---------------------------------------------------------------------------
// 本插件未导出 Config，从宿主真实 schemastery 副本重建同名 schema 只能验证库行为，
// 无法验证本仓 schema —— 故改为「配置文件契约 + apply 端到端默认值」双重证据：
// 见第 3 节（stub 里以 undefined config 驱动，断言默认语义）与第 4 节（文案漂移）。
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assert.equal(typeof pkg.version, 'string', 'package.json 缺 version')
assert.equal(pkg.version, '0.1.7-rc.1', '版本号必须跟宿主发布号（家族惯例）')
assert.equal(pkg.type, 'module', '必须是 ESM 包')
assert.equal(pkg.exports['.'], './src/index.js', 'exports["."] 必须指向宿主入口')
assert.equal(pkg.exports['./client'], './lib/client.js', 'exports["./client"] 必须指向 client bundle')
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml', 'dsh.bundle.patch 必须声明（装上≠挂载：无声明不进组合树）')
assert.equal(pkg.dsh.client.platform, 'web', 'dsh.client.platform 必须是 web')
ok('package.json 入口/导出/挂载声明齐备，版本号 0.1.7-rc.1')

// ---------------------------------------------------------------------------
// 3. dsh.engines.dsh 区间守护（内置判定表，不引 semver 依赖，防测试随依赖漂移）
// ---------------------------------------------------------------------------
const range = pkg.dsh && pkg.dsh.engines && pkg.dsh.engines.dsh
assert.equal(typeof range, 'string', 'package.json 缺 dsh.engines.dsh 声明')
ok('package.json 声明了 dsh.engines.dsh：' + range)

/** 手写 semver 比较器：只处理本仓区间用到的形状（不引依赖，防测试自身依赖漂移）。 */
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim())
  if (!m) throw new Error('unparseable version: ' + v)
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}
function cmpPre(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1
      continue
    }
    if (nx !== ny) return nx ? -1 : 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] < b.nums[i] ? -1 : 1
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  return cmpPre(a.pre, b.pre)
}
/** npm semver 预发布可见性规则：预发布版本只被「区间内含同 [M,m,p] 元组预发布」的区间满足。 */
function preReleaseVisible(version, comparators) {
  if (version.pre.length === 0) return true
  return comparators.some((c) => {
    const mv = parseVersion(c.version)
    return mv.nums[0] === version.nums[0] && mv.nums[1] === version.nums[1] && mv.nums[2] === version.nums[2] && mv.pre.length > 0
  })
}
function satisfies(version, rng) {
  const v = parseVersion(version)
  for (const group of String(rng).split('||')) {
    const parts = group.trim().split(/\s+/).filter(Boolean)
    const comparators = []
    let groupOk = true
    for (const part of parts) {
      const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(part)
      const op = m[1] || '='
      comparators.push({ op, version: m[2] })
      const c = compare(v, parseVersion(m[2]))
      if (op === '>=' && c < 0) groupOk = false
      else if (op === '<=' && c > 0) groupOk = false
      else if (op === '>' && c <= 0) groupOk = false
      else if (op === '<' && c >= 0) groupOk = false
      else if (op === '=' && c !== 0) groupOk = false
    }
    if (groupOk && preReleaseVisible(v, comparators)) return true
  }
  return false
}

const TABLE = [
  ['0.1.2-alpha.3', true],
  ['0.1.2-rc.1', true],
  ['0.1.5-alpha.1', true],
  ['0.1.5-alpha.2', true],
  ['0.1.5-rc.1', true],
  ['0.1.5', true],
  ['0.1.6', true],
  ['0.1.7-rc.1', true],
  ['0.1.7', true],
  ['0.1.3-alpha.1', false],
  ['0.1.8', false],
  ['0.1.8-rc.1', false],
  ['0.2.0', false],
  ['0.0.1', false]
]
for (const [version, expected] of TABLE) {
  assert.equal(satisfies(version, range), expected, 'engines 区间对 ' + version + ' 的判定应为 ' + expected + '（区间=' + range + '）')
}
ok('engines 判定表 ' + TABLE.length + ' 行逐行通过（含 0.1.5-rc.1 / 0.1.7-rc.1 覆盖，0.1.8 排除）')

// 反证：旧单区间不覆盖 0.1.5-rc.1 —— 这正是本次必须加析取的原因
assert.equal(satisfies('0.1.5-rc.1', '>=0.1.2-alpha.3 <0.2.0'), false, '旧单区间本不应覆盖 0.1.5-rc.1，判定器写反了')
ok('反证：旧单区间不覆盖 0.1.5-rc.1（故必须加析取，非冗余声明）')

// 交叉验证：同一判定表与宿主真实 semver 逐行一致（宿主不可解析则显式跳过，不假绿）
const req = createRequire(import.meta.url)
let semver = null
for (const candidate of ['/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/semver', 'semver']) {
  try { semver = req(candidate); break } catch { /* next */ }
}
if (semver && typeof semver.satisfies === 'function') {
  for (const [version, expected] of TABLE) {
    assert.equal(semver.satisfies(version, range), expected, '宿主 semver 对 ' + version + ' 的判定与内置判定表不一致')
  }
  ok('内置判定器与宿主真实 semver.satisfies 逐行一致（' + TABLE.length + ' 行）')
} else {
  ok('宿主 semver 不可解析，跳过交叉验证（不假绿）')
}

// 依赖声明区间必须同样覆盖目标版本（peerDependencies 与 dsh.engines.dsh 同款陷阱）
const peerSettings = pkg.peerDependencies['@deepseek-ai/dsh-settings']
assert.equal(typeof peerSettings, 'string', 'peerDependencies 缺 @deepseek-ai/dsh-settings')
assert.equal(satisfies('0.1.5-rc.1', peerSettings), true, 'peerDependencies 的 dsh-settings 区间不覆盖 0.1.5-rc.1：' + peerSettings)
assert.equal(satisfies('0.1.7-rc.1', peerSettings), true, 'peerDependencies 的 dsh-settings 区间不覆盖 0.1.7-rc.1：' + peerSettings)
// 0.1.7 起 @deepseek-ai/dsh peer 是安装/启动兼容闸的判定对象，必须声明且覆盖 0.1.7-rc.1
const peerDsh = pkg.peerDependencies['@deepseek-ai/dsh']
assert.equal(typeof peerDsh, 'string', 'peerDependencies 缺 @deepseek-ai/dsh（0.1.7 兼容闸必读）')
assert.equal(satisfies('0.1.7-rc.1', peerDsh), true, 'peerDependencies 的 dsh 区间不覆盖 0.1.7-rc.1：' + peerDsh)
ok('peerDependencies 区间覆盖 0.1.5-rc.1 与 0.1.7-rc.1（dsh + dsh-settings 双 peer）')

// ---------------------------------------------------------------------------
// 4. apply 端到端：真入口 + 最小桩，断言默认语义（未配置 = 不注入任何提示词）
// ---------------------------------------------------------------------------
function makeCtx() {
  const seen = { listeners: new Map(), injects: [], configure: 0, autoPolicy: undefined }
  // 0.1.7-rc.1 真实语义（dsh-settings SettingsForms.configure 源码级对照）：
  // 宿主不再有 installSection；插件经 ctx.inject(['settings']) 调
  // settings.configure({auto:false}, ownerFiber) 关闭自动默认页。
  const settingsStub = {
    configure(presentation, owner) {
      seen.configure += 1
      seen.autoPolicy = presentation && presentation.auto
      return () => {}
    }
  }
  const ctx = {
    logger: { debug: () => {}, info: () => {}, warn: () => {} },
    fiber: { id: 'test-fiber' },
    effect: (fn) => { fn(); return () => {} },
    on: (evt, fn) => { seen.listeners.set(evt, fn); return () => {} },
    inject: (services, cb) => { seen.injects.push(services); cb({ settings: settingsStub, effect: ctx.effect, on: ctx.on, fiber: ctx.fiber }); return () => {} }
  }
  return { ctx, seen }
}

// 4a. 未配置（config 空对象）→ 默认 enabled/skipTrivial=true，prompts 空 = 零注入
{
  const { ctx, seen } = makeCtx()
  mod.apply(ctx, {})
  assert.equal(seen.configure, 1, 'apply 必须经 ctx.inject(["settings"]) 调 settings.configure 一次')
  assert.equal(seen.autoPolicy, false, '必须注册 {auto:false}（关闭宿主自动默认页，卡片由 client 半提供）')
  assert.deepEqual(seen.injects, [['settings']], 'apply 内必须等待式注入 settings 服务')
  const agent = { id: 'session-1', ctx: { on: (evt, fn) => { seen.listeners.set('agent:' + evt, fn); return () => {} } } }
  seen.listeners.get('agent/created')({ agent })
  const preStep = seen.listeners.get('agent:agent/pre-step')
  assert.equal(typeof preStep, 'function', 'agent 上应挂 pre-step handler')
  const out = await preStep({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改代码' }] }] }, async () => ({ kind: 'enter', messages: [{ id: 'm0' }] }))
  assert.equal(out.messages.length, 1, '默认空提示词列表 ⇒ 不注入任何提醒（开源默认：只留机制）')
  ok('apply 端到端：默认空列表 = 零注入（未配置不产生噪音）')
}

// 4b. 显式空数组 → 保持空（删光即停注，不偷偷回退默认）
{
  const { ctx, seen } = makeCtx()
  mod.apply(ctx, { enabled: true, skipTrivial: true, prompts: [] })
  const agent = { id: 'session-2', ctx: { on: (evt, fn) => { seen.listeners.set('agent:' + evt, fn); return () => {} } } }
  seen.listeners.get('agent/created')({ agent })
  const preStep = seen.listeners.get('agent:agent/pre-step')
  const out = await preStep({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改代码' }] }] }, async () => ({ kind: 'enter', messages: [{ id: 'm0' }] }))
  assert.equal(out.messages.length, 1, '显式空数组必须保持空（P1 历史缺陷回归）')
  ok('apply 端到端：显式空数组保持为空（删光不回落默认）')
}

// 4c. 配置条目 → 注入 notice 行（summary 只放标题，不带 UI 前缀）
// 0.1.7：volatile 字段经 apply 收到 {get()} 活引用——同时验证解引用兼容。
{
  const { ctx, seen } = makeCtx()
  const volatileOf = (v) => ({ get: () => v })
  mod.apply(ctx, { enabled: volatileOf(true), skipTrivial: volatileOf(true), prompts: volatileOf([{ id: 'a', title: 'Pre-check', text: 'body', enabled: true }]) })
  const agent = { id: 'session-3', ctx: { on: (evt, fn) => { seen.listeners.set('agent:' + evt, fn); return () => {} } } }
  seen.listeners.get('agent/created')({ agent })
  const preStep = seen.listeners.get('agent:agent/pre-step')
  const out = await preStep({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改代码' }] }] }, async () => ({ kind: 'enter', messages: [{ id: 'm0' }] }))
  assert.equal(out.messages.length, 2, '应注入一条 notice 行')
  const notice = out.messages[1]
  assert.equal(notice.role, 'user', 'notice 必须是 user 角色消息')
  assert.equal(notice.source.kind, 'plugin', 'source.kind 必须是 plugin')
  assert.equal(notice.source.plugin, 'dsh-prompt-injector', 'source.plugin 必须是包名（UI 渲染插件名段）')
  assert.equal(notice.source.form, 'notice', "source.form 必须是 'notice'（漏了就失去折叠注入行形态）")
  assert.equal(notice.source.summary, 'Pre-check', 'summary 只放标题，前缀由 UI 自动拼')
  ok('apply 端到端：注入形态 = user / kind:plugin / form:notice / summary=标题')
}

// 4d. 注入链路健壮性：下游抛错不重放（next 只调一次）、决策缺 messages 直接回退
{
  const { ctx, seen } = makeCtx()
  mod.apply(ctx, { enabled: true, skipTrivial: true, prompts: [{ id: 'a', title: 'T', text: 'body', enabled: true }] })
  const agent = { id: 'session-4', ctx: { on: (evt, fn) => { seen.listeners.set('agent:' + evt, fn); return () => {} } } }
  seen.listeners.get('agent/created')({ agent })
  const preStep = seen.listeners.get('agent:agent/pre-step')
  let calls = 0
  const boom = new Error('downstream failed')
  await assert.rejects(
    () => preStep({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] }, async () => { calls += 1; throw boom }),
    /downstream failed/,
    '下游抛错必须向上传播'
  )
  assert.equal(calls, 1, '下游链节只能执行一次（重放会双副作用）')
  const passthrough = await preStep({ messages: [] }, async () => ({ kind: 'enter' }))
  assert.deepEqual(passthrough, { kind: 'enter' }, 'decision 无 messages 时必须原样回退')
  const rejected = await preStep({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }] }, async () => ({ kind: 'reject' }))
  assert.equal(rejected.kind, 'reject', 'kind 非 enter 时必须原样回退')
  ok('注入链路健壮性：next 单次调用 / 非 enter 决策原样回退')
}

// ---------------------------------------------------------------------------
// 5. 三处键集合一致性（host schema ↔ client FIELDS ↔ 实际生效语义）
//    依据 dsh-plugin-audit 的 P1 先例（mem0 Round 5）：设置卡键与 host 键集合不等
//    会导致「设置页调不到该开关」且完全静默 —— 三处必须逐键对齐。
// ---------------------------------------------------------------------------
{
  const hostSrc = readFileSync(join(root, 'src', 'index.js'), 'utf8')
  const clientSrc = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  const logicSrc = readFileSync(join(root, 'src', 'logic.js'), 'utf8')

  // host 侧 Config 的键（z.object 内顶层键）
  const configBlock = /const Config = z\.object\(\{([\s\S]*?)\n\}\)/.exec(hostSrc)
  assert.ok(configBlock, 'src/index.js 里找不到 Config schema（键集合守卫失效）')
  const hostKeys = [...configBlock[1].matchAll(/^\s{2}([A-Za-z_][\w]*):/gm)].map((m) => m[1]).sort()
  assert.deepEqual(hostKeys, ['enabled', 'prompts', 'skipTrivial'], 'host Config 键集合漂移')

  // client 侧 FIELDS 的键
  const fieldsBlock = /const FIELDS = \[([\s\S]*?)\n    \]/.exec(clientSrc)
  assert.ok(fieldsBlock, 'lib/client.js 里找不到 FIELDS（键集合守卫失效）')
  const clientKeys = [...fieldsBlock[1].matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]).sort()
  assert.deepEqual(clientKeys, hostKeys, 'client FIELDS 键集合必须与 host Config 键集合逐键相等（缺一键 = 设置页调不到该开关）')

  // PromptSchema 的键（提示词行级）
  const promptBlock = /const PromptSchema = z\.object\(\{([\s\S]*?)\n\}\)/.exec(hostSrc)
  assert.ok(promptBlock, 'src/index.js 里找不到 PromptSchema')
  const promptKeys = [...promptBlock[1].matchAll(/^\s{2}([A-Za-z_][\w]*):/gm)].map((m) => m[1]).sort()
  assert.deepEqual(promptKeys, ['enabled', 'id', 'text', 'title', 'trigger'], 'PromptSchema 键集合漂移')

  // trigger 枚举字面量三处一致（host 归一化 / 纯逻辑选择器 / 设置卡下拉）
  for (const [label, src] of [['src/index.js', hostSrc], ['src/logic.js', logicSrc], ['lib/client.js', clientSrc]]) {
    assert.ok(src.includes('postCompaction'), label + ' 缺 postCompaction 字面量（trigger 枚举漂移）')
    assert.ok(src.includes('everyTurn'), label + ' 缺 everyTurn 字面量（trigger 枚举漂移）')
  }
  // 三处归一化必须同一方向：非 postCompaction 一律回落 everyTurn
  assert.ok(/p\.trigger === 'postCompaction' \? 'postCompaction' : 'everyTurn'/.test(logicSrc), 'logic.js trigger 归一化方向漂移')
  assert.ok(/trigger:\s*p && p\.trigger === "postCompaction" \? "postCompaction" : "everyTurn"/.test(clientSrc), 'client trigger 归一化方向漂移（与 host 不一致会静默回落）')
  ok('三处键集合逐键相等（host Config ↔ client FIELDS ↔ PromptSchema）+ trigger 枚举三处一致')
}

// ---------------------------------------------------------------------------
// 6. 依赖卫生（家族硬要求：无安装脚本副作用 / 无原生编译）
// ---------------------------------------------------------------------------
{
  const scripts = pkg.scripts || {}
  for (const key of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublishOnly']) {
    assert.equal(scripts[key], undefined, '包内不得声明安装类脚本副作用：' + key)
  }
  assert.equal(pkg.dependencies, undefined, '本插件零运行时 dependencies（只声明 peerDependencies）')
  assert.equal(pkg.optionalDependencies, undefined, '不得声明 optionalDependencies')
  ok('依赖卫生：无安装脚本、无 runtime dependencies（peer-only）')
}

console.log('\n全部通过: ' + PASS.length + ' 组、断言 ' + TABLE.length + ' 行判定表交叉验证')