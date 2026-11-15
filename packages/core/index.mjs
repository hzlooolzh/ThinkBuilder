// ThinkBuilder core —— 解析/加载/校验/渲染/写完成位/字节级往返。
// 零依赖，纯 Node ESM。所有输出都是确定的：同样的图导出/渲染两次必须逐字节相同。
import fs from 'node:fs'
import path from 'node:path'

export const TB_FILE = '_.tb'
export const ROOT_SUFFIX = '__TBROOT__'
// 'c' = 小圆（起点/终点标记），只在编辑器里存在：除标题外没有描述块，导出时整块忽略
export const KINDS = ['r', 'd', 't', 'c']
export const KIND_NAME = { r: '矩形', d: '菱形', t: '三角', c: '起止圆' }

/* ------------------------------------------------------------------ 语法 */

// 解析 _.tb 文本。返回 {spec, issues}，spec 是"文件内容"层（不含树信息）。
export function parseTb(text) {
  const issues = []
  const src = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
  const spec = {
    title: null,
    done: 0,
    desc: { input: '', output: '', process: '', rules: '' },
    children: [],
    struct: null,
  }
  let i = 0
  while (i < src.length && src[i].trim() === '') i++
  if (i >= src.length) {
    return { spec, issues: [err('空文件，缺少 tb1 头')] }
  }
  if (src[i].trim() !== 'tb1') issues.push(err(`首行应为 tb1，实际 ${JSON.stringify(src[i])}`))
  i++
  let lastField = null
  let rawStruct = null
  const rawEdges = []
  for (; i < src.length; i++) {
    const line = src[i]
    const t = line.trim()
    if (t === '') continue
    const ln = i + 1
    if (t.startsWith('+')) {
      if (!lastField) {
        issues.push(err(`L${ln} 续行 + 前面没有字段`))
        continue
      }
      lastField.v = lastField.v === '' ? t.slice(1).trimStart() : lastField.v + '\n' + t.slice(1).trimStart()
      continue
    }
    const fm = /^([TDIOPR])\s+(.*)$/.exec(t)
    if (fm) {
      const [, k, v] = fm
      lastField = null
      if (k === 'T') {
        spec.title = v.trim()
        lastField = { set: (x) => (spec.title = x), v: spec.title, get: () => spec.title }
        continue
      }
      if (k === 'D') {
        if (v.trim() !== '0' && v.trim() !== '1') issues.push(err(`L${ln} D 只能是 0 或 1`))
        spec.done = v.trim() === '1' ? 1 : 0
        continue
      }
      const key = { I: 'input', O: 'output', P: 'process', R: 'rules' }[k]
      spec.desc[key] = v
      lastField = { set: (x) => (spec.desc[key] = x), v, get: () => spec.desc[key] }
      continue
    }
    if (/^S\s+/.test(t)) {
      if (rawStruct != null) issues.push(err(`L${ln} S 只能出现一次`))
      rawStruct = t.replace(/^S\s+/, '').trim()
      continue
    }
    if (/^E\s+/.test(t)) {
      const em = /^E\s+(\d+)\s*>\s*(\d+)$/.exec(t)
      if (!em) {
        issues.push(err(`L${ln} E 行格式应为 "E 1>2"`))
        continue
      }
      rawEdges.push([Number(em[1]), Number(em[2])])
      continue
    }
    const cm = /^(\d+)\s+(.+?)\s+([rdt])$/.exec(t)
    if (cm) {
      spec.children.push({ n: Number(cm[1]), title: cm[2].trim(), kind: cm[3], line: ln })
      continue
    }
    issues.push(err(`L${ln} 无法解析：${JSON.stringify(line)}`))
  }
  // 子块序号必须 1..N 连续
  spec.children.forEach((c, idx) => {
    if (c.n !== idx + 1) issues.push(err(`子块序号应从 1 连续递增，第 ${idx + 1} 个写成了 ${c.n}`))
  })
  // 结构
  if (rawStruct != null && rawEdges.length) issues.push(err('S 与 E 不能同时出现'))
  if (rawStruct != null) {
    try {
      const { edges, entries } = parseStruct(rawStruct)
      spec.struct = { mode: 'S', raw: rawStruct, edges, entries }
    } catch (e) {
      issues.push(err(`S 表达式错误：${e.message}`))
    }
  } else if (rawEdges.length) {
    spec.struct = { mode: 'E', raw: rawEdges.map(([a, b]) => `${a}>${b}`).join(' '), edges: rawEdges, entries: [rawEdges[0][0]] }
  }
  return { spec, issues }
}

