// Browser tests: draw with a simulated pen and check the generated tikz-cd.
// Needs dev dependencies (npm install) and a Chromium for Playwright (npx playwright install chromium).
// Run: npm run e2e
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const MATHJAX = fs.readFileSync(require.resolve('mathjax/es5/tex-svg.js'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(file, 'index.html');
    if (fs.existsSync(index)) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(index)); return; }
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

async function session({ claude = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://cdnjs.cloudflare.com/**', (r) => r.fulfill({ body: MATHJAX, contentType: 'text/javascript' }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  if (claude) {
    // A stand-in for the claude.ai artifact runtime.
    await page.addInitScript(() => {
      const sample = async () => ({ text: '' });
      sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 4, maxInputBytes: 2e7, mediaTypes: ['image/png'] } });
      sample.json = async (input) => (input.includes('short handwritten') ? { latex: 'X_1' } : {
        nodes: [{ id: 'a', row: 0, col: 0, label: 'P' }, { id: 'b', row: 0, col: 1, label: 'Y' }, { id: 'c', row: 1, col: 0, label: 'X' }, { id: 'd', row: 1, col: 1, label: 'Z' }],
        edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd', label: 'g' }, { from: 'c', to: 'd', label: 'f', label_side: 'right' }],
        corners: [{ at: 'a', toward: 'd' }],
      });
      window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
    });
  }
  await page.goto(base);
  await page.waitForFunction(() => window.cdSketchpad && window.MathJax && window.MathJax.tex2svg);
  await page.click('#btn-clear');
  await page.click('#confirm-yes');
  const cell = (c, r) => page.evaluate(([c, r]) => window.cdSketchpad.cellToClient(c, r), [c, r]);
  const k = () => page.evaluate(() => window.cdSketchpad.app.view.k);
  // The code panel refreshes on the next animation frame.
  const code = async () => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page.textContent('#code-text');
  };
  const state = () => page.evaluate(() => JSON.parse(window.cdSketchpad.app.diagram.snapshot()));
  async function stroke(pts, gap = 5) {
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / gap));
      for (let j = 1; j <= n; j++) await page.mouse.move(a.x + ((b.x - a.x) * j) / n, a.y + ((b.y - a.y) * j) / n);
    }
    await page.mouse.up();
  }
  // A hand-drawn line between two cells: slightly wobbly, optionally bowed (+ = left of travel).
  async function line(c0, r0, c1, r1, { bow = 0, prefix = [] } = {}) {
    const a = await cell(c0, r0), b = await cell(c1, r1);
    const A = { x: a.x + 6, y: a.y + 4 }, B = { x: b.x - 8, y: b.y - 5 };
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    const d = { x: dx / L, y: dy / L }, n = { x: dy / L, y: -dx / L };
    const pts = prefix.map((f) => f(A, d, n));
    for (let i = 0; i <= 30; i++) {
      const t = i / 30, off = bow * L * 4 * t * (1 - t) + 2 * Math.sin(t * 17);
      pts.push({ x: A.x + dx * t + n.x * off, y: A.y + dy * t + n.y * off });
    }
    await stroke(pts, 4);
  }
  async function objects(list) {
    for (const [c, r, label] of list) {
      const p = await cell(c, r);
      await page.mouse.click(p.x, p.y);
      await page.keyboard.type(label);
      await page.keyboard.press('Enter');
    }
  }
  return { page, errors, cell, k, code, state, stroke, line, objects };
}

