/**
 * dsh-prompt-injector — 通用每轮上下文注入插件（host 半）。
 *
 * 与 dsh-mem0-plugins 的注入机制同构（agent/pre-step → decision.messages 追加
 * form:'notice' 的 plugin-source 用户消息），但完全通用化：配置里每一条
 * enabled 提示词 → 每轮对话追加一条 notice 行（summary 即标题，UI 自动加
 * 「上下文注入」前缀与插件名）。
 *
 * 配置（设置页可编辑，settings.yaml 用户层持久化）：
 *   enabled      —— 总开关
 *   skipTrivial  —— 琐碎轮（问候/确认/继续等）是否跳过注入，默认 true
 *   prompts[]    —— 提示词列表 { id, title, text, enabled, trigger }，trigger:
 *                   'everyTurn'（默认，每轮注入）| 'postCompaction'（压缩代际
 *                   推进后的下一 freshUser 轮注入一次，同代不重复）。默认列表为
 *                   空（2026-08-29 开源决策）：只留机制不预设内容，用户自填自选。
 *
 * 压缩代际来源：session/event 的 compaction/summary 事件（C0 实证载荷，零 LLM）。
 *
 * 只提醒、不执行：插件不调用任何图谱/wiki 命令，判断权在模型。
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_PROMPTS, normPrompts, freshUserOf, selectPrompts, makePromptMessage } from './logic.js'

/** Settings 命名空间（浏览器卡片与 host 共用同一字符串）。
 * dsh 0.1.2-alpha 起 settingsNamespace() brand 辅助已从 dsh-settings 移除；
 * 命名空间改为在 settings.register/installSection 处校验（小写连字符标识符）。 */
export const PROMPT_INJECTOR_NAMESPACE = 'prompt-injector'

const PromptSchema = z.object({
  id: z.string().default(''),
  title: z.string().default(''),
  text: z.string().default(''),
  enabled: z.boolean().default(true),
  // C1（memorax 吸收 2026-08-29）：'everyTurn' | 'postCompaction'；旧配置缺省 = everyTurn 零迁移，
  // 严格归一化在 logic.js normPrompts（非 'postCompaction' 一律回落 everyTurn）。
  trigger: z.string().default('everyTurn')
})

const Config = z.object({
  enabled: z.boolean().default(true),
  skipTrivial: z.boolean().default(true),
  prompts: z.array(PromptSchema).default(DEFAULT_PROMPTS)
})

// settings 接线在 apply 内经 ctx.inject(['settings']) 完成（服务解析时回调），
// 此处只需 agents（backfill 枚举用）。
export const inject = ['agents']

