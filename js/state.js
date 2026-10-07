// Application state, undo history, selection and autosave.

import { Diagram, History } from './model.js';

export const app = {
  diagram: new Diagram(),
  history: new History(),
  selection: { nodes: new Set(), edges: new Set() },
  tool: 'pen', // 'pen' | 'select' | 'sketch'
  view: { x: 0, y: 0, k: 1 },
  hover: null, // {kind: 'node'|'edge', id}
  format: 'tikz',
  ai: false, // Claude handwriting recognition available
  eraser: false,
  // Per-arrow hints from the stroke that drew it (not saved): {drawnHead, heads, t}
  marks: new Map(),
};

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
}
export function changed(info = {}) {
  for (const fn of listeners) fn(info);
}

const STORE_KEY = 'cd-sketchpad:diagram:v1';
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, app.diagram.snapshot()); } catch { /* storage unavailable */ }
  }, 250);
}

export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.nodes)) return false;
    app.diagram.load(data);
    return !app.diagram.isEmpty();
  } catch {
    return false;
  }
}

function pruneSelection() {
  const d = app.diagram;
  for (const id of [...app.selection.nodes]) if (!d.node(id)) app.selection.nodes.delete(id);
  for (const id of [...app.selection.edges]) if (!d.edge(id)) app.selection.edges.delete(id);
  if (app.hover && !(app.hover.kind === 'node' ? d.node(app.hover.id) : d.edge(app.hover.id))) app.hover = null;
}

// Apply a change to the diagram as one undoable step.
export function commit(mutate, info = {}) {
  const before = app.diagram.snapshot();
  const result = mutate(app.diagram);
  if (app.diagram.snapshot() !== before) {
    app.history.record(before);
    scheduleSave();
  }
  pruneSelection();
  changed({ diagram: true, ...info });
  return result;
}

// For edits that are grouped by the caller (typing a label): mutate without recording,
// then call `recordFrom(before)` once at the end.
export function mutateQuietly(mutate) {
  mutate(app.diagram);
  scheduleSave();
  changed({ diagram: true, quiet: true });
}

export function recordFrom(before) {
  if (before !== app.diagram.snapshot()) app.history.record(before);
  scheduleSave();
  changed({ diagram: true });
}

export function restoreSnapshot(snap) {
  app.diagram.restore(snap);
  pruneSelection();
  scheduleSave();
  changed({ diagram: true });
}

export function undo() {
  const s = app.history.undo(app.diagram.snapshot());
  if (s) restoreSnapshot(s);
}

export function redo() {
  const s = app.history.redo(app.diagram.snapshot());
  if (s) restoreSnapshot(s);
}

export function replaceDiagram(data) {
  commit((d) => d.load(data));
  clearSelection();
}

// ---------- selection ----------

export function clearSelection() {
  app.selection.nodes.clear();
  app.selection.edges.clear();
  changed({ selection: true });
}

export function select({ nodes = [], edges = [] }, additive = false) {
  if (!additive) {
    app.selection.nodes.clear();
    app.selection.edges.clear();
  }
  for (const id of nodes) app.selection.nodes.add(id);
  for (const id of edges) app.selection.edges.add(id);
  changed({ selection: true });
}

export function selectedSingle() {
  const { nodes, edges } = app.selection;
  if (nodes.size === 1 && edges.size === 0) return { kind: 'node', id: [...nodes][0] };
  if (edges.size === 1 && nodes.size === 0) return { kind: 'edge', id: [...edges][0] };
  return null;
}

export function deleteSelection() {
  const { nodes, edges } = app.selection;
  if (!nodes.size && !edges.size) return false;
  commit((d) => {
    for (const id of edges) d.removeEdge(id);
    for (const id of nodes) d.removeNode(id);
  });
  clearSelection();
  return true;
}
