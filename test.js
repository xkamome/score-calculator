// node test.js — 驗證模型能重現原圖的對照表，並檢查各分布的數值正確性
const M = require('./model.js');
const { GAMES, makeDist, judge, sdForRate } = M;

let fail = 0;
const check = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(4)}, want ${want} (±${tol})`);
};

// 1. 原圖的對照表（σ → IIDX 分數率 %, pop'n 分數）
const table = [
  [18.63, 77.78, 94394], [17.86, 79.37, 95000], [15.97, 83.33, 96425], [13.62, 88.23, 98000],
  [13.30, 88.89, 98191], [11.75, 91.98, 99000], [10.42, 94.44, 99506]
];
for (const [sd, iidx, popn] of table) {
  const d = makeDist('normal', sd);
  check(`σ=${sd} IIDX`, judge(GAMES.iidx, d).rate * 100, iidx, 0.02);
  check(`σ=${sd} pop'n`, judge(GAMES.popn, d).rate * 1e5, popn, 8);
}

// 2. 反解：各評級需要的 σ
const need = [['iidx', 'AA', 18.63], ['iidx', 'AAA−', 15.97], ['iidx', 'AAA', 13.30], ['iidx', 'MAX−', 10.42],
  ['popn', 'AAA', 17.86], ['popn', 'S', 13.62], ['popn', 'S+', 11.75]];
for (const [g, r, sd] of need) {
  const rank = GAMES[g].ranks.find(k => k.name === r);
  check(`${g} ${r} 所需 σ`, sdForRate(GAMES[g], 'normal', rank.rate), sd, 0.01);
}

// 3. 各分布：pdf 積分 = pIn、標準差 = sd
const integ = (f, a, b, n = 20000) => {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
};
const cases = [['normal', {}], ['mixture', { p: 0.15, k: 3.5 }], ['t', { nu: 4 }], ['t', { nu: 12 }],
  ['gn', { beta: 1 }], ['gn', { beta: 1.4 }], ['gn', { beta: 4 }],
  ['shift', { dr: 0.8 }], ['shift', { dr: 1.8 }], ['plateau', { ar: 0.5 }], ['plateau', { ar: 3 }]];
for (const [m, prm] of cases) {
  const d = makeDist(m, 14, 3, prm);
  const tag = `${m} ${JSON.stringify(prm)}`;
  check(`${tag} ∫pdf[-25,25] vs pIn`, integ(d.pdf, -25, 25), d.pIn(25), 1e-6);
  check(`${tag} cdf+sf`, d.cdf(40) + d.sf(40), 1, 1e-12);
  if (m !== 't' || prm.nu > 5) {
    const R = 3000;
    const v = integ(x => (x - 3) ** 2 * d.pdf(x), -R, R, 400000);
    check(`${tag} SD`, Math.sqrt(v), 14, 0.02);
  }
}

// 4. 特殊情況：GN β=2 = 常態、t ν 大 ≈ 常態
const n = makeDist('normal', 13, 0);
check('GN β=2 vs 常態', makeDist('gn', 13, 0, { beta: 2 }).pIn(16.67), n.pIn(16.67), 1e-6);
check('t ν=30 vs 常態 (接近)', makeDist('t', 13, 0, { nu: 30 }).pIn(16.67), n.pIn(16.67), 0.01);

// 5. 由判定數反推 GN：來回一致
for (const beta of [0.8, 1.3, 2, 3.5]) {
  const d = makeDist('gn', 14, 0, { beta });
  const f = M.fitGN(d.pIn(16.67), d.pIn(33.33), 16.67, 33.33);
  check(`fitGN β=${beta}`, f.beta, beta, 0.005);
  check(`fitGN β=${beta} SD`, f.sd, 14, 0.02);
}

// 6. 關鍵現象：同 SD 下，厚尾 → IIDX 升、pop'n 降
const sd = 13.3;
for (const [m, prm] of [['normal', {}], ['mixture', { p: 0.1, k: 3 }], ['t', { nu: 4 }], ['gn', { beta: 1.3 }], ['gn', { beta: 1 }],
  ['gn', { beta: 4 }], ['shift', { dr: 0.9 }], ['plateau', { ar: 2 }]]) {
  const d = makeDist(m, sd, 0, prm);
  const i = judge(GAMES.iidx, d).rate, p = judge(GAMES.popn, d).rate;
  const eq = judge(GAMES.popn, makeDist(m, sdForRate(GAMES.iidx, m, 16 / 18, 0, prm), 0, prm)).rate;
  console.log(`  ${m.padEnd(8)} ${JSON.stringify(prm).padEnd(18)} IIDX ${(i * 100).toFixed(2)}%  pop'n ${(p * 1e5).toFixed(0)}  IIDX AAA 等價 pop'n ${(eq * 1e5).toFixed(0)}`);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