// S 表达式：chain (("," | ";") chain)*；chain = node (">" node)*；node = 序号 | "(" expr ")"
// 括号只能出现在 chain 末尾。入口 = 入度为 0 的节点，所以 `;` 起的续接不会产生新入口。
export function parseStruct(raw) {
  const toks = String(raw).match(/\d+|[>,();]/g) || []
  const edges = []
  const nodes = []
  const seen = new Set()
  let i = 0
  const note = (n) => {
    if (!seen.has(n)) {
      seen.add(n)
      nodes.push(n)
    }
  }
  const expr = (from) => {
    const entries = []
    for (;;) {
      const r = chain(from)
      if (r.first != null) entries.push(r.first)
      if (toks[i] === ',' || toks[i] === ';') {
        i++
        continue
      }
      return entries
    }
  }
  const chain = (from) => {
    let prev = from
    let first = null
    for (;;) {
      if (toks[i] === '(') {
        i++
        const inner = expr(prev)
        if (!inner.length) throw new Error('空括号')
        if (toks[i] !== ')') throw new Error('缺少右括号')
        i++
        if (toks[i] === '>') throw new Error('括号后不能再接 >')
        if (first == null) first = inner[0]
        return { first }
      }
      const t = toks[i]
      if (!/^\d+$/.test(t ?? '')) throw new Error(t ? `非法符号 ${t}` : '表达式不完整')
      const id = Number(t)
      i++
      note(id)
      if (prev != null) edges.push([prev, id])
      if (first == null) first = id
      prev = id
      if (toks[i] === '>') {
        i++
        continue
      }
      return { first }
    }
  }
  expr(null)
  if (i < toks.length) throw new Error(`多余符号 ${toks[i]}`)
  // 入口 = 入度为 0 的节点（`;` 续接不会新增入口）
  const hasIn = new Set(edges.map(([, z]) => z))
  let entries = nodes.filter((n) => !hasIn.has(n))
  if (!entries.length) entries = edges.length ? [edges[0][0]] : nodes.slice(0, 1)
  return { edges, entries }
}

// 反序列化：spec + 子块行 + 结构 → _.tb 文本（固定顺序，保证字节级往返）
export function serializeTb(spec) {
  const out = ['tb1']
  const t = spec.titleFolderMismatch ? spec.title : null
  if (t) out.push(`T ${t}`)
  out.push(`D ${spec.done ? 1 : 0}`)
  const d = spec.desc || {}
  const keys = [['I', 'input', '期望输入'], ['O', 'output', '期望输出'], ['P', 'process', '处理描述'], ['R', 'rules', '工作规范需求']]
  // 编辑器可能留下空出口槽（"通过,,失败"）：有空格才压掉，且保留原来的分隔符（, 或 ，）
  const normalizeOut = (s) => {
    const parts = String(s).split(/[,，]/)
    if (!parts.some((p) => p.trim() === '')) return String(s)
    const sep = String(s).includes('，') ? '，' : ','
    return parts.map((p) => p.trim()).filter(Boolean).join(sep)
  }
  for (const [k, key] of keys) {
    const v = k === 'O' ? normalizeOut(d[key] == null ? '' : d[key]) : d[key]
    if (v == null || v === '') continue
    const lines = String(v).split('\n')
    out.push(`${k} ${lines[0]}`)
    for (const l of lines.slice(1)) out.push(`+ ${l}`)
  }
  for (const c of spec.children) out.push(`${c.n} ${c.title} ${c.kind}`)
  if (spec.struct) {
    if (spec.struct.mode === 'S') out.push(`S ${spec.struct.raw}`)
    else for (const [a, b] of spec.struct.edges) out.push(`E ${a}>${b}`)
  }
  return out.join('\n') + '\n'
}

/* ------------------------------------------------------------------ 加载 */

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

// 在一个目录里按深度优先找 __TBROOT__ 根
export function findProjectRoots(dir, maxDepth = 3, depth = 0, acc = []) {
  let items = []
  try {
    items = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const it of items) {
    if (!it.isDirectory() || it.name.startsWith('.')) continue
    const p = path.join(dir, it.name)
    if (it.name.endsWith(ROOT_SUFFIX)) acc.push(p)
    else if (depth + 1 < maxDepth) findProjectRoots(p, maxDepth, depth + 1, acc)
  }
  return acc
}

export function projectTitle(rootDir) {
  const name = path.basename(rootDir)
  return name.endsWith(ROOT_SUFFIX) ? name.slice(0, -ROOT_SUFFIX.length) : name
}

