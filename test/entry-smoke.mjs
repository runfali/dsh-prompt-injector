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
 * 依赖 @deepseek-ai/dsh-settings / @deepseek-ai/schemastery：
 * 运行前确保依赖可用（npm/pnpm install，或 node_modules 存在）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('host entry 可加载（schemastery default import 契约）', async () => {
  const mod = await import('../src/index.js')
  assert.equal(typeof mod.apply, 'function', 'apply 导出')
  assert.deepEqual(mod.inject, ['agents'], 'inject 声明')
  assert.equal(typeof mod.PROMPT_INJECTOR_NAMESPACE, 'string', 'namespace 导出')
})

test('apply 可用最小 stub 上下文驱动（注入钩子注册不炸）', async () => {
  const mod = await import('../src/index.js')
  const listeners = []
  // installSettingsSection 内部会 ctx.inject(['settings'], cb)——stub 直接执行
  // 回调（模拟 settings 服务就绪），回调收到带 settings 注册能力的子 ctx。
  const makeSettingsScope = () => ({
    register() { return { get: () => ({ enabled: true, skipTrivial: true }), watch: () => {} } }
  })
  const ctx = {
    logger: { debug: () => {} },
    effect(fn) { return fn() },
    on(evt, fn) { listeners.push([evt, fn]); return () => {} },
    get(name) { return name === 'agents' ? undefined : undefined },
    inject(services, cb) {
      const sctx = {
        settings: makeSettingsScope(),
        effect: (fn) => fn(),
        on: (evt, fn) => { listeners.push([evt, fn]); return () => {} }
      }
      return cb(sctx)
    }
  }
  mod.apply(ctx, { enabled: true, skipTrivial: true })
  assert.ok(listeners.some(([e]) => e === 'agent/created'), '应注册 agent/created 监听')
})

test('pre-step 端到端注入：freshUser 轮追加一条 notice；工具步/琐碎轮不注入', async () => {
  const mod = await import('../src/index.js')
  // 收集 agent 级 pre-step handler
  const agentListeners = new Map()
  const makeAgentCtx = () => ({
    on(evt, fn) { agentListeners.set(evt, fn); return () => {} }
  })
  const agent = { id: 'session-test', ctx: makeAgentCtx() }
  const ctx = {
    logger: { debug: () => {} },
    effect(fn) { return fn() },
    on(evt, fn) { if (evt === 'agent/created') fn({ agent }); return () => {} },
    get(name) { return name === 'agents' ? undefined : undefined },
    inject(services, cb) {
      const sctx = {
        settings: {
          register() { return { get: () => ({ enabled: true, skipTrivial: true, prompts: [{ id: 'a', title: '提醒A', text: '正文A', enabled: true }, { id: 'b', title: '提醒B', text: '', enabled: true }] }), watch: () => {} } }
        },
        effect: (fn) => fn(),
        on: (evt, fn) => { if (evt === 'agent/created') fn({ agent }); return () => {} }
      }
      return cb(sctx)
    }
  }
  mod.apply(ctx, { enabled: true, skipTrivial: true })
  const preStep = agentListeners.get('agent/pre-step')
  assert.equal(typeof preStep, 'function', 'agent 上应挂 pre-step handler')

  const run = async (payload) => preStep(payload, async () => ({ kind: 'enter', messages: [{ id: 'm0' }] }))
  // 1. freshUser + 实义 → 注入 1 条（提醒B 无正文被过滤）
  const out1 = await run({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '帮我改代码' }] }] })
  assert.equal(out1.messages.length, 2, '注入 1 条 notice')
  assert.equal(out1.messages[1].source.form, 'notice')
  assert.equal(out1.messages[1].source.summary, '提醒A')
  // 2. 工具回执步 → 不注入
  const out2 = await run({ messages: [{ source: { kind: 'tool' }, content: [{ type: 'text', text: '回执' }] }] })
  assert.equal(out2.messages.length, 1)
  // 3. 琐碎轮 → 不注入
  const out3 = await run({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '好的' }] }] })
  assert.equal(out3.messages.length, 1)
})

test('postCompaction 端到端：代际推进→注入一次→同代不重复→新代再注入→dispose 清零', async () => {
  const mod = await import('../src/index.js')
  const agentListeners = new Map()
  const rootListeners = new Map()
  const agent = { id: 'session-c', ctx: { on(evt, fn) { agentListeners.set(evt, fn); return () => {} } } }
  const sessionObj = { id: 'session-c' }
  const makeSctx = () => ({
    settings: {
      register() {
        return {
          get: () => ({
            enabled: true, skipTrivial: true,
            prompts: [
              { id: 'a', title: '提醒A', text: '正文A', enabled: true },
              { id: 'p', title: '压缩后', text: '正文P', enabled: true, trigger: 'postCompaction' }
            ]
          }),
          watch: () => {}
        }
      }
    },
    effect: (fn) => fn(),
    on: (evt, fn) => { rootListeners.set(evt, fn); if (evt === 'agent/created') fn({ agent }); return () => {} }
  })
  const ctx = {
    logger: { debug: () => {} },
    effect(fn) { return fn() },
    on(evt, fn) { rootListeners.set(evt, fn); if (evt === 'agent/created') fn({ agent }); return () => {} },
    get() { return undefined },
    inject(services, cb) { return cb(makeSctx()) }
  }
  mod.apply(ctx, { enabled: true, skipTrivial: true })
  const preStep = agentListeners.get('agent/pre-step')
  const onEvent = rootListeners.get('session/event')
  const onDisposed = rootListeners.get('session/disposed')
  assert.equal(typeof onEvent, 'function', '应挂 session/event 监听')
  assert.equal(typeof onDisposed, 'function', '应挂 session/disposed 监听')
  const run = (text) => preStep({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text }] }] }, async () => ({ kind: 'enter', messages: [{ id: 'm0' }] }))
  const compact = () => onEvent(sessionObj, { type: 'compaction/summary', seq: 100, time: Date.now(), data: { compactionId: 'cid-1', shadowedSeqs: [1, 2], shadowedRange: { start: 1, end: 2 }, shadowedTokenCount: 999 } })
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
  const before = summaries(await run('普通轮')) // 已应用 gen3 → 只剩 everyTurn
  assert.deepEqual(before, ['提醒A'])
  onEvent(sessionObj, { type: 'user/message', seq: 101, data: { id: 'x' } })
  onEvent(sessionObj, { type: 'compaction/end', seq: 102, data: { compactionId: 'cid-1' } })
  assert.deepEqual(summaries(await run('end 事件后')), ['提醒A'], '非 summary 事件不触发注入')
  // 7. dispose 清零：代际与已应用记录重置
  onDisposed(sessionObj)
  compact()
  assert.deepEqual(summaries(await run('dispose 后')), ['提醒A', '压缩后'], 'dispose 后重新计数并注入')
})
