#!/usr/bin/env node
// 自检：字节级往返、确定性、校验、完成位写入。node scripts/selftest.mjs
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as tb from '../packages/core/index.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
let fails = 0
const ok = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.log(`  ✗ ${msg}`)
    fails++
  }
}

const fixturesDir = path.join(ROOT, 'fixtures')
const fixtures = fs
  .readdirSync(fixturesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

const tbFiles = (dir) => {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === tb.TB_FILE) out.push(p)
    }
  }
  walk(dir)
  return out.sort()
}

for (const name of fixtures) {
  const dir = path.join(fixturesDir, name)
  const roots = tb.findProjectRoots(dir, 3)
  console.log(`\n[${name}] ${path.basename(roots[0] || '')}`)
  if (roots.length !== 1) {
    ok(false, `应恰好有 1 个根，实际 ${roots.length}`)
    continue
  }
  const project = tb.loadProject(roots[0])
  // 1. 结构问题
  const issues = tb.validate(project)
  const hard = issues.filter((i) => i.level === '错')
  ok(hard.length === 0, `结构校验无「错」${hard.length ? '：' + hard.map((i) => i.msg).join('；') : ''}`)
  const loadIssues = project.issues.filter((i) => i.level === '错')
  ok(loadIssues.length === 0, `加载无「错」${loadIssues.length ? '：' + loadIssues.map((i) => i.msg).join('；') : ''}`)

  // 2. 字节级往返
  for (const f of tbFiles(roots[0])) {
    const src = fs.readFileSync(f, 'utf8')
    const { spec, issues: pi } = tb.parseTb(src)
    const again = tb.serializeTb(spec)
    ok(again === src && pi.length === 0, `往返一致 ${path.relative(roots[0], f)}`)
  }

  // 3. 确定性
  const b1 = tb.renderBoot(project, 400)
  const b2 = tb.renderBoot(tb.loadProject(roots[0]), 400)
  ok(b1 === b2, 'boot 两次渲染逐字节相同')
  ok(tb.estimateTokens(b1) >= 0, `boot ≈ ${tb.estimateTokens(b1)} tok / ${Buffer.byteLength(b1)} B`)

  console.log('  --- boot ---')
  console.log(
    b1
      .split('\n')
      .map((l) => '  | ' + l)
      .join('\n'),
  )
  const chk = tb.renderCheck(project)
  console.log('  --- check ---')
  console.log(
    chk
      .split('\n')
      .map((l) => '  | ' + l)
      .join('\n'),
  )
}

/* ---- 完成位语义（T4） ---- */
console.log('\n[T4 完成位语义]')
{
  const dir = tb.findProjectRoots(path.join(fixturesDir, 't4-done'), 3)[0]
  const project = tb.loadProject(dir)
  const boot = tb.renderBoot(project, 400)
  ok(boot.includes('数据层 r ✓'), '根视图的子块行标出 数据层 ✓')
  ok(!boot.includes('表结构'), '已完成的 数据层 子树不再下沉（表结构不出现在 boot）')
  ok(boot.includes('录入'), '未完成的 录入 仍出现')
  ok(project.blocks.get('0.2').done === 0, '0.2 录入 done=0')
}

/* ---- tb_set_done 只改 D 行 ---- */
console.log('\n[tb_set_done 原子写入]')
{
  const src = tb.findProjectRoots(path.join(fixturesDir, 't4-done'), 3)[0]
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-selftest-'))
  const copy = path.join(tmp, path.basename(src))
  fs.cpSync(src, copy, { recursive: true })
  const project = tb.loadProject(copy)
  const target = path.join(copy, '录入', tb.TB_FILE)
  const before = fs.readFileSync(target, 'utf8')
  tb.setDone(project, '0.2', 1)
  const after = fs.readFileSync(target, 'utf8')
  const diff = (a, b) => {
    const la = a.split('\n')
    const lb = b.split('\n')
    const out = []
    for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) out.push([la[i], lb[i]])
    return out
  }
  const d = diff(before, after)
  ok(d.length === 1 && d[0][0] === 'D 0' && d[0][1] === 'D 1', `只改了一行：${JSON.stringify(d)}`)
  ok(tb.loadProject(copy).blocks.get('0.2').done === 1, '重新加载后 0.2 done=1')
  ok(!fs.existsSync(target + '.tmp'), '临时文件已清理')
  let threw = false
  try {
    tb.setDone(project, '0.9', 1)
  } catch {
    threw = true
  }
  ok(threw, '不存在的 ID 抛错')
  fs.rmSync(tmp, { recursive: true, force: true })
}

