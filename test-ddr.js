// node test-ddr.js — 驗證 DDR 計分與最大概似估計
const M = require('./model.js');
const { GAMES } = M;

let fail = 0;
const check = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(4)}, want ${want} (±${tol})`);
};

// 1. DDR 計分（DDR A 起）
const S = (probs, chart) => M.ddrScore(probs, chart).score;
check('全 MARVELOUS', S([1, 0, 0, 0, 0], { steps: 500 }), 1e6, 1e-6);
check('全 PERFECT（500 步）', S([0, 1, 0, 0, 0], { steps: 500 }), 995000, 1e-6);
check('90 MARVELOUS + 10 GREAT（100 步）', S([0.9, 0, 0.1, 0, 0], { steps: 100 }), 959900, 1e-6);
check('含 freeze 全 O.K.', S([1, 0, 0, 0, 0], { steps: 98, freezes: 2 }), 1e6, 1e-6);
check('GOOD = 0.2U − 10', S([0, 0, 0, 1, 0], { steps: 100 }), 100 * (2000 - 10), 1e-6);
const ex = M.ddrScore([0.5, 0.3, 0.2, 0, 0], { steps: 100, freezes: 10 });
check('EX SCORE', ex.ex, 100 * (1.5 + 0.6 + 0.2) + 30, 1e-9);
check('EX 滿分', ex.exMax, 330, 0);
check('floor10', M.floor10(987654.9), 987650, 0);
const probs = [0.6, 0.25, 0.1, 0.03, 0.02], chart = { steps: 400, freezes: 20 };
const lossSum = Object.values(M.ddrScore(probs, chart).loss).reduce((a, b) => a + b);
check('失分分解加總', 1e6 - lossSum, S(probs, chart), 1e-6);

// 2. 最大概似：由理論判定數還原參數
const W = GAMES.ddr.windows;
const gen = d => M.categoryProbs(d, W).map(p => p * 1e5);
check('MLE 常態 σ', M.fitCounts('normal', W, gen(M.normalDist(15, 0))).sd, 15, 0.01);
const ft = M.fitCounts('t', W, gen(M.tScale(10, 0, 4)));
check('MLE t ν', ft.shape.nu, 4, 0.05);
check('MLE t SD', ft.sd, 10 * Math.sqrt(2), 0.05);
check('MLE GN β', M.fitCounts('gn', W, gen(M.gnScale(12, 0, 1.3))).shape.beta, 1.3, 0.01);
const fs = M.fitCounts('shift', W, gen(M.shiftScale(10, 0, 8)));
check('MLE 偏移混合 d/σ', fs.shape.dr, 0.8, 0.01);
const fp = M.fitCounts('plateau', W, gen(M.plateauScale(6, 0, 15)));
check('MLE 平台常態 a/σ', fp.shape.ar, 2.5, 0.01);
check('MLE 混合 G²≈0', M.fitCounts('mixture', W, gen(M.mixtureScale(9, 0, 0.08, 4))).G2, 0, 0.5);

// 2b. 有界分布
{
  const b = M.boundedScale(20, 3, 2.5);
  check('有界 Beta：SD = a/√(2α+1)', b.sd, 20 / Math.sqrt(6), 1e-12);
  check('有界 Beta：中心的 CDF = 0.5', b.cdf(3), 0.5, 1e-12);
  check('有界 Beta：半寬以外的機率 = 0', b.pOut(23), 0, 1e-15);
  let mass = 0, m2 = 0;
  for (let x = -17 + 0.0005; x < 23; x += 0.001) { const f = b.pdf(x) * 0.001; mass += f; m2 += f * (x - 3) ** 2; }
  check('有界 Beta：pdf 積分 = 1', mass, 1, 1e-6);
  check('有界 Beta：pdf 算出的 SD', Math.sqrt(m2), b.sd, 1e-4);
  check('有界 Beta：α = 1 是均勻分布', M.boundedScale(10, 0, 1).cdf(5), 0.75, 1e-12);
  const band = M.bandDist(W[2], W[3]);
  check('GOOD 帶：全部落在 GOOD', M.categoryProbs(band, W)[3], 1, 1e-12);
  check('MISS 質量：全部落在 MISS', M.categoryProbs(M.beyondDist(W[3]), W)[4], 1, 1e-12);
}

// 2c. 三態模型
{
  const D = M.TRI_DEFAULT;
  const sum = a => a.reduce((x, y) => x + y, 0);
  check('三態：各判定機率加總 = 1', sum(M.categoryProbs(M.triModel(12, 2, D).dist, W)), 1, 1e-12);
  const t10 = M.triModel(10, 0, D);
  check('三態：未到 GREAT 邊界時模型 SD = 顯示 SD', t10.modelSd, 10, 1e-9);
  const t6 = M.triModel(6, 0, D);
  check('三態：SD 很小時全部超準', t6.p, 0, 0);
  check('三態：SD 很小時模型 SD = 顯示 SD', t6.modelSd, 6, 1e-9);
  check('三態：超準態沒有偏移時全是 MARVELOUS', M.categoryProbs(M.boundedScale(W[0], 0, 2), W)[0], 1, 1e-12);
  const nm = M.withoutMiss(M.categoryProbs(M.triModel(16, 1, D).dist, W));
  check('假設沒有 MISS：MISS 機率 = 0', nm[4], 0, 0);
  check('假設沒有 MISS：其餘加總 = 1', sum(nm), 1, 1e-12);
  check('假設沒有 MISS：FC 機率 = 1', M.ddrFromCat(nm, { steps: 500, freezes: 20 }).fc, 1, 0);
  const pm = M.ddrPredict(M.triModel(16, 1, D).dist, { steps: 500 }), pn = M.ddrFromCat(nm, { steps: 500 });
  check('假設沒有 MISS：分數比照模型預測高', +(pn.score > pm.score), 1, 0);
  const tc = M.triModel(18, 0, D);
  check('三態：寬度上限是 GREAT 窗', tc.b, W[2], 1e-12);
  check('三態：不太準的步不會出 GOOD', M.categoryProbs(M.boundedScale(tc.b, 0, D.alB), W)[3], 0, 1e-15);

  // 由理論判定數還原參數（步數很多 → 判定數幾乎沒有隨機誤差）
  const truth = { alA: 2.5, alB: 12, p0: -0.2, p1: 0.25, g0: -7.5, m0: -7, c1: 0.4 };
  const syn = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18].map((sd, i) => {
    const mean = [0, 2, -1, 3, 0, -2, 1, 4, -3, 2][i];
    const n = 2e5, q = M.categoryProbs(M.triModel(sd, mean, truth).dist, W).map(x => x * n);
    return { sd, mean, marv: q[0], perf: q[1], great: q[2], good: q[3], miss: q[4], ok: 0 };
  });
  const acc = M.fitAccidents(syn);
  check('出事率還原 g0', acc.g0, truth.g0, 0.01);
  check('出事率還原 m0', acc.m0, truth.m0, 0.01);
  check('出事率還原斜率 c1', acc.c1, truth.c1, 0.005);
  const ft = M.fitTri(syn).prm;
  check('三態還原 αA', ft.alA, truth.alA, 0.05);
  check('三態還原 αB', ft.alB, truth.alB, 0.3);
  check('三態還原 p0', ft.p0, truth.p0, 0.02);
  check('三態還原 p1', ft.p1, truth.p1, 0.01);
}

// 2d. 實際成績：三態 vs 常態
{
  const PLAYS = require('./ddr-plays.js');
  check('成績資料：判定數算出的分數 = 畫面分數（不符場數）', PLAYS.filter(p => M.playScore(p) !== p.score).length, 0, 0);
  const cal = M.calibrateDdr(PLAYS);
  const n = cal.normal, t = cal.tri;
  console.log(`  常態 k=${n.kScale.toFixed(3)}：分數誤差 ${n.rmse.toFixed(0)}、EX 誤差 ${n.exRmse.toFixed(1)}、判定數誤差 ${n.judgeErr.map(v => v.toFixed(1)).join('/')}、AIC ${n.aic.toFixed(0)}`);
  console.log(`  三態　　　：分數誤差 ${t.rmse.toFixed(0)}、EX 誤差 ${t.exRmse.toFixed(1)}、判定數誤差 ${t.judgeErr.map(v => v.toFixed(1)).join('/')}、AIC ${t.aic.toFixed(0)}`);
  check('實際成績：三態 EX 誤差比常態小', +(t.exRmse < n.exRmse), 1, 0);
  check('實際成績：三態每種判定數的誤差都比常態小', +t.judgeErr.every((v, i) => v < n.judgeErr[i]), 1, 0);
  check('實際成績：三態 AIC 比常態小', +(t.aic < n.aic), 1, 0);
}

// 3. 範例成績：各模型的適合度
const real = [480, 95, 20, 2, 3];
console.log('\n範例 MARVELOUS/PERFECT/GREAT/GOOD/MISS =', real.join('/'));
for (const m of ['normal', 't', 'gn', 'mixture', 'shift', 'plateau']) {
  const f = M.fitCounts(m, W, real);
  console.log(`  ${m.padEnd(8)} AIC ${f.aic.toFixed(2).padStart(8)}  G² ${f.G2.toFixed(2).padStart(7)}  p ${f.pValue == null ? '—' : f.pValue.toExponential(2)}  SD ${f.sd.toFixed(2)}  ${JSON.stringify(f.shape)}  預測 ${f.expected.map(v => v.toFixed(1)).join('/')}`);
}

// 4. 常態下各評級所需 σ（600 步 + 30 freeze）
console.log('\n常態、600 步 + 30 freeze：');
for (const r of GAMES.ddr.ranks) {
  console.log(`  ${r.name.padEnd(4)} ${M.sdForDdr(r.rate * 1e6, { steps: 600, freezes: 30 }, 'normal').toFixed(2)} ms`);
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