// 加载整棵树。返回 {title, rootDir, rootId, blocks: Map, issues}
export function loadProject(rootDir) {
  const issues = []
  const title = projectTitle(rootDir)
  const blocks = new Map()
  const root = mkBlock('0', title, 'r', rootDir, null)
  blocks.set('0', root)
  loadChildren(root, blocks, issues)
  resolveEdges(blocks, issues)
  return { title, rootDir, rootId: '0', blocks, issues }
}

function mkBlock(id, title, kind, dir, parentId) {
  return {
    id,
    title,
    kind,
    dir,
    parentId,
    done: 0,
    desc: { input: '', output: '', process: '', rules: '' },
    children: [], // [{id, n}]
    struct: null,
    spec: null,
    missing: false,
  }
}

function loadChildren(block, blocks, issues) {
  const file = path.join(block.dir, TB_FILE)
  let text = null
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    issues.push(err(`${block.id} 缺少 ${TB_FILE}（${rel(block.dir)}）`))
    block.missing = true
    return
  }
  const { spec, issues: pis } = parseTb(text)
  for (const p of pis) issues.push({ ...p, where: block.id })
  block.spec = spec
  block.done = spec.done
  block.desc = spec.desc
  if (spec.title) block.sourceTitle = spec.title
  if (!spec.children.length) {
    block.struct = spec.struct
    return
  }
  // 列出候选子目录（含 _.tb 的子目录）
  let entries = []
  try {
    entries = fs.readdirSync(block.dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  } catch {}
  const used = new Set()
  for (const c of spec.children) {
    let dir = path.join(block.dir, c.title)
    if (!used.has(c.title) && isDir(dir) && fs.existsSync(path.join(dir, TB_FILE))) {
      used.add(c.title)
    } else {
      // 用 T 行反查
      const cands = entries.filter((e) => !used.has(e.name) && existsTb(path.join(block.dir, e.name)) && peekTitle(path.join(block.dir, e.name)) === c.title)
      if (cands.length === 1) {
        dir = path.join(block.dir, cands[0].name)
        used.add(cands[0].name)
      } else {
        issues.push(err(`${block.id} 的子块「${c.title}」找不到对应文件夹`))
        block.children.push({ id: `${block.id}.${c.n}`, n: c.n, missing: true })
        continue
      }
    }
    const id = `${block.id}.${c.n}`
    const child = mkBlock(id, c.title, c.kind, dir, block.id)
    blocks.set(id, child)
    block.children.push({ id, n: c.n })
    loadChildren(child, blocks, issues)
  }
  // 多余子目录
  for (const e of entries) {
    if (used.has(e.name)) continue
    if (existsTb(path.join(block.dir, e.name))) issues.push(err(`${block.id} 下有未声明的子块文件夹「${e.name}」`))
  }
  block.struct = spec.struct
}

const existsTb = (d) => fs.existsSync(path.join(d, TB_FILE))
function peekTitle(dir) {
  try {
    const { spec } = parseTb(fs.readFileSync(path.join(dir, TB_FILE), 'utf8'))
    return spec.title || path.basename(dir)
  } catch {
    return null
  }
}

// 把 local 序号的边映到全局 ID，并做结构校验
function resolveEdges(blocks, issues) {
  for (const b of blocks.values()) {
    if (!b.children.length || !b.struct) continue
    const st = b.struct
    const known = new Set(b.children.map((c) => c.n))
    const edges = []
    for (const [a, z] of st.edges) {
      if (!known.has(a) || !known.has(z)) {
        issues.push(err(`${b.id} 的边 ${a}>${z} 引用了不存在的子块序号`))
        continue
      }
      edges.push({ a, z, from: `${b.id}.${a}`, to: `${b.id}.${z}` })
    }
    b.edges = edges
    b.entries = (st.entries || []).filter((n) => known.has(n))
  }
}

/* ------------------------------------------------------------------ 校验 */

