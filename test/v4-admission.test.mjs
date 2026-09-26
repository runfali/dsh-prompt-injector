/**
 * V4 source-admission 回归守护（本仓 P0 先例：0.1.7-rc.1 真机「本轮运行失败」）。
 *
 * 事故：0.1.7 会话格式升级 V4 后，`kind:'plugin'` + `plugin:'<名字>'` 这组 V3 旧包装
 * 被 V4 原生准入直接拒绝。注入消息每轮都带这个 source，于是真机上
 * 「加提示词 → 开启会话 → 本轮运行失败 format v4 message requires a producer-owned
 * source kind」。当时 smoke.mjs / entry.test.mjs 都断言 kind==='plugin'，把错误契约
 * 反向固化了——测试全绿，真机必炸。
 *
 * 本文件的作用：用 dsh 自己发布的 V4 准入函数（而不是我们手写的规则副本）校验
 * makePromptMessage 产出的 source 真能被接受，并附反向对照证明旧形态确实会被拒
 * （否则这个守护本身可能是空转的）。
 *
 * 准入函数来源：dsh-session-format-v3-to-v4 的 assertV4RowAdmission ——
 * dsh-session-persistence-jsonl 的 encodeEvent（写盘路径）内部调用的就是它。
 * 该包是 dsh 的传递依赖，会出现在本仓 node_modules（pnpm store 提升）里；
 * 装不上时默认失败（静默跳过正是这次事故的成因），仅在显式设置
 * DSH_PI_ALLOW_MISSING_V4_CODEC=1 时才降级为跳过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PROMPT_INJECTOR_SOURCE_KIND, makePromptMessage } from '../src/logic.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)

/** 尽力定位 dsh 发布的 V4 格式包；找不到返回 undefined。
 * 返回 { assertV4RowAdmission, codec, assertReleasedV4Relationships }。 */
async function loadV4Codec() {
  const candidates = []
  const entry = '@deepseek-ai/dsh-session-format-v3-to-v4'

  // 1) 常规解析（包 exports 收紧时可能失败，故只作为第一顺位尝试）
  try { candidates.push(require.resolve(entry + '/package.json')) } catch { /* exports 受限 */ }

  // 2) 从本仓 @deepseek-ai/dsh 的真实位置向各级 node_modules 探
  try {
    const dshPkg = require.resolve('@deepseek-ai/dsh/package.json')
    let dir = dirname(dshPkg)
    for (let i = 0; i < 6; i += 1) {
      candidates.push(join(dir, 'node_modules', entry, 'package.json'))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* dsh 未装 */ }

  // 3) pnpm store 的提升目录（本仓实际布局）
  candidates.push(join(root, 'node_modules', '.pnpm', 'node_modules', entry, 'package.json'))
  candidates.push(join(root, 'node_modules', '.pnpm', 'node_modules', '@deepseek-ai', 'dsh-session-format-v3-to-v4', 'lib', 'index.js'))

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const pkgDir = candidate.endsWith('package.json') ? dirname(candidate) : dirname(dirname(candidate))
    for (const rel of ['lib/index.js', 'lib/index.cjs', 'dist/index.js']) {
      const file = join(pkgDir, rel)
      if (!existsSync(file)) continue
      try {
        const mod = await import(pathToFileURL(file).href)
        if (typeof mod.assertV4RowAdmission === 'function') {
          return {
            assertV4RowAdmission: mod.assertV4RowAdmission,
            codec: mod.releasedV4SessionFormatCodec,
            assertReleasedV4Relationships: mod.assertReleasedV4Relationships
          }
        }
      } catch { /* 换下一个候选 */ }
    }
  }
  return undefined
}

const v4 = await loadV4Codec()
const assertV4RowAdmission = v4 === undefined ? undefined : v4.assertV4RowAdmission

if (assertV4RowAdmission === undefined && process.env.DSH_PI_ALLOW_MISSING_V4_CODEC !== '1') {
  throw new Error(
    '找不到 @deepseek-ai/dsh-session-format-v3-to-v4 的 assertV4RowAdmission，V4 准入守护无法执行。\n' +
    '  该包是 @deepseek-ai/dsh 的传递依赖；请先安装开发依赖（pnpm install / npm install）。\n' +
    '  确实无法安装、需要临时跳过时显式设置 DSH_PI_ALLOW_MISSING_V4_CODEC=1' +
    '（跳过等于放弃这道守护——0.1.7 的「本轮运行失败」就是没有它才漏出去的）。'
  )
}

if (assertV4RowAdmission === undefined) {
  console.log('  ! 已按 DSH_PI_ALLOW_MISSING_V4_CODEC=1 跳过 V4 准入守护（未经真机校验）')
}