const results = [];
async function scenario(name, fn, opts) {
  const s = await session(opts);
  try {
    await fn(s);
    assert.deepEqual(s.errors, []);
    results.push(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}`);
  } finally {
    await s.page.close();
  }
}

await scenario('taps, labels and strokes give the Vakil 1.3.B diagram', async (s) => {
  await s.objects([[0, 0, 'X_1'], [1, 1, 'Y'], [2, 1, 'Z'], [0, 2, 'X_2']]);
  await s.line(0, 0, 1, 1);
  await s.line(0, 2, 1, 1);
  await s.line(1, 1, 2, 1, { bow: 0.12 });
  assert.equal(await s.code(), '\\begin{tikzcd}\n  X_1 \\arrow[dr] \\\\\n  & Y \\arrow[r, bend left] & Z \\\\\n  X_2 \\arrow[ur]\n\\end{tikzcd}');
});

await scenario('dashes make a dashed arrow to a new object; a zig-zag deletes it', async (s) => {
  await s.objects([[0, 0, 'A']]);
  const a = await s.cell(0, 0), b = await s.cell(1, 0);
  const seg = (t0, t1) => [{ x: a.x + (b.x - a.x) * t0 + 10, y: a.y }, { x: a.x + (b.x - a.x) * t1 + 10, y: a.y }];
  await s.stroke(seg(0.05, 0.28), 3);
  await s.stroke(seg(0.36, 0.6), 3);
  await s.stroke(seg(0.68, 0.95), 3);
  await s.page.waitForTimeout(900);
  await s.page.keyboard.type('B');
  await s.page.keyboard.press('Enter');
  assert.match(await s.code(), /A \\arrow\[r, dashed\] & B/);
  const mx = (a.x + b.x) / 2;
  await s.stroke([0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: mx - 14 + (i % 2) * 28, y: a.y - 18 + i * 6 })), 3);
  assert.match(await s.code(), /^\\begin\{tikzcd\}\n  A & B\n/);
});

await scenario('marks change arrow styles: hook, maps to, two heads, pullback corner, loop', async (s) => {
  await s.objects([[0, 0, 'A'], [1, 0, 'B'], [0, 1, 'C'], [1, 1, 'D']]);
  await s.line(0, 0, 1, 0, {
    prefix: [
      (A, d, n) => ({ x: A.x + n.x * 10 + d.x * 2, y: A.y + n.y * 10 + d.y * 2 }),
      (A, d, n) => ({ x: A.x + n.x * 9 - d.x * 4, y: A.y + n.y * 9 - d.y * 4 }),
      (A, d, n) => ({ x: A.x + n.x * 5 - d.x * 7, y: A.y + n.y * 5 - d.y * 7 }),
      (A, d, n) => ({ x: A.x + n.x * 1 - d.x * 4, y: A.y + n.y * 1 - d.y * 4 }),
    ],
  });
  await s.line(0, 0, 0, 1);
  const k = await s.k();
  const a = await s.cell(0, 0);
  await s.stroke([{ x: a.x - 9 * k, y: a.y + 22 * k }, { x: a.x + 9 * k, y: a.y + 22 * k }], 2);
  await s.line(1, 0, 1, 1);
  const d = await s.cell(1, 1);
  const tip = d.y - 16 * k;
  await s.stroke([{ x: d.x - 8 * k, y: tip - 16 * k }, { x: d.x, y: tip - 6 * k }, { x: d.x + 8 * k, y: tip - 16 * k }], 2);
  await s.stroke([{ x: d.x - 8 * k, y: tip - 22 * k }, { x: d.x, y: tip - 12 * k }, { x: d.x + 8 * k, y: tip - 22 * k }], 2);
  await s.line(0, 1, 1, 1);
  const cx = a.x + 30 * k, cy = a.y + 26 * k;
  await s.stroke([{ x: cx + 12 * k, y: cy - 8 * k }, { x: cx + 12 * k, y: cy + 8 * k }, { x: cx - 4 * k, y: cy + 8 * k }], 2);
  const loop = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    loop.push({ x: d.x + (t - 0.5) * 30 * k, y: d.y + 8 * k + 60 * k * Math.sin(t * Math.PI) });
  }
  await s.stroke(loop, 3);
  assert.equal(await s.code(), [
    '\\begin{tikzcd}',
    '  A \\arrow[r, hook] \\arrow[d, maps to] \\arrow[dr, phantom, "\\lrcorner", very near start] & B \\arrow[d, two heads] \\\\',
    '  C \\arrow[r] & D \\arrow[loop, distance=2em, in=235, out=305]',
    '\\end{tikzcd}',
  ].join('\n'));
});

await scenario('long-press moves, select tool bends, lasso selects, undo restores', async (s) => {
  await s.objects([[0, 0, 'A'], [1, 0, 'B'], [0, 1, 'C']]);
  await s.line(0, 0, 1, 0);
  const b = await s.cell(1, 0), b2 = await s.cell(2, 0);
  await s.page.mouse.move(b.x, b.y);
  await s.page.mouse.down();
  await s.page.waitForTimeout(600);
  await s.page.mouse.move(b2.x, b2.y, { steps: 10 });
  await s.page.mouse.up();
  assert.match(await s.code(), /A \\arrow\[rr\] & & B/);
  await s.page.keyboard.press('Control+z');
  assert.match(await s.code(), /A \\arrow\[r\] & B/);
  await s.page.click('.tool[data-tool="select"]');
  const a = await s.cell(0, 0);
  const mx = (a.x + b.x) / 2;
  await s.page.mouse.move(mx, a.y);
  await s.page.mouse.down();
  for (let i = 1; i <= 8; i++) await s.page.mouse.move(mx, a.y - i * 3);
  await s.page.mouse.up();
  assert.match(await s.code(), /A \\arrow\[r, bend left=25\]/);
  await s.page.click('.tool[data-tool="pen"]');
  const c = await s.cell(0, 1);
  const ring = [];
  for (let i = 0; i <= 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    ring.push({ x: a.x + 45 * Math.cos(t), y: (a.y + c.y) / 2 + 120 * Math.sin(t) });
  }
  await s.stroke(ring, 4);
  const sel = await s.page.evaluate(() => [...window.cdSketchpad.app.selection.nodes].map((id) => window.cdSketchpad.app.diagram.node(id).label).sort());
  assert.deepEqual(sel, ['A', 'C']);
});

await scenario('tikz-cd import and CD export', async (s) => {
  await s.page.click('#btn-import');
  await s.page.fill('#import-text', '\\begin{tikzcd} A \\arrow[r, "f"] \\arrow[d, "g"\'] & B \\arrow[d, "h"] \\\\ C \\arrow[r, "k"\'] & D \\end{tikzcd}');
  await s.page.click('#import-apply');
  await s.page.click('#tab-cd');
  assert.equal(await s.code(), '\\begin{CD}\n  A @>{f}>> B \\\\\n  @V{g}VV @VV{h}V \\\\\n  C @>>{k}> D\n\\end{CD}');
});

await scenario('handwriting and sketches are read by Claude when available', async (s) => {
  const c = await s.cell(1, 1);
  await s.stroke([{ x: c.x - 12, y: c.y - 14 }, { x: c.x + 12, y: c.y + 14 }], 2);
  await s.stroke([{ x: c.x + 12, y: c.y - 14 }, { x: c.x - 12, y: c.y + 14 }], 2);
  await s.page.waitForFunction(() => window.cdSketchpad.app.diagram.nodes.some((n) => n.label === 'X_1'));
  await s.page.click('.tool[data-tool="sketch"]');
  await s.page.click('#btn-zoom-out');
  await s.page.click('#btn-zoom-out');
  const a = await s.cell(2, 0), b = await s.cell(3, 1);
  await s.stroke([{ x: a.x, y: a.y }, { x: b.x, y: a.y }], 4);
  await s.stroke([{ x: a.x, y: a.y }, { x: a.x, y: b.y }], 4);
  await s.page.click('#btn-recognize');
  await s.page.waitForFunction(() => window.cdSketchpad.app.diagram.nodes.length === 5);
  assert.match(await s.code(), /P \\arrow\[r\] \\arrow\[d\] \\arrow\[dr, phantom, "\\lrcorner", very near start\] & Y \\arrow\[d, "g"\]/);
  assert.equal((await s.state()).ink.length, 0);
}, { claude: true });

await browser.close();
server.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
