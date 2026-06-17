/**
 * pert-render.js
 * Construit le SVG du réseau PERT à partir du résultat de PertEngine.computePert().
 * Layout : grille à colonnes (niveau topologique) x rangées communes -> alignement
 * vertical strict des tâches de même niveau, quel que soit leur nombre dans les
 * colonnes voisines.
 */

const PertRender = (() => {

  const NODE_W = 140;
  const NODE_H = 64;     // 3 compartiments égaux
  const COL_GAP = 100;
  const ROW_GAP = 30;
  const PAD = 50;

  function render(svgEl, result) {
    const byId = new Map(result.tasks.map(t => [t.id, t]));

    // ----- 1. Regrouper par colonne (level) -----
    const columns = new Map();
    for (const t of result.tasks) {
      if (!columns.has(t.level)) columns.set(t.level, []);
      columns.get(t.level).push(t);
    }
    const levels = [...columns.keys()].sort((a, b) => a - b);
    const maxRows = Math.max(...levels.map(l => columns.get(l).length));

    // ----- 2. Assigner une rangée à chaque tâche (grille commune) -----
    const positions = new Map(); // id -> { x, y, cx, cy, row }

    for (const lvl of levels) {
      let nodes = columns.get(lvl).slice();
      nodes.sort((a, b) => barycenter(a, positions) - barycenter(b, positions));
      columns.set(lvl, nodes);

      const offset = Math.floor((maxRows - nodes.length) / 2);
      const x = PAD + lvl * (NODE_W + COL_GAP);

      nodes.forEach((t, i) => {
        const row = nodes.length === maxRows ? i : offset + i;
        const y = PAD + row * (NODE_H + ROW_GAP);
        positions.set(t.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2, row });
      });
    }

    compactRows(positions);

    const usedRows = Math.max(...[...positions.values()].map(p => p.row)) + 1;
    const totalW = PAD * 2 + levels.length * NODE_W + (levels.length - 1) * COL_GAP;
    const totalH = PAD * 2 + usedRows * NODE_H + (usedRows - 1) * ROW_GAP;

    svgEl.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);
    svgEl.setAttribute("width", totalW);
    svgEl.setAttribute("height", totalH);
    svgEl.setAttribute("data-base-w", totalW);
    svgEl.setAttribute("data-base-h", totalH);
    svgEl.innerHTML = "";

    svgEl.appendChild(buildDefs());

    const edgeLayer = svgEl1("g", { class: "edges" });
    for (const e of result.edges) {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      edgeLayer.appendChild(buildEdge(a, b, e.critical));
    }
    svgEl.appendChild(edgeLayer);

    const nodeLayer = svgEl1("g", { class: "nodes" });
    for (const t of result.tasks) {
      nodeLayer.appendChild(buildNode(t, positions.get(t.id)));
    }
    svgEl.appendChild(nodeLayer);

    return { width: totalW, height: totalH };
  }

  // Si une rangée entière (sur toutes les colonnes) est vide, referme l'espace.
  function compactRows(positions) {
    const allRows = [...positions.values()].map(p => p.row);
    const maxRow = Math.max(...allRows);
    const used = new Set(allRows);
    const emptyRows = [];
    for (let r = 0; r <= maxRow; r++) if (!used.has(r)) emptyRows.push(r);
    if (emptyRows.length === 0) return;

    for (const pos of positions.values()) {
      const shift = emptyRows.filter(r => r < pos.row).length;
      if (shift > 0) {
        pos.row -= shift;
        pos.y = PAD + pos.row * (NODE_H + ROW_GAP);
        pos.cy = pos.y + NODE_H / 2;
      }
    }
  }

  function barycenter(task, positions) {
    if (task.predecessors.length === 0) return 0;
    const rows = task.predecessors
      .map(p => positions.get(p))
      .filter(Boolean)
      .map(p => p.row);
    if (rows.length === 0) return 0;
    return rows.reduce((a, b) => a + b, 0) / rows.length;
  }

  function buildDefs() {
    const defs = svgEl1("defs");
    defs.innerHTML = `
      <marker id="pert-arrow-crit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M2 1L8 5L2 9" fill="none" stroke="#b3402c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>
      <marker id="pert-arrow-norm" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M2 1L8 5L2 9" fill="none" stroke="#2f5d8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </marker>`;
    return defs;
  }

  function buildEdge(a, b, critical) {
    const x1 = a.x + NODE_W;
    const y1 = a.cy;
    const x2 = b.x;
    const y2 = b.cy;
    const midX = (x1 + x2) / 2;

    return svgEl1("path", {
      d: `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`,
      class: critical ? "edge-critical" : "edge-normal",
      "stroke-width": critical ? "2" : "1.4",
      "marker-end": critical ? "url(#pert-arrow-crit)" : "url(#pert-arrow-norm)"
    });
  }

  // Nœud à exactement 3 compartiments horizontaux égaux :
  //  1) ES | EF
  //  2) ID — nom (durée)
  //  3) LS | LF
  function buildNode(task, pos) {
    const isJalon = task.duration === 0;
    const cls = isJalon ? "jalon" : (task.critical ? "critical" : "normal");
    const g = svgEl1("g", { class: "node-group", "data-id": task.id });

    const rowH = NODE_H / 3;
    const rect = svgEl1("rect", {
      x: pos.x, y: pos.y, width: NODE_W, height: NODE_H, rx: 6,
      class: `node-rect ${cls}`,
      "stroke-width": task.critical && !isJalon ? "2" : "1.4"
    });
    g.appendChild(rect);

    const strokeColor = isJalon ? "#6b6358" : (task.critical ? "#b3402c" : "#2f5d8a");
    const textColor = isJalon ? "#4a4438" : (task.critical ? "#7a2a1c" : "#1f3f5c");

    g.appendChild(svgEl1("line", {
      x1: pos.x, x2: pos.x + NODE_W, y1: pos.y + rowH, y2: pos.y + rowH,
      stroke: strokeColor, opacity: 0.55, "stroke-width": 1
    }));
    g.appendChild(svgEl1("line", {
      x1: pos.x, x2: pos.x + NODE_W, y1: pos.y + rowH * 2, y2: pos.y + rowH * 2,
      stroke: strokeColor, opacity: 0.55, "stroke-width": 1
    }));
    g.appendChild(svgEl1("line", {
      x1: pos.x + NODE_W / 2, x2: pos.x + NODE_W / 2, y1: pos.y, y2: pos.y + rowH,
      stroke: strokeColor, opacity: 0.4, "stroke-width": 1
    }));
    g.appendChild(svgEl1("line", {
      x1: pos.x + NODE_W / 2, x2: pos.x + NODE_W / 2, y1: pos.y + rowH * 2, y2: pos.y + NODE_H,
      stroke: strokeColor, opacity: 0.4, "stroke-width": 1
    }));

    g.appendChild(svgText(pos.x + NODE_W * 0.25, pos.y + rowH * 0.5, task.es, textColor, 13, "node-label-val"));
    g.appendChild(svgText(pos.x + NODE_W * 0.75, pos.y + rowH * 0.5, task.ef, textColor, 13, "node-label-val"));

    const namePart = task.name && task.name !== task.id ? ` ${truncate(task.name, 14)}` : "";
    const label = isJalon ? `${task.id}${namePart}` : `${task.id}${namePart} (${task.duration}j)`;
    g.appendChild(svgText(pos.x + NODE_W / 2, pos.y + rowH * 1.5, label, textColor, 11, "node-label-id"));

    g.appendChild(svgText(pos.x + NODE_W * 0.25, pos.y + rowH * 2.5, task.ls, textColor, 13, "node-label-val"));
    g.appendChild(svgText(pos.x + NODE_W * 0.75, pos.y + rowH * 2.5, task.lf, textColor, 13, "node-label-val"));

    const title = svgEl1("title");
    title.textContent = `${task.id} — ${task.name}\nDurée: ${task.duration}j\nES:${task.es} EF:${task.ef} LS:${task.ls} LF:${task.lf}\nMarge: ${task.slack}${task.critical ? " (critique)" : ""}`;
    g.appendChild(title);

    return g;
  }

  function svgText(x, y, content, fill, size, cls) {
    const t = svgEl1("text", {
      x, y, "text-anchor": "middle", "dominant-baseline": "central",
      fill, "font-size": size, class: cls
    });
    t.textContent = content;
    return t;
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