/* ---- 故意写坏一个块，检查校验器能抓到 ---- */
console.log('\n[校验器反例]')
{
  const src = tb.findProjectRoots(path.join(fixturesDir, 't2-medium'), 3)[0]
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-selftest-bad-'))
  const copy = path.join(tmp, path.basename(src))
  fs.cpSync(src, copy, { recursive: true })
  // 把 表单校验 的 O 改成 3 项，出边仍 2 条 → 应报错
  const f = path.join(copy, '录入', '表单校验', tb.TB_FILE)
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('O 通过,失败', 'O 通过,失败,取消'), 'utf8')
  const p = tb.loadProject(copy)
  const txt = tb.renderCheck(p)
  ok(/菱形出边 2 条 ≠ O 项 3 个/.test(txt), `抓到菱形出边数不匹配：${txt.split('\n')[0]}`)
  // S 里制造合并
  const g = path.join(copy, '录入', tb.TB_FILE)
  fs.writeFileSync(g, fs.readFileSync(g, 'utf8').replace('S 1>2>(3,4);3>(5,6)', 'S 1>2>(3,4);3>(2,6)'), 'utf8')
  const txt2 = tb.renderCheck(tb.loadProject(copy))
  ok(/合并/.test(txt2), '抓到 S 合并')
  fs.rmSync(tmp, { recursive: true, force: true })
}

/* ---- S 的 ; 续接 ---- */
console.log('\n[S 续接语法]')
{
  const r = tb.parseStruct('1>2>(3,4);3>(5,6)')
  ok(r.edges.length === 5, `5 条边（实际 ${r.edges.length}）`)
  ok(JSON.stringify(r.entries) === '[1]', `入口只有 1（实际 ${JSON.stringify(r.entries)}）`)
  const e2 = tb.parseStruct('1>2,3>4')
  ok(JSON.stringify(e2.entries) === '[1,3]', `a,b 多入口（实际 ${JSON.stringify(e2.entries)}）`)
}