/** 把一条消息包成 V4 user/message 行；序位字段不影响 source 准入。 */
const rowOf = (message) => ({
  type: 'user/message',
  seq: 3,
  time: Date.now(),
  data: message
})

test('V4 准入：makePromptMessage 的 source 被 dsh 真实准入接受（写盘路径）', { skip: assertV4RowAdmission === undefined }, () => {
  const message = makePromptMessage({ id: 'a', title: '图谱·Wiki 提醒', text: '正文', enabled: true })
  assert.doesNotThrow(
    () => assertV4RowAdmission(rowOf(message), new Set(['user/message'])),
    'makePromptMessage 的 source 必须能通过 V4 准入，否则真机上每条注入都会让整轮失败'
  )
})

test('V4 准入：生产者 kind 是 plugin: 命名空间形态，且不再带 V3 的 plugin 字段', { skip: assertV4RowAdmission === undefined }, () => {
  const message = makePromptMessage({ id: 'a', title: 'T', text: 'b', enabled: true })
  assert.equal(message.source.kind, 'plugin:dsh-prompt-injector')
  assert.equal(message.source.kind, PROMPT_INJECTOR_SOURCE_KIND)
  assert.equal('plugin' in message.source, false, "V4 source 不得再带 V3 的 plugin 字段")
  assert.equal(message.source.form, 'notice')
})

test('V4 准入反向对照：旧写法 kind:"plugin" 确实会被拒绝（证明守护非空转）', { skip: assertV4RowAdmission === undefined }, () => {
  const legacy = {
    id: 'm-legacy',
    role: 'user',
    content: [{ type: 'text', text: '正文' }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-prompt-injector',
      form: 'notice',
      summary: '图谱·Wiki 提醒'
    }
  }
  assert.throws(
    () => assertV4RowAdmission(rowOf(legacy), new Set(['user/message'])),
    /producer-owned source kind/,
    '旧形态必须被拒——若这里不抛错，说明准入函数没被真正调用，本文件的守护是空转'
  )
})

// ---------------------------------------------------------------------------
// 真实写盘函数 + 完整往返：不只调内层校验，而是走 persistence 实际使用的
// releasedV4SessionFormatCodec.encodeEvent（dsh-session-persistence-jsonl 的
// worker encodeEvent 内部就是它），再 decodeRow 读回并做关系校验。
// ---------------------------------------------------------------------------
const hasCodec = v4 !== undefined && typeof v4.codec?.encodeEvent === 'function'

test('V4 写盘：真实 encodeEvent 接受修复后的注入消息（并逐字节读回）', { skip: !hasCodec }, () => {
  const message = makePromptMessage({ id: 'a', title: '标题', text: '正文', enabled: true })
  const event = { type: 'user/message', seq: 0, time: 1790408425694, surfaceOp: 'append', data: message }

  let row
  assert.doesNotThrow(() => { row = v4.codec.encodeEvent(event) }, '真实写盘函数必须接受修复后的 source')

  // 读回准入：decodeRow 内部同样调用 assertV4RowAdmission
  const header = { version: 4, id: 'sess-1', createdAt: 1, delegationDepth: 0, isSeeded: false }
  const decoder = v4.codec.createDecoder(v4.codec.encodeHeader(header, 0))
  const events = []
  decoder.decodeRow(row, { emitRun: () => {}, emitEvent: (ev) => events.push(ev) })
  assert.equal(events.length, 1, '写入的行必须能被读回一条事件')
  assert.equal(events[0].data.source.kind, 'plugin:dsh-prompt-injector', '读回后 source.kind 保持不变')
  assert.equal(events[0].data.source.form, 'notice')
  assert.equal(events[0].data.source.summary, '标题')

  // 回放安全性
  if (typeof v4.assertReleasedV4Relationships === 'function') {
    assert.doesNotThrow(
      () => v4.assertReleasedV4Relationships({ header, inheritedEventCount: 0, events }, new Set(['user/message'])),
      '写入并读回的事件必须通过 V4 关系校验（否则回放/恢复会失败）'
    )
  }
})

test('V4 写盘反向对照：真实 encodeEvent 拒绝旧写法（即真机报错位置）', { skip: !hasCodec }, () => {
  const legacy = {
    id: 'm-legacy',
    role: 'user',
    content: [{ type: 'text', text: '正文' }],
    source: { kind: 'plugin', plugin: 'dsh-prompt-injector', form: 'notice', summary: '标题' }
  }
  assert.throws(
    () => v4.codec.encodeEvent({ type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: legacy }),
    /producer-owned source kind/,
    '旧写法必须在写盘函数上就被拒——这正是真机「本轮运行失败」抛错的位置'
  )
})
