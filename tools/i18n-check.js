// 번역 사전 점검: node tools/i18n-check.js [--missing out.txt]
// 코드의 tr('…')·tr`…` 열쇠를 모아 i18n-dict.js 에 없는 것·안 쓰는 것·{0} 자리가 안 맞는 것을 보여 줌
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const ROOT = path.join(__dirname, '..', 'app', 'js');
const files = [];
(function list(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) list(p); else if (p.endsWith('.js') && !/i18n/.test(e.name)) files.push(p); } })(ROOT);
const keys = new Map();
for (const f of files) {
  const ast = acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  walk.simple(ast, {
    CallExpression(n) { if (n.callee.type === 'Identifier' && n.callee.name === 'trc' && n.arguments[1] && n.arguments[1].type === 'Literal') { const k = n.arguments[1].value + '#' + n.arguments[0].value; if (!keys.has(k)) keys.set(k, path.relative(ROOT, f)); } if (n.callee.type === 'Identifier' && n.callee.name === 'tr' && n.arguments[0] && n.arguments[0].type === 'Literal') { const k = n.arguments[0].value; if (!keys.has(k)) keys.set(k, path.relative(ROOT, f)); } },
    TaggedTemplateExpression(n) { if (n.tag.name !== 'tr') return; const q = n.quasi.quasis.map((x) => x.value.cooked); let k = q[0]; for (let i = 1; i < q.length; i++) k += '{' + (i - 1) + '}' + q[i]; if (!keys.has(k)) keys.set(k, path.relative(ROOT, f)); },
  });
}
keys.set('SimpleSketch 3D', 'i18n.js');
for (const t of fs.readFileSync(path.join(ROOT, '..', 'index.html'), 'utf8').matchAll(/title="([^"]*[\uac00-\ud7a3][^"]*)"/g)) keys.set(t[1], 'index.html');
const src = fs.readFileSync(path.join(ROOT, 'i18n-dict.js'), 'utf8');
const dictAst = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
const dict = new Map();
walk.simple(dictAst, { Property(n) { if (n.value.type === 'ArrayExpression' && (n.key.type === 'Literal')) dict.set(n.key.value, n.value.elements.map((e) => e && e.value)); } });
const missing = [...keys].filter(([k]) => !dict.has(k));
const unused = [...dict.keys()].filter((k) => !keys.has(k));
const slots = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join('');
const bad = [...dict].filter(([k, v]) => v.length !== 3 || v.some((x) => typeof x !== 'string' || !x || slots(x) !== slots(k)));
console.log('열쇠', keys.size, '/ 사전', dict.size, '/ 빠진 것', missing.length, '/ 안 쓰는 것', unused.length, '/ 자리 틀린 것', bad.length);
for (const [k, v] of bad.slice(0, 20)) console.log('  틀림:', JSON.stringify(k), JSON.stringify(v));
for (const k of unused.slice(0, 20)) console.log('  안 씀:', JSON.stringify(k));
const mi = process.argv.indexOf('--missing');
if (mi > 0) fs.writeFileSync(process.argv[mi + 1], missing.map(([k, f]) => f + '\t' + JSON.stringify(k)).join('\n'));
else for (const [k, f] of missing.slice(0, 30)) console.log('  빠짐:', f, JSON.stringify(k));
process.exit(missing.length || bad.length ? 1 : 0);
