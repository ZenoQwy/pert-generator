/**
 * pert-app.js
 * Câblage UI : drawer de données (JSON ou formulaire) -> PertEngine -> PertRender,
 * + viewport en pan/zoom libre pour explorer le diagramme.
 */

(() => {
  const EXAMPLE = {
    title: "Lancement produit — exemple",
    tasks: [
      { id: "A", name: "Cadrage", duration: 4, predecessors: [] },
      { id: "B", name: "Étude marché", duration: 7, predecessors: [] },
      { id: "C", name: "Spécifications", duration: 5, predecessors: ["A"] },
      { id: "D", name: "Maquettes", duration: 3, predecessors: ["A"] },
      { id: "E", name: "Développement", duration: 14, predecessors: ["C", "D"] },
      { id: "F", name: "Tests", duration: 6, predecessors: ["E"] },
      { id: "G", name: "Plan marketing", duration: 8, predecessors: ["B"] },
      { id: "H", name: "Lancement", duration: 2, predecessors: ["F", "G"] }
    ]
  };

  const els = {
    drawerToggle: document.getElementById("drawer-toggle"),
    drawerClose: document.getElementById("drawer-close"),
    drawerOverlay: document.getElementById("drawer-overlay"),
    editorPanel: document.getElementById("editor-panel"),
    jsonInput: document.getElementById("json-input"),
    jsonWrap: document.getElementById("json-wrap"),
    formWrap: document.getElementById("form-wrap"),
    taskCards: document.getElementById("task-cards"),
    addTaskBtn: document.getElementById("add-task-btn"),
    applyBtn: document.getElementById("apply-btn"),
    resetBtn: document.getElementById("reset-btn"),
    errorBox: document.getElementById("error-box"),
    svg: document.getElementById("pert-svg"),
    viewport: document.getElementById("viewport"),
    viewportInner: document.getElementById("viewport-inner"),
    emptyState: document.getElementById("empty-state"),
    statsBar: document.getElementById("stats-bar"),
    projectTitle: document.getElementById("project-title"),
    tabs: document.querySelectorAll(".tab-btn"),
    zoomIn: document.getElementById("zoom-in"),
    zoomOut: document.getElementById("zoom-out"),
    zoomFit: document.getElementById("zoom-fit"),
    zoomPct: document.getElementById("zoom-pct")
  };

  let currentData = clone(EXAMPLE);
  let lastResult = null;

  // ================= DRAWER =================
  function openDrawer() {
    els.editorPanel.classList.add("open");
    els.drawerOverlay.classList.add("open");
  }
  function closeDrawer() {
    els.editorPanel.classList.remove("open");
    els.drawerOverlay.classList.remove("open");
  }
  els.drawerToggle.addEventListener("click", openDrawer);
  els.drawerClose.addEventListener("click", closeDrawer);
  els.drawerOverlay.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDrawer();
  });

  // ================= TABS =================
  els.tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      els.tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      if (tab === "json") {
        syncJsonFromData();
        els.jsonWrap.classList.remove("hidden");
        els.formWrap.classList.remove("active");
      } else {
        els.jsonWrap.classList.add("hidden");
        els.formWrap.classList.add("active");
        renderForm();
      }
    });
  });

  // ================= BUTTONS =================
  els.applyBtn.addEventListener("click", () => {
    const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
    if (activeTab === "json") {
      try {
        currentData = JSON.parse(els.jsonInput.value);
      } catch (e) {
        showError("JSON invalide : " + e.message);
        return;
      }
    } else {
      currentData = readFormData();
    }
    recompute(true);
  });

  els.resetBtn.addEventListener("click", () => {
    currentData = clone(EXAMPLE);
    syncJsonFromData();
    renderForm();
    recompute(true);
  });

  els.addTaskBtn.addEventListener("click", () => {
    currentData.tasks.push({
      id: nextId(currentData.tasks),
      name: "Nouvelle tâche",
      duration: 1,
      predecessors: []
    });
    renderForm();
  });

  function syncJsonFromData() {
    els.jsonInput.value = JSON.stringify(currentData, null, 2);
  }

  function nextId(tasks) {
    let n = tasks.length + 1;
    const ids = new Set(tasks.map(t => t.id));
    let candidate = `T${n}`;
    while (ids.has(candidate)) { n++; candidate = `T${n}`; }
    return candidate;
  }

  // ================= FORM =================
  function renderForm() {
    els.taskCards.innerHTML = "";
    currentData.tasks.forEach((t, idx) => {
      els.taskCards.appendChild(buildTaskCard(t, idx));
    });
  }

  function buildTaskCard(task, idx) {
    const card = document.createElement("div");
    card.className = "task-card";
    card.innerHTML = `
      <div class="task-card-head">
        <span class="task-id-badge">#${idx + 1}</span>
        <button class="task-del" data-idx="${idx}">Supprimer</button>
      </div>
      <div class="field-row">
        <div class="col-name">
          <label>ID</label>
          <input type="text" data-field="id" data-idx="${idx}" value="${escapeAttr(task.id)}">
        </div>
        <div class="col-dur">
          <label>Durée (j)</label>
          <input type="number" min="0" step="1" data-field="duration" data-idx="${idx}" value="${task.duration}">
        </div>
      </div>
      <div class="field-row">
        <div class="col-name" style="flex:3">
          <label>Nom de la tâche</label>
          <input type="text" data-field="name" data-idx="${idx}" value="${escapeAttr(task.name)}">
        </div>
      </div>
      <div class="field-row">
        <div style="flex:1">
          <label>Prédécesseurs (séparés par virgule)</label>
          <input type="text" data-field="predecessors" data-idx="${idx}" value="${escapeAttr((task.predecessors || []).join(', '))}">
        </div>
      </div>
    `;
    card.querySelector(".task-del").addEventListener("click", e => {
      currentData.tasks.splice(Number(e.target.dataset.idx), 1);
      renderForm();
    });
    card.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", onFieldInput);
    });
    return card;
  }

  function onFieldInput(e) {
    const idx = Number(e.target.dataset.idx);
    const field = e.target.dataset.field;
    const task = currentData.tasks[idx];
    if (field === "predecessors") {
      task.predecessors = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
    } else if (field === "duration") {
      task.duration = e.target.value === "" ? 0 : Number(e.target.value);
    } else {
      task[field] = e.target.value;
    }
  }

  function readFormData() { return currentData; }

  // ================= COMPUTE + RENDER =================
  function recompute(refit) {
    try {
      const result = PertEngine.computePert(currentData);
      hideError();
      lastResult = result;
      drawResult(result, refit);
    } catch (err) {
      showError(err.message || String(err));
      els.svg.style.display = "none";
      els.emptyState.style.display = "flex";
    }
  }

  function drawResult(result, refit) {
    els.emptyState.style.display = "none";
    els.svg.style.display = "block";
    PertRender.render(els.svg, result);

    els.projectTitle.textContent = result.title;
    els.statsBar.innerHTML = `
      <span>Tâches : <b>${result.tasks.length}</b></span>
      <span>Durée totale : <b>${result.projectDuration} j</b></span>
      <span class="crit-label">Chemin critique : <b>${result.criticalPath.join(" → ")}</b></span>
    `;

    if (refit) requestAnimationFrame(fitToScreen);
  }

  function showError(msg) {
    els.errorBox.textContent = "⚠ " + msg;
    els.errorBox.style.display = "block";
  }
  function hideError() { els.errorBox.style.display = "none"; }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function escapeAttr(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  // ================= PAN & ZOOM =================
  let scale = 1, tx = 0, ty = 0;
  let isDragging = false, lastX = 0, lastY = 0;

  function applyTransform() {
    els.viewportInner.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    els.zoomPct.textContent = Math.round(scale * 100) + "%";
  }

  function fitToScreen(attempt) {
    attempt = attempt || 0;
    const baseW = Number(els.svg.getAttribute("data-base-w")) || els.svg.getBBox().width;
    const baseH = Number(els.svg.getAttribute("data-base-h")) || els.svg.getBBox().height;
    if (!baseW || !baseH) return;

    let vpRect = els.viewport.getBoundingClientRect();
    if ((vpRect.width < 10 || vpRect.height < 10) && attempt < 15) {
      requestAnimationFrame(() => fitToScreen(attempt + 1));
      return;
    }
    // Repli : si après plusieurs tentatives le panneau est toujours sans
    // dimensions mesurables, on se base sur la fenêtre pour ne jamais rester
    // bloqué sur un écran vide.
    if (vpRect.width < 10 || vpRect.height < 10) {
      vpRect = { width: window.innerWidth, height: window.innerHeight - 140 };
    }

    const margin = 40;
    const fitScale = Math.min(
      (vpRect.width - margin * 2) / baseW,
      (vpRect.height - margin * 2) / baseH,
      1.4
    );
    scale = Math.max(fitScale, 0.1);
    tx = (vpRect.width - baseW * scale) / 2;
    ty = (vpRect.height - baseH * scale) / 2;
    applyTransform();
  }

  function zoomBy(factor, centerX, centerY) {
    const vpRect = els.viewport.getBoundingClientRect();
    const cx = centerX != null ? centerX - vpRect.left : vpRect.width / 2;
    const cy = centerY != null ? centerY - vpRect.top : vpRect.height / 2;
    const newScale = Math.min(Math.max(scale * factor, 0.15), 3);
    // garder le point sous le curseur fixe pendant le zoom
    tx = cx - ((cx - tx) / scale) * newScale;
    ty = cy - ((cy - ty) / scale) * newScale;
    scale = newScale;
    applyTransform();
  }

  els.zoomIn.addEventListener("click", () => zoomBy(1.2));
  els.zoomOut.addEventListener("click", () => zoomBy(1 / 1.2));
  els.zoomFit.addEventListener("click", fitToScreen);

  els.viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive: false });

  els.viewport.addEventListener("mousedown", e => {
    if (e.target.closest("#zoom-controls")) return;
    isDragging = true;
    lastX = e.clientX; lastY = e.clientY;
    els.viewport.classList.add("dragging");
  });
  window.addEventListener("mousemove", e => {
    if (!isDragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    applyTransform();
  });
  window.addEventListener("mouseup", () => {
    isDragging = false;
    els.viewport.classList.remove("dragging");
  });

  // touch support (mobile / trackpad pinch fallback via two fingers handled by browser pinch-zoom natively on most setups;
  // basic single-finger pan provided here)
  let touchLastX = 0, touchLastY = 0, touching = false;
  els.viewport.addEventListener("touchstart", e => {
    if (e.touches.length === 1) {
      touching = true;
      touchLastX = e.touches[0].clientX;
      touchLastY = e.touches[0].clientY;
    }
  }, { passive: true });
  els.viewport.addEventListener("touchmove", e => {
    if (!touching || e.touches.length !== 1) return;
    const t = e.touches[0];
    tx += t.clientX - touchLastX;
    ty += t.clientY - touchLastY;
    touchLastX = t.clientX; touchLastY = t.clientY;
    applyTransform();
  }, { passive: true });
  els.viewport.addEventListener("touchend", () => { touching = false; });

  window.addEventListener("resize", () => { if (lastResult) fitToScreen(); });

  // ================= INIT =================
  applyTransform(); // assure une transform neutre (scale=1) dès le départ, le
                     // diagramme reste visible même si fitToScreen est différé
  syncJsonFromData();
  renderForm();
  recompute(true);
})();
