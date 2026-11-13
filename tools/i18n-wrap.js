// 한 번 쓰는 도구: app/js 안의 한글 글자를 번역 함수 tr로 감싼다.
//   '저장' → tr('저장'),  `면 ${n}개` → tr`면 ${n}개`,  '면 ' + n + '개' → tr`면 ${n}개`
// 주석과 console.* 안의 글은 그대로 둔다. 바뀌지 않을 때까지 여러 번 돈다 (감싼 것 안의 글까지)
// 사용: node tools/i18n-wrap.js [파일...]  (안 주면 app/js 전부)
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.join(__dirname, '..', 'app', 'js');
const H = /[가-힣]/;
const isTr = (n) => n && n.type === 'Identifier' && n.name === 'tr';
const escTpl = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');

function pass(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
  const edits = [];
  const taken = [];   // 이미 고칠 구간 (겹치면 다음 차례로)
  const inTaken = (n) => taken.some(([a, b]) => n.start >= a && n.end <= b);
  const skip = (anc) => anc.some((a) => (a.type === 'CallExpression' && ((a.callee.type === 'MemberExpression' && a.callee.object.name === 'console') || isTr(a.callee))) || (a.type === 'TaggedTemplateExpression' && isTr(a.tag)));
  const strLit = (n) => n.type === 'Literal' && typeof n.value === 'string';
  // 1) '+' 이음: 맨 위 '+'만
  walk.ancestor(ast, {
    BinaryExpression(n, st, anc) {
      if (n.operator !== '+') return;
      const p = anc[anc.length - 2];
      if (p && p.type === 'BinaryExpression' && p.operator === '+' && p.left === n) return;
      if (skip(anc.slice(0, -1)) || inTaken(n)) return;
      const ops = [];
      let cur = n;
      const spine = [];
      while (cur.type === 'BinaryExpression' && cur.operator === '+') { spine.push(cur); ops.unshift(cur.right); cur = cur.left; }
      ops.unshift(cur);
      const korean = ops.some((o) => (strLit(o) && H.test(o.value)) || (o.type === 'TemplateLiteral' && o.quasis.some((q) => H.test(q.value.cooked))));
      if (!korean) return;
      const k = ops.findIndex((o) => strLit(o) || o.type === 'TemplateLiteral');
      let body = '';
      let start = 0;
      if (k >= 2) { const pre = spine[spine.length - k + 1]; body += '${' + src.slice(pre.start, pre.end) + '}'; start = k; }
      for (let i = start; i < ops.length; i++) {
        const o = ops[i];
        if (strLit(o)) body += escTpl(o.value);
        else if (o.type === 'TemplateLiteral') { o.quasis.forEach((q, j) => { body += q.value.raw; if (j < o.expressions.length) body += '${' + src.slice(o.expressions[j].start, o.expressions[j].end) + '}'; }); }
        else body += '${' + src.slice(o.start, o.end) + '}';
      }
      edits.push([n.start, n.end, 'tr`' + body + '`']);
      taken.push([n.start, n.end]);
    },
  });
  // 2) 남은 글자·템플릿
  walk.ancestor(ast, {
    Literal(n, st, anc) {
      if (!strLit(n) || !H.test(n.value) || inTaken(n) || skip(anc.slice(0, -1))) return;
      const p = anc[anc.length - 2];
      if (p && p.type === 'Property' && p.key === n) return;
      edits.push([n.start, n.end, 'tr(' + src.slice(n.start, n.end) + ')']);
      taken.push([n.start, n.end]);
    },
    TemplateLiteral(n, st, anc) {
      if (!n.quasis.some((q) => H.test(q.value.cooked)) || inTaken(n) || skip(anc.slice(0, -1))) return;
      const p = anc[anc.length - 2];
      if (p && p.type === 'TaggedTemplateExpression') return;
      edits.push([n.start, n.start, 'tr']);
      taken.push([n.start, n.end]);
    },
  });
  if (!edits.length) return null;
  edits.sort((a, b) => b[0] - a[0]);
  let out = src;
  let last = Infinity;
  for (const [a, b, r] of edits) { if (b > last) continue; out = out.slice(0, a) + r + out.slice(b); last = a; }
  return out;
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : (function list(d, acc = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) list(p, acc); else if (p.endsWith('.js') && !/i18n/.test(e.name)) acc.push(p); } return acc; })(ROOT);
for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  const orig = src;
  for (let i = 0; i < 6; i++) { const r = pass(src); if (r == null) break; src = r; }
  if (src === orig) continue;
  if (!/import \{[^}]*\btr\b[^}]*\} from '\.{1,2}\/i18n\.js'/.test(src)) {
    const rel = path.relative(path.dirname(f), path.join(ROOT, 'i18n.js')).replace(/\\/g, '/');
    const imp = "import { tr } from '" + (rel.startsWith('.') ? rel : './' + rel) + "';\n";
    const m = [...src.matchAll(/^import .*;$/gm)].pop();
    src = m ? src.slice(0, m.index + m[0].length + 1) + imp + src.slice(m.index + m[0].length + 1) : src.replace(/^(\/\/.*\n)*/, (h) => h + imp);
  }
  acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });   // 깨지지 않았는지
  fs.writeFileSync(f, src);
  console.log('고침', path.relative(ROOT, f));
}
