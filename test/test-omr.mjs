// End-to-end simulation test of the Scantron OMR pipeline.
// Loads the <script> from index.html with a stub DOM, renders a synthetic
// perspective-warped "photo" of a filled answer sheet, and checks that
// readSheet() recovers the planted answers and student ID.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// ---------- minimal DOM/browser stubs ----------
function fakeEl() {
  const el = {
    style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    children: [],
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; },
    value: '', textContent: '', checked: false, width: 0, height: 0,
    addEventListener() {}, setAttribute() {}, appendChild(c) { this.children.push(c); }, after() {}, remove() {},
    querySelectorAll: () => [], focus() {}, scrollIntoView() {}, play: async () => {},
    getContext: () => ({ clearRect() {}, drawImage() {}, beginPath() {}, arc() {}, stroke() {}, fillText() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }) }),
  };
  return el;
}
const els = new Map();
const documentStub = {
  getElementById: id => { if (!els.has(id)) els.set(id, fakeEl()); return els.get(id); },
  createElement: () => fakeEl(),
  querySelectorAll: () => [],
  body: fakeEl(),
};
// real <select> elements always have a value; the stub needs the defaults preset
documentStub.getElementById('shForm').value = '50';
documentStub.getElementById('nqCount').value = '20';
documentStub.getElementById('nqChoices').value = '5';

