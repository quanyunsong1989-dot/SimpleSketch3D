// 앱으로 묶기: node build.js → %TEMP%\sketch3d-build\SimpleSketch3D
// node build.js --public : 남에게 줄 판. .skp 기능(스케치업 SDK)을 빼고, 시험 스크립트 기능을 끄고,
//   라이선스 글을 넣어 release\SimpleSketch3D-<버전>-win-x64.zip 까지 만든다 (Trimble 승인 전에는 꼭 이걸로)
// (@electron/packager는 Node 26에서 압축 풀기가 멈춰서, 이미 풀린 Electron을 복사해 직접 묶는다)
const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');
const ResEdit = require('resedit');
const pkg = require('./package.json');

const SRC = __dirname;
const ELECTRON = path.join(SRC, 'node_modules', 'electron', 'dist');
const OUT = path.join(os.tmpdir(), 'sketch3d-build', 'SimpleSketch3D');
const PUBLIC = process.argv.includes('--public');
// .skp 부분(skp-pack.js)은 Trimble 승인 전이라 공개 소스·공개판에는 없음. 파일이 있을 때만 씀
const skpPack = !PUBLIC && fs.existsSync(path.join(SRC, 'skp-pack.js')) ? require('./skp-pack.js') : null;

function copyDir(a, b, filter) {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const s = path.join(a, e.name), d = path.join(b, e.name);
    if (filter && !filter(s)) continue;
    if (e.isDirectory()) copyDir(s, d, filter); else fs.copyFileSync(s, d);
  }
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(ELECTRON, OUT);
  fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, 'SimpleSketch3D.exe'));
  fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });
  // 앱 파일 모아서 app.asar
  const stage = path.join(os.tmpdir(), 'sketch3d-build', 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const p2 = { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: 'main.js', public: PUBLIC };
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(p2, null, 2));
  for (const f of ['main.js', 'preload.js']) fs.copyFileSync(path.join(SRC, f), path.join(stage, f));
  copyDir(path.join(SRC, 'app'), path.join(stage, 'app'));
  if (skpPack) skpPack.stage(stage);
  await asar.createPackageWithOptions(stage, path.join(OUT, 'resources', 'app.asar'), { unpack: '*.node' });
  console.log(skpPack ? '내 PC용: .skp 기능 포함 (남에게 주지 말 것)' : '공개판: .skp 기능 없음');
  // 아이콘·이름 넣기
  const exePath = path.join(OUT, 'SimpleSketch3D.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(SRC, 'build_icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const [a, b, c] = pkg.version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: 'SimpleSketch 3D', FileDescription: 'SimpleSketch 3D', CompanyName: 'SimpleSketch 3D contributors',
    InternalName: 'SimpleSketch3D', OriginalFilename: 'SimpleSketch3D.exe', LegalCopyright: '(c) 2026 SimpleSketch 3D contributors, MIT License', ProductVersion: pkg.version, FileVersion: pkg.version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  fs.rmSync(stage, { recursive: true, force: true });
  // 라이선스 글: 우리 것(MIT)·남의 것(three.js·Electron)
  const P = path.join(SRC, 'public'), LIC = path.join(OUT, 'licenses');
  fs.mkdirSync(LIC, { recursive: true });
  fs.renameSync(path.join(OUT, 'LICENSE'), path.join(LIC, 'electron-LICENSE.txt'));
  fs.copyFileSync(path.join(SRC, 'node_modules', 'three', 'LICENSE'), path.join(LIC, 'three.js-LICENSE.txt'));
  // 렌더링 창이 쓰는 것 (app/lib/rt)
  const RT = path.join(SRC, 'app', 'lib', 'rt');
  for (const [src, name] of [['three/LICENSE', 'three.js-r187-LICENSE.txt'], ['three-gpu-pathtracer/LICENSE', 'three-gpu-pathtracer-LICENSE.txt'], ['three-mesh-bvh/LICENSE', 'three-mesh-bvh-LICENSE.txt'], ['oidn/LICENSE', 'oidn-webgpu-LICENSE.txt'], ['oidn/WEIGHTS-LICENSE.txt', 'open-image-denoise-weights-LICENSE.txt']]) fs.copyFileSync(path.join(RT, src), path.join(LIC, name));
  if (skpPack) skpPack.resources(OUT, LIC);
  fs.copyFileSync(path.join(P, 'LICENSE'), path.join(OUT, 'LICENSE.txt'));
  fs.copyFileSync(path.join(P, 'THIRD-PARTY-NOTICES.md'), path.join(OUT, 'THIRD-PARTY-NOTICES.md'));
  fs.copyFileSync(path.join(P, 'README.txt'), path.join(OUT, 'README.txt'));
  // 예제 모델 (조명 넣은 거실)
  if (fs.existsSync(path.join(P, 'samples'))) copyDir(path.join(P, 'samples'), path.join(OUT, 'samples'));
  console.log(OUT);
  if (PUBLIC) {
    // 올릴 zip (윈도우 기본 tar로 묶음). 폴더 이름째 들어가게
    const REL = path.join(SRC, 'release');
    fs.mkdirSync(REL, { recursive: true });
    const zip = path.join(REL, 'SimpleSketch3D-' + pkg.version + '-win-x64.zip');
    fs.rmSync(zip, { force: true });
    const tar = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe');
    require('child_process').execFileSync(tar, ['-a', '-c', '-f', zip, '-C', path.dirname(OUT), path.basename(OUT)], { stdio: 'inherit' });
    console.log(zip + ' (' + Math.round(fs.statSync(zip).size / 1e6) + 'MB)');
  }
})().catch((e) => { console.error(e); process.exit(1); });
