/**
 * dsh-prompt-injector host entry 加载冒烟测试。
 *
 * 背景（2026-08-26 第二轮审计 P0）：src/index.js 曾写 `import { z }`——
 * schemastery 只有 default export，ESM 静态分析期直接抛
 * "does not provide an export named 'z'"，整个 host 模块无法加载，
 * 插件装上也不生效；而 node --check 只查语法、smoke.mjs 只 import
 * logic.js（零依赖），两类测试都抓不到。本测试直接 import index.js，
 * 任何导入/顶层求值错误都会在此炸出。
 *
 * 0.1.7 契约（本文件 2026-09-25 修正）：
 * - `settings.installSection` / `settingsNamespace` 已从 dsh-settings 移除；
 *   插件改经 `ctx.inject(['settings'])` 调 `settings.configure({auto:false}, fiber)`
 *   关闭宿主自动默认页。旧 stub 还按 installSection 模拟，导致本文件长期
 *   红着——且因为当时没被 npm test 收进脚本，腐烂无人发现（已一并收编）。
 * - 配置值不再经 settings section 读回：apply 直接收到 config 对象，可热编辑
 *   字段是 volatile 活引用 `{get()}`。故注入内容一律由 apply 第二参给出。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** 0.1.7 真实语义的设置桩：只有 configure(presentation, owner)。 */
function makeSettingsStub(seen) {
  return {
    configure(presentation, owner) {
      seen.configure += 1
      seen.autoPolicy = presentation && presentation.auto
      return () => {}
    }
  }
}

/** 最小 ctx 桩：真入口 apply 能跑起来并挂上监听。 */
function makeCtx() {
  const seen = { listeners: new Map(), agentListeners: new Map(), configure: 0, autoPolicy: undefined, injects: [] }
  const ctx = {
    logger: { debug: () => {}, info: () => {}, warn: () => {} },
    fiber: { id: 'test-fiber' },
    effect: (fn) => { fn(); return () => {} },
    on: (evt, fn) => { seen.listeners.set(evt, fn); return () => {} },
    get: () => undefined,
    inject: (services, cb) => {
      seen.injects.push(services)
      cb({ settings: makeSettingsStub(seen), effect: ctx.effect, on: ctx.on, fiber: ctx.fiber })
      return () => {}
    }
  }
  return { ctx, seen }
}

/** 建一个挂在 ctx 上的假 agent，返回它的 agent 级 pre-step handler。 */
function attachAgent(ctx, seen, id) {
  const agent = {
    id,
    ctx: { on: (evt, fn) => { seen.agentListeners.set(evt, fn); return () => {} } }
  }
  const created = seen.listeners.get('agent/created')
  assert.equal(typeof created, 'function', 'apply 应注册 agent/created 监听')
  created({ agent })
  return seen.agentListeners.get('agent/pre-step')
}

/** 用 volatile 活引用包一层（0.1.7 热编辑字段的真实形状）。 */
const volatileOf = (v) => ({ get: () => v })

const enterDecision = async () => ({ kind: 'enter', messages: [{ id: 'm0' }] })
const userTurn = (text) => ({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }] })

test('host entry 可加载（schemastery default import 契约）', async () => {
  const mod = await import('../src/index.js')
  assert.equal(typeof mod.apply, 'function', 'apply 导出')
  assert.deepEqual(mod.inject, ['agents'], 'inject 声明')
  assert.equal(typeof mod.PROMPT_INJECTOR_NAMESPACE, 'string', 'namespace 导出')
})

test('apply 可用最小 stub 上下文驱动（注入钩子注册不炸 + configure({auto:false})）', async () => {
  const mod = await import('../src/index.js')
  const { ctx, seen } = makeCtx()
  mod.apply(ctx, { enabled: true, skipTrivial: true })

  assert.equal(seen.configure, 1, 'apply 必须调 settings.configure 一次（0.1.7 展示策略）')
  assert.equal(seen.autoPolicy, false, '必须注册 {auto:false}（关闭宿主自动默认页）')
  assert.deepEqual(seen.injects, [['settings']], 'apply 内必须等待式注入 settings 服务')

  const preStep = attachAgent(ctx, seen, 'session-1')
  assert.equal(typeof preStep, 'function', 'agent 上应挂 pre-step handler')
})