export function splitOut(block) {
  return String((block.desc && block.desc.output) || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function labelsOf(blocks, id) {
  const b = blocks.get(id)
  if (!b || b.kind !== 'd') return []
  return splitOut(b)
}

export function validate(project) {
  const out = []
  const { blocks } = project
  const add = (level, msg) => out.push({ level, msg })
  const seenEdges = new Map() // from -> [to]
  for (const b of blocks.values()) {
    if (b.missing) continue
    if (b.kind !== 'r' && b.children.length) add('错', `${b.id} ${b.title} ${b.kind} 不允许有子块（只有矩形可以包含）`)
    if (b.kind === 'r' && b.children.length === 0 && b.id === project.rootId) add('告警', '根逻辑块没有子块，这个项目是空的')
    const labels = labelsOf(blocks, b.id)
    if (b.kind === 'd' && labels.length < 2) add('错', `${b.id} ${b.title} 菱形的 O 应有≥2 项（逗号分隔），当前 ${labels.length} 项`)
    if (!b.struct && b.children.length) {
      add('告警', `${b.id} 有子块但没写 S/E，视为无序并列`)
      continue
    }
    if (!b.edges) b.edges = []
    // 出边表
    for (const e of b.edges) {
      const k = e.from
      if (!seenEdges.has(k)) seenEdges.set(k, [])
      seenEdges.get(k).push(e)
    }
    // 合并检查（S 模式）
    if (b.struct && b.struct.mode === 'S') {
      const indeg = new Map()
      for (const e of b.edges) indeg.set(e.to, (indeg.get(e.to) || 0) + 1)
      for (const [to, n] of indeg) if (n > 1) add('错', `${b.id} 的 S 有合并（${to} 被指入 ${n} 次），请改用 E 表`)
      if (hasCycle(b.edges.map((e) => [e.a, e.z]))) add('错', `${b.id} 的 S 含环，请改用 E 表`)
    }
    // 菱形/三角出边数（用本层序号统计，不用全局 ID）
    const deg = new Map()
    for (const e of b.edges) deg.set(e.a, (deg.get(e.a) || 0) + 1)
    for (const c of b.children) {
      const cb = blocks.get(c.id)
      if (!cb) continue
      const d = deg.get(c.n) || 0
      const virt = (b.virtualOut && b.virtualOut.get(c.n)) || 0
      if (cb.kind === 'd') {
        const l = labelsOf(blocks, cb.id)
        if (d + virt === 0) add('告警', `${cb.id} ${cb.title} 菱形没有出口（允许，但导出后没有分支）`)
        else if (d + virt !== l.length) add('错', `${cb.id} ${cb.title} 菱形出边 ${d + virt} 条 ≠ O 项 ${l.length} 个（第 k 条边对应 O 第 k 项）`)
        else if (virt > 0 && virt === d + virt) add('告警', `${cb.id} ${cb.title} 的出口全部接在起止圆上，导出后没有分支`)
      }
      if (cb.kind === 't' && d > 1) add('错', `${cb.id} ${cb.title} 三角最多 1 条出边，当前 ${d}`)
      if (d === 0 && cb.kind !== 'd' && cb.kind !== 'c' && b.children.length > 1 && !hasIncoming(blocks, cb.id) && !(b.entries || []).includes(c.n)) {
        // 没有输出本身合法（链尾/终点），只有"既没有进也没有出"才提醒
        add('告警', `${cb.id} ${cb.title} 是孤立块（无进无出）`)
      }
    }
    // 孤立声明
    if (b.children.length && !b.struct) add('告警', `${b.id} 的子块未连线，全部视为并行`)
  }
  // 回环信息
  for (const b of blocks.values()) {
    if (b.struct && b.struct.mode === 'E' && b.edges && hasCycle(b.edges.map((e) => [e.a, e.z]))) add('信息', `${b.id} 的 E 含回环（允许，但别实现成死循环）`)
  }
  return out
}

function hasIncoming(blocks, id) {
  const b = blocks.get(id)
  if (!b || !b.parentId) return false
  const p = blocks.get(b.parentId)
  if (!p || !p.edges) return false
  return p.edges.some((e) => e.to === id)
}

export function hasCycle(pairs) {
  const g = new Map()
  for (const p of pairs) {
    const [a, z] = Array.isArray(p) ? p : [p.a, p.z]
    if (!g.has(a)) g.set(a, [])
    g.get(a).push(z)
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2
  const color = new Map()
  const dfs = (n) => {
    color.set(n, GRAY)
    for (const m of g.get(n) || []) {
      const c = color.get(m) || WHITE
      if (c === GRAY) return true
      if (c === WHITE && dfs(m)) return true
    }
    color.set(n, BLACK)
    return false
  }
  for (const n of g.keys()) if ((color.get(n) || WHITE) === WHITE && dfs(n)) return true
  return false
}

/* ------------------------------------------------------------------ 渲染 */

// 首条注入的详尽读法：只在 tb_boot 里出现一次，后续 tb_block/tb_children 不再重复。
export const LEGEND = [
  '# tb1 读法（一次读完即可，之后按需下钻）',
  '字段行：T 标题 / D 完成(1=已完成；无 D 行=未完成) / I 期望输入 / O 期望输出 / P 处理描述 / R 工作规范需求；行首 + 是上一字段的续行。',
  '子块行：n 标题 r|d|t，n 是本层序号；全 ID = 头行前缀 + n（头行 "# 0.2 录入 r 子块=0.2.*" 时本层 1 即 0.2.1）。引用块、调用工具一律用全 ID。',
  'r=矩形逻辑组块（可以包含子块，不表示一定有）；d=菱形条件判断（无子块）；t=三角形处理（无子块）。',
  'S=内部流向：a>b 串行；a>(b,c) 当 a 是菱形时按 a 的 O 顺序分支（第 k 条边对应 O 第 k 项），a 不是菱形时为并行；a,b 为多入口；; 续接已出现过的节点（分支走完再往下）。',
  'E=边表：块内含合并/回环、无法用 S 表达时改用它，一行一条边，第一个 E 行的起点即本块入口。',
  '菱形：O 是出口清单（项数=出边数，第 k 项=第 k 条出口名），不是产物清单；父块里 "~通过,失败" 由它派生；它的产物（如错误明细）写在消费方块的 I。',
  '行尾 ✓ = 该块已完成（D 1），已完成块不再展开子块。',
  '工具（参数一律全 ID）：tb_boot 读骨架与根块；tb_block(id) 读该块描述+子块；tb_children(id) 只读子块+流向；tb_find(q) 按关键词找块；tb_check 校验结构；tb_set_done(id,0|1) 标记完成。流程图文件夹只读，不要改动。',
].join('\n')

export function fmtChildLine(blocks, parent, c) {
  const cb = blocks.get(c.id)
  if (!cb) return `${c.n} ? r`
  const labels = cb.kind === 'd' ? labelsOf(blocks, cb.id) : []
  const tail = labels.length ? ` ~${labels.join(',')}` : ''
  return `${c.n} ${cb.title} ${cb.kind}${cb.done ? ' ✓' : ''}${tail}`
}

export function renderBlockBody(project, id, opts = {}) {
  const { blocks } = project
  const b = blocks.get(id)
  if (!b) return null
  const out = []
  const head = `# ${b.id} ${b.title} ${b.kind}${b.children.length ? ` 子块=${b.id}.*` : ''}`
  out.push(head)
  if (b.done && opts.done !== false) out.push(`D 1`)
  for (const [k, key, name] of [
    ['I', 'input', '期望输入'],
    ['O', 'output', '期望输出'],
    ['P', 'process', '处理描述'],
    ['R', 'rules', '工作规范'],
  ]) {
    const v = (b.desc && b.desc[key]) || ''
    if (!v) continue
    const lines = String(v).split('\n')
    out.push(`${k} ${lines[0]}`)
    for (const l of lines.slice(1)) out.push(`+ ${l}`)
  }
  for (const c of b.children) out.push(fmtChildLine(blocks, b, c))
  if (b.struct && b.struct.mode === 'S') out.push(`S ${b.struct.raw}`)
  else if (b.struct && b.struct.mode === 'E') for (const e of b.edges || []) out.push(`E ${e.a}>${e.z}`)
  return out.join('\n')
}

// 骨架：root 的孙子及更深（深度≥2），跳过已完成块的子树
export function renderSkeleton(project, maxDepth = 99) {
  const { blocks, rootId } = project
  const lines = []
  const walk = (id, depth) => {
    const b = blocks.get(id)
    if (!b) return
    if (depth >= 2) {
      const labels = b.kind === 'd' ? labelsOf(blocks, b.id) : []
      lines.push(`${b.id} ${b.title} ${b.kind}${labels.length ? ` ~${labels.join(',')}` : ''}${b.done ? ' ✓' : ''}`)
    }
    if (b.done && depth >= 1) return // 已完成不下沉
    if (depth >= maxDepth) return
    for (const c of b.children) walk(c.id, depth + 1)
  }
  for (const c of blocks.get(rootId).children) walk(c.id, 1)
  return lines
}

// budget 只约束根视图+骨架；读法(LEGEND)是一次性成本，不计入预算
export function renderBoot(project, budget = 400) {
  const { rootId } = project
  const rootBody = renderBlockBody(project, rootId)
  const skel = renderSkeleton(project)
  const build = (lines, dropped) => {
    const parts = [rootBody]
    if (lines.length || dropped > 0) {
      parts.push('# 骨架', ...lines)
      if (dropped > 0) parts.push(`…+${dropped} 块未列出，用 tb_children 下钻`)
    }
    return parts.join('\n')
  }
  const full = build(skel, 0)
  if (estimateTokens(full) <= budget) return `${LEGEND}\n${full}`
  // 超预算：先砍骨架最深层，再砍根块的描述字段
  for (let keep = skel.length - 1; keep >= 0; keep--) {
    const text = build(skel.slice(0, keep), skel.length - keep)
    if (estimateTokens(text) <= budget) return `${LEGEND}\n${text}`
  }
  const slim = rootBody.split('\n').filter((l) => !/^[IOPR] /.test(l) && !l.startsWith('+ '))
  return `${LEGEND}\n${slim.join('\n')}`
}

export function renderChildren(project, id) {
  const { blocks } = project
  const b = blocks.get(id)
  if (!b) return null
  const out = [`# ${b.id} ${b.title} ${b.kind}${b.children.length ? ` 子块=${b.id}.*` : ''}`]
  if (b.done) out.push('D 1')
  for (const c of b.children) out.push(fmtChildLine(blocks, b, c))
  if (b.struct && b.struct.mode === 'S') out.push(`S ${b.struct.raw}`)
  else if (b.struct && b.struct.mode === 'E') for (const e of b.edges || []) out.push(`E ${e.a}>${e.z}`)
  if (!b.children.length) out.push('（无子块，叶子节点）')
  return out.join('\n')
}

export function renderCheck(project) {
  const issues = validate(project)
  if (!issues.length) return 'ok'
  const rank = { 错: 0, 告警: 1, 信息: 2 }
  issues.sort((a, b) => (rank[a.level] - rank[b.level]) || a.msg.localeCompare(b.msg))
  return issues.map((i) => `${i.level} ${i.msg}`).join('\n')
}

export function renderFind(project, query) {
  const q = String(query).toLowerCase()
  const hits = []
  for (const b of project.blocks.values()) {
    const hay = `${b.id} ${b.title} ${b.kind} ${b.desc.input} ${b.desc.output} ${b.desc.process} ${b.desc.rules}`.toLowerCase()
    if (hay.includes(q)) hits.push(`${b.id} ${b.title} ${b.kind}${b.done ? ' ✓' : ''}`)
  }
  return hits.length ? hits.join('\n') : `未找到「${query}」`
}

/* --------------------------------------------------------- 写完成位（唯一写操作） */

export function setDone(project, id, done) {
  const b = project.blocks.get(id)
  if (!b) throw new Error(`没有块 ${id}`)
  const rootResolved = path.resolve(project.rootDir)
  const file = path.resolve(b.dir, TB_FILE)
  if (!file.startsWith(rootResolved + path.sep) && file !== path.join(rootResolved, TB_FILE)) throw new Error('路径越界，拒绝写入')
  const text = fs.readFileSync(file, 'utf8')
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const v = done ? 1 : 0
  const idx = lines.findIndex((l) => /^D\s+[01]\s*$/.test(l))
  if (idx >= 0) lines[idx] = `D ${v}`
  else {
    const h = lines.findIndex((l) => l.trim() === 'tb1')
    lines.splice(h + 1, 0, `D ${v}`)
  }
  const next = lines.join(nl)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, next, 'utf8')
  fs.renameSync(tmp, file)
  b.done = v
  return `D ${v}`
}

/* --------------------------------------------------- 编辑器 IR 的机械导出/导入 */

// 本地序号图 → S 表达式。有合并或环时返回 null（调用方降级 E）。输出是确定的。
export function encodeS(ns, pairs) {
  if (!pairs.length) return { raw: '', entries: ns.slice() }
  const indeg = new Map(ns.map((n) => [n, 0]))
  const out = new Map(ns.map((n) => [n, []]))
  for (const [a, z] of pairs) {
    if (!out.has(a) || !indeg.has(z)) return null
    out.get(a).push(z)
    indeg.set(z, indeg.get(z) + 1)
  }
  for (const n of ns) {
    const o = out.get(n)
    const uniq = [...new Set(o)].sort((x, y) => x - y)
    out.set(n, uniq)
    if (uniq.length !== o.length) return null
  }
  if ([...indeg.values()].some((v) => v > 1)) return null
  if (hasCycle(pairs)) return null
  const entries = ns.filter((n) => indeg.get(n) === 0)
  const entrySet = new Set(entries)
  const used = new Set()
  const chains = []
  const starts = [...entries]
  const pushQueue = (arr) => {
    for (const t of arr) if (!starts.includes(t)) starts.push(t)
  }
  for (let si = 0; si < starts.length; si++) {
    const start = starts[si]
    const free = (n) => out.get(n).filter((t) => !used.has(`${n}>${t}`))
    if (!free(start).length) continue
    const parts = [start]
    let cur = start
    for (;;) {
      const outs = free(cur)
      if (!outs.length) break
      if (outs.length === 1) {
        used.add(`${cur}>${outs[0]}`)
        cur = outs[0]
        parts.push(cur)
        continue
      }
      for (const t of outs) used.add(`${cur}>${t}`)
      parts.push(`(${outs.join(',')})`)
      pushQueue(outs)
      break
    }
    const sep = entrySet.has(start) && chains.length ? ',' : ';'
    chains.push({ sep, text: parts.join('>') })
  }
  if (used.size !== pairs.length) return null
  const raw = chains.map((c, i) => (i === 0 ? c.text : c.sep + c.text)).join('')
  return { raw, entries }
}

const EMPTY_DESC = () => ({ input: '', output: '', process: '', rules: '' })

export function newBlock(id, kind, title, parentId = null) {
  return { id, kind, title, parentId, done: false, desc: EMPTY_DESC(), children: [], flow: { edges: [] }, layout: { x: 0, y: 0 } }
}

export function newProject(title) {
  return {
    format: 'tb-editor1',
    title,
    rootId: 'b0',
    seq: 1,
    blocks: { b0: { ...newBlock('b0', 'r', title), flow: { edges: [] } } },
  }
}

// 按"最长路径"给同一父块下的子块排行，再摆成 2 列的网格（首次导入用）
export function autoLayout(ir) {
  for (const b of Object.values(ir.blocks)) {
    if (!b.children.length) continue
    const rank = new Map(b.children.map((id) => [id, 0]))
    const indeg = new Map(b.children.map((id) => [id, 0]))
    const out = new Map(b.children.map((id) => [id, []]))
    for (const [a, z] of b.flow.edges) {
      if (!out.has(a) || !indeg.has(z)) continue
      out.get(a).push(z)
      indeg.set(z, indeg.get(z) + 1)
    }
    const order = [...b.children]
    const depth = new Map(b.children.map((id) => [id, 0]))
    for (let guard = 0; guard < b.children.length + 2; guard++) {
      let changed = false
      for (const a of b.children) {
        for (const z of out.get(a)) {
          if ((depth.get(z) || 0) < (depth.get(a) || 0) + 1) {
            depth.set(z, (depth.get(a) || 0) + 1)
            changed = true
          }
        }
      }
      if (!changed) break
    }
    const cols = new Map()
    const placed = new Set()
    for (const id of order) {
      if (placed.has(id)) continue
      placed.add(id)
      const d = Math.min(depth.get(id) || 0, 3)
      const row = cols.get(d) || 0
      cols.set(d, row + 1)
      const blk = ir.blocks[id]
      if (blk) blk.layout = { x: 28 + d * 300, y: 24 + row * 124 }
    }
    void rank
    void indeg
  }
  return ir
}

// 机械导出：把 IR 写成 <dir>/<title>__TBROOT__/**/_.tb。导出两次必须逐字节相同。
export function exportProject(ir, dir) {
  // 机械导出：<目标目录>/<项目名>/<项目名>__TBROOT__/<块>...（项目文件夹+根块文件夹两层）
  const projectDir = path.join(dir, ir.title)
  const rootDir = path.join(projectDir, `${ir.title}${ROOT_SUFFIX}`)
  const files = []
  const walk = (id, folder) => {
    const b = ir.blocks[id]
    if (!b) return
    // 小圆只是画布上的起止标记：不进导出树、不占序号、也不参与逻辑线
    const kids = b.children.map((cid) => ir.blocks[cid]).filter((cb) => cb && cb.kind !== 'c')
    const num = new Map(kids.map((kid, i) => [kid.id, i + 1]))
    const pairs = []
    for (const [a, z] of b.flow.edges || []) {
      if (num.has(a) && num.has(z)) pairs.push([num.get(a), num.get(z)])
    }
    const ns = kids.map((_, i) => i + 1)
    const enc = encodeS(ns, pairs)
    let struct = null
    if (enc && enc.raw) struct = { mode: 'S', raw: enc.raw }
    else if (pairs.length) {
      // E 行顺序有意义（第一个 E 行的起点=入口），必须保持原顺序，不能排序
      struct = { mode: 'E', edges: pairs }
    }
    const spec = {
      title: b.title,
      titleFolderMismatch: false,
      done: b.done ? 1 : 0,
      desc: b.desc,
      children: kids.map((kid, i) => {
        // 经过起止圆连出去的线：真实块没有出边，导出后本来就是链尾，不需要补线
        return { n: i + 1, title: kid.title, kind: kid.kind }
      }),
      struct,
    }
    fs.mkdirSync(folder, { recursive: true })
    const file = path.join(folder, TB_FILE)
    fs.writeFileSync(file, serializeTb(spec), 'utf8')
    files.push(file)
    for (const kid of kids) walk(kid.id, path.join(folder, kid.title))
  }
  fs.rmSync(rootDir, { recursive: true, force: true }) // 只清旧的根块文件夹，项目文件夹里的其它东西不动
  walk(ir.rootId, rootDir)
  return { projectDir, rootDir, files }
}

// 从导出树反向加载成 IR（供编辑器打开已有项目）
export function importProject(rootDir) {
  const p = loadProject(rootDir)
  const ir = {
    format: 'tb-editor1',
    title: p.title,
    rootId: 'b0',
    seq: 1,
    blocks: {},
    issues: p.issues,
  }
  const map = new Map([[p.rootId, 'b0']])
  const queue = [p.rootId]
  const mk = (id) => {
    if (!map.has(id)) {
      map.set(id, `b${ir.seq++}`)
      queue.push(id)
    }
    return map.get(id)
  }
  mk(p.rootId)
  while (queue.length) {
    const gid = queue.shift()
    const g = p.blocks.get(gid)
    const bid = map.get(gid)
    const b = newBlock(bid, g.kind, g.title, g.parentId ? map.get(g.parentId) || null : null)
    b.done = !!g.done
    b.desc = { ...EMPTY_DESC(), ...(g.desc || {}) }
    b.children = []
    for (const c of g.children) {
      if (c.missing) continue
      const cid = mk(c.id)
      b.children.push(cid)
      const cb = p.blocks.get(c.id)
      if (cb) cb.parentId = gid
    }
    b.flow = { edges: (g.edges || []).map((e) => [map.get(e.from) || e.from, map.get(e.to) || e.to]).filter(([a, z]) => a && z) }
    ir.blocks[bid] = b
  }
  return autoLayout(ir)
}

// 整项目 token 估算（boot + 一个块视图的近似的"AI 实际要读的量"）
export function projectTokens(ir) {
  const p = irToProject(ir)
  return { boot: estimateTokens(renderBoot(p)), legend: estimateTokens(LEGEND) }
}

// IR → 只读的"加载态"对象，便于复用 validate/render*
export function irToProject(ir) {
  const blocks = new Map()
  const pathOf = (id) => {
    const b = ir.blocks[id]
    if (!b) return ''
    return b.parentId ? `${pathOf(b.parentId)}/${b.title}` : ir.title
  }
  for (const [id, b] of Object.entries(ir.blocks)) {
    // 小圆不进只读视图：tbfd / 校验 / 渲染都当它不存在（与导出器一致）
    if (b.kind === 'c') continue
    const real = b.children.filter((cid) => ir.blocks[cid] && ir.blocks[cid].kind !== 'c')
    const edges = (b.flow.edges || [])
      .map(([a, z]) => ({
        a: real.indexOf(a) + 1,
        z: real.indexOf(z) + 1,
        from: a,
        to: z,
      }))
      .filter((e) => e.a > 0 && e.z > 0)
    // 起止圆只作起点/终点：它相关的线不进树，但要记住"这层本来有几条线接到了圆上"，
    // 否则菱形的出口数会对不上 O 项数而报假错。
    const virtOut = new Map()
    for (const [a, z] of b.flow.edges || []) {
      if (!ir.blocks[a] || !ir.blocks[z]) continue
      if (ir.blocks[a].kind === 'c') continue
      if (ir.blocks[z].kind !== 'c') continue
      const n = real.indexOf(a) + 1
      if (n > 0) virtOut.set(n, (virtOut.get(n) || 0) + 1)
    }
    const ns = real.map((_, i) => i + 1)
    const enc = encodeS(ns, edges.map((e) => [e.a, e.z]))
    const struct =
      enc && enc.raw
        ? { mode: 'S', raw: enc.raw, edges: edges.map((e) => [e.a, e.z]), entries: enc.entries }
        : edges.length
          ? { mode: 'E', raw: '', edges: edges.map((e) => [e.a, e.z]), entries: [edges[0].a] }
          : null
    blocks.set(id, {
      id,
      title: b.title,
      kind: b.kind,
      dir: pathOf(id),
      parentId: b.parentId,
      done: b.done ? 1 : 0,
      desc: { ...EMPTY_DESC(), ...(b.desc || {}) },
      children: real.map((cid, i) => ({ id: cid, n: i + 1 })),
      struct,
      spec: null,
      missing: false,
      edges,
      entries: (struct && struct.entries) || [],
      virtualOut: virtOut,
    })
  }
  return { title: ir.title, rootDir: '', rootId: ir.rootId, blocks, issues: [] }
}

/* ------------------------------------------------------------------ 杂项 */

export function estimateTokens(s) {
  let cjk = 0
  let other = 0
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)
    if (c >= 0x2e80 && c <= 0x9fff) cjk++
    else if (c >= 0xff00 && c <= 0xffef) cjk++
    else other++
  }
  return Math.round(cjk + other / 3.6)
}

const err = (msg) => ({ level: '错', msg })
const rel = (p) => p
