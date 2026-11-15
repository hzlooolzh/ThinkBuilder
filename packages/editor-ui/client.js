// ThinkBuilder 编辑器 —— 客户端半边（DSH 侧栏面板）。
// 画布是"容器式"的：矩形逻辑组块会把它的子块画在自己身体里（本层 + 下一层，最多两层）。
// 保存/导入/导出/校验全部交给宿主路由 /thinkbuilder/api/*，这里只负责画和改。
window.__ModuleLoader__.load({
  id: 'thinkbuilder-editor',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback } = React

    const PANEL_ID = 'thinkbuilder'
    const KIND_NAME = { r: '矩形', d: '菱形', t: '三角', c: '起止圆' }
    const GLYPH = { r: '▭', d: '◇', t: '▽', c: '○' }
    const LEAF = { r: [196, 80], d: [196, 100], t: [196, 96], c: [92, 56] }
    const GAPX = 44
    const GAPY = 54
    const PAD = 14
    const HEAD = 30
    const MIN_W = 420

    /* ------------------------------------------------------------------ 样式 */

    const CSS = `
      .tbx-root {
        --tb-bg: var(--dsw-alias-bg-layer-1, #f7f9fc);
        --tb-panel: var(--dsw-alias-bg-layer-2, #ffffff);
        --tb-panel3: var(--dsw-alias-bg-layer-3, #f1f4f9);
        --tb-border: var(--dsw-alias-border-l2, #dfe5ef);
        --tb-border-strong: var(--dsw-alias-border-l3, #c9d3e3);
        --tb-text: var(--dsw-alias-label-primary, #1c2636);
        --tb-text2: var(--dsw-alias-label-secondary, #55637a);
        --tb-text3: var(--dsw-alias-label-tertiary, #8896ad);
        --tb-brand: var(--dsw-alias-brand-primary, #2f6fed);
        --tb-hover: var(--dsw-alias-interactive-bg-hover, rgba(47,111,237,.08));
        --tb-grid: var(--dsw-alias-border-l1, rgba(120,140,170,.18));
        --tb-ok: var(--dsw-alias-state-success-primary, #2f8f4e);
        --tb-warn: var(--dsw-alias-state-warn-primary, #b26a00);
        --tb-err: var(--dsw-alias-state-error-primary, #c0392b);
        color: var(--tb-text);
        background: var(--tb-panel);
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        font-size: 13px;
      }
      .tbx-bar { display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--tb-border); }
.tbx-tbgrp { display:flex; align-items:center; gap:4px; }
.tbx-sep { width:1px; height:18px; background:var(--tb-border); flex:none; }
.tbx-menu { position:absolute; right:0; top:30px; min-width:120px; background:var(--tb-panel); border:1px solid var(--tb-border-strong); border-radius:8px; box-shadow:0 12px 28px rgba(0,0,0,.22); padding:4px; z-index:20; }
.tbx-menu button { display:block; width:100%; text-align:left; border:0; background:none; color:var(--tb-text); font-size:12.5px; padding:6px 8px; border-radius:6px; cursor:pointer; }
.tbx-chip { display:inline-flex; align-items:center; gap:4px; max-width:220px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding:2px 8px; border:1px solid var(--tb-border-strong); border-radius:999px; font-size:12px; color:var(--tb-text2); cursor:pointer; }
.tbx-chip:hover { background:var(--tb-hover); color:var(--tb-text); }
.tbx-menu button:hover { background:var(--tb-hover); }
.tbx-popmask { position:fixed; inset:0; z-index:19; }
      .tbx-btn { border:1px solid var(--tb-border-strong); background:var(--tb-panel); color:var(--tb-text); border-radius:6px; padding:4px 9px; font-size:12px; cursor:pointer; line-height:1.5; }
      .tbx-btn:hover { background:var(--tb-hover); }
      .tbx-btn[aria-pressed="true"] { border-color:var(--tb-brand); color:var(--tb-brand); }
      .tbx-btn:disabled { opacity:.45; cursor:not-allowed; }
      .tbx-primary { background:var(--tb-brand); border-color:var(--tb-brand); color:var(--dsw-alias-label-primary-foreground,#fff); }
      .tbx-primary:hover { filter:brightness(1.06); background:var(--tb-brand); }
      .tbx-main { flex:1; min-height:0; display:flex; }
      .tbx-canvas { position:relative; flex:1; min-width:0; overflow:hidden; background:var(--tb-bg); cursor:default; }
      .tbx-canvas.panning { cursor:grabbing; }
      .tbx-grid { position:absolute; inset:0; background-image:radial-gradient(circle at 1px 1px, var(--tb-grid) 1px, transparent 0); background-size:22px 22px; }
      .tbx-world { position:absolute; left:0; top:0; transform-origin:0 0; }
      .tbx-node { position:absolute; user-select:none; box-sizing:border-box; }
      .tbx-leaf { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:3px; padding:8px 10px; box-sizing:border-box; box-shadow:0 1px 3px rgba(16,24,40,.14); }
      .tbx-r { border-radius:8px; background:rgba(108,142,191,.20); border:1.5px solid rgba(108,142,191,.85); }
      .tbx-d { background:rgba(215,155,0,.20); border:1.5px solid rgba(215,155,0,.85); }
      .tbx-t { background:rgba(130,179,102,.22); border:1.5px solid rgba(130,179,102,.9); }
      .tbx-node.sel { box-shadow:0 0 0 2px var(--tb-brand), 0 3px 12px rgba(16,24,40,.18); }
      .tbx-node .ttl { font-size:12.5px; font-weight:600; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .tbx-node .sub { font-size:10.5px; opacity:.78; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .tbx-cont { border-radius:10px; background:rgba(108,142,191,.09); border:1.5px solid rgba(108,142,191,.6); box-sizing:border-box; }
      .tbx-cont > .hd { height:30px; display:flex; align-items:center; gap:6px; padding:0 8px; border-bottom:1px dashed rgba(108,142,191,.45); cursor:grab; border-radius:9px 9px 0 0; }
      .tbx-cont.sel { box-shadow:0 0 0 2px var(--tb-brand); }
      .tbx-cont > .hd .ttl { font-size:12.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
      .tbx-cont > .hd .enter { font-size:11px; color:var(--tb-brand); border:1px solid var(--tb-border-strong); background:var(--tb-panel); border-radius:5px; padding:0 5px; cursor:pointer; }
      .tbx-cont > .hd .enter:hover { background:var(--tb-hover); }
      .tbx-badge { font-size:10px; color:var(--tb-text3); border:1px solid var(--tb-border); border-radius:4px; padding:0 4px; }
.tbx-rs { position:absolute; right:-6px; bottom:-6px; width:13px; height:13px; border-radius:3px; background:var(--tb-panel); border:1.5px solid var(--tb-border2); cursor:nwse-resize; opacity:.55; }
.tbx-cont:hover .tbx-rs, .tbx-cont.sel .tbx-rs { opacity:1; background:var(--tb-brand); border-color:var(--tb-brand); }
      .tbx-diamond { clip-path:polygon(50% 0, 100% 50%, 50% 100%, 0 50%); }
      .tbx-tri { clip-path:polygon(50% 96%, 100% 4%, 0 4%); padding-top:14px; padding-bottom:22px; }
      .tbx-c { border-radius:50%; width:92px; height:56px; padding:6px 8px; background:rgba(120,140,170,.16); border:1.5px solid rgba(120,140,170,.75); }
      .tbx-c .ttl { font-size:11.5px; }
      .tbx-c .sub { display:none; }
      .tbx-cwrap { display:flex; align-items:center; justify-content:center; }
      .tbx-side { width:318px; flex:0 0 318px; border-left:1px solid var(--tb-border); background:var(--tb-panel); overflow:auto; padding:10px 12px; box-sizing:border-box; }
      .tbx-field { margin-bottom:9px; }
      .tbx-field > label { display:block; font-size:11px; color:var(--tb-text3); margin-bottom:3px; }
      .tbx-in, .tbx-ta, .tbx-sel {
        width:100%; box-sizing:border-box; border:1px solid var(--tb-border-strong); border-radius:5px;
        padding:5px 7px; font-size:12px; line-height:1.5; font-family:inherit;
        background:var(--tb-panel); color:var(--tb-text); outline:none;
      }
      .tbx-in:focus, .tbx-ta:focus, .tbx-sel:focus { border-color:var(--tb-brand); box-shadow:0 0 0 2px var(--tb-hover); }
      .tbx-ta { resize:vertical; }
      .tbx-status { border-top:1px solid var(--tb-border); padding:5px 10px; font-size:11px; color:var(--tb-text2); display:flex; gap:12px; flex-wrap:wrap; max-height:110px; overflow:auto; }
      .tbx-crumb { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--tb-text2); flex-wrap:nowrap; overflow:hidden; white-space:nowrap; min-width:60px; }
      .tbx-crumb button { border:0; background:none; color:var(--tb-brand); cursor:pointer; padding:0 2px; font-size:12px; }
      .tbx-veil { position:fixed; inset:0; background:rgba(10,16,28,.45); display:flex; align-items:center; justify-content:center; z-index:60; }
      .tbx-dialog { width:560px; max-width:92vw; max-height:80vh; background:var(--tb-panel); border:1px solid var(--tb-border); border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.3); display:flex; flex-direction:column; overflow:hidden; }
      .tbx-dialog > .hd { padding:10px 14px; border-bottom:1px solid var(--tb-border); font-weight:600; font-size:13px; display:flex; justify-content:space-between; align-items:center; }
      .tbx-dialog > .bd { padding:10px 14px; overflow:auto; }
      .tbx-dialog > .ft { padding:10px 14px; border-top:1px solid var(--tb-border); display:flex; justify-content:flex-end; gap:8px; }
      .tbx-dirlist { border:1px solid var(--tb-border); border-radius:6px; max-height:260px; overflow:auto; }
      .tbx-dir { padding:4px 8px; cursor:pointer; font-size:12px; display:flex; gap:8px; align-items:center; }
      .tbx-dir:hover { background:var(--tb-hover); }
      .tbx-pick { padding:8px 12px; display:flex; flex-direction:column; gap:8px; align-items:center; justify-content:center; color:var(--tb-text2); height:100%; }
      .tbx-card { border:1px solid var(--tb-border); border-radius:8px; padding:10px 12px; cursor:pointer; background:var(--tb-panel); }
      .tbx-card:hover { background:var(--tb-hover); border-color:var(--tb-border-strong); }
      .tbx-tags { display:flex; gap:6px; flex-wrap:wrap; font-size:11px; color:var(--tb-text3); }
      .tbx-hint { font-size:11px; color:var(--tb-text3); line-height:1.6; }
      .tbx-empty {
        position:absolute; left:50%; top:46%; transform:translate(-50%,-50%);
        color:var(--tb-text3); font-size:13px; line-height:1.95; text-align:left;
        background:var(--tb-panel); border:1px dashed var(--tb-border-strong); border-radius:10px;
        padding:12px 18px; pointer-events:none; max-width:520px;
      }
      .tbx-rel { font-size:11.5px; color:var(--tb-text2); line-height:1.7; margin-top:4px; }
      .tbx-rel b { color:var(--tb-text); font-weight:600; }
      .tbx-oline { display:flex; gap:5px; margin-bottom:4px; align-items:center; }
      .tbx-oline .tbx-in { flex:1; }
      .tbx-idx { font-size:11px; color:var(--tb-text3); min-width:16px; text-align:right; }
      .tbx-warn { color:var(--tb-warn); }
      .tbx-ok { color:var(--tb-ok); }
      .tbx-mask { position:fixed; inset:0; background:rgba(10,16,28,.42); display:flex; align-items:center; justify-content:center; z-index:70; }
      .tbx-confirm { width:420px; max-width:92vw; background:var(--tb-panel); border:1px solid var(--tb-border); border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,.3); padding:16px 18px; }
      .tbx-confirm .hd { font-weight:600; font-size:13.5px; margin-bottom:8px; }
      .tbx-confirm .bd { font-size:12.5px; line-height:1.8; color:var(--tb-text2); }
      .tbx-confirm .ft { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; }
    `

    const ensureCss = () => {
      if (typeof document === 'undefined') return
      if (document.getElementById('tbx-style')) return
      const el = document.createElement('style')
      el.id = 'tbx-style'
      el.textContent = CSS
      document.head.appendChild(el)
    }

    /* ------------------------------------------------------------------ 小工具 */

    const api = async (p, body) => {
      const opt = body
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET' }
      const r = await fetch(`/thinkbuilder/api${p}`, opt)
      let data
      try {
        data = await r.json()
      } catch {
        throw new Error(`服务端返回了非 JSON（HTTP ${r.status}）`)
      }
      if (!data.ok) throw new Error(data.error || `HTTP ${r.status}`)
      return data
    }

    const clone = (x) => JSON.parse(JSON.stringify(x))
    const uid = (() => {
      let n = 0
      return () => `b${Date.now().toString(36)}${(n++).toString(36)}`
    })()
    const emptyDesc = () => ({ input: '', output: '', process: '', rules: '' })

    // 新块放在这一层已有块的右边，谁也不压着谁（含子块的矩形按它自己的尺寸算）
    const freeSpot = (ir, parentId, kind) => {
      const p = ir.blocks[parentId]
      if (!p) return { x: 0, y: 0 }
      let x = 0
      for (const cid of p.children || []) {
        const k = ir.blocks[cid]
        if (!k) continue
        const w = (k.size && k.size.w) || (LEAF[k.kind] || LEAF.r)[0]
        x = Math.max(x, ((k.layout && k.layout.x) || 0) + w + GAPX)
      }
      void kind
      return { x, y: 0 }
    }
    // 原始出口槽位：保留空串（编辑器要显示空框），不加 filter
    const rawOut = (b) =>
      String((b.desc && b.desc.output) || '')
        .split(/[,，]/)
        .map((s) => s.trim())
    // 有效出口：过滤空槽，给标签/计数用
    const splitOut = (b) => rawOut(b).filter(Boolean)

    const makeIr = (title) => ({
      format: 'tb-editor1',
      title,
      rootId: 'root',
      seq: 1,
      blocks: {
        root: {
          id: 'root',
          kind: 'r',
          title,
          parentId: null,
          done: false,
          desc: emptyDesc(),
          children: [],
          flow: { edges: [] },
          layout: { x: 0, y: 0 },
        },
      },
    })

    const chain = (ir, id) => {
      const out = []
      let cur = id
      let guard = 0
      while (cur && ir.blocks[cur] && guard++ < 64) {
        out.unshift(ir.blocks[cur])
        cur = ir.blocks[cur].parentId
      }
      return out
    }

    /* ------------------------------------------------------------------ 排版（底层向上量尺寸） */

    // 同一父块下按逻辑线分层：无入边的是第 0 层，其余取最长路径
    const flowRows = (parent, kids) => {
      const outs = new Map(kids.map((k) => [k.id, []]))
      for (const [a, z] of parent.flow.edges || []) {
        if (outs.has(a) && outs.has(z)) outs.get(a).push(z)
      }
      const lvl = new Map(kids.map((k) => [k.id, 0]))
      for (let it = 0; it < kids.length + 2; it++) {
        let changed = false
        for (const k of kids) {
          for (const z of outs.get(k.id)) {
            if ((lvl.get(z) || 0) < (lvl.get(k.id) || 0) + 1) {
              lvl.set(z, (lvl.get(k.id) || 0) + 1)
              changed = true
            }
          }
        }
        if (!changed) break
      }
      const rows = new Map()
      for (const k of kids) {
        const L = Math.min(lvl.get(k.id) || 0, 5)
        if (!rows.has(L)) rows.set(L, [])
        rows.get(L).push(k)
      }
      return [...rows.keys()].sort((a, b) => a - b).map((L) => rows.get(L))
    }

    const sizeOf = (ir, block, depth) => {
      const [lw, lh] = LEAF[block.kind] || LEAF.r
      // 只展开一层：当前层（depth 0）的矩形把子块画在身上，子块本身不再展开
      const canHold = block.kind === 'r' && block.children.length > 0 && depth === 0
      if (!canHold) return { w: lw, h: lh, inner: null }
      const inner = arrange(ir, block.id, depth + 1)
      // 用户手动拉过尺寸就以手拉的下限为准，子块仍然只是撑大、不会缩回去
      const min = block.size || {}
      return {
        w: Math.max(lw, inner.width + PAD * 2, min.w || 0),
        h: Math.max(lh, inner.height + HEAD + PAD * 2, min.h || 0),
        inner,
      }
    }

    // 位置只认块自己的 layout：拖动一个块不会牵动别人。
    // 只有从来没摆过的块（老数据/自动布局清空过）才临时按网格补位，补在哪由它自己的旧值决定一次。
    const arrange = (ir, parentId, depth) => {
      const parent = ir.blocks[parentId]
      const kids = (parent ? parent.children : []).map((id) => ir.blocks[id]).filter(Boolean)
      const geo = new Map()
      if (!kids.length) return { geo, width: 0, height: 0 }
      let maxX = 0
      let maxY = 0
      let cursorX = 0
      let cursorY = 0
      let rowH = 0
      for (const k of kids) {
        const s = sizeOf(ir, k, depth)
        const L = k.layout
        let x
        let y
        if (L && Number.isFinite(L.x) && Number.isFinite(L.y)) {
          x = L.x
          y = L.y
        } else {
          if (cursorX > 0 && cursorX + s.w > 1200) {
            cursorX = 0
            cursorY += rowH + GAPY
            rowH = 0
          }
          x = cursorX
          y = cursorY
          cursorX += s.w + GAPX
          rowH = Math.max(rowH, s.h)
        }
        geo.set(k.id, { x, y, w: s.w, h: s.h })
        maxX = Math.max(maxX, x + s.w)
        maxY = Math.max(maxY, y + s.h)
      }
      return { geo, width: maxX, height: maxY }
    }

    // 把"当前层 + 下一层"拍平成一串绝对坐标的节点，外加每个父块内部的连线
    const buildScene = (ir, levelId, showNext) => {
      const items = []
      const edges = []
      const abs = new Map()
      const visit = (parentId, ox, oy, depth) => {
        const parent = ir.blocks[parentId]
        if (!parent) return
        const kids = (parent.children || []).map((id) => ir.blocks[id]).filter(Boolean)
        const { geo } = arrange(ir, parentId, depth)
        if (parent.flow.edges && parent.flow.edges.length) {
          const outs = new Map()
          for (const [a, z] of parent.flow.edges) {
            if (!geo.has(a) || !geo.has(z)) continue
            const idx = outs.get(a) || 0
            outs.set(a, idx + 1)
            const src = ir.blocks[a]
            const label = src && src.kind === 'd' ? splitOut(src)[idx] || '' : ''
            edges.push({ key: `${parentId}:${a}>${z}:${idx}`, parentId, from: a, to: z, label })
          }
        }
        for (const k of kids) {
          const g = geo.get(k.id)
          if (!g) continue
          const box = { x: ox + g.x, y: oy + g.y, w: g.w, h: g.h }
          abs.set(k.id, box)
          const expand = showNext && depth === 0 && k.kind === 'r' && k.children.length > 0
          items.push({ block: k, box, depth, expand })
          if (expand) visit(k.id, box.x + PAD, box.y + HEAD, depth + 1)
        }
      }
      visit(levelId, 0, 0, 0)
      // 连线端点：源块底边中点 → 目标块顶边中点；回环（目标在源上方）绕右侧外圈走折线，避免穿块
      const edgePaths = edges
        .map((e) => {
          const a = abs.get(e.from)
          const z = abs.get(e.to)
          if (!a || !z) return null
          const x1 = a.x + a.w / 2
          const y1 = a.y + a.h
          const x2 = z.x + z.w / 2
          const y2 = z.y
          const srcTitle = (ir.blocks[e.from] && ir.blocks[e.from].title) || e.from
          const dstTitle = (ir.blocks[e.to] && ir.blocks[e.to].title) || e.to
          if (y2 > y1 + 6) {
            const dy = Math.max(28, Math.abs(y2 - y1) / 2)
            return {
              ...e,
              back: false,
              d: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2 - 2}`,
              mx: (x1 + x2) / 2,
              my: (y1 + y2) / 2,
              srcTitle,
              dstTitle,
            }
          }
          // 回环：右侧出 → 绕到所有块右边界之外 → 从目标右侧进入
          const rx = Math.max(a.x + a.w, z.x + z.w) + 48
          const sy = a.y + a.h / 2
          const ty = z.y + z.h / 2
          const r = 10
          const d =
            `M ${a.x + a.w} ${sy} L ${rx - r} ${sy} Q ${rx} ${sy} ${rx} ${sy + (ty > sy ? r : -r)} ` +
            `L ${rx} ${ty - (ty > sy ? r : -r)} Q ${rx} ${ty} ${rx - r} ${ty} L ${z.x + z.w + 2} ${ty}`
          return { ...e, back: true, d, mx: rx + 4, my: (sy + ty) / 2, srcTitle, dstTitle }
        })
        .filter(Boolean)
      const all = items.map((i) => i.box)
      const bounds = all.reduce(
        (b, x) => ({ x: Math.min(b.x, x.x), y: Math.min(b.y, x.y), r: Math.max(b.r, x.x + x.w), b: Math.max(b.b, x.y + x.h) }),
        { x: 0, y: 0, r: 800, b: 520 },
      )
      return { items, edges: edgePaths, abs, bounds, width: bounds.r - bounds.x, height: bounds.b - bounds.y }
    }

    /* ------------------------------------------------------------------ 图形 */

    function Icon({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 8, height: 6, rx: 1.5 }),
        h('rect', { x: 13, y: 14, width: 8, height: 6, rx: 1.5 }),
        h('path', { d: 'M11 7h3.5a1.5 1.5 0 0 1 1.5 1.5V14' }),
      )
    }

    function SidebarIcon({ size }) {
      return h(Icon, { size })
    }

    function LeafShape({ block, selected, armed, onDown, onEnter, onRename }) {
      const cls = ['tbx-node', 'tbx-leaf', `tbx-${block.kind}`, selected ? 'sel' : '', block.kind === 'd' ? 'tbx-diamond' : block.kind === 't' ? 'tbx-tri' : ''].join(' ')
      const labels = block.kind === 'd' ? splitOut(block) : []
      return h(
        'div',
        {
          className: `${cls}${armed ? ' armed' : ''}`,
          'data-id': block.id,
          onPointerDown: (e) => onDown(e, block),
          onDoubleClick: (e) => {
            e.stopPropagation()
            onEnter(block.id)
          },
          style: { width: '100%', height: '100%', position: 'relative' },
          title: `${GLYPH[block.kind]} ${KIND_NAME[block.kind]} · ${block.id}`,
        },
        h('div', { className: 'ttl' }, block.done ? '✓ ' : '', block.title || '（未命名）'),
        h('div', { className: 'sub' }, labels.length ? `~${labels.join(',')}` : KIND_NAME[block.kind]),
      )
    }

    function Container({ block, box, selected, armed, onDown, onEnter, onResize }) {
      return h(
        'div',
        {
          className: `tbx-node tbx-cont${selected ? ' sel' : ''}`,
          'data-id': block.id,
          style: { left: box.x, top: box.y, width: box.w, height: box.h },
        },
        h(
          'div',
          {
            className: 'hd',
            onPointerDown: (e) => onDown(e, block),
            onDoubleClick: (e) => {
              e.stopPropagation()
              onEnter(block.id)
            },
            title: `${block.title} · 拖动标题栏移动，双击进入`,
          },
          h('span', { style: { opacity: 0.6, fontSize: 11 } }, '▭'),
          h('span', { className: 'ttl' }, block.done ? '✓ ' : '', block.title || '（未命名）'),
          h('span', { className: 'tbx-badge' }, `${block.children.length} 子块`),
          h(
            'button',
            {
              className: 'enter',
              onPointerDown: (e) => e.stopPropagation(),
              onClick: (e) => {
                e.stopPropagation()
                onEnter(block.id)
              },
              title: '进入这一层',
            },
            '进入 ▸',
          ),
        ),
        h('div', {
          className: 'tbx-rs',
          title: '拖动右下角可以拉大这个矩形（子块拖出去也会自动撑大）',
          onPointerDown: (e) => onResize(e, block),
        }),
      )
    }

    /* ------------------------------------------------------------------ 画布 */

    function Canvas({ ir, levelId, showNext, selected, setSelected, enterLevel, edit, onMutated, note, connect, setConnect }) {
      const wrapRef = useRef(null)
      const [view, setView] = useState({ x: 40, y: 30, s: 1 })
      const [armed, setArmed] = useState(null) // 连线起点 id
      const [tick, setTick] = useState(0)
      const dragRef = useRef(null)
      const panRef = useRef(null)

      const scene = useMemo(() => buildScene(ir, levelId, showNext), [ir, levelId, showNext, tick])

      const screenToWorld = (cx, cy) => {
        const r = wrapRef.current.getBoundingClientRect()
        return { x: (cx - r.left - view.x) / view.s, y: (cy - r.top - view.y) / view.s }
      }

      // 子块不会离开父块：坐标一律夹在父块左/上边界之内（父块会随子块向右/下自动撑大）
      const clampInside = (b, x, y) => {
        // 这一层自己的块可以随便放；只有画在矩形身体里的子块才受限
        if (!b || !b.parentId || b.parentId === levelId) return { x, y }
        return { x: Math.max(0, x), y: Math.max(0, y) }
      }

      // 拉大矩形：只记住"至少这么大"，子块以后拖出去更多时还会继续撑大
      const startResize = (e, block) => {
        if (e.button !== 0) return
        e.stopPropagation()
        e.preventDefault()
        const box = scene.abs.get(block.id)
        if (!box) return
        const before = clone(ir)
        const cx = e.clientX
        const cy = e.clientY
        const s0 = { w: box.w, h: box.h }
        const move = (ev) => {
          const b = ir.blocks[block.id]
          if (!b) return
          b.size = {
            w: Math.max(180, Math.round(s0.w + (ev.clientX - cx) / view.s)),
            h: Math.max(110, Math.round(s0.h + (ev.clientY - cy) / view.s)),
          }
          setTick((n) => n + 1)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          onMutated(before)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const down = (e, block) => {
        if (e.button !== 0) return
        e.stopPropagation()
        if (connect || armed) {
          if (!armed) {
            setArmed(block.id)
            setSelected(block.id)
            note('点另一个块完成连线，Esc 取消')
          } else if (armed !== block.id) {
            const pa = ir.blocks[armed].parentId || levelId
            const pb = block.parentId || levelId
            if (pa !== pb) return note('逻辑线只能在同一个父层里连：先进入那一层再连')
            edit((x) => {
              const p = x.blocks[pb]
              if (!p) return
              const dup = (p.flow.edges || []).some(([a, z]) => a === armed && z === block.id)
              if (!dup) p.flow.edges = [...(p.flow.edges || []), [armed, block.id]]
            })
            note('已连接')
            setArmed(null)
          }
          return
        }
        setSelected(block.id)
        const start = { cx: e.clientX, cy: e.clientY, id: block.id, x: block.layout.x || 0, y: block.layout.y || 0, moved: false, before: clone(ir), wx: 0, wy: 0 }
        dragRef.current = start
        const move = (ev) => {
          const d = dragRef.current
          if (!d) return
          const dx = (ev.clientX - d.cx) / view.s
          const dy = (ev.clientY - d.cy) / view.s
          if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true
          const p = screenToWorld(ev.clientX, ev.clientY)
          d.wx = p.x
          d.wy = p.y
          const b = ir.blocks[d.id]
          if (!b) return
          b.layout = clampInside(b, Math.round(d.x + dx), Math.round(d.y + dy))
          setTick((n) => n + 1)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          const d = dragRef.current
          dragRef.current = null
          if (d && d.moved) onMutated(d.before)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const bgDown = (e) => {
        if (e.button !== 0) return
        const start = { cx: e.clientX, cy: e.clientY, x: view.x, y: view.y, moved: false }
        panRef.current = start
        setArmed(null)
        if (setConnect) setConnect(false)
        const move = (ev) => {
          const p = panRef.current
          if (!p) return
          const dx = ev.clientX - p.cx
          const dy = ev.clientY - p.cy
          if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true
          setView((v) => ({ ...v, x: p.x + dx, y: p.y + dy }))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          const p = panRef.current
          panRef.current = null
          if (p && !p.moved) setSelected(null)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      useEffect(() => {
        const el = wrapRef.current
        if (!el) return
        const onWheel = (e) => {
          e.preventDefault()
          const rect = el.getBoundingClientRect()
          const px = e.clientX - rect.left
          const py = e.clientY - rect.top
          const next = Math.min(2, Math.max(0.35, view.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
          const k = next / view.s
          setView({ s: next, x: px - (px - view.x) * k, y: py - (py - view.y) * k })
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
      }, [view])

      const fit = () => {
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const s = Math.min(1.15, Math.max(0.4, Math.min((r.width - 80) / Math.max(200, scene.width), (r.height - 80) / Math.max(200, scene.height))))
        setView({ s, x: 40, y: 30 })
      }
      useEffect(() => {
        fit()
      }, [levelId])

      if (!ir.blocks[levelId]) {
        return h('div', { className: 'tbx-pick' }, '这一层不存在（可能刚被删除），点上方的面包屑回到上一层。')
      }

      return h(
        'div',
        { ref: wrapRef, className: 'tbx-canvas' + (panRef.current ? ' panning' : ''), onPointerDown: bgDown },
        h('div', { className: 'tbx-grid' }),
        h(
          'div',
          { className: 'tbx-world', style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` } },
          h(
            'svg',
            { width: Math.max(scene.bounds.r + 240, 800), height: Math.max(scene.bounds.b + 240, 600), style: { position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' } },
            h(
              'defs',
              null,
              h(
                'marker',
                { id: 'tbx-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
                h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--tb-text2)' }),
              ),
            ),
            scene.edges.map((e) =>
              h(
                'g',
                { key: e.key, style: { pointerEvents: 'none' } },
                h('title', null, `${e.srcTitle} → ${e.dstTitle}${e.label ? `（${e.label}）` : ''}`),
                h('path', { d: e.d, fill: 'none', stroke: 'var(--tb-text2)', strokeWidth: 1.5, opacity: 0.85, markerEnd: 'url(#tbx-arrow)' }),
                e.label
                  ? h(
                      'g',
                      null,
                      h('rect', {
                        x: e.mx - (e.back ? 0 : e.label.length * 3.6 + 4),
                        y: e.my - 9,
                        width: e.label.length * 7.2 + 8,
                        height: 17,
                        rx: 4,
                        fill: 'var(--tb-panel)',
                        stroke: 'var(--tb-border)',
                      }),
                      h(
                        'text',
                        {
                          x: e.mx + (e.back ? 4 : 0),
                          y: e.my + 3.5,
                          textAnchor: e.back ? 'start' : 'middle',
                          fontSize: 10,
                          fill: 'var(--tb-text2)',
                        },
                        e.label,
                      ),
                    )
                  : null,
              ),
            ),
          ),
          scene.items.map((it) => {
            const common = { block: it.block, selected: selected === it.block.id, armed: !!armed, onDown: down, onEnter: enterLevel, onResize: startResize }
            return it.expand
              ? h(Container, { key: it.block.id, ...common, box: it.box })
              : h(
                  'div',
                  {
                    key: it.block.id,
                    className: 'tbx-node',
                    'data-id': it.block.id,
                    style: { left: it.box.x, top: it.box.y, width: it.box.w, height: it.box.h },
                  },
                  h(LeafShape, common),
                )
          }),
        ),
        !scene.items.length
          ? h(
              'div',
              { className: 'tbx-empty' },
              h('div', null, '这一层还是空的。'),
              h('div', null, '用上方「＋矩形 / ＋菱形 / ＋三角 / ＋起止圆」加逻辑块，再用「→ 连线」把它们接起来。'),
              h('div', null, '矩形块可以继续装子块，子块会画在它身体里，并且不会跑出父块（拖动时停在左/上边框）。'),
            )
          : null,
        h(
          'div',
          { style: { position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 6, zIndex: 3 } },
          h('button', { className: 'tbx-btn', onClick: () => setView((v) => ({ ...v, s: Math.min(2, v.s * 1.15) })) }, '＋'),
          h('button', { className: 'tbx-btn', onClick: () => setView((v) => ({ ...v, s: Math.max(0.35, v.s / 1.15) })) }, '－'),
          h('button', { className: 'tbx-btn', onClick: fit }, '适应'),
          h('span', { className: 'tbx-hint', style: { alignSelf: 'center' } }, `${Math.round(view.s * 100)}%`),
        ),
        armed
          ? h(
              'div',
              { style: { position: 'absolute', left: 12, top: 12, background: 'var(--tb-panel)', border: '1px solid var(--tb-border-strong)', borderRadius: 6, padding: '4px 8px', fontSize: 12, zIndex: 3 } },
              '点另一个块完成连线，Esc 取消',
            )
          : null,
      )
    }

    /* ------------------------------------------------------------------ 检查器 */

    function Field({ label, children }) {
      return h('div', { className: 'tbx-field' }, h('label', null, label), children)
    }

    function Inspector({ ir, id, levelId, edit, onDelete, onEnter, onBeginEdit, note }) {
      const b = id ? ir.blocks[id] : null
      const isLevel = !!b && id === levelId
      const [title, setTitle] = useState('')
      const [desc, setDesc] = useState(emptyDesc())
      const [kind, setKind] = useState('r')
      const [done, setDone] = useState(false)

      useEffect(() => {
        if (!b) return
        setTitle(b.title || '')
        setDesc({ ...emptyDesc(), ...(b.desc || {}) })
        setKind(b.kind)
        setDone(!!b.done)
      }, [id])

      if (!b) {
        return h(
          'div',
          { className: 'tbx-side' },
          h('div', { style: { fontWeight: 600, marginBottom: 8 } }, '没有选中块'),
          h('div', { className: 'tbx-hint' }, '在画布上点一个逻辑块，这里就是它的描述块：标题、完成、期望输入/输出、处理描述、工作规范需求。'),
          h('div', { className: 'tbx-hint', style: { marginTop: 10 } }, '提示：拖动块移动位置；双击矩形块进入它的下一层；「→ 连线」先点源块再点目标块。想编辑根块（项目标题那一块）自己的描述块，点工具栏的「✎ 本层描述」。'),
        )
      }

      const commit = (patch, opts) => {
        edit((x) => {
          const t = x.blocks[id]
          if (!t) return
          if (patch.title !== undefined) {
            t.title = patch.title
            if (id === x.rootId) x.title = patch.title
          }
          if (patch.kind !== undefined) t.kind = patch.kind
          if (patch.done !== undefined) t.done = patch.done
          if (patch.desc !== undefined) t.desc = patch.desc
        }, opts)
      }
      // 打字时：先记一个撤销点，之后每次输入都直接写进 ir（历史只记一次）
      const beginTextEdit = () => {
        if (beginTextEdit.done) return
        beginTextEdit.done = true
        onBeginEdit()
      }
      const endTextEdit = () => {
        beginTextEdit.done = false
      }

      const childCount = (b.children || []).length
      const blockedKind = childCount > 0
      const parent = b.parentId ? ir.blocks[b.parentId] : null
      const sib = (id) => (ir.blocks[id] && ir.blocks[id].title) || id
      const incoming = []
      const outgoing = []
      if (parent) {
        const idxOf = new Map()
        for (const [a, z] of parent.flow.edges || []) {
          const i2 = idxOf.get(a) || 0
          idxOf.set(a, i2 + 1)
          const src = ir.blocks[a]
          const lab = src && src.kind === 'd' ? splitOut(src)[i2] || '' : ''
          const tail = lab ? `（${lab}）` : ''
          if (a === b.id) outgoing.push(`${sib(z)}${tail}`)
          else if (z === b.id) incoming.push(`${sib(a)}${tail}`)
        }
      }

      return h(
        'div',
        { className: 'tbx-side' },
        h('div', { className: 'tbx-tags', style: { marginBottom: 8 } },
          h('span', null, `${GLYPH[b.kind]} ${KIND_NAME[b.kind]}`),
          h('span', null, `ID ${b.id}`),
          b.kind === 'c' ? h('span', null, '导出时忽略') : h('span', null, `${childCount} 个子块`),
        ),
        h(Field, { label: '标题' },
          h('input', {
            className: 'tbx-in',
            value: title,
            onFocus: beginTextEdit,
            onChange: (e) => {
              setTitle(e.target.value)
              commit({ title: e.target.value }, { history: false })
            },
            onBlur: () => { endTextEdit(); if (title !== b.title) commit({ title }, { history: false }) },
            onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur() },
          }),
        ),
        h(Field, { label: '类型' },
          h('div', { className: 'tbx-hint', style: { marginTop: 2 } },
            `${GLYPH[kind]} ${KIND_NAME[kind]} —— 类型在新建时确定，之后不能改（删掉重加）。`),
        ),
        h(Field, { label: '完成' },
          h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 } },
            h('input', { type: 'checkbox', checked: done, onChange: (e) => { setDone(e.target.checked); commit({ done: e.target.checked }) } }),
            b.kind === 'c' ? '（起止圆不参与完成位）' : '已实现（D=1，AI 会跳过这一块以及它下面的所有块）',
          ),
        ),
        b.kind === 'c'
          ? h('div', { className: 'tbx-hint', style: { marginTop: 6 } },
              '起止圆只做「入口 / 结束」的视觉标记：接进来的线表示流程从这里开始，接出去的线表示流程在这里结束。它没有期望输入/输出/处理描述/工作规范，导出器会把它从树里去掉。')
          : ['input', 'output', 'process', 'rules'].map((k) =>
              h(Field, { key: k, label: { input: '期望输入', output: '期望输出', process: '处理描述', rules: '工作规范需求' }[k] },
                k === 'output' && b.kind === 'd'
                  ? h('div', null,
                      rawOut(b).map((v, i) =>
                        h('div', { key: i, className: 'tbx-oline' },
                          h('span', { className: 'tbx-idx' }, `${i + 1}`),
                          h('input', {
                            className: 'tbx-in',
                            value: v,
                            onFocus: beginTextEdit,
                            onBlur: endTextEdit,
                            placeholder: `第 ${i + 1} 个出口名（可以留空）`,
                            onChange: (e) => {
                              const arr = rawOut(b).slice()
                              arr[i] = e.target.value
                              const out = arr.join(',')
                              setDesc({ ...desc, output: out })
                              commit({ desc: { ...desc, output: out } }, { history: false })
                            },
                          }),
                          h('button', {
                            className: 'tbx-btn',
                            title: '删掉这个出口',
                            onClick: () => {
                              const arr = rawOut(b).filter((_, j) => j !== i)
                              const out = arr.join(',')
                              setDesc({ ...desc, output: out })
                              commit({ desc: { ...desc, output: out } }, { history: false })
                            },
                          }, '×'),
                        ),
                      ),
                      h('button', {
                        className: 'tbx-btn',
                        onClick: () => {
                          const arr = [...rawOut(b), '']
                          const out = arr.join(',')
                          setDesc({ ...desc, output: out })
                          commit({ desc: { ...desc, output: out } }, { history: false })
                          note('已加一个出口框：先填名字，再给它接一条出边')
                        },
                      }, '＋ 出口'),
                      h('div', { className: 'tbx-hint', style: { marginTop: 4 } }, `第 k 个框 = 第 k 条出边的标签（空框会被忽略，不会写进导出）；现在有 ${splitOut(b).length} 个有效出口，实际出边 ${(parent && (parent.flow.edges || []).filter(([a]) => a === b.id).length) || 0} 条。`),
                    )
                  : h('textarea', {
                      className: 'tbx-ta',
                      rows: k === 'rules' ? 3 : 2,
                      value: desc[k] || '',
                      onFocus: beginTextEdit,
                      onChange: (e) => {
                        const next = { ...desc, [k]: e.target.value }
                        setDesc(next)
                        commit({ desc: next }, { history: false })
                      },
                      onBlur: () => {
                        endTextEdit()
                        const cur = (ir.blocks[id] && ir.blocks[id].desc) || {}
                        if ((desc[k] || '') !== (cur[k] || '')) commit({ desc: { ...desc } }, { history: false })
                      },
                    }),
              ),
            ),
        parent
          ? h(Field, { label: '来向 / 去向' },
              h('div', { className: 'tbx-rel' },
                h('div', null, h('b', null, '来向：'), incoming.length ? incoming.join('、') : '（这一层没有线进来）'),
                h('div', null, h('b', null, '去向：'), outgoing.length ? outgoing.join('、') : '（没有线出去，流程在此结束）'),
              ),
            )
          : null,
        isLevel
          ? h('div', { className: 'tbx-hint', style: { marginBottom: 8 } },
              '这是「本层」的块：它不画在画布上（画布画的是它里面的块）。根块的描述块就是整个项目的描述，会写进根文件夹的 _.tb。它不能删、不能改类型。')
          : null,
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
          b.kind === 'r' && !isLevel ? h('button', { className: 'tbx-btn', onClick: () => onEnter(b.id) }, '进入这一层 ▸') : null,
          isLevel
            ? h('button', { className: 'tbx-btn', onClick: () => onEnter(b.id) }, '进入这一层 ▸')
            : h('button', { className: 'tbx-btn', onClick: () => onDelete(b.id), style: { color: 'var(--tb-err)' } }, '删除这一块'),
        ),
      )
    }

    /* ------------------------------------------------------------------ 导出对话框 */

    const LAST_EXPORT = 'tbx:lastExportDir'

    function ExportDialog({ stateDir, defaultDir, ir, onClose, onDone }) {
      const [dir, setDir] = useState(() => {
        try {
          return window.localStorage.getItem(LAST_EXPORT) || defaultDir || ''
        } catch {
          return defaultDir || ''
        }
      })
      const [list, setList] = useState(null)
      const [parent, setParent] = useState(null)
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')

      const browse = async (p) => {
        setErr('')
        try {
          const r = await api(`/dirs?path=${encodeURIComponent(p || '')}`)
          setList(r.dirs)
          setParent(r.parent)
          if (r.path) setDir(r.path)
        } catch (e) {
          setErr(e.message)
        }
      }
      useEffect(() => {
        browse(dir || defaultDir)
      }, [])

      const go = async () => {
        setBusy(true)
        setErr('')
        try {
          const r = await api('/export', { dir: stateDir, ir, target: dir })
          try {
            window.localStorage.setItem(LAST_EXPORT, dir)
          } catch {}
          onDone(r)
        } catch (e) {
          setErr(e.message)
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { className: 'tbx-veil', onPointerDown: (e) => e.target === e.currentTarget && onClose() },
        h(
          'div',
          { className: 'tbx-dialog' },
          h('div', { className: 'hd' }, h('span', null, '导出到…'), h('button', { className: 'tbx-btn', onClick: onClose }, '×')),
          h(
            'div',
            { className: 'bd' },
            h(Field, { label: `导出地址（会在它下面新建「${ir.title}」项目文件夹，里面有「${ir.title}__TBROOT__」）` },
              h('div', { style: { display: 'flex', gap: 6 } },
                h('input', { className: 'tbx-in', value: dir, onChange: (e) => setDir(e.target.value), onKeyDown: (e) => e.key === 'Enter' && browse(dir) }),
                h('button', { className: 'tbx-btn', onClick: () => browse(dir) }, '打开'),
                parent ? h('button', { className: 'tbx-btn', onClick: () => browse(parent) }, '上一层') : null,
              ),
            ),
            h('div', { className: 'tbx-dirlist' },
              (list || []).map((d) => h('div', { key: d.path, className: 'tbx-dir', onDoubleClick: () => browse(d.path), onClick: () => setDir(d.path) },
                h('span', null, '📁'),
                h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, d.name),
                d.tb ? h('span', { className: 'tbx-badge' }, '含 TB 工程') : null,
              )),
              !list ? h('div', { className: 'tbx-dir', style: { color: 'var(--tb-text3)' } }, '读取中…') : null,
              list && !list.length ? h('div', { className: 'tbx-dir', style: { color: 'var(--tb-text3)' } }, '这个目录下没有子目录') : null,
            ),
            h('div', { className: 'tbx-hint', style: { marginTop: 8 } }, '单击选中目录，双击进入；「打开」跳到输入框里的路径。'),
            err ? h('div', { style: { color: 'var(--tb-err)', whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 } }, err) : null,
          ),
          h(
            'div',
            { className: 'ft' },
            h('button', { className: 'tbx-btn', onClick: onClose }, '取消'),
            h('button', { className: 'tbx-btn tbx-primary', disabled: busy || !dir, onClick: go }, busy ? '导出中…' : '导出到这儿'),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ 目录浏览对话框（选工作区/导出地址） */

    function WorkspaceDialog({ initial, onClose, onPick }) {
      const [dir, setDir] = useState(initial || '')
      const [list, setList] = useState(null)
      const [parent, setParent] = useState(null)
      const [err, setErr] = useState('')

      const browse = async (p) => {
        setErr('')
        try {
          const r = await api(`/dirs?path=${encodeURIComponent(p || '')}`)
          setList(r.dirs)
          setParent(r.parent)
          if (r.path) setDir(r.path)
        } catch (e) {
          setErr(e.message)
        }
      }

      useEffect(() => {
        browse(dir)
      }, [])

      return h(
        'div',
        { className: 'tbx-veil', onPointerDown: (e) => e.target === e.currentTarget && onClose() },
        h(
          'div',
          { className: 'tbx-dialog' },
          h('div', { className: 'hd' }, h('span', null, '选一个目录'), h('button', { className: 'tbx-btn', onClick: onClose }, '×')),
          h(
            'div',
            { className: 'bd' },
            h(Field, { label: '目录（也可以直接改这个输入框）' },
              h('div', { style: { display: 'flex', gap: 6 } },
                h('input', { className: 'tbx-in', value: dir, onChange: (e) => setDir(e.target.value), onKeyDown: (e) => e.key === 'Enter' && browse(dir) }),
                h('button', { className: 'tbx-btn', onClick: () => browse(dir) }, '打开'),
                parent ? h('button', { className: 'tbx-btn', onClick: () => browse(parent) }, '上一层') : null,
              ),
            ),
            h('div', { className: 'tbx-dirlist' },
              (list || []).map((d) => h('div', { key: d.path, className: 'tbx-dir', onDoubleClick: () => browse(d.path), onClick: () => setDir(d.path) },
                h('span', null, '📁'),
                h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, d.name),
                d.tb ? h('span', { className: 'tbx-badge' }, '含 TB 工程') : null,
              )),
              !list ? h('div', { className: 'tbx-dir', style: { color: 'var(--tb-text3)' } }, '读取中…') : null,
              list && !list.length ? h('div', { className: 'tbx-dir', style: { color: 'var(--tb-text3)' } }, '这个目录下没有子目录') : null,
            ),
            h('div', { className: 'tbx-hint', style: { marginTop: 8 } }, '双击进入下一层；点目录名选中；「选定」用输入框里的路径。'),
            err ? h('div', { style: { color: 'var(--tb-err)', whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 } }, err) : null,
          ),
          h(
            'div',
            { className: 'ft' },
            h('button', { className: 'tbx-btn', onClick: onClose }, '取消'),
            h('button', { className: 'tbx-btn tbx-primary', disabled: !dir, onClick: () => onPick(dir) }, '选定'),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ 主面板 */

    function Page(props) {
      const useWorkspaces = props.useWorkspaces
      const wsItems = typeof useWorkspaces === 'function' ? useWorkspaces((s) => s.items) || [] : []
      const [wsDir, setWsDir] = useState(() => {
        try {
          return window.localStorage.getItem('tbx:lastWorkspace') || ''
        } catch {
          return ''
        }
      })
      const [wsDlg, setWsDlg] = useState(false)
      const [projDir, setProjDir] = useState('')
      const [ir, setIr] = useState(null)
      const [levelId, setLevelId] = useState('root')
      const [selected, setSelected] = useState(null)
      const [projects, setProjects] = useState([])
      const [status, setStatus] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [connect, setConnect] = useState(false)
      const [showNext, setShowNext] = useState(true)
      const [dirty, setDirty] = useState(false)
      const [stats, setStats] = useState(null)
      const [check, setCheck] = useState('')
      const [log, setLog] = useState([])
      const [exporting, setExporting] = useState(false)
      const [more, setMore] = useState(false)
      const [savedAt, setSavedAt] = useState(null) // 上次自动保存成功的时间
      const history = useRef([])
      const future = useRef([])
      // 自动保存用的镜像（避免闭包拿到旧的 ir / projDir）
      const irRef = useRef(null)
      const projRef = useRef('')
      const dirtyRef = useRef(false)
      const savingRef = useRef(false)
      const autoTimer = useRef(null)
      const retryRef = useRef(0)
      irRef.current = ir
      projRef.current = projDir
      dirtyRef.current = dirty

      useEffect(() => {
        ensureCss()
      }, [])

      const note = (m) => setStatus(m)
      const fail = (e) => {
        setError(e && e.message ? e.message : String(e))
        setStatus('')
      }

      // 自动保存：编辑后 1.2s 落盘；切工程/关页面/页面隐藏时立刻补存
      const saveNow = async (why) => {
        if (!dirtyRef.current || !irRef.current || !projRef.current) return
        if (savingRef.current) return
        savingRef.current = true
        try {
          const snapshot = irRef.current
          const dir = projRef.current
          const r = await api('/save', { dir, ir: snapshot })
          setDirty(false)
          retryRef.current = 0
          setSavedAt(new Date())
          setStats(r.stats || null)
          note(why === 'auto' ? '已自动保存' : '已保存')
        } catch (e) {
          retryRef.current += 1
          note(`自动保存失败：${e && e.message ? e.message : e}（内容还在页面里，可点保存重试）`)
        } finally {
          savingRef.current = false
          // 保存失败或保存期间又有改动：再排一次；连续失败 3 次就停下，避免刷屏
          if (dirtyRef.current) {
            if (retryRef.current > 0 && retryRef.current >= 3) {
              note('自动保存连续失败 3 次，内容还在页面里，请点「保存」手动重试')
            } else {
              scheduleAuto()
            }
          }
        }
      }

      const scheduleAuto = () => {
        if (autoTimer.current) clearTimeout(autoTimer.current)
        autoTimer.current = setTimeout(() => {
          autoTimer.current = null
          saveNow('auto')
        }, 1200)
      }

      useEffect(() => {
        if (dirty && ir) scheduleAuto()
        return () => {
          if (autoTimer.current) clearTimeout(autoTimer.current)
        }
      }, [ir, dirty])

      useEffect(() => {
        const onHide = () => {
          if (document.visibilityState === 'hidden') saveNow('auto')
        }
        const onPageHide = () => saveNow('auto')
        document.addEventListener('visibilitychange', onHide)
        window.addEventListener('pagehide', onPageHide)
        return () => {
          document.removeEventListener('visibilitychange', onHide)
          window.removeEventListener('pagehide', onPageHide)
        }
      }, [])

      const scan = useCallback(async (dir) => {
        if (!dir) return
        try {
          const r = await api(`/projects?dir=${encodeURIComponent(dir)}`)
          setProjects(r.projects || [])
          setError('')
          try {
            window.localStorage.setItem('tbx:lastWorkspace', dir)
          } catch {}
        } catch (e) {
          fail(e)
        }
      }, [])

      useEffect(() => {
        if (!wsDir && wsItems.length) setWsDir(wsItems[0].path || '')
      }, [wsItems, wsDir])

      useEffect(() => {
        scan(wsDir)
      }, [wsDir, scan])

      const push = (before) => {
        history.current.push(before || clone(ir))
        if (history.current.length > 80) history.current.shift()
        future.current = []
      }

      const edit = (fn, opts) => {
        if (!ir) return
        if (!opts || opts.history !== false) push(clone(ir))
        const next = clone(ir)
        fn(next)
        setIr(next)
        setDirty(true)
        setStats(null)
      }

      const onMutated = (before) => {
        push(before)
        setIr(clone(ir))
        setDirty(true)
        setStats(null)
      }

      const undo = () => {
        const prev = history.current.pop()
        if (!prev) return note('没有可撤销的操作')
        future.current.push(clone(ir))
        setIr(prev)
        setDirty(true)
        note('已撤销')
      }
      const redo = () => {
        const next = future.current.pop()
        if (!next) return note('没有可重做的操作')
        history.current.push(clone(ir))
        setIr(next)
        setDirty(true)
        note('已重做')
      }

      const openProject = async (p) => {
        await saveNow('auto') // 切工程前先把当前改动落盘
        setBusy(true)
        setError('')
        try {
          const r = await api('/load', { dir: p })
          setIr(r.ir)
          setProjDir(p)
          setLevelId(r.ir.rootId)
          setSelected(null)
          setDirty(false)
          setStats(r.stats)
          setCheck('')
          setLog([`打开 ${p}（来源 ${r.source === 'json' ? '编辑器状态' : '导出树'}，${r.stats.blocks} 块）`])
          note('已打开')
        } catch (e) {
          fail(e)
        } finally {
          setBusy(false)
        }
      }

      const newProject = async () => {
        await saveNow('auto')
        const title = window.prompt('新项目名（= 根逻辑块标题，也是导出的文件夹名）', '新项目')
        if (!title) return
        const next = makeIr(title.trim())
        setIr(next)
        setProjDir(`${wsDir}/${title.trim()}`)
        setLevelId(next.rootId)
        setSelected(null)
        setDirty(true)
        setStats(null)
        setCheck('')
        note('新项目已建立，记得保存或直接导出')
      }

      const save = async () => {
        if (!ir) return
        setBusy(true)
        setError('')
        dirtyRef.current = true
        try {
          await saveNow('manual')
          setLog((l) => [...l, `手动保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`])
        } finally {
          setBusy(false)
        }
      }

      const runCheck = async () => {
        if (!ir) return
        try {
          const r = await api('/check', { ir })
          setCheck(r.text)
          setStats(r.stats)
          note(r.text === 'ok' ? '校验通过' : '有需要看的提示')
        } catch (e) {
          fail(e)
        }
      }

      const addBlock = (kind) => {
        if (!ir) return
        let parentId = levelId
        if (selected && ir.blocks[selected]) {
          const s = ir.blocks[selected]
          if (s.kind === 'r') parentId = s.id
        }
        const p = ir.blocks[parentId]
        if (!p) return
        if (p.kind !== 'r') {
          note('菱形/三角不能包含子块，先选一个矩形')
          return
        }
        const id = uid()
        edit((x) => {
          const pp = x.blocks[parentId]
          const n = pp.children.length
          const circleNames = pp.children.filter((c) => x.blocks[c] && x.blocks[c].kind === 'c').map((c) => x.blocks[c].title)
          const starts = circleNames.filter((t) => t.startsWith('开始')).length
          const ends = circleNames.filter((t) => t.startsWith('结束')).length
          x.blocks[id] = {
            id,
            kind,
            title:
              kind === 'c'
                ? starts <= ends
                  ? starts
                    ? `开始${starts + 1}`
                    : '开始'
                  : ends
                    ? `结束${ends + 1}`
                    : '结束'
                : `逻辑组块${n + 1}`,
            parentId,
            done: false,
            desc: emptyDesc(),
            children: [],
            flow: { edges: [] },
            layout: { x: 0, y: 0 },
          }
          pp.children = [...pp.children, id]
          x.blocks[id].layout = freeSpot(x, parentId, kind)
        })
        setSelected(id)
        note(kind === 'c' ? '已加一个起止圆：只当入口/出口标记，导出时忽略' : `已加一个${KIND_NAME[kind]}`)
      }

      const del = (id) => {
        if (!ir) return
        const b = ir.blocks[id]
        if (!b) return
        if (id === ir.rootId) return note('根块不能删')
        if (id === levelId) return note('本层的块不能删：先回到上一层')
        const gone = new Set()
        const walk = (x) => {
          gone.add(x)
          for (const c of ir.blocks[x].children || []) walk(c)
        }
        walk(id)
        edit((x) => {
          delete x.blocks[id]
          for (const b2 of Object.values(x.blocks)) {
            b2.children = (b2.children || []).filter((c) => c !== id)
            b2.flow.edges = (b2.flow.edges || []).filter(([a, z]) => a !== id && z !== id)
          }
          void gone
        })
        if (selected === id) setSelected(null)
        if (!ir.blocks[levelId]) setLevelId(ir.rootId)
        note('已删除')
      }

      useEffect(() => {
        const onKey = (e) => {
          if (!ir) return
          const tag = e.target && e.target.tagName
          const typing = tag && /INPUT|TEXTAREA|SELECT/.test(tag)
          if (e.key === 'Escape') {
            if (more) return setMore(false)
            if (exporting) return setExporting(false)
            if (connect) return setConnect(false)
            const cur = ir.blocks[levelId]
            if (cur && cur.parentId) return setLevelId(cur.parentId)
            return setSelected(null)
          }
          if (typing) return
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault()
            if (e.shiftKey) redo()
            else undo()
          } else if ((e.key === 'Delete') && selected) {
            e.preventDefault()
            del(selected)
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      })

      /* ------------- 选择页 ------------- */

      if (!ir) {
        return h(
          'div',
          { className: 'tbx-root' },
          h('div', { className: 'tbx-bar' },
            h('strong', null, 'ThinkBuilder'),
            h('span', { className: 'tbx-hint' }, '画逻辑块 → 导出 AI 能直接读的项目文件夹'),
            h('div', { style: { flex: 1 } }),
            h('button', { className: 'tbx-btn tbx-primary', onClick: newProject }, '新建项目'),
          ),
          h(
            'div',
            { style: { padding: 14, overflow: 'auto', flex: 1 } },
            h(Field, { label: '工作区根目录（工程列表从这里往下找，可以填任意路径）' },
              h('div', { style: { display: 'flex', gap: 6 } },
                h('input', {
                  className: 'tbx-in',
                  value: wsDir,
                  placeholder: 'D:\\项目 或 C:\\Users\\你\\work',
                  onChange: (e) => setWsDir(e.target.value),
                  onKeyDown: (e) => e.key === 'Enter' && scan(wsDir),
                }),
                h('button', { className: 'tbx-btn', onClick: () => setWsDlg(true) }, '浏览…'),
                h('button', { className: 'tbx-btn', onClick: () => scan(wsDir) }, '刷新'),
              ),
            ),
            h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' } },
              h('span', { className: 'tbx-hint' }, `找到 ${projects.length} 个工程`),
            ),
            h('div', { style: { display: 'grid', gap: 8 } },
              projects.map((p) => h('div', { key: p.dir, className: 'tbx-card', onClick: () => openProject(p.dir) },
                h('div', { style: { fontWeight: 600, marginBottom: 4 } }, p.title),
                h('div', { className: 'tbx-hint' }, p.dir),
                h('div', { className: 'tbx-tags', style: { marginTop: 4 } },
                  h('span', null, p.state ? '有编辑器状态' : '只有导出树'),
                ),
              )),
              !projects.length ? h('div', { className: 'tbx-hint' }, '这个工作区里还没有 ThinkBuilder 工程。点右上角「新建项目」开始。') : null,
            ),
            error ? h('div', { style: { color: 'var(--tb-err)', marginTop: 10, whiteSpace: 'pre-wrap' } }, error) : null,
          ),
          wsDlg
            ? h(WorkspaceDialog, {
                initial: wsDir,
                onClose: () => setWsDlg(false),
                onPick: (p) => {
                  setWsDlg(false)
                  setWsDir(p)
                  scan(p)
                },
              })
            : null,
        )
      }

      /* ------------- 编辑页 ------------- */

      const parentOfLevel = ir.blocks[levelId] ? ir.blocks[levelId].parentId : null
      const canGoUp = !!parentOfLevel
      const crumbs = chain(ir, levelId)

      return h(
        'div',
        { className: 'tbx-root' },
        h('div', { className: 'tbx-bar' },
          // 左：层级导航
          h('div', { className: 'tbx-tbgrp' },
            h('button', { className: 'tbx-btn', disabled: !canGoUp, onClick: () => setLevelId(parentOfLevel), title: '上一层（Esc）' }, '←'),
            h('div', { className: 'tbx-crumb' },
              crumbs.map((b, i) =>
                h('span', { key: b.id, style: { display: 'flex', alignItems: 'center', gap: 4 } },
                  i ? h('span', { style: { color: 'var(--tb-text3)' } }, '/') : null,
                  h('button', {
                    onClick: () => {
                      if (i === crumbs.length - 1) setSelected(b.id)
                      else setLevelId(b.id)
                    },
                    title: i === crumbs.length - 1 ? '点一下编辑本层块（根块/父块）的描述块' : '回到这一层',
                  }, b.title || '未命名'),
                ),
              ),
            ),
            h('button', {
              className: 'tbx-btn',
              'aria-pressed': selected === levelId,
              onClick: () => setSelected(levelId === selected ? null : levelId),
              title: '编辑本层块自己的描述块（I/O/P/R）：根块就是项目标题那一块',
            }, '✎ 本层描述'),
          ),
          h('div', { className: 'tbx-sep' }),
          // 中：加块（选中矩形时矩形会加进它里面）
          h('div', { className: 'tbx-tbgrp' },
            h('button', { className: 'tbx-btn', onClick: () => addBlock('r'), title: '矩形逻辑组块：能包含下一层；选中一个矩形时加进它里面' }, '▭ 矩形'),
            h('button', { className: 'tbx-btn', onClick: () => addBlock('d'), title: '菱形条件判断块：出口数 = 期望输出项数' }, '◇ 菱形'),
            h('button', { className: 'tbx-btn', onClick: () => addBlock('t'), title: '三角形处理块：尖头朝下代表输出' }, '▽ 三角'),
            h('button', { className: 'tbx-btn', onClick: () => addBlock('c'), title: '起止圆：只做入口/结束标记，导出时忽略' }, '○ 圆'),
          ),
          h('div', { className: 'tbx-sep' }),
          h('div', { className: 'tbx-tbgrp' },
            h('button', { className: 'tbx-btn', 'aria-pressed': connect, onClick: () => setConnect((v) => !v), title: '连线：点起点再点终点' }, '→ 连线'),
            h('button', { className: 'tbx-btn', 'aria-pressed': showNext, onClick: () => setShowNext((v) => !v), title: '显示/隐藏下一层子块' }, '子层'),
          ),
          h('div', { style: { flex: 1 } }),
          // 右：历史 + 更多 + 落盘
          h('div', { className: 'tbx-tbgrp' },
            h('button', { className: 'tbx-btn', onClick: undo, title: '撤销 Ctrl+Z' }, '↶'),
            h('button', { className: 'tbx-btn', onClick: redo, title: '重做 Ctrl+Shift+Z' }, '↷'),
            h('div', { style: { position: 'relative' } },
              h('button', { className: 'tbx-btn', 'aria-pressed': more, onClick: () => setMore((v) => !v), title: '更多' }, '⋯'),
              more
                ? [
                    h('div', { key: 'mask', className: 'tbx-popmask', onPointerDown: () => setMore(false) }),
                    h('div', { key: 'menu', className: 'tbx-menu' },
                      h('button', { onClick: () => { setMore(false); runCheck() } }, '校验整张图'),
                      h('button', { onClick: async () => { setMore(false); await saveNow('auto'); setIr(null); setSelected(null); setDirty(false); setMore(false) } }, '关闭工程'),
                    ),
                  ]
                : null,
            ),
          ),
          h('button', { className: 'tbx-btn', disabled: busy || !projDir, onClick: save, title: '保存到 .thinkbuilder/project.json' }, '保存'),
          h('button', { className: 'tbx-btn tbx-primary', disabled: busy || !projDir, onClick: () => setExporting(true) }, '导出…'),
        ),
        h('div', { className: 'tbx-main' },
          h(Canvas, {
            ir,
            levelId,
            showNext,
            selected,
            setSelected,
            enterLevel: (id) => {
              const b = ir.blocks[id]
              if (b && b.kind === 'r') setLevelId(id)
              else note('只有矩形逻辑组块能包下一层')
            },
            edit,
            onMutated,
            note,
            connect,
            setConnect,
          }),
          h(Inspector, { ir, id: selected, levelId, edit, onDelete: del, onEnter: (id) => setLevelId(id), onBeginEdit: () => push(clone(ir)), note }),
        ),
        h('div', { className: 'tbx-status' },
          h('span', { style: { color: error ? 'var(--tb-err)' : dirty ? 'var(--tb-warn)' : 'var(--tb-ok)' } },
            error
              ? error
              : dirty
                ? '● 有改动，1.2 秒后自动保存…'
                : savedAt
                  ? `✓ 已保存 ${savedAt.toLocaleTimeString('zh-CN', { hour12: false })}`
                  : status || '就绪'),
          stats ? h('span', null, `块 ${stats.blocks} · boot ${stats.bootTokens} tok（读法 ${stats.legendTokens}）· ${stats.bytes} B`) : null,
          check ? h('span', { style: { color: check === 'ok' ? 'var(--tb-ok)' : 'var(--tb-warn)', whiteSpace: 'pre-wrap' } }, check) : null,
          log.slice(-2).map((l, i) => h('span', { key: i }, l)),
        ),
        exporting
          ? h(ExportDialog, {
              stateDir: projDir,
              defaultDir: wsDir,
              ir,
              onClose: () => setExporting(false),
              onDone: (r) => {
                setExporting(false)
                setDirty(false)
                setStats(r.stats)
                setLog((l) => [...l, `导出 ${r.files} 个文件 → ${r.projectDir}`])
                if (r.errors) note(`导出完成，但有 ${r.errors} 个结构错误（点「校验」看详情）`)
                else if (r.warnings) note(`导出完成（${r.warnings} 条告警，不影响使用）`)
                else note('导出完成')
              },
            })
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Page))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => 'ThinkBuilder' }, SidebarIcon),
        )
      },
    }
  },
})
