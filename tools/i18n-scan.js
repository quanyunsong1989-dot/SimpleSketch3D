// 앱 안의 한글 글자(문자열)를 전부 찾아 보여 줌: node tools/i18n-scan.js [--json out.json]
// 번역 안 된 글이 남았는지 볼 때 씀 (T(...)·T`...`로 감싼 것과 주석은 뺌)
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.join(__dirname, '..', 'app', 'js');
const HANGUL = /[가-힣]/;
const files = [];
(function list(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) list(p); else if (p.endsWith('.js')) files.push(p); } })(ROOT);

const out = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true }); } catch (e) { console.error('파싱 실패', f, e.message); continue; }
  walk.ancestor(ast, {
    Literal(n, st, anc) {
      if (typeof n.value !== 'string' || !HANGUL.test(n.value)) return;
      const p = anc[anc.length - 2];
      if (p && p.type === 'CallExpression' && p.callee.type === 'Identifier' && (p.callee.name === 'tr' || p.callee.name === 'trc')) return;
      out.push({ file: path.relative(ROOT, f), line: n.loc.start.line, kind: 'str', parent: p ? p.type : '', text: n.value });
    },
    TemplateLiteral(n, st, anc) {
      const raw = n.quasis.map((q) => q.value.cooked).join('{}');
      if (!HANGUL.test(raw)) return;
      const p = anc[anc.length - 2];
      if (p && p.type === 'TaggedTemplateExpression' && p.tag.name === 'tr') return;
      out.push({ file: path.relative(ROOT, f), line: n.loc.start.line, kind: 'tpl', parent: p ? p.type : '', text: raw });
    },
  });
}
const j = process.argv.indexOf('--json');
if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));
const by = {};
for (const o of out) by[o.file] = (by[o.file] || 0) + 1;
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => v + ' ' + k).join('\n'));
console.log('합계', out.length, '/ 서로 다른 글', new Set(out.map((o) => o.text)).size, '/ 글자 수', [...new Set(out.map((o) => o.text))].join('').length);