test('pre-step 端到端注入：freshUser 轮追加一条 notice；工具步/琐碎轮不注入', async () => {
  const mod = await import('../src/index.js')
  const { ctx, seen } = makeCtx()
  // 提醒B 正文为空 → 不注入（host 侧过滤空正文行）
  mod.apply(ctx, {
    enabled: true,
    skipTrivial: true,
    prompts: [
      { id: 'a', title: '提醒A', text: '正文A', enabled: true },
      { id: 'b', title: '提醒B', text: '', enabled: true }
    ]
  })
  const preStep = attachAgent(ctx, seen, 'session-2')

  const run = (payload) => preStep(payload, enterDecision)

  // 1. freshUser + 实义 → 注入 1 条（提醒B 无正文被过滤）
  const out1 = await run(userTurn('帮我改代码'))
  assert.equal(out1.messages.length, 2, '注入 1 条 notice')
  assert.equal(out1.messages[1].source.form, 'notice')
  assert.equal(out1.messages[1].source.summary, '提醒A')
  // 2. 工具回执步 → 不注入
  const out2 = await run({ messages: [{ source: { kind: 'tool' }, content: [{ type: 'text', text: '回执' }] }] })
  assert.equal(out2.messages.length, 1)
  // 3. 琐碎轮 → 不注入
  const out3 = await run(userTurn('好的'))
  assert.equal(out3.messages.length, 1)
})

test('postCompaction 端到端：代际推进→注入一次→同代不重复→新代再注入→dispose 清零', async () => {
  const mod = await import('../src/index.js')
  const { ctx, seen } = makeCtx()
  // 0.1.7：可热编辑字段是 volatile 活引用——同时验证 apply 侧解引用
  mod.apply(ctx, {
    enabled: volatileOf(true),
    skipTrivial: volatileOf(true),
    prompts: volatileOf([
      { id: 'a', title: '提醒A', text: '正文A', enabled: true },
      { id: 'p', title: '压缩后', text: '正文P', enabled: true, trigger: 'postCompaction' }
    ])
  })
  const preStep = attachAgent(ctx, seen, 'session-c')
  const onEvent = seen.listeners.get('session/event')
  const onDisposed = seen.listeners.get('session/disposed')
  assert.equal(typeof onEvent, 'function', '应挂 session/event 监听')
  assert.equal(typeof onDisposed, 'function', '应挂 session/disposed 监听')

  const sessionObj = { id: 'session-c' }
  const run = (text) => preStep(userTurn(text), enterDecision)
  const compact = () => onEvent(sessionObj, {
    type: 'compaction/summary', seq: 100, time: Date.now(),
    data: { compactionId: 'cid-1', shadowedSeqs: [1, 2], shadowedRange: { start: 1, end: 2 }, shadowedTokenCount: 999 }
  })
  const summaries = (out) => out.messages.slice(1).map((m) => m.source.summary)

  // 1. 未压缩过（gen 0）：只注入 everyTurn 行
  assert.deepEqual(summaries(await run('帮我改代码')), ['提醒A'], 'gen0 不注入 postCompaction')
  // 2. 压缩一次 → 下一实义轮注入两条
  compact()
  assert.deepEqual(summaries(await run('继续改')), ['提醒A', '压缩后'], '代际推进后注入一次')
  // 3. 同代不再注入
  assert.deepEqual(summaries(await run('再改一点')), ['提醒A'], '同代不重复')
  // 4. 新代再注入
  compact()
  assert.deepEqual(summaries(await run('第三轮')), ['提醒A', '压缩后'], '新代再注入')
  // 5. 琐碎轮：everyTurn 被拦、postCompaction 放行（一次性系统告知）
  compact()
  assert.deepEqual(summaries(await run('好的')), ['压缩后'], '琐碎轮仅 postCompaction 放行')
  // 6. 非 summary 事件不计数
  assert.deepEqual(summaries(await run('普通轮')), ['提醒A'])
  onEvent(sessionObj, { type: 'user/message', seq: 101, data: { id: 'x' } })
  onEvent(sessionObj, { type: 'compaction/end', seq: 102, data: { compactionId: 'cid-1' } })
  assert.deepEqual(summaries(await run('end 事件后')), ['提醒A'], '非 summary 事件不触发注入')
  // 7. dispose 清零：代际与已应用记录重置
  onDisposed(sessionObj)
  compact()
  assert.deepEqual(summaries(await run('dispose 后')), ['提醒A', '压缩后'], 'dispose 后重新计数并注入')
})