const storage = new Map();
const localStorageStub = {
  getItem: k => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)),
};
const sandbox = {
  document: documentStub, localStorage: localStorageStub,
  navigator: { mediaDevices: {}, vibrate() {} },
  window: {}, fetch: async () => { throw new Error('no network in test'); },
  confirm: () => true, requestAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout() {},
  console, Math, JSON, Date, Array, Object, Uint8Array, Uint32Array, Int32Array, Uint8ClampedArray,
  Image: function () {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
};
sandbox.window = sandbox;

// evaluate the app script, then pull out the functions under test
const exportNames = ['buildLayout', 'FORMS', 'formForQuestions', 'readSheet', 'homographyFrom4', 'applyH', 'LETTERS'];
const fn = new Function(...Object.keys(sandbox), script + '\nreturn {' + exportNames.join(',') + '};');
const app = fn(...Object.values(sandbox));
console.log('app script evaluated OK');

// ---------- synthetic sheet photo ----------
// Truth homography: page inches -> image pixels (with perspective + offset).
function makeTruthH(app, W, H, skew, rotDeg) {
  // page corners in inches -> image quad
  const m = 60; // margin px
  const dst = [
    [m + skew, m],                 // page (0,0)
    [W - m, m + skew * 0.6],       // page (8.5,0)
    [m, H - m - skew * 0.5],       // page (0,11)
    [W - m - skew, H - m],         // page (8.5,11)
  ];
  // In-plane rotation about the image centre — a phone held at an angle, which
  // the per-quadrant fiducial search does not otherwise see.
  if (rotDeg) {
    const a = rotDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const cx = W / 2, cy = H / 2;
    for (const p of dst) {
      const dx = p[0] - cx, dy = p[1] - cy;
      p[0] = cx + dx * ca - dy * sa;
      p[1] = cy + dx * sa + dy * ca;
    }
  }
  const src = [[0, 0], [8.5, 0], [0, 11], [8.5, 11]];
  return app.homographyFrom4(src, dst);
}

// Separable box blur, to model an out-of-focus / motion-blurred camera frame.
function boxBlur(gray, W, H, radius) {
  if (!radius) return gray;
  const tmp = new Float32Array(W * H), out = new Uint8ClampedArray(W * H);
  const win = radius * 2 + 1;
  for (let y = 0; y < H; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += gray[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = sum / win;
      const add = gray[y * W + Math.min(W - 1, x + radius + 1)];
      const sub = gray[y * W + Math.max(0, x - radius)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = sum / win;
      const add = tmp[Math.min(H - 1, y + radius + 1) * W + x];
      const sub = tmp[Math.max(0, y - radius) * W + x];
      sum += add - sub;
    }
  }
  return out;
}
function invertH(h) {
  // invert 3x3
  const [a, b, c, d, e, f, g, hh, i] = h;
  const A = e * i - f * hh, B = c * hh - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * hh - e * g, Hh = b * g - a * hh, I = a * e - b * d;
  const det = a * A + b * D + c * G;
  return [A, B, C, D, E, F, G, Hh, I].map(v => v / det);
}

function renderPhoto(app, layout, planted, plantedId, W, H, opts) {
  const skew = opts.skew || 0, noise = opts.noise || 0;
  // Fill darkness per bubble. Default 45 (dark pen); a fillFor callback models a
  // light pencil mark or a sheet with mixed ink darkness.
  const fillFor = opts.fillFor || (() => 45);
  // How much of the bubble the student inked, as a fraction of its radius. 1 =
  // a complete fill; smaller models a partial/tentative mark (low confidence).
  const cov = opts.fillCoverage || 1;
  // opts.glyph draws the light-grey printed letter (A–E) at every bubble centre,
  // the real-sheet feature that inflates an unmarked bubble and used to fool the
  // averaging metric. Modelled as a small central mid-grey disk (~9% coverage).
  const glyphV = 140, glyphRR = 0.22;
  const Ht = makeTruthH(app, W, H, skew, opts.rotate || 0);
  const Hinv = invertH(Ht);
  const gray = new Uint8ClampedArray(W * H);
  const fid = layout.fid;
  // precompute filled bubble set, each tagged with its ink darkness
  const filled = [];
  for (const b of layout.bubbles) {
    const want = planted[b.q] || '';
    if (want.includes(app.LETTERS[b.choice])) { b._fill = fillFor(b); filled.push(b); }
  }
  const idFilled = [];
  for (const b of layout.idBubbles) {
    if (plantedId[b.digit] !== undefined && Number(plantedId[b.digit]) === b.value) idFilled.push(b);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // image px -> page inches
      const w = Hinv[6] * x + Hinv[7] * y + Hinv[8];
      const px = (Hinv[0] * x + Hinv[1] * y + Hinv[2]) / w;
      const py = (Hinv[3] * x + Hinv[4] * y + Hinv[5]) / w;
      // Page bow (handheld curl): the printed bubble grid is displaced vertically
      // by a parabola that peaks mid-page and is zero at the fiducials, so the
      // fiducials (and hence the recovered flat homography) stay true while the
      // bubbles drift — most in mid-page. Applied to bubbles/marks only, not the
      // fiducials/desk, exactly the geometry a bowed sheet presents to the scanner.
      const pyb = opts.bow
        ? py - opts.bow * Math.sin(Math.PI * Math.max(0, Math.min(1, (py - 0.55) / 9.9)))
        : py;
      let v = 235; // background/desk + paper
      if (px < -0.2 || px > 8.7 || py < -0.2 || py > 11.2) v = 120; // dark desk
      else {
        // fiducials
        for (const [cx, cy] of fid.centers) {
          if (Math.abs(px - cx) <= fid.size / 2 && Math.abs(py - cy) <= fid.size / 2) { v = 20; break; }
        }
        if (v > 100) {
          for (const b of filled) {
            const dx = px - b.cx, dy = pyb - b.cy;
            const rr = b.r * cov;
            if (dx * dx + dy * dy <= rr * rr) { v = b._fill; break; }
          }
        }
        if (v > 100) {
          for (const b of idFilled) {
            const dx = px - b.cx, dy = pyb - b.cy;
            if (dx * dx + dy * dy <= b.r * b.r) { v = 45; break; }
          }
        }
        // printed letter at each bubble centre (only where still paper, so a
        // fill covers its own letter). Small and mid-grey, like the real form.
        if (opts.glyph && v > 100) {
          for (const b of layout.bubbles) {
            const dx = px - b.cx, dy = pyb - b.cy;
            const gr = b.r * glyphRR;
            if (dx * dx + dy * dy <= gr * gr) { v = glyphV; break; }
          }
        }
        // faint printed bubble outlines (ring) for realism — a hairline, like the
        // real sheet's stroke-width:1 (~0.01"), not a thick band.
        if (v > 100) {
          for (const b of layout.bubbles) {
            const dx = px - b.cx, dy = pyb - b.cy;
            const d2 = dx * dx + dy * dy, r = b.r;
            if (d2 <= r * r && d2 >= (r - 0.008) * (r - 0.008)) { v = 150; break; }
          }
        }
      }
      if (noise) v += (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1) * noise; // deterministic noise
      gray[y * W + x] = Math.max(0, Math.min(255, v));
    }
  }
  // Dark decoy squares in image space — a shadow or clutter on the desk that is
  // fiducial-sized and sits nearer the frame corner than the real one.
  (opts.decoys || []).forEach(d => {
    for (let y = d.y0; y < d.y0 + d.s; y++)
      for (let x = d.x0; x < d.x0 + d.s; x++)
        if (x >= 0 && x < W && y >= 0 && y < H) gray[y * W + x] = d.v == null ? 20 : d.v;
  });
  return opts.blur ? boxBlur(gray, W, H, opts.blur) : gray;
}

function fakeCanvas(gray, W, H) {
  return {
    width: W, height: H,
    getContext: () => ({
      getImageData: () => {
        const data = new Uint8ClampedArray(W * H * 4);
        for (let i = 0; i < W * H; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gray[i]; data[i * 4 + 3] = 255; }
        return { data };
      },
    }),
  };
}

// ---------- run cases ----------
let failures = 0;         // baseline (clean-photo) regressions — must stay 0
let advFailures = 0;      // adversarial gaps — the targets we're driving down
function runCase(name, formKey, numQuestions, planted, plantedId, opts) {
  const layout = app.buildLayout(formKey);
  const W = opts.W || 1000, H = opts.H || 1280;
  const gray = renderPhoto(app, layout, planted, plantedId, W, H, opts);
  const res = app.readSheet(fakeCanvas(gray, W, H), layout, numQuestions);
  const tag = opts.adversarial ? 'ADV ' : '';
  const fail = msg => {
    console.log(`FAIL ${tag}${name}: ${msg}`);
    if (opts.adversarial) advFailures++; else failures++;
  };
  if (!res.ok) { fail(`readSheet not ok (${res.reason})`); return; }
  const wantAnswers = Array.from({ length: numQuestions }, (_, i) => planted[i] || '');
  const gotA = res.answers.join(','), wantA = wantAnswers.join(',');
  const wantId = plantedId.join('');
  let bad = [];
  if (gotA !== wantA) {
    for (let i = 0; i < numQuestions; i++)
      if ((res.answers[i] || '') !== (wantAnswers[i] || '')) bad.push(`Q${i + 1} got "${res.answers[i]}" want "${wantAnswers[i]}"`);
  }
  if (res.studentId !== wantId) bad.push(`ID got "${res.studentId}" want "${wantId}"`);
  if (bad.length) fail('\n  ' + bad.slice(0, 12).join('\n  '));
  else console.log(`PASS ${tag}${name} (thr=${res.thr.toFixed(2)}, max=${res.maxScore.toFixed(2)})`);
}

const key20 = {};
'ABCDEABCDEDCBAEDCBAA'.split('').forEach((ch, i) => key20[i] = ch);
key20[7] = ''; // one blank answer
key20[12] = 'AC'; // one double-mark

runCase('20Q straight-on', '20', 20, key20, [1, 2, 3, 4, 5, 6], { skew: 0 });
runCase('20Q perspective skew', '20', 20, key20, [0, 0, 4, 2, 9, 7], { skew: 55 });
runCase('20Q skew + noise', '20', 20, key20, [3, 1, 4, 1, 5, 9], { skew: 40, noise: 10 });

const key50 = {};
for (let i = 0; i < 50; i++) key50[i] = 'ABCDE'[(i * 7 + 3) % 5];
runCase('50Q straight-on', '50', 50, key50, [9, 8, 7, 6, 5, 4], { skew: 0 });
runCase('50Q perspective', '50', 50, key50, [1, 1, 2, 2, 3, 3], { skew: 45, W: 1100, H: 1400 });

const key100 = {};
for (let i = 0; i < 100; i++) key100[i] = 'ABCDE'[(i * 3 + 1) % 5];
runCase('100Q straight-on', '100', 100, key100, [5, 5, 5, 5, 5, 5], { W: 1300, H: 1660 });
runCase('100Q perspective', '100', 100, key100, [2, 4, 6, 8, 0, 1], { skew: 35, W: 1300, H: 1660 });

// 25-question quiz on a 50-question form (partial read)
const key25 = {};
for (let i = 0; i < 25; i++) key25[i] = 'ABCDE'[i % 5];
runCase('25Q quiz on 50Q form', app.formForQuestions(25), 25, key25, [4, 2], { skew: 20 });

// Corner clutter: a fiducial-sized dark smudge on the paper (staple shadow,
// doodle) just inside the top-left corner, nearer the outer corner than the real
// fiducial and isolated on white so it survives as a blob. A fiducial finder that
// only kept the blob nearest the corner would lock onto this decoy and skew the
// whole homography; selectFiducialQuad out-votes it on area/geometry. On a dense
// 100Q form a corner shift misplaces bubble samples; 20Q is too coarse to show it.
// (The real TL fiducial lands near image (136,136) at this size.) A former
// adversarial case, now a permanent guard against fiducial-clutter regressions.
runCase('decoy smudge inside top-left corner', '100', 100, key100, [5, 5, 5, 5, 5, 5],
  { skew: 0, W: 1300, H: 1660, decoys: [{ x0: 72, y0: 72, s: 34 }] });

// Rotation and blur are already handled; kept as baseline guards.
runCase('8-degree rotation', '20', 20, key20, [1, 2, 3, 4, 5, 6], { skew: 10, rotate: 8 });
runCase('blurred frame', '50', 50, key50, [9, 8, 7, 6, 5, 4], { skew: 20, blur: 3, W: 1100, H: 1400 });

// Bowed page (handheld curl): the fiducials stay true but the bubble grid is
// displaced most in mid-page, so a flat homography samples the top questions off
// their marks — the exact real-sheet failure (coverage climbing 0.06→1.0 down the
// page). The per-row snap in readSheet locks each row back onto its mark. bow=0.14"
// shifts the top row ~1.6 bubble radii; without snapping these top rows read blank.
runCase('bowed page, glyphs', '20', 20, key20, [1, 2, 3, 4, 5, 6], { skew: 0, bow: 0.14, glyph: true });
// Dense forms have tighter rows, so they tolerate less bow before a row would
// reach its neighbour; a milder curl here (flatten dense sheets when scanning).
runCase('bowed page, dense 100Q', '100', 100, key100, [5, 5, 5, 5, 5, 5], { bow: 0.08, glyph: true, W: 1300, H: 1660 });

// Mixed ink: some marks firm pen, some light pencil — but all COMPLETE fills. The
// coverage-fraction metric reads a filled bubble as filled regardless of how dark
// the pencil is, so mixed darkness on one sheet all comes through.
runCase('mixed pen/pencil darkness', '20', 20, key20, [1, 2, 3, 4, 5, 6],
  { skew: 0, fillFor: b => ([2, 7, 14].includes(b.q) ? 165 : 45) });

// A whole sheet in light-but-complete pencil (v=180). Coverage, not darkness, is
// what's measured, so a fully-filled light bubble reads as confidently as a dark
// one. (Below ~20% contrast a mark would start to be missed — that's the floor.)
runCase('light-but-complete pencil', '20', 20, key20, [1, 2, 3, 4, 5, 6],
  { skew: 0, fillFor: () => 180 });

// Printed A–E letters at every bubble centre (the real-sheet feature the synthetic
// renderer used to lack). The averaging metric let those letters lift unmarked
// bubbles toward the cut; the coverage fraction ignores the thin letter and only
// the actually-filled bubbles read. Guards against glyph false-positives.
runCase('printed letters in every bubble', '20', 20, key20, [1, 2, 3, 4, 5, 6],
  { skew: 0, glyph: true });
runCase('printed letters, dense 100Q', '100', 100, key100, [5, 5, 5, 5, 5, 5],
  { glyph: true, W: 1300, H: 1660 });

// ---------- confidence signal (minMargin) ----------
// readSheet reports how far the weakest accepted mark cleared its per-question
// cut; the UI (isLowConfidence, LOW_MARGIN = 0.08) holds a scan for review below
// that. Check the signal separates a complete fill from a tentative partial one.
const LOW_MARGIN = 0.08;
function marginOf(formKey, numQ, planted, plantedId, opts) {
  const layout = app.buildLayout(formKey);
  const W = opts.W || 1000, H = opts.H || 1280;
  const gray = renderPhoto(app, layout, planted, plantedId, W, H, opts);
  return app.readSheet(fakeCanvas(gray, W, H), layout, numQ).minMargin;
}
const firmMargin = marginOf('20', 20, key20, [1, 2, 3, 4, 5, 6], { skew: 0 });
// A partial fill (~30% of the radius) — detected, but only just, so it's flagged.
const partialMargin = marginOf('20', 20, key20, [1, 2, 3, 4, 5, 6], { skew: 0, fillCoverage: 0.30 });
if (!(firmMargin >= LOW_MARGIN)) {
  console.log(`FAIL confidence: firm sheet flagged low (minMargin=${firmMargin.toFixed(3)})`); failures++;
} else if (!(partialMargin < LOW_MARGIN)) {
  console.log(`FAIL confidence: partial fill not flagged (minMargin=${partialMargin.toFixed(3)})`); failures++;
} else {
  console.log(`PASS confidence signal (firm=${firmMargin.toFixed(3)} ≥ ${LOW_MARGIN} > partial=${partialMargin.toFixed(3)})`);
}

console.log('\n' + (failures ? `${failures} BASELINE case(s) FAILED` : 'baseline: ALL PASSED') +
  (advFailures ? ` · adversarial: ${advFailures} exposing gaps` : ''));
// Only baseline regressions break the build; adversarial gaps are tracked, not fatal.
process.exit(failures ? 1 : 0);