/* ---- 编辑器 IR：导入→导出必须逐字节复原，且导出幂等 ---- */
console.log('\n[IR 导入导出]')
{
  const enc = tb.encodeS([1, 2, 3, 4, 5, 6], [[1, 2], [2, 3], [2, 4], [3, 5], [3, 6]])
  ok(enc && enc.raw === '1>2>(3,4);3>(5,6)', `编码成 S：${enc && enc.raw}`)
  ok(tb.encodeS([1, 2], [[1, 2], [2, 1]]) === null, '有环 → null（降级 E）')
  ok(tb.encodeS([1, 2, 3], [[1, 2], [1, 3], [2, 3]]) === null, '有合并 → null（降级 E）')
  for (const name of fixtures) {
    const src = tb.findProjectRoots(path.join(fixturesDir, name), 3)[0]
    const ir = tb.importProject(src)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-ir-'))
    const r1 = tb.exportProject(ir, tmp)
    const rel = path.relative(r1.rootDir, r1.files[0])
    ok(r1.files.length === tbFiles(src).length, `${name} 文件数 ${r1.files.length}`)
    let bad = 0
    for (const f of r1.files) {
      const orig = path.join(src, path.relative(r1.rootDir, f))
      if (!fs.existsSync(orig) || fs.readFileSync(orig, 'utf8') !== fs.readFileSync(f, 'utf8')) bad++
    }
    ok(bad === 0, `${name} 导出与原件逐字节相同${bad ? `（${bad} 个不同）` : ''}`)
    const r2 = tb.exportProject(tb.importProject(r1.rootDir), tmp)
    ok(r2.files.every((f) => fs.readFileSync(f, 'utf8') === fs.readFileSync(path.join(r1.rootDir, path.relative(r2.rootDir, f)), 'utf8')), `${name} 导出幂等`)
    void rel
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/* ---- 起止圆：只在编辑器里存在，导出时必须整块消失且不留下线 ---- */
console.log('\n[起止圆]')
{
  const ir = tb.newProject('圆测试')
  const root = ir.rootId
  const mk = (id, kind, title) => {
    ir.blocks[id] = tb.newBlock(id, kind, title, root)
    ir.blocks[root].children.push(id)
  }
  mk('c1', 'c', '开始')
  mk('a1', 'd', '判断')
  mk('a2', 't', '处理')
  mk('c2', 'c', '结束')
  ir.blocks.a1.desc = { input: '', output: '通过,失败', process: '', rules: '' }
  ir.blocks[root].flow.edges = [['c1', 'a1'], ['a1', 'a2'], ['a1', 'c2']]
  ok(tb.irToProject(ir).blocks.get(root).children.length === 2, '只读视图里只剩 2 个真实子块')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-circle-'))
  const out = tb.exportProject(ir, tmp)
  ok(out.files.length === 3, `导出 3 份 _.tb（根 + 判断 + 处理），实际 ${out.files.length}`)
  ok(!fs.existsSync(path.join(out.rootDir, '开始')) && !fs.existsSync(path.join(out.rootDir, '结束')), '起止圆的文件夹没有导出')
  const rootTb = fs.readFileSync(path.join(out.rootDir, tb.TB_FILE), 'utf8')
  ok(!/开始|结束/.test(rootTb), '根文本里不出现起止圆')
  const back = tb.importProject(out.rootDir)
  ok(tb.irToProject(back).blocks.get(back.rootId).struct.raw === '1>2', '导出后结构是 1>2（圆被忽略）')
  const ck = tb.renderCheck(tb.irToProject(ir))
  ok(!/错/.test(ck), `出口接到起止圆不算错（check: ${ck.replace(/\n/g, ' | ')}）`)
  fs.rmSync(tmp, { recursive: true, force: true })
}

/* ---- 出口空槽：编辑器里留的空白框不能污染导出文本，也不能丢掉相邻标签 ---- */
console.log('\n[出口空槽]')
{
  const ir = tb.newProject('空槽测试')
  const root = ir.rootId
  const a1 = tb.newBlock('a1', 'd', '判断', root)
  ir.blocks.a1 = a1
  ir.blocks[root].children.push('a1')
  a1.desc = { input: '', output: '通过,,失败', process: '', rules: '' }
  ok(tb.labelsOf(tb.irToProject(ir).blocks, 'a1').length === 2, '空槽不算一个出口（标签只有 2 个）')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-slot-'))
  const out = tb.exportProject(ir, tmp)
  const txt = fs.readFileSync(path.join(out.rootDir, '判断', tb.TB_FILE), 'utf8')
  ok(/^O 通过,失败$/m.test(txt), `导出时空槽被压掉：${(txt.split('\n').find((l) => l.startsWith('O ')) || '')}`)
  a1.desc.output = '增删改查四接口，写接口返回记录 id'
  const out2 = tb.exportProject(ir, tmp)
  const txt2 = fs.readFileSync(path.join(out2.rootDir, '判断', tb.TB_FILE), 'utf8')
  ok(txt2.includes('增删改查四接口，写接口返回记录 id'), '全角逗号原样保留，不被改写成半角')
  ok(!/错/.test(tb.renderCheck(tb.irToProject(ir))), '空槽不会让校验报错')
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
