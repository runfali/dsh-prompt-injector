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
  assert.equal(out1.messages[1].source.summary, '上下文注入 提醒A')
  // 2. 工具回执步 → 不注入
  const out2 = await run({ messages: [{ source: { kind: 'tool' }, content: [{ type: 'text', text: '回执' }] }] })
  assert.equal(out2.messages.length, 1)
  // 3. 琐碎轮 → 不注入
  const out3 = await run({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '好的' }] }] })
  assert.equal(out3.messages.length, 1)
})