/**
 * dsh-prompt-injector — 纯逻辑模块（零依赖，便于单测）。
 * host 入口 src/index.js 从这里导入；不依赖 dsh-settings / schemastery。
 */

/** 默认内置提示词：空（2026-08-29 开源决策，发哥拍板）。
 * 插件只留注入机制，不预设任何内容——提示词由用户在设置页自填自选触发模式。
 * 写法示例见 README「Prompt examples」节。 */
export const DEFAULT_PROMPTS = []

/** 提示词列表防御性收敛（外部编辑 settings.yaml 时兜底）。
 * 语义：未配置（非数组/undefined）→ 内置默认（现为空 = 不注入）；
 * 显式空数组 → 空（用户删光=不再注入）。 */
export function normPrompts(raw) {
  if (!Array.isArray(raw)) return DEFAULT_PROMPTS.slice()
  const out = []
  raw.forEach((p, i) => {
    if (!p || typeof p !== 'object') return
    out.push({
      id: String((p.id !== undefined && p.id !== null && p.id !== '') ? p.id : ('p' + i)),
      title: String(p.title !== undefined && p.title !== null ? p.title : '').trim(),
      text: String(p.text !== undefined && p.text !== null ? p.text : ''),
      enabled: p.enabled !== false,
      // C1（2026-08-29 memorax 吸收）：触发模式，旧配置无此字段 = everyTurn，零迁移
      trigger: p.trigger === 'postCompaction' ? 'postCompaction' : 'everyTurn'
    })
  })
  return out
}

/** 琐碎输入判定：空/纯标点/斜杠命令/纯问候确认。移植自 dsh-mem0-plugins
 *  src/guards.js（hermes is_trivial_prompt 的中文扩充），MIT 许可。 */
const TRIVIAL_PROMPT_RE = new RegExp(
  '^(?:' +
  'yes|no|ok|okay|sure|thanks|thank you|yep|nope|yeah|nah|y|n|k|' +
  '好|好的|好哒|好嘞|嗯|嗯嗯|哦|噢|噢噢|行|行吧|可以|对|对的|是的|是|没错|' +
  '收到|了解|明白了|明白|知道了|知道|中|妥|' +
  '不|不用|不用了|不了|算了|没有|没|' +
  '谢谢|多谢|感谢|辛苦了|麻烦了|' +
  'hi|hey|hello|yo|sup|' +
  '你好|您好|哈喽|嗨|嗨嗨|在吗|在么|' +
  'continue|go ahead|do it|proceed|got it|cool|nice|great|done|next|lgtm|' +
  '继续|接着来|请继续|下一步|开始吧|就这样|搞定|完成' +
  ')' +
  '[\\s!?.:;,"\'~’“”—–…()\\[\\]{}<>*&^%$#@!+=`\\u00a0' +
  '。，！？；：、“”‘’《》【】（）～…·—]*$',
  'i'
)
const SLASH_COMMAND_RE = /^\/[a-zA-Z][\w-]{0,23}$/

export function isTrivialPrompt(text) {
  if (!text) return true
  const stripped = String(text).trim()
  if (!stripped) return true
  if (!stripped.replace(/[\p{P}\p{S}\p{Z}\s]/gu, '')) return true
  if (SLASH_COMMAND_RE.test(stripped)) return true
  return TRIVIAL_PROMPT_RE.test(stripped)
}

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function genId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'pi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/** 单条提示词 → notice 消息。
 * summary 只放标题（不带「上下文注入」前缀）：UI 渲染 ContextInjectionRow 时
 * 自动拼「上下文注入 | <插件名> | <summary>」——手动加前缀会重复
 * （2026-08-27 发哥实测反馈）。 */
export function makePromptMessage(prompt) {
  return {
    id: genId(),
    role: 'user',
    content: [{ type: 'text', text: prompt.text }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-prompt-injector',
      form: 'notice',
      summary: prompt.title || '未命名'
    }
  }
}

/** 本轮 freshUser 消息（source.kind === 'user'）；无则 undefined。 */
export function freshUserOf(payload) {
  return ((payload && payload.messages) || []).find(
    (m) => m && m.source && m.source.kind === 'user'
  )
}

/** 判断本轮是否需要注入提醒（everyTurn 语义，保留兼容）：有 freshUser 才注入；skipTrivial 时琐碎输入跳过。 */
export function shouldInject(payload, skipTrivial) {
  const freshUser = freshUserOf(payload)
  if (!freshUser) return false
  if (skipTrivial !== true) return true
  return !isTrivialPrompt(textOfBlocks(freshUser.content))
}

/** 纯选择器（C3，memorax 吸收 2026-08-29）：按本轮 freshUser 与压缩代际决定注入哪些行。
 * - everyTurn 行：有 freshUser 即注入；skipTrivial 时琐碎轮跳过（既有语义不变）。
 * - postCompaction 行：仅 generation > 0 且 applied(promptId) < generation 时放行；
 *   琐碎轮不拦截——系统状态一次性告知，每代至多一条，噪声有界。
 * 返回 { prompts, mark }：mark = 注入后需记为已应用的 postCompaction 行 id。 */
export function selectPrompts(prompts, opts) {
  const { freshUser, skipTrivial, generation, applied } = opts || {}
  if (!freshUser) return { prompts: [], mark: [] }
  const trivial = skipTrivial === true && isTrivialPrompt(textOfBlocks(freshUser.content))
  const gen = typeof generation === 'number' && generation > 0 ? generation : 0
  const out = []
  const mark = []
  for (const p of prompts || []) {
    if (!p || !p.enabled || !p.text) continue
    if (p.trigger === 'postCompaction') {
      const seen = typeof applied === 'function' ? Number(applied(p.id)) || 0 : 0
      if (gen > 0 && seen < gen) {
        out.push(p)
        mark.push(p.id)
      }
    } else if (!trivial) {
      out.push(p)
    }
  }
  return { prompts: out, mark }
}