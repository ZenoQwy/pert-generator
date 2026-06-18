/**
 * pert-render.js
 * Construit le SVG du réseau PERT à partir du résultat de PertEngine.computePert().
 * direction : 'LR' (gauche→droite, défaut) ou 'TB' (haut→bas)
 */

const PertRender = (() => {

  const NODE_W  = 172;
  const NODE_H  = 108;
  const COL_GAP = 96;   // écart entre niveaux (axe principal)
  const ROW_GAP = 28;   // écart entre nœuds du même niveau (axe secondaire)
  const PAD     = 56;

  function render(svgEl, result, direction) {
    direction = direction || 'LR';
    const TB  = direction === 'TB';
    const byId = new Map(result.tasks.map(t => [t.id, t]));

    // 1. Colonnes par niveau
    const columns = new Map();
    for (const t of result.tasks) {
      if (!columns.has(t.level)) columns.set(t.level, []);
      columns.get(t.level).push(t);
    }
    const levels = [...columns.keys()].sort((a, b) => a - b);

    // 2. Nœuds virtuels : pour chaque arête sautant N>1 niveaux,
    //    on insère N-1 fantômes afin que le layout réserve un couloir libre.
    const longEdgeVIds = new Map(); // "from→to" → [vId, ...]
    for (const e of result.edges) {
      const fromLvl = byId.get(e.from).level;
      const toLvl   = byId.get(e.to).level;
      if (toLvl - fromLvl <= 1) continue;
      const vIds = [];
      let prevId = e.from;
      for (let lvl = fromLvl + 1; lvl < toLvl; lvl++) {
        const vId    = `__v_${e.from}_${e.to}_${lvl}`;
        const nextId = lvl === toLvl - 1 ? e.to : `__v_${e.from}_${e.to}_${lvl + 1}`;
        const vTask  = { id: vId, level: lvl, _virtual: true,
                         predecessors: [prevId], successors: [nextId] };
        vIds.push(vId);
        prevId = vId;
        byId.set(vId, vTask);
        if (!columns.has(lvl)) columns.set(lvl, []);
        columns.get(lvl).push(vTask);
      }
      longEdgeVIds.set(`${e.from}→${e.to}`, vIds);
    }

    // 3. Multi-pass barycenter (5 passes) sur le graphe augmenté
    const ranks = new Map();
    for (const lvl of levels) {
      const nodes = columns.get(lvl).slice();
      nodes.sort((a, b) => baryPred(a, ranks) - baryPred(b, ranks));
      columns.set(lvl, nodes);
      nodes.forEach((t, i) => ranks.set(t.id, i));
    }
    for (let c = 0; c < 2; c++) {
      for (const lvl of [...levels].reverse()) {
        const nodes = columns.get(lvl).slice();
        nodes.sort((a, b) => barySucc(a, ranks) - barySucc(b, ranks));
        columns.set(lvl, nodes);
        nodes.forEach((t, i) => ranks.set(t.id, i));
      }
      for (const lvl of levels) {
        const nodes = columns.get(lvl).slice();
        nodes.sort((a, b) => baryPred(a, ranks) - baryPred(b, ranks));
        columns.set(lvl, nodes);
        nodes.forEach((t, i) => ranks.set(t.id, i));
      }
    }

    // 4. Positions finales (réels + virtuels)
    const maxSlots = Math.max(...levels.map(l => columns.get(l).length));
    const positions = new Map();
    for (const lvl of levels) {
      const nodes  = columns.get(lvl);
      const offset = Math.floor((maxSlots - nodes.length) / 2);
      nodes.forEach((t, i) => {
        const slot  = nodes.length === maxSlots ? i : offset + i;
        const main  = PAD + lvl  * (TB ? (NODE_H + COL_GAP) : (NODE_W + COL_GAP));
        const cross = PAD + slot * (TB ? (NODE_W + ROW_GAP) : (NODE_H + ROW_GAP));
        const x = TB ? cross : main;
        const y = TB ? main  : cross;
        positions.set(t.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2, row: slot });
      });
    }

    compactRows(positions, TB);

    // 5. Dimensions du SVG
    const usedSlots = Math.max(...[...positions.values()].map(p => p.row)) + 1;
    const totalW = TB
      ? PAD * 2 + usedSlots  * NODE_W + (usedSlots  - 1) * ROW_GAP
      : PAD * 2 + levels.length * NODE_W + (levels.length - 1) * COL_GAP;
    const totalH = TB
      ? PAD * 2 + levels.length * NODE_H + (levels.length - 1) * COL_GAP
      : PAD * 2 + usedSlots  * NODE_H + (usedSlots  - 1) * ROW_GAP;

    svgEl.setAttribute("viewBox",     `0 0 ${totalW} ${totalH}`);
    svgEl.setAttribute("width",       totalW);
    svgEl.setAttribute("height",      totalH);
    svgEl.setAttribute("data-base-w", totalW);
    svgEl.setAttribute("data-base-h", totalH);
    svgEl.innerHTML = "";

    svgEl.appendChild(buildDefs());

    const getEdgePath = (e) => {
      const a   = positions.get(e.from), b = positions.get(e.to);
      const vIds = longEdgeVIds.get(`${e.from}→${e.to}`) || [];
      return vIds.length ? edgePathMulti(a, b, vIds, positions, TB) : edgePath(a, b, TB);
    };

    // 6a. Arêtes non-critiques
    const normalLayer = svgEl1("g", { class: "edges-normal" });
    for (const e of result.edges.filter(e => !e.critical))
      normalLayer.appendChild(buildEdgePath(getEdgePath(e), false, e.from, e.to));
    svgEl.appendChild(normalLayer);

    // 6b. Halos + arêtes critiques
    const haloLayer = svgEl1("g", { class: "edge-halos" });
    const critLayer  = svgEl1("g", { class: "edges-critical" });
    for (const e of result.edges.filter(e => e.critical)) {
      const d = getEdgePath(e);
      haloLayer.appendChild(buildEdgeHaloPath(d, e.from, e.to));
      critLayer.appendChild(buildEdgePath(d, true, e.from, e.to));
    }
    svgEl.appendChild(haloLayer);
    svgEl.appendChild(critLayer);

    // 7. Nœuds réels uniquement
    const nodeLayer = svgEl1("g", { class: "nodes" });
    for (const t of result.tasks)
      nodeLayer.appendChild(buildNode(t, positions.get(t.id)));
    svgEl.appendChild(nodeLayer);

    return { width: totalW, height: totalH };
  }

  // Referme les rangées/colonnes secondaires vides
  function compactRows(positions, TB) {
    const allSlots = [...positions.values()].map(p => p.row);
    const maxSlot  = Math.max(...allSlots);
    const used     = new Set(allSlots);
    const empty    = [];
    for (let r = 0; r <= maxSlot; r++) if (!used.has(r)) empty.push(r);
    if (empty.length === 0) return;

    for (const pos of positions.values()) {
      const shift = empty.filter(r => r < pos.row).length;
      if (shift > 0) {
        pos.row -= shift;
        if (TB) {
          pos.x  = PAD + pos.row * (NODE_W + ROW_GAP);
          pos.cx = pos.x + NODE_W / 2;
        } else {
          pos.y  = PAD + pos.row * (NODE_H + ROW_GAP);
          pos.cy = pos.y + NODE_H / 2;
        }
      }
    }
  }

  function baryPred(task, ranks) {
    const preds = task.predecessors.filter(p => ranks.has(p));
    if (!preds.length) return 0;
    return preds.reduce((s, p) => s + ranks.get(p), 0) / preds.length;
  }
  function barySucc(task, ranks) {
    const succs = task.successors.filter(s => ranks.has(s));
    if (!succs.length) return Infinity;
    return succs.reduce((s, p) => s + ranks.get(p), 0) / succs.length;
  }

  function buildDefs() {
    const defs = svgEl1("defs");
    // orient="auto" suffit : la flèche tourne avec la direction du chemin (LR ou TB)
    defs.innerHTML = `
      <filter id="node-shadow" x="-8%" y="-8%" width="116%" height="130%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#00000014"/>
      </filter>
      <marker id="arr-crit" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto">
        <path d="M2 1.5L8 5L2 8.5" fill="none" stroke="#b83229"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>
      <marker id="arr-norm" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto">
        <path d="M2 1.5L8 5L2 8.5" fill="none" stroke="#1f56a3"
              stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>`;
    return defs;
  }

  // Chemin court (niveaux adjacents) — courbe S
  function edgePath(a, b, TB) {
    if (TB) {
      const x1 = a.cx, y1 = a.y + NODE_H;
      const x2 = b.cx, y2 = b.y;
      const midY = (y1 + y2) / 2;
      return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    } else {
      const x1 = a.x + NODE_W, y1 = a.cy;
      const x2 = b.x,          y2 = b.cy;
      const midX = (x1 + x2) / 2;
      return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
    }
  }

  // Chemin multi-segments via nœuds virtuels pour arêtes longues
  function edgePathMulti(a, b, vIds, positions, TB) {
    const pts = TB
      ? [
          { x: a.cx,         y: a.y + NODE_H },
          ...vIds.map(vid => { const p = positions.get(vid); return { x: p.cx, y: p.cy }; }),
          { x: b.cx,         y: b.y          }
        ]
      : [
          { x: a.x + NODE_W, y: a.cy         },
          ...vIds.map(vid => { const p = positions.get(vid); return { x: p.cx, y: p.cy }; }),
          { x: b.x,          y: b.cy         }
        ];
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      if (TB) {
        const mid = (p0.y + p1.y) / 2;
        d += ` C${p0.x},${mid} ${p1.x},${mid} ${p1.x},${p1.y}`;
      } else {
        const mid = (p0.x + p1.x) / 2;
        d += ` C${mid},${p0.y} ${mid},${p1.y} ${p1.x},${p1.y}`;
      }
    }
    return d;
  }

  function buildEdgeHaloPath(d, from, to) {
    return svgEl1("path", {
      d, stroke: "#ffffff", fill: "none",
      "stroke-width": "7", "stroke-linecap": "round",
      "data-from": from, "data-to": to
    });
  }

  function buildEdgePath(d, critical, from, to) {
    return svgEl1("path", {
      d,
      class: critical ? "edge-critical" : "edge-normal",
      "stroke-width": critical ? "2.2" : "1.5",
      "marker-end":   critical ? "url(#arr-crit)" : "url(#arr-norm)",
      "data-from": from, "data-to": to
    });
  }

  function buildNode(task, pos) {
    const isJalon = task.duration === 0;
    const theme   = isJalon ? "jalon" : (task.critical ? "critical" : "normal");

    const colors = {
      critical: { fill: "#fdf0ef", stroke: "#b83229", text: "#7a2018", num: "#b83229" },
      normal:   { fill: "#edf3fc", stroke: "#1f56a3", text: "#153b72", num: "#1f56a3" },
      jalon:    { fill: "#f3f1ec", stroke: "#5e5749", text: "#3d362b", num: "#5e5749" }
    };
    const c = colors[theme];

    const g    = svgEl1("g", { class: "node-group", "data-id": task.id });
    const rowH = NODE_H / 3;

    g.appendChild(svgEl1("rect", {
      x: pos.x, y: pos.y, width: NODE_W, height: NODE_H, rx: 8,
      fill: c.fill, stroke: c.stroke,
      "stroke-width": task.critical && !isJalon ? "2" : "1.5",
      filter: "url(#node-shadow)"
    }));

    g.appendChild(hline(pos.x, pos.x + NODE_W, pos.y + rowH,     c.stroke));
    g.appendChild(hline(pos.x, pos.x + NODE_W, pos.y + rowH * 2, c.stroke));
    g.appendChild(vline(pos.x + NODE_W / 2, pos.y,            pos.y + rowH,    c.stroke));
    g.appendChild(vline(pos.x + NODE_W / 2, pos.y + rowH * 2, pos.y + NODE_H,  c.stroke));

    g.appendChild(svgText(pos.x + NODE_W * 0.25, pos.y + rowH * 0.5, task.es, c.num, 14, "bold", "node-label-val"));
    g.appendChild(svgText(pos.x + NODE_W * 0.75, pos.y + rowH * 0.5, task.ef, c.num, 14, "bold", "node-label-val"));

    const hasName = task.name && task.name !== task.id;
    const durPart = isJalon ? "" : ` (${task.duration}j)`;
    const midCy   = pos.y + rowH * 1.5;
    if (hasName) {
      const nameLines = wrapText(task.name, 23); // max 2 lignes de 23 chars
      const LINE_H = rowH * 0.30; // espacement entre lignes (~10.8px)
      const totalLines = 1 + nameLines.length;
      const startY = midCy - ((totalLines - 1) * LINE_H) / 2;
      g.appendChild(svgText(pos.x + NODE_W / 2, startY, `${task.id}${durPart}`, c.text, 10, "700", "node-label-id"));
      nameLines.forEach((line, i) =>
        g.appendChild(svgText(pos.x + NODE_W / 2, startY + (i + 1) * LINE_H, line, c.text, 9.5, "500", "node-label-id"))
      );
    } else {
      g.appendChild(svgText(pos.x + NODE_W / 2, midCy, `${task.id}${durPart}`, c.text, 10.5, "600", "node-label-id"));
    }

    g.appendChild(svgText(pos.x + NODE_W * 0.25, pos.y + rowH * 2.5, task.ls, c.num, 14, "bold", "node-label-val"));
    g.appendChild(svgText(pos.x + NODE_W * 0.75, pos.y + rowH * 2.5, task.lf, c.num, 14, "bold", "node-label-val"));

    if (task.freeFloat > 0) {
      const bx = pos.x + NODE_W - 1, by = pos.y + 1;
      const badge = svgEl1("g");
      badge.appendChild(svgEl1("rect", {
        x: bx - 22, y: by, width: 22, height: 14,
        rx: 4, fill: "#1f56a3", opacity: "0.85"
      }));
      const bt = svgEl1("text", {
        x: bx - 11, y: by + 7, "text-anchor": "middle",
        "dominant-baseline": "central", fill: "#fff",
        "font-size": 8, "font-weight": "700",
        "font-family": "JetBrains Mono, monospace"
      });
      bt.textContent = `+${task.freeFloat}`;
      badge.appendChild(bt);
      g.appendChild(badge);
    }

    const title = svgEl1("title");
    title.textContent = `${task.id} — ${task.name}\nDurée: ${task.duration}j  |  ES:${task.es}  EF:${task.ef}  LS:${task.ls}  LF:${task.lf}  Marge:${task.slack}${task.critical ? " (critique)" : ""}`;
    g.appendChild(title);

    return g;
  }

  function hline(x1, x2, y, stroke) {
    return svgEl1("line", { x1, x2, y1: y, y2: y, stroke, opacity: "0.3", "stroke-width": 1 });
  }
  function vline(x, y1, y2, stroke) {
    return svgEl1("line", { x1: x, x2: x, y1, y2, stroke, opacity: "0.25", "stroke-width": 1 });
  }
  function svgText(x, y, content, fill, size, weight, cls) {
    const t = svgEl1("text", {
      x, y, "text-anchor": "middle", "dominant-baseline": "central",
      fill, "font-size": size, "font-weight": weight, class: cls
    });
    t.textContent = content;
    return t;
  }
  function wrapText(str, maxChars) {
    if (str.length <= maxChars) return [str];
    const words = str.split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      const candidate = cur ? cur + " " + w : w;
      if (candidate.length <= maxChars) {
        cur = candidate;
      } else {
        lines.push(cur || truncate(w, maxChars));
        if (lines.length >= 2) break; // max 2 lignes de nom
        cur = w.length > maxChars ? truncate(w, maxChars) : w;
      }
    }
    if (cur && lines.length < 2) lines.push(cur);
    return lines;
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  }
  function svgEl1(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  return { render };
})();
