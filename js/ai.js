// Handwriting recognition with Claude, through the claude.ai artifact `sample` capability.
// Everything here is optional: when the page runs elsewhere, `aiReady()` resolves false.

let samplePromise = null;
let disabled = false;

function getSample() {
  if (!samplePromise) {
    samplePromise = (async () => {
      if (!window.claude || typeof window.claude.use !== 'function') return null;
      try {
        const s = await window.claude.use('sample');
        if (!s) return null;
        const limits = await s.limits().catch(() => null);
        return limits && limits.images ? s : null;
      } catch {
        return null;
      }
    })();
  }
  return samplePromise;
}

export async function aiReady() {
  if (disabled) return false;
  return !!(await getSample());
}

const DENIED = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'images_unavailable', 'tools_unavailable'];

// Map a rejection to 'denied' | 'limited' | 'cancelled' | 'failed'.
export function errorKind(e) {
  const code = e && e.code;
  if (DENIED.includes(code)) {
    disabled = true;
    return 'denied';
  }
  if (code === 'rate_limited' || code === 'session_expired') return 'limited';
  if (code === 'cancelled') return 'cancelled';
  return 'failed';
}

const LABEL_PROMPT = `The image shows one short handwritten mathematical expression: a label from a commutative diagram, such as an object (X_1, A[x]/(x^3), Y \\times_Z Y, \\mathcal{O}_X, \\operatorname{Spec} R) or a morphism name (f, \\pi_1, \\alpha, \\iota).

Transcribe it as LaTeX math without dollar signs. Use _ and ^ for subscripts and superscripts, commands for Greek letters and symbols (\\times, \\otimes, \\oplus, \\circ, \\cong), \\mathbb or \\mathcal when the letter is written that way, and keep brackets exactly as written. Do not add anything that is not in the image.

Reply with only JSON: {"latex": "..."}. If the image is unreadable or empty, reply {"latex": ""}.`;

export async function recognizeLabel(blob, signal) {
  const sample = await getSample();
  if (!sample) throw { code: 'not_granted' };
  const res = await sample.json(LABEL_PROMPT, { images: [blob], modelTier: 'quick', signal });
  return res && typeof res.latex === 'string' ? res.latex.trim() : '';
}

const DIAGRAM_PROMPT = `The image is a hand-drawn commutative diagram (category theory, algebra, topology). Convert it into a structured description.

Objects: every vertex of the diagram, usually a written label. Place each on an integer grid like tikz-cd: "row" (0 = top) and "col" (0 = left). Keep the drawing's layout: objects that line up vertically share a col, objects that line up horizontally share a row, and diagonal arrows usually join cells that differ by one row and one column. Labels are LaTeX math without dollar signs (X_1, Y \\times_Z Y, A[[x]], A[x]/(x^3), \\mathcal{O}_X, \\cdots). An arrow end with no written label is an object whose label is "".

Arrows: every arrow, with the ids of the objects it goes "from" and "to", and its label in LaTeX ("" if none). Style fields:
- "label_side": "left" or "right" of the arrow's direction of travel, or "over" if written across the arrow
- "head": "to" (→), "epi" (↠, two heads), "none" (plain line), "harpoon" (⇀)
- "tail": "none", "hook" (↪), "mono" (↣), "mapsto" (↦)
- "body": "solid", "dashed", "dotted" or "squiggly"
- "double": true for ⇒ or for a double line =
- "bend": 0 when straight; otherwise an angle from 15 to 90 degrees, positive when the arrow bows out to the left of its direction of travel, negative when it bows to the right
- for a loop (from equals to) add "loop": the direction it points in degrees (90 above, 0 right, 180 left, 270 below)
Pullback or pushout corner marks (⌟ ⌜) drawn inside a square next to an object go in "corners" as {"at": id of that object, "toward": id of the object at the opposite corner of the square}.

Reply with only JSON of this shape:
{"nodes":[{"id":"a","row":0,"col":0,"label":"X_1"}],"edges":[{"from":"a","to":"b","label":"f","label_side":"left","head":"to","tail":"none","body":"solid","double":false,"bend":0}],"corners":[]}`;

export async function recognizeDiagram(blob, { signal, onText } = {}) {
  const sample = await getSample();
  if (!sample) throw { code: 'not_granted' };
  const res = await sample.json(DIAGRAM_PROMPT, { images: [blob], signal, onText, modelTier: 'default' });
  return normalizeRecognized(res);
}

// Validate the model's JSON into {nodes:[{key,row,col,label}], edges:[…], corners:[…]}.
export function normalizeRecognized(res) {
  const out = { nodes: [], edges: [], corners: [] };
  if (!res || typeof res !== 'object') return out;
  const keys = new Set();
  const taken = new Set();
  for (const n of Array.isArray(res.nodes) ? res.nodes : []) {
    const key = String(n.id ?? '');
    if (!key || keys.has(key)) continue;
    let row = Math.round(Number(n.row)) || 0, col = Math.round(Number(n.col)) || 0;
    while (taken.has(`${col},${row}`)) col++;
    taken.add(`${col},${row}`);
    keys.add(key);
    out.nodes.push({ key, row, col, label: typeof n.label === 'string' ? n.label.trim() : '' });
  }
  const enumOr = (v, list, d) => (list.includes(v) ? v : d);
  for (const e of Array.isArray(res.edges) ? res.edges : []) {
    const from = String(e.from ?? ''), to = String(e.to ?? '');
    if (!keys.has(from) || !keys.has(to)) continue;
    out.edges.push({
      from, to,
      label: typeof e.label === 'string' ? e.label.trim() : '',
      side: enumOr(e.label_side, ['left', 'right', 'over'], 'left'),
      head: enumOr(e.head, ['to', 'epi', 'none', 'harpoon'], 'to'),
      tail: enumOr(e.tail, ['none', 'hook', 'mono', 'mapsto'], 'none'),
      body: enumOr(e.body, ['solid', 'dashed', 'dotted', 'squiggly'], 'solid'),
      double: e.double === true,
      bend: Math.max(-90, Math.min(90, Math.round(Number(e.bend) / 15) * 15 || 0)),
      loop: Number.isFinite(Number(e.loop)) ? Number(e.loop) : 90,
    });
  }
  for (const c of Array.isArray(res.corners) ? res.corners : []) {
    const at = String(c.at ?? ''), toward = String(c.toward ?? '');
    if (keys.has(at) && keys.has(toward) && at !== toward) out.corners.push({ at, toward });
  }
  return out;
}