export function apply(ctx, config = {}) {
  let current = () => config
  // dsh 0.1.2-alpha：独立 installSettingsSection 帮助函数已从 dsh-settings 移除，
  // 同样的接线改为 provider 上的 settings.installSection(owner, ns, schema, entry, hooks)
  // （源码级核对：register(base=entry) → setSource(scope.get) → 卸载回落 effect →
  // onChange() 同步首发 → scope.watch 持续通知）。
  // hooks 在 inject 回调内执行——此处 onChange 为空操作、setSource 只赋值上方
  // 已声明的 current，无 TDZ 风险，故保持原位置。
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.installSection(ctx, PROMPT_INJECTOR_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        // 各消费点每轮读取 current()，无需主动刷新
      }
    })
  })

  const spec = () => {
    const value = current() || {}
    return {
      enabled: value.enabled !== false,
      skipTrivial: value.skipTrivial !== false,
      prompts: normPrompts(value.prompts)
    }
  }

  // C2（memorax 吸收 2026-08-29）：压缩代际计数。载荷实形经 rc.2 源码 + 真机持久日志
  // 双重实证（C0）：event = {type:'compaction/summary', seq, time, data:{compactionId,
  // shadowedSeqs, shadowedRange, shadowedTokenCount, provider, model, ...}}，字段嵌在
  // data 层（D5 教训）。只数 summary（已提交的压缩）；start/end 不数（end 可带 error 无 summary）。
  const MAP_CAP = 256
  const compactionGen = new Map() // sessionId -> 已提交压缩次数（代际）
  const appliedGen = new Map() // sessionId + '\u0000' + promptId -> 已注入时的代际
  const capMap = (map) => {
    while (map.size > MAP_CAP) map.delete(map.keys().next().value)
  }

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    try {
      if (!event || event.type !== 'compaction/summary' || !session || !session.id) return
      const next = (compactionGen.get(session.id) || 0) + 1
      compactionGen.set(session.id, next)
      capMap(compactionGen)
      // C0 探针降级为 debug 日志：平台若漂移事件形状，此行即证据
      ctx.logger.debug('[dsh-prompt-injector] compaction/summary session=' + session.id +
        ' gen=' + next + ' seq=' + event.seq +
        ' dataKeys=' + (event.data ? Object.keys(event.data).join(',') : '-'))
    } catch (error) {
      ctx.logger.debug('[dsh-prompt-injector] compaction counter failed: ' + String((error && error.message) || error))
    }
  }), 'pi:compaction-counter')

  // 会话 dispose 即清（载荷 = (session)，dsh-session emitDisposed 实证）
  ctx.effect(() => ctx.on('session/disposed', (session) => {
    const id = session && session.id
    if (!id) return
    compactionGen.delete(id)
    const prefix = id + '\u0000'
    for (const k of appliedGen.keys()) {
      if (typeof k === 'string' && k.startsWith(prefix)) appliedGen.delete(k)
    }
  }), 'pi:dispose-cleanup')

  const hookedAgents = new WeakSet()

  const installAgentHooks = (agent) => {
    if (!agent || !agent.id || !agent.ctx) return
    if (hookedAgents.has(agent)) return
    hookedAgents.add(agent)

    agent.ctx.on('agent/pre-step', async (payload, next) => {
      // 第一阶段：执行下游链节。若下游抛错，不重放、向上传播
      // （重放会让下游副作用执行两次——继承上游的隐患，2026-08-26 第二轮审计修）。
      let decision
      try {
        decision = await next()
      } catch (error) {
        ctx.logger.debug('[dsh-prompt-injector] downstream pre-step error: ' + String((error && error.message) || error))
        throw error
      }
      // 第二阶段：只做纯内存注入；任何异常都回退原决策，不破坏本轮。
      try {
        if (!decision || decision.kind !== 'enter' || !decision.messages) return decision
        const s = spec()
        if (!s.enabled) return decision
        const freshUser = freshUserOf(payload)
        if (!freshUser) return decision
        const sessionId = agent.id
        const sel = selectPrompts(s.prompts, {
          freshUser,
          skipTrivial: s.skipTrivial,
          generation: compactionGen.get(sessionId) || 0,
          applied: (pid) => appliedGen.get(sessionId + '\u0000' + pid) || 0
        })
        if (!sel.prompts.length) return decision
        const reminders = sel.prompts.map((p) => makePromptMessage(p))
        // 先构造消息再记代际：mark 只影响 postCompaction 行，构造失败时不吞提醒
        for (const pid of sel.mark) {
          appliedGen.set(sessionId + '\u0000' + pid, compactionGen.get(sessionId) || 0)
          capMap(appliedGen)
        }
        return { kind: 'enter', messages: [...decision.messages, ...reminders] }
      } catch (error) {
        ctx.logger.debug('[dsh-prompt-injector] injection failed: ' + String((error && error.message) || error))
        return decision
      }
    })
    ctx.logger.debug('[dsh-prompt-injector] hooks installed for agent ' + agent.id)
  }

  // 新 agent 挂载
  ctx.effect(
    () => ctx.on('agent/created', (payload) => installAgentHooks(payload && payload.agent)),
    'pi:agent-hooks'
  )

  // 补挂既有 agent（插件晚于 agent 创建时，agent/created 已错过）
  const agentsRegistry = ctx.get && typeof ctx.get === 'function' ? ctx.get('agents') : undefined
  const agentsService = agentsRegistry || ctx.agents
  if (agentsService && typeof agentsService.list === 'function') {
    try {
      const existing = agentsService.list()
      if (existing && existing.length) {
        for (const agent of existing) installAgentHooks(agent)
        ctx.logger.debug('[dsh-prompt-injector] backfilled ' + existing.length + ' pre-existing agent(s)')
      }
    } catch (error) {
      ctx.logger.debug('[dsh-prompt-injector] existing-agent backfill failed: ' + String((error && error.message) || error))
    }
  }
}