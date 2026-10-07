// Files and clipboard. Inside a claude.ai artifact, downloads go through the
// `downloads` capability; elsewhere a normal browser download is used.

let downloadsPromise = null;

function downloadsCapability() {
  if (!downloadsPromise) {
    downloadsPromise = (async () => {
      try {
        if (window.claude && typeof window.claude.use === 'function') return await window.claude.use('downloads');
      } catch { /* not available */ }
      return null;
    })();
  }
  return downloadsPromise;
}

export function inArtifact() {
  return !!(window.claude && typeof window.claude.use === 'function');
}

// Resolves 'saved' | 'declined' | 'unavailable'.
export async function saveFile(filename, data, mime = 'application/octet-stream') {
  const dl = await downloadsCapability();
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      if (e && e.code === 'declined') return 'declined';
      if (e && e.code === 'rate_limited') return 'declined';
    }
  }
  if (inArtifact()) return 'unavailable'; // the frame blocks plain downloads
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}

// Must be called directly from a click handler. Falls back to selecting `el`'s text.
export function copyText(text, el) {
  const fallback = () => {
    if (!el) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    try { return document.execCommand('copy'); } catch { return false; }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallback());
    }
  } catch { /* fall through */ }
  return Promise.resolve(fallback());
}

export function svgString(svg) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
}

export function svgToPng(svg, width, height, scale = 3, background = '#ffffff') {
  return new Promise((resolve, reject) => {
    const src = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const ctx = canvas.getContext('2d');
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg')); };
    img.src = url;
  });
}

// Rasterise pen strokes (world coordinates) to a PNG blob, black on white, cropped.
export function inkToPng(strokes, { maxSide = 1200, pad = 24, width = 3 } = {}) {
  const pts = strokes.flatMap((s) => s.points || s);
  if (!pts.length) return Promise.resolve(null);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  const k = Math.min(2, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(32, Math.round(w * k));
  canvas.height = Math.max(32, Math.round(h * k));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const list = s.points || s;
    if (!list.length) continue;
    ctx.beginPath();
    list.forEach((p, i) => {
      const x = (p.x - x0 + pad) * k, y = (p.y - y0 + pad) * k;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (list.length === 1) ctx.lineTo((list[0].x - x0 + pad) * k + 0.1, (list[0].y - y0 + pad) * k);
    ctx.stroke();
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ? { blob: b, x0: x0 - pad, y0: y0 - pad, k, w: canvas.width, h: canvas.height } : null), 'image/png'));
}
