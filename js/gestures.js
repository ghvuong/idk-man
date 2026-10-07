// Pen-stroke analysis: pure functions that look at the shape of a stroke.
// Thresholds are relative to `unit` (the grid cell width in world pixels).

import {
  dist, sub, dot, norm, lerp, leftNormal, angleBetween, bboxOf, pathLength, centroid, deg,
} from './geom.js';

export function resample(points, step) {
  if (points.length < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: points[0].x, y: points[0].y }];
  let prev = points[0];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    let seg = dist(prev, cur);
    let from = prev;
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      const q = lerp(from, cur, t);
      out.push(q);
      from = q;
      seg = dist(from, cur);
      carry = 0;
    }
    carry += seg;
    prev = cur;
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.25) out.push({ x: last.x, y: last.y });
  return out;
}

// Turning angle (radians, signed) at each interior point of a polyline.
function turns(pts) {
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    out.push(angleBetween(sub(pts[i], pts[i - 1]), sub(pts[i + 1], pts[i])));
  }
  return out;
}

export function features(raw, unit) {
  const length = pathLength(raw);
  const bb = bboxOf(raw);
  const diag = Math.hypot(bb.w, bb.h);
  const chord = raw.length > 1 ? dist(raw[0], raw[raw.length - 1]) : 0;
  const coarse = resample(raw, Math.max(4, unit / 14));
  const t = turns(coarse);
  let total = 0, net = 0, sharp = 0;
  for (const a of t) {
    total += Math.abs(a);
    net += a;
    if (Math.abs(a) > (100 * Math.PI) / 180) sharp++;
  }
  return {
    length, bb, diag, chord, coarse,
    totalTurn: total, netTurn: net, sharp,
    straightness: length > 0 ? chord / length : 1,
  };
}

// Scratch-out: several sharp back-and-forth reversals packed into a small area.
export function isScribble(f, unit) {
  return f.sharp >= 3 && f.length > 2.3 * f.diag && f.diag > unit * 0.12;
}

export function isClosed(f, unit) {
  return f.length > unit * 0.9 &&
    f.chord < Math.max(unit * 0.25, f.length * 0.18) &&
    f.totalTurn > 1.5 * Math.PI;
}

// A small curl at the start of a stroke (↪). Returns {side: +1 left | -1 right, end} or null.
export function detectHook(raw, unit) {
  const total = pathLength(raw);
  if (total < unit * 0.45) return null;
  const pts = resample(raw, Math.max(1.5, unit / 60));
  const budget = Math.min(total * 0.35, unit * 0.4);
  let acc = 0, turn = 0, best = 0, bestIdx = 0, i = 1;
  for (; i < pts.length - 1 && acc < budget; i++) {
    acc += dist(pts[i - 1], pts[i]);
    turn += angleBetween(sub(pts[i], pts[i - 1]), sub(pts[i + 1], pts[i]));
    if (Math.abs(turn) > Math.abs(best)) { best = turn; bestIdx = i; }
  }
  if (Math.abs(best) < (140 * Math.PI) / 180) return null;
  // The curl ends where the stroke has turned the most; the main line starts there.
  const curl = pts.slice(0, bestIdx + 1);
  const rest = pts.slice(bestIdx);
  if (rest.length < 3) return null;
  const a = rest[0], b = rest[rest.length - 1];
  const n = leftNormal(sub(b, a));
  const c = centroid(curl);
  const side = dot(sub(c, a), n) >= 0 ? 1 : -1;
  // Map the resampled index back to the raw stroke by arc length.
  const cut = pathLength(curl);
  let s = 0, j = 1;
  for (; j < raw.length && s < cut; j++) s += dist(raw[j - 1], raw[j]);
  return { side, end: Math.max(0, j - 1) };
}

// Index of the point farthest from the start: the arrow tip when a head was drawn in-stroke.
export function tipIndex(raw) {
  let best = 0, bi = 0;
  for (let i = 0; i < raw.length; i++) {
    const d = dist(raw[0], raw[i]);
    if (d > best) { best = d; bi = i; }
  }
  return bi;
}

// tikz-cd "bend" angle (degrees, + = left) that matches how far the stroke bows out.
// A tikz bend of θ with looseness 1 bulges by 0.2936·L·sin θ at its middle.
export function estimateBend(pts) {
  if (pts.length < 3) return 0;
  const a = pts[0], b = pts[pts.length - 1];
  const L = dist(a, b);
  if (L < 1) return 0;
  const n = leftNormal(sub(b, a));
  let h = 0;
  for (const p of pts) {
    const d = dot(sub(p, a), n);
    if (Math.abs(d) > Math.abs(h)) h = d;
  }
  const r = Math.abs(h) / L;
  if (r < 0.065) return 0;
  const theta = deg(Math.asin(Math.min(1, r / 0.2936)));
  const q = Math.min(90, Math.max(15, Math.round(theta / 15) * 15));
  return h > 0 ? q : -q;
}

// Shape of a small mark: 'bar' | 'angle' | 'curl' | 'zigzag' | 'dot' | 'other'.
// For 'angle', `apexDir` points from the middle of the two ends towards the apex.
export function markShape(raw, unit) {
  const length = pathLength(raw);
  if (length < Math.max(3, unit * 0.03)) return { type: 'dot' };
  const first = raw[0], last = raw[raw.length - 1];
  const chord = dist(first, last);
  if (chord / length > 0.88) return { type: 'bar', dir: norm(sub(last, first)), mid: lerp(first, last, 0.5) };
  const pts = resample(raw, Math.max(1.5, length / 24));
  // Find the sharpest corner using a window of a few points on each side.
  const k = 3;
  let bestA = 0, bestI = -1, corners = 0, lastCorner = -10;
  for (let i = k; i < pts.length - k; i++) {
    const a = Math.abs(angleBetween(sub(pts[i], pts[i - k]), sub(pts[i + k], pts[i])));
    if (a > bestA) { bestA = a; bestI = i; }
    if (a > (75 * Math.PI) / 180 && i - lastCorner > k) { corners++; lastCorner = i; }
  }
  const t = turns(resample(raw, Math.max(1.5, length / 30)));
  const total = t.reduce((s, a) => s + Math.abs(a), 0);
  if (corners >= 3) return { type: 'zigzag' };
  if (bestI >= 0 && bestA > (55 * Math.PI) / 180) {
    const apex = pts[bestI];
    const mid = lerp(first, last, 0.5);
    const legA = dist(first, apex), legB = dist(apex, last);
    if (Math.min(legA, legB) > length * 0.18) {
      return { type: 'angle', apex, apexDir: norm(sub(apex, mid)), turn: deg(bestA) };
    }
  }
  if (total > (130 * Math.PI) / 180) return { type: 'curl', c: centroid(raw) };
  return { type: 'other' };
}

export { centroid, bboxOf, pathLength };
