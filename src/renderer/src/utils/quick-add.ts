// 快速添加语法解析：从一句话里解析出标题 / 标签 / 分类 / 优先级 / 截止时间。
// 语法：`#标签`、`@分类`（需能匹配到已知分类）、`!P2` 或 `!2`（P0-P6）、
// 日期：`今天/今日 明天 后天 大后天 周X/星期X/礼拜X（本周X、下周X、下下周X）`、相对 `+3d +2w +4h`、
// 时刻：`下午3点 上午9:30 晚上8点半 中午12点 15:00`（必须带「点/时/冒号」，普通数字不误判）。
// 裸日期 → 全天事件（due 存当天零点）；带时刻 → 定时；裸时刻已过点 → 自动排到明天；
// 识别不了的片段原样保留在标题里。
export interface QuickAddParsed {
  title: string
  priority: number | null
  tags: string[]
  categoryName: string | null
  /** ISO 字符串；未解析出日期为 null */
  dueAt: string | null
  /** 裸日期（无时刻）→ 全天事件 */
  allDay: boolean
}

const WEEKDAY_CHARS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
const DAY = 86_400_000

interface DateHit {
  /** 当天零点的时间戳 */
  dayStart: number
  /** 命中的原文 */
  raw: string
}

interface TimeHit {
  hour: number
  minute: number
  raw: string
}

/** 解析日期词：今天/明日系 + 周X 系（含本周/下周/下下周），取未来最近的一天。 */
function matchDate(text: string): DateHit | null {
  const re = /(大后天|后天|明天|今日|今天|(下下|下|本)?(?:周|星期|礼拜)([一二三四五六日天]))/
  const m = re.exec(text)
  if (!m) return null
  const raw = m[1]
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (raw === '明天') return { dayStart: dayStart + DAY, raw }
  if (raw === '后天') return { dayStart: dayStart + 2 * DAY, raw }
  if (raw === '大后天') return { dayStart: dayStart + 3 * DAY, raw }
  const target = WEEKDAY_CHARS[m[3] ?? '']
  if (target == null) return null
  const prefix = m[2] ?? ''
  let diff = (target - now.getDay() + 7) % 7
  if (prefix === '下') diff += 7
  if (prefix === '下下') diff += 14
  return { dayStart: dayStart + diff * DAY, raw }
}

/** 解析时刻词：下午3点 / 上午9:30 / 晚上8点半 / 中午12点 / 15:00。连接符（点/时/冒号）必须出现。 */
function matchTime(text: string): TimeHit | null {
  const re = /(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})[点时:：]\s*(半|(\d{1,2})\s*分?)?/g
  for (const m of text.matchAll(re)) {
    let hour = Number(m[2])
    const period = m[1] ?? ''
    const minute = m[3] === '半' ? 30 : m[4] != null ? Number(m[4]) : 0
    const colonStyle = m[0].includes(':') || m[0].includes('：')
    // 冒号写法必须带分钟（避免把 2026-11-20 这类日期误读成时刻）
    if (colonStyle && m[4] == null) continue
    if (hour > 23 || minute > 59) continue
    if (period === '下午' || period === '傍晚' || period === '晚上') {
      if (hour < 12) hour += 12
    } else if (period === '凌晨' && hour === 12) {
      hour = 0
    }
    // 早上/上午/中午保持原值
    return { hour, minute, raw: m[0] }
  }
  return null
}

export function parseQuickAdd(input: string, categoryNames: string[] = []): QuickAddParsed {
  let rest = ` ${input.trim()} `
  const tags: string[] = []
  let priority: number | null = null
  let categoryName: string | null = null
  let dueMs: number | null = null
  let allDay = false

  // 优先级：!P2 / !2（前后需有边界）
  const pm = /(?:^|\s)!(?:P|p)?([0-6])(?=\s|$)/.exec(rest)
  if (pm) {
    priority = Number(pm[1])
    rest = rest.replace(pm[0], ' ')
  }

  // 标签：#名称（可多个）
  const tagRe = /(?:^|\s)#([^\s#@!]+)/g
  for (const m of rest.matchAll(tagRe)) tags.push(m[1])
  rest = rest.replace(tagRe, ' ')

  // 分类：@名称，需命中已知分类（全名相等，或是唯一以该片段开头的分类）
  const cm = /(?:^|\s)@([^\s#@!]+)/.exec(rest)
  if (cm) {
    const typed = cm[1]
    const exact = categoryNames.find((n) => n === typed)
    const prefix = categoryNames.filter((n) => n.startsWith(typed))
    if (exact || prefix.length === 1) {
      categoryName = exact ?? prefix[0]
      rest = rest.replace(cm[0], ' ')
    }
  }

  // 相对日期：+3d +2w +4h（保持当前时刻锚点，不是全天）
  const rm = /(?:^|\s)\+(\d{1,3})([dhw])(?=\s|$)/i.exec(rest)
  if (rm) {
    const n = Number(rm[1])
    const unit = rm[2].toLowerCase()
    const step = unit === 'h' ? 3_600_000 : unit === 'w' ? 7 * DAY : DAY
    dueMs = Date.now() + n * step
    rest = rest.replace(rm[0], ' ')
  } else {
    const date = matchDate(rest)
    const time = matchTime(rest)
    if (date) {
      if (time) {
        dueMs = date.dayStart + time.hour * 3_600_000 + time.minute * 60_000
        rest = rest.replace(date.raw, ' ').replace(time.raw, ' ')
      } else {
        // 裸日期 → 全天事件（当天零点）
        allDay = true
        dueMs = date.dayStart
        rest = rest.replace(date.raw, ' ')
      }
    } else if (time) {
      const now = new Date()
      const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.hour, time.minute).getTime()
      // 已过点 → 排到明天
      dueMs = todayAt > Date.now() ? todayAt : todayAt + DAY
      rest = rest.replace(time.raw, ' ')
    }
  }

  const title = rest.replace(/\s+/g, ' ').trim()
  return {
    title,
    priority,
    tags: [...new Set(tags)],
    categoryName,
    dueAt: dueMs != null ? new Date(dueMs).toISOString() : null,
    allDay
  }
}
