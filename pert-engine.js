/**
 * pert-engine.js
 * Moteur de calcul pour un diagramme PERT (méthode "activité sur nœud" / AON).
 * Entrée  : { title, tasks: [{ id, name, duration, predecessors: [] }, ...] }
 * Sortie  : tâches enrichies avec es, ef, ls, lf, slack, critical, level (colonne)
 *           + liste d'arêtes + durée totale du projet.
 */

const PertEngine = (() => {

  class PertError extends Error {}

  function computePert(data) {
    if (!data || !Array.isArray(data.tasks) || data.tasks.length === 0) {
      throw new PertError("Le projet doit contenir un tableau 'tasks' non vide.");
    }

    const tasks = data.tasks.map(t => normalizeTask(t));
    const byId = new Map(tasks.map(t => [t.id, t]));

    // Validation : IDs uniques, prédécesseurs existants
    const seen = new Set();
    for (const t of tasks) {
      if (seen.has(t.id)) throw new PertError(`ID dupliqué : "${t.id}"`);
      seen.add(t.id);
    }
    for (const t of tasks) {
      for (const p of t.predecessors) {
        if (!byId.has(p)) {
          throw new PertError(`La tâche "${t.id}" référence un prédécesseur inconnu : "${p}"`);
        }
      }
    }

    // Successeurs (inverse des prédécesseurs)
    for (const t of tasks) t.successors = [];
    for (const t of tasks) {
      for (const p of t.predecessors) byId.get(p).successors.push(t.id);
    }

    // Tri topologique (Kahn) -> détecte aussi les cycles
    const order = topoSort(tasks, byId);

    // ----- Passe avant : ES, EF -----
    for (const id of order) {
      const t = byId.get(id);
      if (t.predecessors.length === 0) {
        t.es = 0;
      } else {
        t.es = Math.max(...t.predecessors.map(p => byId.get(p).ef));
      }
      t.ef = t.es + t.duration;
    }

    const projectDuration = Math.max(...tasks.map(t => t.ef));

    // ----- Passe arrière : LF, LS -----
    const reverseOrder = [...order].reverse();
    for (const id of reverseOrder) {
      const t = byId.get(id);
      if (t.successors.length === 0) {
        t.lf = projectDuration;
      } else {
        t.lf = Math.min(...t.successors.map(s => byId.get(s).ls));
      }
      t.ls = t.lf - t.duration;
    }

    // ----- Marge totale + criticité -----
    for (const t of tasks) {
      t.slack = t.ls - t.es;
      t.critical = t.slack === 0;
    }

    // ----- Marge libre : ES(successeur min) − EF -----
    for (const t of tasks) {
      if (t.successors.length === 0) {
        t.freeFloat = projectDuration - t.ef;
      } else {
        t.freeFloat = Math.min(...t.successors.map(s => byId.get(s).es)) - t.ef;
      }
    }

    // ----- Niveau / colonne pour la mise en page (longest path depuis la racine) -----
    for (const id of order) {
      const t = byId.get(id);
      t.level = t.predecessors.length === 0
        ? 0
        : Math.max(...t.predecessors.map(p => byId.get(p).level)) + 1;
    }

    // ----- Arêtes -----
    const edges = [];
    for (const t of tasks) {
      for (const p of t.predecessors) {
        const from = byId.get(p);
        edges.push({
          from: from.id,
          to: t.id,
          critical: from.critical && t.critical && from.ef === t.es
        });
      }
    }

    // ----- Chemin critique ordonné (liste d'IDs) -----
    const criticalPath = order.filter(id => byId.get(id).critical);

    return {
      title: data.title || "Diagramme PERT",
      tasks: order.map(id => byId.get(id)),
      edges,
      projectDuration,
      criticalPath
    };
  }

  function normalizeTask(raw) {
    if (raw == null || typeof raw !== "object") {
      throw new PertError("Chaque tâche doit être un objet.");
    }
    const id = String(raw.id ?? "").trim();
    if (!id) throw new PertError("Une tâche est sans 'id'.");
    const duration = Number(raw.duration);
    if (!Number.isFinite(duration) || duration < 0) {
      throw new PertError(`Durée invalide pour la tâche "${id}".`);
    }
    let predecessors = raw.predecessors ?? raw.pred ?? [];
    if (typeof predecessors === "string") {
      predecessors = predecessors.split(",").map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(predecessors)) {
      throw new PertError(`'predecessors' invalide pour la tâche "${id}".`);
    }
    return {
      id,
      name: String(raw.name ?? id),
      duration,
      predecessors: predecessors.map(String)
    };
  }

  function topoSort(tasks, byId) {
    const inDegree = new Map(tasks.map(t => [t.id, t.predecessors.length]));
    const queue = tasks.filter(t => inDegree.get(t.id) === 0).map(t => t.id);
    const order = [];
    const adj = new Map(tasks.map(t => [t.id, []]));
    for (const t of tasks) for (const p of t.predecessors) adj.get(p).push(t.id);

    while (queue.length) {
      // stabilité : on garde l'ordre d'apparition initial à degré égal
      queue.sort((a, b) => tasks.findIndex(t => t.id === a) - tasks.findIndex(t => t.id === b));
      const id = queue.shift();
      order.push(id);
      for (const next of adj.get(id)) {
        inDegree.set(next, inDegree.get(next) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }

    if (order.length !== tasks.length) {
      const stuck = tasks.filter(t => !order.includes(t.id)).map(t => t.id);
      throw new PertError(`Dépendance circulaire détectée impliquant : ${stuck.join(", ")}`);
    }
    return order;
  }

  return { computePert, PertError };
})();

if (typeof module !== "undefined") module.exports = PertEngine;
