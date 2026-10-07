// Builds dist/phac-so-do.html: the whole app in one file that opens with a double click
// (file://), with CSS, the ES modules and MathJax inlined so it also works offline.
// Usage: npm install && npm run build:single
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- bundle the ES modules into one script with a tiny module registry ----

const liveLets = new Set();
const modules = [];
for (const file of fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).sort()) {
  let code = read(`js/${file}`);
  const exported = [];
  const imports = [];
  code = code.replace(/^import\s*\*\s*as\s+(\w+)\s+from\s*'(\.\/[\w-]+\.js)';/gm, (_, name, from) => {
    imports.push({ from, names: [] });
    return `const ${name} = __require('${from}');`;
  });
  code = code.replace(/^import\s*\{([^}]*)\}\s*from\s*'(\.\/[\w-]+\.js)';/gm, (_, list, from) => {
    const names = list.split(',').map((s) => s.trim()).filter(Boolean);
    imports.push({ from, names: names.map((n) => n.split(/\s+as\s+/)[0]) });
    return `const { ${names.map((n) => n.replace(/\s+as\s+/, ': ')).join(', ')} } = __require('${from}');`;
  });
  if (/^import\s/m.test(code)) throw new Error(`${file}: unsupported import form`);
  code = code.replace(/^export\s+((?:async\s+)?function\*?|class|const|let)\s+(\w+)/gm, (_, kind, name) => {
    exported.push(name);
    if (kind === 'let') liveLets.add(`${file}:${name}`);
    return `${kind} ${name}`;
  });
  code = code.replace(/^export\s*\{([^}]*)\};?/gm, (_, list) => {
    for (const n of list.split(',').map((s) => s.trim()).filter(Boolean)) exported.push(n);
    return '';
  });
  if (/^export\s/m.test(code)) throw new Error(`${file}: unsupported export form`);
  modules.push({ file, code, exported, imports });
}
// Named imports are copied once; a re-assigned `export let` would go stale.
for (const m of modules) {
  for (const imp of m.imports) {
    for (const n of imp.names) {
      if (liveLets.has(`${imp.from.slice(2)}:${n}`)) throw new Error(`${m.file} imports live binding ${n}`);
    }
  }
}

const bundle = [
  'const __defs = {}, __cache = {};',
  'function __require(name) {',
  '  if (!(name in __cache)) { __cache[name] = {}; __cache[name] = __defs[name](__require); }',
  '  return __cache[name];',
  '}',
  ...modules.map((m) => [
    `__defs['./${m.file}'] = function (__require) {`,
    m.code,
    `return { ${m.exported.map((n) => `get ${n}() { return ${n}; }`).join(', ')} };`,
    '};',
  ].join('\n')),
  "__require('./main.js');",
].join('\n');

// ---- assemble the page ----

const inlineScript = (s) => s.replace(/<\/script/gi, '<\\/script');
const mathjax = fs.readFileSync(require.resolve('mathjax/es5/tex-svg.js'), 'utf8');
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5';
let html = read('index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="css/app.css">', `<style>\n${read('css/app.css')}</style>`);
// MathJax is inlined; extensions it may fetch later still come from the CDN.
swap("    tex: { packages: { '[+]': ['ams'] } },", `    loader: { paths: { mathjax: '${CDN}' } },\n    tex: { packages: { '[+]': ['ams'] } },`);
swap(`<script defer src="${CDN}/tex-svg.js"></script>`,
  `<script>/* MathJax 3.2.2 — Apache License 2.0, https://www.mathjax.org */\n${inlineScript(mathjax)}\n</script>`);
swap('<script type="module" src="js/main.js"></script>', `<script type="module">\n${inlineScript(bundle)}\n</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'phac-so-do.html');
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB)`);
