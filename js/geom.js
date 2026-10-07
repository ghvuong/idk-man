// Vector, Bézier and polygon helpers. World coordinates: x to the right, y downwards.

export const pt = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const angleOf = (d) => Math.atan2(d.y, d.x);
export const fromAngle = (a, r = 1) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
export const deg = (rad) => (rad * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

export function norm(a) {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
}

// The normal on the left of travel direction `d`, as seen on screen (y down).
// This is the side tikz-cd calls "left": labels go there unless swapped.
export function leftNormal(d) {
  const u = norm(d);
  return { x: u.y, y: -u.x };
}

// Signed angle from a to b in (-π, π].
export function angleBetween(a, b) {
  return Math.atan2(cross(a, b), dot(a, b));
}

export function wrapAngle(a) {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

// ---------- cubic Bézier ----------
// A curve is an array [p0, p1, p2, p3].

export function bezierPoint(c, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

export function bezierTangent(c, t) {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, d = 3 * t * t;
  const v = {
    x: a * (c[1].x - c[0].x) + b * (c[2].x - c[1].x) + d * (c[3].x - c[2].x),
    y: a * (c[1].y - c[0].y) + b * (c[2].y - c[1].y) + d * (c[3].y - c[2].y),
  };
  // Degenerate end tangents fall back to the chord.
  if (Math.hypot(v.x, v.y) < 1e-9) return norm(sub(c[3], c[0]));
  return norm(v);
}

// de Casteljau split at t: returns [left, right].
export function splitBezier(c, t) {
  const p01 = lerp(c[0], c[1], t), p12 = lerp(c[1], c[2], t), p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [[c[0], p01, p012, m], [m, p123, p23, c[3]]];
}

export function subBezier(c, t0, t1) {
  if (t1 <= t0) {
    const m = bezierPoint(c, (t0 + t1) / 2);
    return [m, m, m, m];
  }
  const right = splitBezier(c, t0)[1];
  return splitBezier(right, (t1 - t0) / (1 - t0 || 1))[0];
}

export function lineAsBezier(a, b) {
  return [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
}

export function sampleBezier(c, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(bezierPoint(c, i / n));
  return out;
}

export function bezierLength(c, n = 24) {
  let l = 0, prev = c[0];
  for (let i = 1; i <= n; i++) {
    const p = bezierPoint(c, i / n);
    l += dist(prev, p);
    prev = p;
  }
  return l;
}

// Parameter t at which the arc length from the start reaches `s` (approximate).
export function bezierTAtLength(c, s, n = 48) {
  let l = 0, prev = c[0];
  for (let i = 1; i <= n; i++) {
    const p = bezierPoint(c, i / n);
    const seg = dist(prev, p);
    if (l + seg >= s) return (i - 1 + (s - l) / (seg || 1)) / n;
    l += seg;
    prev = p;
  }
  return 1;
}

// Offset a curve sideways along its end normals (good enough for gentle bends).
export function offsetBezier(c, d) {
  const n0 = leftNormal(bezierTangent(c, 0));
  const n1 = leftNormal(bezierTangent(c, 1));
  return [add(c[0], mul(n0, d)), add(c[1], mul(n0, d)), add(c[2], mul(n1, d)), add(c[3], mul(n1, d))];
}

export function bezierPath(c) {
  const f = (p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  return `M${f(c[0])}C${f(c[1])} ${f(c[2])} ${f(c[3])}`;
}

export function polyPath(pts, closed = false) {
  if (!pts.length) return '';
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += `L${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
  return closed ? d + 'Z' : d;
}

// ---------- boxes ----------
// A box is {x, y, hw, hh}: centre and half extents.

export function inBox(p, b) {
  return Math.abs(p.x - b.x) <= b.hw && Math.abs(p.y - b.y) <= b.hh;
}

// Parameter where the curve leaves box `a` (searching forward) and enters box `b`
// (searching backward). Assumes the curve starts inside `a` and ends inside `b`.
export function clipBezierToBoxes(c, a, b) {
  const N = 64;
  let t0 = 0, t1 = 1;
  if (a) {
    let i = 1;
    while (i <= N && inBox(bezierPoint(c, i / N), a)) i++;
    if (i > N) t0 = 0.35;
    else t0 = refine(c, (i - 1) / N, i / N, (p) => inBox(p, a));
  }
  if (b) {
    let i = N - 1;
    while (i >= 0 && inBox(bezierPoint(c, i / N), b)) i--;
    if (i < 0) t1 = 0.65;
    else t1 = refine(c, (i + 1) / N, i / N, (p) => inBox(p, b));
  }
  if (t1 - t0 < 0.02) {
    const m = (t0 + t1) / 2;
    t0 = Math.max(0, m - 0.01);
    t1 = Math.min(1, m + 0.01);
  }
  return [t0, t1];
}

// Bisection between tIn (predicate true) and tOut (predicate false).
function refine(c, tIn, tOut, inside) {
  for (let k = 0; k < 20; k++) {
    const m = (tIn + tOut) / 2;
    if (inside(bezierPoint(c, m))) tIn = m;
    else tOut = m;
  }
  return (tIn + tOut) / 2;
}

// Point on the border of box `b` in direction `dir` (unit vector) from its centre.
export function boxBorderPoint(b, dir) {
  const sx = Math.abs(dir.x) > 1e-9 ? b.hw / Math.abs(dir.x) : Infinity;
  const sy = Math.abs(dir.y) > 1e-9 ? b.hh / Math.abs(dir.y) : Infinity;
  const s = Math.min(sx, sy);
  return { x: b.x + dir.x * s, y: b.y + dir.y * s };
}

// ---------- polylines ----------

export function pointSegDist(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

export function polylineDist(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, pointSegDist(p, pts[i - 1], pts[i]));
  return best;
}

function segIntersect(p, p2, q, q2) {
  const r = sub(p2, p), s = sub(q2, q);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(sub(q, p), s) / den;
  const u = cross(sub(q, p), r) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function polylineCrossings(a, b) {
  let n = 0;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segIntersect(a[i - 1], a[i], b[j - 1], b[j])) n++;
    }
  }
  return n;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}
