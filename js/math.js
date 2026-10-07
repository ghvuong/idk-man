// LaTeX labels → SVG. Uses MathJax (SVG output, loaded from a CDN in index.html) when it
// is available, and a Unicode approximation otherwise, so the editor always works.

const NS = 'http://www.w3.org/2000/svg';
const cache = new Map();
const listeners = new Set();
let ready = false;

export function mathIsReady() {
  return ready;
}

export function onMathChange(fn) {
  listeners.add(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

function mathJaxUsable() {
  const MJ = window.MathJax;
  return !!(MJ && typeof MJ.tex2svg === 'function' && MJ.startup && MJ.startup.document);
}

export function initMath() {
  const done = () => {
    if (ready || !mathJaxUsable()) return;
    ready = true;
    cache.clear();
    notify();
  };
  window.addEventListener('mathjax-ready', done);
  done();
  // The CDN script may finish loading after this module runs; poll briefly as a safety net.
  let tries = 0;
  const timer = setInterval(() => {
    done();
    if (ready || ++tries > 150) clearInterval(timer);
  }, 200);
}

// Measure/render one label. Returns null for an empty label.
function entryFor(tex) {
  if (!tex || !tex.trim()) return null;
  const hit = cache.get(tex);
  if (hit) return hit;
  let entry = null;
  if (ready) {
    try {
      const container = window.MathJax.tex2svg(tex, { display: false });
      const svg = container.querySelector('svg');
      const vb = svg.getAttribute('viewBox').split(/[\s,]+/).map(Number);
      entry = { kind: 'mj', vb, inner: svg.innerHTML, error: !!svg.querySelector('[data-mjx-error]') };
    } catch (err) {
      // MathJax may need to fetch an extension first; draw the fallback now, redraw later.
      if (err && err.retry && typeof err.retry.then === 'function') {
        err.retry.then(() => { cache.delete(tex); notify(); }, () => {});
      }
      return fallbackEntry(tex);
    }
  } else {
    entry = fallbackEntry(tex);
  }
  cache.set(tex, entry);
  return entry;
}

// Size of a label at font size `px`, in pixels: {w, h}.
export function measureTeX(tex, px) {
  const e = entryFor(tex);
  if (!e) return { w: 0, h: 0 };
  const k = px / 1000;
  return { w: e.vb[2] * k, h: e.vb[3] * k };
}

// An <svg> element containing the rendered label, top-left at (0, 0).
export function texElement(tex, px) {
  const e = entryFor(tex);
  if (!e) return null;
  const k = px / 1000;
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', e.vb.join(' '));
  el.setAttribute('width', (e.vb[2] * k).toFixed(2));
  el.setAttribute('height', (e.vb[3] * k).toFixed(2));
  el.setAttribute('overflow', 'visible');
  if (e.kind === 'mj') {
    el.innerHTML = e.inner;
    if (e.error) el.classList.add('tex-error');
  } else {
    el.appendChild(fallbackText(e));
  }
  return { el, w: e.vb[2] * k, h: e.vb[3] * k };
}

// ---------- fallback (no MathJax) ----------

const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', times: '×', otimes: '⊗', oplus: '⊕', circ: '∘', cdot: '·',
  cdots: '⋯', ldots: '…', dots: '…', to: '→', rightarrow: '→', leftarrow: '←', infty: '∞',
  partial: '∂', nabla: '∇', cong: '≅', simeq: '≃', sim: '∼', le: '≤', ge: '≥', neq: '≠',
  in: '∈', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', coprod: '∐', prod: '∏', sum: '∑',
  bigoplus: '⊕', bigotimes: '⊗', ast: '∗', star: '⋆', bullet: '•', emptyset: '∅', varnothing: '∅',
  lrcorner: '⌟', ulcorner: '⌜', llcorner: '⌞', urcorner: '⌝', dashv: '⊣', vdash: '⊢', bot: '⊥',
  top: '⊤', hom: 'hom', Hom: 'Hom', ell: 'ℓ', hbar: 'ℏ', wedge: '∧', vee: '∨', setminus: '∖',
  colon: ':', quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': '', ' ': ' ', '{': '{', '}': '}',
  langle: '⟨', rangle: '⟩', lbrack: '[', rbrack: ']', mid: '|', vert: '|',
};

const ALPHABETS = {
  mathbb: { A: '𝔸', B: '𝔹', C: 'ℂ', D: '𝔻', E: '𝔼', F: '𝔽', G: '𝔾', H: 'ℍ', I: '𝕀', J: '𝕁', K: '𝕂', L: '𝕃', M: '𝕄', N: 'ℕ', O: '𝕆', P: 'ℙ', Q: 'ℚ', R: 'ℝ', S: '𝕊', T: '𝕋', U: '𝕌', V: '𝕍', W: '𝕎', X: '𝕏', Y: '𝕐', Z: 'ℤ' },
  mathcal: { A: '𝒜', B: 'ℬ', C: '𝒞', D: '𝒟', E: 'ℰ', F: 'ℱ', G: '𝒢', H: 'ℋ', I: 'ℐ', J: '𝒥', K: '𝒦', L: 'ℒ', M: 'ℳ', N: '𝒩', O: '𝒪', P: '𝒫', Q: '𝒬', R: 'ℛ', S: '𝒮', T: '𝒯', U: '𝒰', V: '𝒱', W: '𝒲', X: '𝒳', Y: '𝒴', Z: '𝒵' },
};

// Turn a TeX string into runs of {text, level} where level is 0, -1 (subscript) or +1 (superscript).
export function texToRuns(tex) {
  const runs = [];
  let i = 0;
  const push = (text, level) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.level === level) last.text += text;
    else runs.push({ text, level });
  };
  const readGroup = () => {
    // Reads one argument: {…} or a single token. Returns raw TeX.
    while (tex[i] === ' ') i++;
    if (tex[i] === '{') {
      let depth = 0, j = i;
      for (; j < tex.length; j++) {
        if (tex[j] === '{') depth++;
        else if (tex[j] === '}' && --depth === 0) break;
      }
      const s = tex.slice(i + 1, j);
      i = j + 1;
      return s;
    }
    if (tex[i] === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      i += m ? m[0].length : 1;
      return m ? m[0] : '';
    }
    return tex[i++] || '';
  };
  const plain = (s) => texToRuns(s).map((r) => r.text).join('');
  const walk = (level) => {
    while (i < tex.length) {
      const c = tex[i];
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
        const name = m ? m[1] : '';
        i += m ? m[0].length : 1;
        if (ALPHABETS[name]) {
          const arg = readGroup();
          push([...plain(arg)].map((ch) => ALPHABETS[name][ch] || ch).join(''), level);
        } else if (['mathrm', 'operatorname', 'text', 'mathbf', 'mathit', 'mathsf', 'mathfrak', 'mathscr', 'textrm', 'mbox'].includes(name)) {
          push(plain(readGroup()), level);
        } else if (['left', 'right', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr', 'displaystyle', 'scriptstyle', 'limits'].includes(name)) {
          // sizing commands: ignore
        } else if (name in SYMBOLS) {
          push(SYMBOLS[name], level);
        } else {
          push(name, level);
        }
      } else if (c === '_' || c === '^') {
        i++;
        const arg = readGroup();
        push(plain(arg), c === '_' ? -1 : 1);
      } else if (c === '{' || c === '}') {
        i++;
      } else if (c === '~') {
        push(' ', level);
        i++;
      } else {
        push(c, level);
        i++;
      }
    }
  };
  walk(0);
  return runs;
}

