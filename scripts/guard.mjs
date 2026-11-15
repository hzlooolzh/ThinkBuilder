#!/usr/bin/env node
// 只读护栏：证明 AI 只改了 D 行，没动流程图结构。
//   node scripts/guard.mjs snap   <项目目录>   先拍快照
//   node scripts/guard.mjs verify <项目目录>   回收结果
// 快照文件写在项目目录的上一级：.tb-guard.json
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as tb from '../packages/core/index.mjs'

const [, , cmd, target] = process.argv
if (!cmd || !target) {
  console.error('用法：node scripts/guard.mjs <snap|verify> <项目目录>')
  process.exit(2)
}
const root = tb.findProjectRoots(path.resolve(target), 3)[0]
if (!root) {
  console.error(`在 ${target} 下没找到 *${tb.ROOT_SUFFIX}`)
  process.exit(2)
}
const guardFile = path.join(path.dirname(root), '.tb-guard.json')

function scan() {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === tb.TB_FILE) {
        const raw = fs.readFileSync(p, 'utf8')
        const noD = raw.replace(/^D\s+[01]\s*$/m, 'D x')
        const dline = (/^D\s+([01])\s*$/m.exec(raw) || [, '0'])[1]
        out[path.relative(root, p)] = {
          hash: crypto.createHash('sha256').update(noD).digest('hex').slice(0, 16),
          done: dline,
        }
      }
    }
  }
  walk(root)
  return out
}

const now = scan()
if (cmd === 'snap') {
  fs.writeFileSync(guardFile, JSON.stringify({ root, at: new Date().toISOString(), files: now }, null, 2), 'utf8')
  console.log(`已拍快照：${Object.keys(now).length} 个 _.tb → ${guardFile}`)
  process.exit(0)
}
if (cmd !== 'verify') {
  console.error('未知命令')
  process.exit(2)
}
const before = JSON.parse(fs.readFileSync(guardFile, 'utf8')).files
let hard = 0
let doneChg = 0
for (const k of Object.keys(before)) {
  if (!(k in now)) {
    console.log(`✗ 文件被删除：${k}`)
    hard++
    continue
  }
  if (before[k].hash !== now[k].hash) {
    console.log(`✗ 除 D 行外的内容被改动：${k}`)
    hard++
  }
  if (before[k].done !== now[k].done) {
    console.log(`· D ${before[k].done} → ${now[k].done}  ${k}`)
    doneChg++
  }
}
for (const k of Object.keys(now)) if (!(k in before)) {
  console.log(`✗ 新增了文件：${k}`)
  hard++
}
console.log(hard === 0 ? `✓ 结构未被改动，只有 ${doneChg} 处 D 行变化` : `${hard} 处违规改动`)
process.exit(hard === 0 ? 0 : 1)
