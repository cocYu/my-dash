// 宽松 JSON 解析器：JSON 美化 / JSON 比较共用的输入适配层。
// 按以下顺序尝试，命中即返回：
//   1. 转义 JSON 文本（日志/代码里拷出的 {\"a\":1} 或带外层引号的 "{\"a\":1}"）→ 逐层反转义
//   2. 严格 JSON.parse
//   3. JSON5（无引号键 / 单引号 / 尾逗号 / 注释 —— 覆盖「JS 对象字面量」形态）
//   4. JS 残余语法兜底（undefined 值 → null）再走一次 JSON5
// 任何格式输入，输出一律为严格 JSON（宽松只作用于输入侧）。
import JSON5 from 'json5'

export type JsonInputFormat = 'json' | 'escaped' | 'json5' | 'js'

export interface LenientParseResult {
  value: unknown
  /** 参与解析的文本（转义输入已反转义为标准形态） */
  text: string
  format: JsonInputFormat
}

export const FORMAT_LABELS: Record<JsonInputFormat, string> = {
  json: '严格 JSON',
  escaped: '转义 JSON 文本',
  json5: 'JSON5',
  js: 'JS 对象'
}

function looksLikeJsonText(t: string): boolean {
  const s = t.trim()
  return s.startsWith('{') || s.startsWith('[')
}

/**
 * 把「转义的 JSON 文本」反转义一层：
 * 支持 {\"a\":1}、嵌套转义 {\\\"a\\\":1}，以及带外层引号的 "{\\"a\\":1}"。
 * 原理：把整段文本当作 JSON 字符串字面量的内容交给 JSON.parse。
 * 无法反转义或结果不像 JSON 文本时返回 null。
 */
function unescapeOneLevel(t: string): string | null {
  let inner = t.trim()
  // 已带外层引号（单/双）的字符串字面量：剥掉再按字符串内容解析
  if (
    inner.length >= 2 &&
    ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'")))
  ) {
    inner = inner.slice(1, -1)
  }
  if (!inner.includes('\\')) return null // 无转义痕迹
  // 两种候选形态依次尝试：
  //   a) 原样（内层引号已是 \" 转义形态，常见于日志/代码拷贝）
  //   b) 给裸引号补转义（用户粘贴时丢了部分转义）
  const candidates = [inner, inner.replaceAll('"', '\\"')]
  for (const cand of candidates) {
    try {
      const out = JSON.parse(`"${cand}"`) as unknown
      if (typeof out === 'string' && looksLikeJsonText(out)) return out
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

/** 反复反转义（处理多重转义，上限 3 层），返回最终文本与是否发生过反转义 */
function unescapeAll(text: string): { text: string; escaped: boolean } {
  let cur = text
  let escaped = false
  for (let i = 0; i < 3; i++) {
    const next = unescapeOneLevel(cur)
    if (next === null || next === cur) break
    cur = next
    escaped = true
  }
  return { text: cur, escaped }
}

/** JS 残余语法兜底：undefined 值替换为 null（JSON5 不接受 undefined） */
function jsUndefinedToNull(t: string): string {
  return t.replace(/([:[,]\s*)undefined\b/g, '$1null')
}

/**
 * 宽松解析一段疑似 JSON 的文本。
 * 全部策略失败时抛出带位置信息的错误（取 JSON5 的报错，信息最可读）。
 */
export function parseJsonLenient(input: string): LenientParseResult {
  const raw = input.trim()
  if (!raw) throw new Error('内容为空')

  // 1. 转义文本反转义
  const { text, escaped } = unescapeAll(raw)

  // 2. 严格 JSON
  try {
    return { value: JSON.parse(text) as unknown, text, format: escaped ? 'escaped' : 'json' }
  } catch {
    /* 继续降级 */
  }

  // 3. JSON5（同时覆盖常见 JS 对象字面量写法）
  try {
    return { value: JSON5.parse(text) as unknown, text, format: escaped ? 'escaped' : 'json5' }
  } catch {
    /* 继续降级 */
  }

  // 4. JS 残余语法：undefined 值 → null 后再试
  const jsFixed = jsUndefinedToNull(text)
  if (jsFixed !== text) {
    try {
      return { value: JSON5.parse(jsFixed) as unknown, text: jsFixed, format: 'js' }
    } catch {
      /* 落入最终报错 */
    }
  }

  // 全部失败：挑一个最有定位价值的错误抛出
  try {
    JSON5.parse(text)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err))
  }
  throw new Error('无法解析为 JSON / JSON5 / JS 对象')
}