let measureCtx = null;
const FALLBACK_FONT = '"Latin Modern Math", "STIX Two Math", "Cambria Math", "Times New Roman", serif';

function fallbackEntry(tex) {
  const runs = texToRuns(tex);
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  }
  let w = 0;
  for (const r of runs) {
    const size = r.level ? 700 : 1000;
    if (measureCtx) {
      measureCtx.font = `italic ${size}px ${FALLBACK_FONT}`;
      r.w = measureCtx.measureText(r.text).width;
    } else {
      r.w = r.text.length * size * 0.55;
    }
    w += r.w;
  }
  // viewBox in 1/1000 em, baseline at y = 0 like MathJax output.
  return { kind: 'text', runs, vb: [0, -800, Math.max(w, 300), 1100] };
}

function fallbackText(e) {
  const text = document.createElementNS(NS, 'text');
  text.setAttribute('font-family', FALLBACK_FONT);
  text.setAttribute('font-style', 'italic');
  text.setAttribute('font-size', '1000');
  text.setAttribute('fill', 'currentColor');
  let x = 0;
  for (const r of e.runs) {
    const t = document.createElementNS(NS, 'tspan');
    t.textContent = r.text;
    t.setAttribute('x', x.toFixed(1));
    t.setAttribute('y', r.level < 0 ? '220' : r.level > 0 ? '-380' : '0');
    if (r.level) t.setAttribute('font-size', '700');
    text.appendChild(t);
    x += r.w;
  }
  return text;
}
