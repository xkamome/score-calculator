/*
 * 音樂遊戲判定誤差 → 期望分數 的數學模型
 *
 * 每顆 note 的時間誤差 X（ms）服從某個對稱分布（可加偏移 μ）。
 * 判定窗 ±w 內的機率 P(|X| ≤ w) = F(w) − F(−w)，
 * 各判定機率 = 相鄰窗口機率差，期望分數率 = Σ 機率 × 得點 / 滿點。
 *
 * 所有分布都以「標準差 sd」＋形狀參數表示，方便在同一個 sd 下比較形狀。
 */
(function (root) {
  'use strict';

  // ---------- 特殊函數 ----------

  // 互補誤差函數（Numerical Recipes erfcc，相對誤差 < 1.2e-7）
  function erfc(x) {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
      t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  const Phi = z => 0.5 * erfc(-z / Math.SQRT2);   // 標準常態 CDF
  const PhiC = z => 0.5 * erfc(z / Math.SQRT2);   // 1 − Φ(z)，尾端不失精度

  // 標準常態分位數（Acklam，相對誤差 < 1.2e-9）
  function PhiInv(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const lo = 0.02425;
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p < lo) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= 1 - lo) {
      const q = p - 0.5, r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // ln Γ(x)（Lanczos g=7）
  const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lnGamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
    x -= 1;
    let s = LANCZOS[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) s += LANCZOS[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
  }

  // 正規化不完全 Gamma：回傳 {P, Q}，P + Q = 1，兩者各自保有精度
  function gammaPQ(a, x) {
    if (x <= 0) return { P: 0, Q: 1 };
    const lnPre = -x + a * Math.log(x) - lnGamma(a);
    if (x < a + 1) {
      let ap = a, del = 1 / a, sum = del;
      for (let n = 0; n < 1000; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
      }
      const P = sum * Math.exp(lnPre);
      return { P, Q: 1 - P };
    }
    const TINY = 1e-300;
    let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
      c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    const Q = Math.exp(lnPre) * h;
    return { P: 1 - Q, Q };
  }

  // 正規化不完全 Beta I_x(a, b)
  function betacf(a, b, x) {
    const TINY = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 1000; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }
  function betaI(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }

  function bisect(f, lo, hi, iters = 80) {
    // f 單調；回傳 f(x) = 0 的根
    let flo = f(lo);
    for (let i = 0; i < iters; i++) {
      const mid = 0.5 * (lo + hi), fm = f(mid);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // ---------- 分布（全部以 sd 參數化）----------
  // 每個分布提供 cdf(x)、sf(x) = 1 − cdf(x)、pdf(x)，以及描述核心寬度的 info

  function withWindows(dist) {
    dist.pIn = w => dist.cdf(w) - dist.cdf(-w);          // P(|X| ≤ w)
    dist.pOut = w => dist.cdf(-w) + dist.sf(w);          // P(|X| > w)
    return dist;
  }

  function normalDist(sd, mu) {
    const z = x => (x - mu) / sd;
    return withWindows({
      cdf: x => Phi(z(x)),
      sf: x => PhiC(z(x)),
      pdf: x => Math.exp(-0.5 * z(x) ** 2) / (sd * Math.sqrt(2 * Math.PI)),
      sd,
      info: []
    });
  }

  // 雙常態混合：(1−p)·N(μ, σc²) + p·N(μ, (kσc)²)
  function mixtureScale(sc, mu, p, k) {
    const sw = k * sc;
    const a = normalDist(sc, mu), b = normalDist(sw, mu);
    return withWindows({
      cdf: x => (1 - p) * a.cdf(x) + p * b.cdf(x),
      sf: x => (1 - p) * a.sf(x) + p * b.sf(x),
      pdf: x => (1 - p) * a.pdf(x) + p * b.pdf(x),
      sd: sc * Math.sqrt(1 - p + p * k * k),
      info: [['核心 σc', sc], ['失準 σw', sw]]
    });
  }
  const mixtureDist = (sd, mu, { p, k }) => mixtureScale(sd / Math.sqrt(1 - p + p * k * k), mu, p, k);

  // Student-t：X = μ + s·T_ν，sd = s·√(ν/(ν−2))（ν ≤ 2 時 SD 為無限大）
  function tScale(s, mu, nu) {
    const lnC = lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - Math.log(s);
    const half = x => { const z = (x - mu) / s; return { z, ib: 0.5 * betaI(nu / 2, 0.5, nu / (nu + z * z)) }; };
    return withWindows({
      cdf: x => { const { z, ib } = half(x); return z >= 0 ? 1 - ib : ib; },
      sf: x => { const { z, ib } = half(x); return z >= 0 ? ib : 1 - ib; },
      pdf: x => { const z = (x - mu) / s; return Math.exp(lnC - (nu + 1) / 2 * Math.log1p(z * z / nu)); },
      sd: nu > 2 ? s * Math.sqrt(nu / (nu - 2)) : Infinity,
      info: [['尺度 s', s]]
    });
  }
  const tDist = (sd, mu, { nu }) => tScale(sd * Math.sqrt((nu - 2) / nu), mu, nu);

  // 廣義常態（指數冪分布）：f(x) ∝ exp(−(|x−μ|/α)^β)
  function gnScale(alpha, mu, beta) {
    const lnC = Math.log(beta / (2 * alpha)) - lnGamma(1 / beta);
    const tail = x => 0.5 * gammaPQ(1 / beta, (Math.abs(x - mu) / alpha) ** beta).Q;  // 單側尾端
    return withWindows({
      cdf: x => x >= mu ? 1 - tail(x) : tail(x),
      sf: x => x >= mu ? tail(x) : 1 - tail(x),
      pdf: x => Math.exp(lnC - (Math.abs(x - mu) / alpha) ** beta),
      sd: alpha * Math.exp(0.5 * (lnGamma(3 / beta) - lnGamma(1 / beta))),
      info: [['尺度 α', alpha]]
    });
  }
  const gnDist = (sd, mu, { beta }) => gnScale(sd * Math.exp(0.5 * (lnGamma(1 / beta) - lnGamma(3 / beta))), mu, beta);

  // 偏移混合（位置混合）：½·N(μ−d, σ²) + ½·N(μ+d, σ²)，SD² = σ² + d²
  // d/σ < 1 時是單峰的平頂分布（尾巴比同 SD 的常態薄），> 1 時分成兩個峰
  function shiftScale(s, mu, d) {
    const a = normalDist(s, mu - d), b = normalDist(s, mu + d);
    return withWindows({
      cdf: x => 0.5 * (a.cdf(x) + b.cdf(x)),
      sf: x => 0.5 * (a.sf(x) + b.sf(x)),
      pdf: x => 0.5 * (a.pdf(x) + b.pdf(x)),
      sd: Math.sqrt(s * s + d * d),
      info: [['各群 σ', s], ['偏移 ±d', d]]
    });
  }
  const shiftDist = (sd, mu, { dr }) => { const s = sd / Math.sqrt(1 + dr * dr); return shiftScale(s, mu, dr * s); };

  // 平台常態：X = μ + U + E，U ~ 均勻(−a, a)，E ~ N(0, σ²)，SD² = a²/3 + σ²
  function plateauScale(s, mu, a) {
    if (a < 1e-6 * s) return Object.assign(normalDist(s, mu), { info: [['平台半寬 a', 0], ['邊緣 σ', s]] });
    const phi = z => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const H = u => { const z = u / s; return u * Phi(z) + s * phi(z); };   // ∫Φ(u/σ)du
    const F0 = y => (H(y + a) - H(y - a)) / (2 * a);                         // y ≤ 0 時的 CDF（中心在 0）
    const dens = y => (y <= 0 ? Phi((y + a) / s) - Phi((y - a) / s) : PhiC((y - a) / s) - PhiC((y + a) / s)) / (2 * a);
    return withWindows({
      cdf: x => { const y = x - mu; return y <= 0 ? F0(y) : 1 - F0(-y); },
      sf: x => { const y = x - mu; return y >= 0 ? F0(-y) : 1 - F0(y); },
      pdf: x => dens(x - mu),
      sd: Math.sqrt(a * a / 3 + s * s),
      info: [['平台半寬 a', a], ['邊緣 σ', s]]
    });
  }
  const plateauDist = (sd, mu, { ar }) => { const s = sd / Math.sqrt(1 + ar * ar / 3); return plateauScale(s, mu, ar * s); };

  const MODELS = {
    normal: { make: (sd, mu) => normalDist(sd, mu), params: [] },
    mixture: {
      make: (sd, mu, prm) => mixtureDist(sd, mu, prm),
      params: [
        { key: 'p', min: 0.01, max: 0.4, step: 0.01, value: 0.1 },
        { key: 'k', min: 1.2, max: 6, step: 0.1, value: 3 }
      ]
    },
    t: {
      make: (sd, mu, prm) => tDist(sd, mu, prm),
      params: [{ key: 'nu', min: 2.5, max: 30, step: 0.1, value: 4 }]
    },
    gn: {
      make: (sd, mu, prm) => gnDist(sd, mu, prm),
      params: [{ key: 'beta', min: 0.6, max: 6, step: 0.05, value: 1.3 }]
    },
    shift: {
      make: (sd, mu, prm) => shiftDist(sd, mu, prm),
      params: [{ key: 'dr', min: 0, max: 2.5, step: 0.05, value: 0.9 }]
    },
    plateau: {
      make: (sd, mu, prm) => plateauDist(sd, mu, prm),
      params: [{ key: 'ar', min: 0, max: 5, step: 0.05, value: 2 }]
    }
  };

  function makeDist(model, sd, mu = 0, prm = {}) {
    return MODELS[model].make(sd, mu, prm);
  }

  // ---------- 遊戲 ----------

  const GAMES = {
    iidx: {
      id: 'iidx', short: 'IIDX',
      windows: [16.67, 33.33],
      points: [2, 1], maxPoints: 2,
      judgments: ['PGREAT', 'GREAT', 'GOOD 以下'],
      ranks: [
        { name: 'A', rate: 12 / 18 }, { name: 'AA', rate: 14 / 18 }, { name: 'AAA−', rate: 15 / 18 },
        { name: 'AAA', rate: 16 / 18 }, { name: 'MAX−', rate: 17 / 18 }
      ]
    },
    popn: {
      id: 'popn', short: "pop'n",
      windows: [25, 50, 100],
      points: [1, 0.7, 0.4], maxPoints: 1,
      judgments: ['COOL', 'GREAT', 'GOOD', 'BAD'],
      ranks: [{ name: 'AAA', rate: 0.95 }, { name: 'S', rate: 0.98 }, { name: 'S+', rate: 0.99 }]
    },
    // DDR A 起的計分（A20／A20 PLUS／A3／WORLD 沿用）。判定窗為社群實測值（±1／2／5.5／8.5 幀）
    ddr: {
      id: 'ddr', short: 'DDR',
      windows: [50 / 3, 100 / 3, 275 / 3, 425 / 3],
      points: [1, 1, 0.6, 0.2], maxPoints: 1,          // 不含每個非 MARVELOUS 判定的 −10
      judgments: ['MARVELOUS', 'PERFECT', 'GREAT', 'GOOD', 'MISS'],
      ranks: [
        { name: 'A', rate: 0.80 }, { name: 'A+', rate: 0.85 }, { name: 'AA−', rate: 0.89 },
        { name: 'AA', rate: 0.90 }, { name: 'AA+', rate: 0.95 }, { name: 'AAA', rate: 0.99 }
      ]
    }
  };

  // DDR 分數：U = 1,000,000 ÷ (步數 + freeze arrow 數 + shock arrow 數)
  // MARVELOUS／O.K. = U，PERFECT = U − 10，GREAT = 0.6U − 10，GOOD = 0.2U − 10，MISS／N.G. = 0
  // 顯示分數以 10 分為單位無條件捨去。EX SCORE：MARVELOUS／O.K. 3、PERFECT 2、GREAT 1。
  // freeze arrow 與 shock arrow 預設全部 O.K.（chart.ng 是 N.G. 的數量）；時間誤差只作用在一般步（含 freeze 起點）。
  function ddrScore(probs, chart) {
    const { steps, freezes = 0, shocks = 0, ng = 0 } = chart;
    const N = steps + freezes + shocks, U = 1e6 / N, ok = freezes + shocks - ng;
    const vals = [U, U - 10, 0.6 * U - 10, 0.2 * U - 10, 0];
    const exVals = [3, 2, 1, 0, 0];
    let m = 0, sq = 0, ex = 0, exSq = 0;
    probs.forEach((p, i) => { m += p * vals[i]; sq += p * vals[i] ** 2; ex += p * exVals[i]; exSq += p * exVals[i] ** 2; });
    return {
      score: steps * m + ok * U, U, N,
      scoreSd: Math.sqrt(Math.max(0, steps * (sq - m * m))),
      ex: steps * ex + 3 * ok, exMax: 3 * N,
      exSd: Math.sqrt(Math.max(0, steps * (exSq - ex * ex))),
      loss: {
        perfect: steps * probs[1] * 10,
        great: steps * probs[2] * (0.4 * U + 10),
        good: steps * probs[3] * (0.8 * U + 10),
        miss: steps * probs[4] * U
      }
    };
  }
  const floor10 = v => Math.floor(v / 10 + 1e-9) * 10;

  // 反解：DDR 分數達到 target 需要多小的 sd
  function sdForDdr(target, chart, model, mu = 0, prm = {}) {
    return bisect(sd => ddrScore(judge(GAMES.ddr, makeDist(model, sd, mu, prm)).probs, chart).score - target, 0.2, 400);
  }

  // 各判定機率與期望分數率（每顆 note）
  function judge(game, dist) {
    const probs = [];
    let prev = 0;
    for (const w of game.windows) {
      const c = dist.pIn(w);
      probs.push(Math.max(0, c - prev));
      prev = c;
    }
    probs.push(dist.pOut(game.windows[game.windows.length - 1]));
    let mean = 0, sq = 0;
    game.points.forEach((pt, i) => {
      const s = pt / game.maxPoints;
      mean += probs[i] * s;
      sq += probs[i] * s * s;
    });
    return { probs, rate: mean, varPerNote: Math.max(0, sq - mean * mean) };
  }

  // N 顆 note 的總分率：期望值、標準差、達到門檻的機率（中央極限近似）
  function scoreSpread(j, notes) {
    const sd = Math.sqrt(j.varPerNote / notes);
    return {
      mean: j.rate,
      sd,
      pReach: thr => sd === 0 ? (j.rate >= thr ? 1 : 0) : PhiC((thr - j.rate) / sd)
    };
  }

  function rankOf(game, rate) {
    let r = null;
    for (const k of game.ranks) if (rate >= k.rate - 1e-12) r = k;
    return r;
  }

  // 反解：要達到 targetRate 需要多小的 sd
  function sdForRate(game, model, targetRate, mu = 0, prm = {}) {
    return bisect(sd => judge(game, makeDist(model, sd, mu, prm)).rate - targetRate, 0.2, 400);
  }

  // |X| 的分位數：有 q 比例的 note 落在 ±w 內
  function absQuantile(dist, q) {
    return bisect(w => dist.pIn(w) - q, 0, 2000);
  }

  // ---------- 由實際判定數反推 ----------

  // 常態假設下，由單一窗口的命中率反推 σ
  function normalSdFromRatio(r, w) {
    return w / PhiInv((1 + r) / 2);
  }

  // 廣義常態：由 r1 = P(|X| ≤ w1)、r2 = P(|X| ≤ w2) 解出 (α, β)
  function fitGN(r1, r2, w1, w2) {
    if (!(r1 > 0 && r2 > r1 && r2 < 1)) return { ok: false, reason: 'range' };
    const ratio = w2 / w1;
    // 給定 β，先讓窗口 1 命中率 = r1，再回傳窗口 2 的命中率
    const r2At = beta => {
      const a = 1 / beta;
      const t = bisect(tt => gammaPQ(a, tt).P - r1, 0, 1e4, 100);
      return { t, r2: gammaPQ(a, t * ratio ** beta).P };
    };
    const LO = 0.25, HI = 12;
    const rLo = r2At(LO).r2, rHi = r2At(HI).r2;
    let beta, clipped = null;
    if (r2 <= rLo) { beta = LO; clipped = 'low'; }
    else if (r2 >= rHi) { beta = HI; clipped = 'high'; }
    else beta = Math.exp(bisect(lb => r2At(Math.exp(lb)).r2 - r2, Math.log(LO), Math.log(HI), 60));
    const { t } = r2At(beta);
    const alpha = w1 / t ** (1 / beta);
    const sd = alpha * Math.exp(0.5 * (lnGamma(3 / beta) - lnGamma(1 / beta)));
    return { ok: true, beta, alpha, sd, clipped };
  }

  // ---------- 由判定數做最大概似估計 ----------

  // Nelder–Mead 單純形法（最小化）
  function nelderMead(f, x0, { step = 0.4, iters = 800, tol = 1e-10 } = {}) {
    const n = x0.length;
    let pts = [x0.slice()];
    for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; pts.push(x); }
    let vals = pts.map(f);
    for (let it = 0; it < iters; it++) {
      const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
      pts = order.map(i => pts[i]); vals = order.map(i => vals[i]);
      if (Math.abs(vals[n] - vals[0]) < tol) break;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
      const worst = pts[n];
      const refl = c.map((cj, j) => 2 * cj - worst[j]), fr = f(refl);
      if (fr < vals[0]) {
        const exp = c.map((cj, j) => 3 * cj - 2 * worst[j]), fe = f(exp);
        if (fe < fr) { pts[n] = exp; vals[n] = fe; } else { pts[n] = refl; vals[n] = fr; }
      } else if (fr < vals[n - 1]) {
        pts[n] = refl; vals[n] = fr;
      } else {
        const con = fr < vals[n] ? c.map((cj, j) => (cj + refl[j]) / 2) : c.map((cj, j) => (cj + worst[j]) / 2);
        const fc = f(con);
        if (fc < Math.min(fr, vals[n])) { pts[n] = con; vals[n] = fc; }
        else {
          for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((x, j) => (pts[0][j] + x) / 2); vals[i] = f(pts[i]); }
        }
      }
    }
    let b = 0;
    for (let i = 1; i <= n; i++) if (vals[i] < vals[b]) b = i;
    return { x: pts[b], f: vals[b] };
  }

  function categoryProbs(dist, windows) {
    const out = [];
    let prev = 0;
    for (const w of windows) { const c = dist.pIn(w); out.push(Math.max(0, c - prev)); prev = c; }
    out.push(dist.pOut(windows[windows.length - 1]));
    return out;
  }
  function logLik(probs, counts) {
    let ll = 0;
    counts.forEach((n, i) => { if (n > 0) ll += n * Math.log(Math.max(probs[i], 1e-300)); });
    return ll;
  }

  const sigmoid = x => 1 / (1 + Math.exp(-x));
  const clampOpen = r => Math.min(1 - 1e-6, Math.max(1e-6, r));
  // 每個模型：θ（無限制實數）→ 分布、起始點、回傳的形狀參數
  const FIT_SPECS = {
    normal: {
      k: 1,
      build: th => normalDist(Math.exp(th[0]), 0),
      inits: g => [[Math.log(g)]],
      shape: () => ({})
    },
    t: {
      k: 2,
      build: th => tScale(Math.exp(th[0]), 0, Math.min(1000, 0.3 + Math.exp(th[1]))),
      inits: g => [[Math.log(g * 0.8), Math.log(4)], [Math.log(g), Math.log(20)], [Math.log(g * 0.6), Math.log(1.5)]],
      shape: th => ({ nu: Math.min(1000, 0.3 + Math.exp(th[1])) })
    },
    gn: {
      k: 2,
      build: th => gnScale(Math.exp(th[0]), 0, Math.min(20, 0.15 + Math.exp(th[1]))),
      inits: g => [[Math.log(g * 1.2), Math.log(1.2)], [Math.log(g * 1.4), Math.log(1.85)], [Math.log(g * 0.5), Math.log(0.6)]],
      shape: th => ({ beta: Math.min(20, 0.15 + Math.exp(th[1])) })
    },
    mixture: {
      k: 3,
      build: th => mixtureScale(Math.exp(th[0]), 0, 0.5 * sigmoid(th[1]), 1 + Math.exp(th[2])),
      inits: g => [[Math.log(g * 0.9), -1.4, Math.log(2)], [Math.log(g * 0.8), -2.8, Math.log(4)], [Math.log(g), -0.4, Math.log(0.8)]],
      shape: th => ({ p: 0.5 * sigmoid(th[1]), k: 1 + Math.exp(th[2]) })
    },
    shift: {
      k: 2,
      build: th => shiftScale(Math.exp(th[0]), 0, Math.exp(th[1])),
      inits: g => [[Math.log(g * 0.8), Math.log(g * 0.4)], [Math.log(g * 0.6), Math.log(g * 0.8)], [Math.log(g), Math.log(g * 0.05)]],
      shape: th => ({ dr: Math.exp(th[1] - th[0]) })
    },
    plateau: {
      k: 2,
      build: th => plateauScale(Math.exp(th[0]), 0, Math.exp(th[1])),
      inits: g => [[Math.log(g * 0.7), Math.log(g * 0.8)], [Math.log(g * 0.4), Math.log(g * 1.4)], [Math.log(g), Math.log(g * 0.05)]],
      shape: th => ({ ar: Math.exp(th[1] - th[0]) })
    }
  };

  // counts：各判定數（最後一格是最外側窗口以外）。假設誤差中心在 0。
  function fitCounts(model, windows, counts) {
    const total = counts.reduce((a, b) => a + b, 0);
    const r1 = clampOpen(counts[0] / total);
    const guess = Math.min(200, Math.max(1, windows[0] / PhiInv((1 + r1) / 2)));
    const spec = FIT_SPECS[model];
    const nll = th => {
      const v = -logLik(categoryProbs(spec.build(th), windows), counts);
      return isFinite(v) ? v : 1e300;
    };
    let best = null;
    for (const x0 of spec.inits(guess)) {
      let r = nelderMead(nll, x0);
      r = nelderMead(nll, r.x, { step: 0.1 });
      if (!best || r.f < best.f) best = r;
    }
    const dist = spec.build(best.x);
    const ll = -best.f;
    const sat = logLik(counts.map(n => n / total), counts);
    const df = counts.length - 1 - spec.k;
    const G2 = Math.max(0, 2 * (sat - ll));
    return {
      model, k: spec.k, dist, ll, aic: 2 * spec.k - 2 * ll, df, G2,
      pValue: df > 0 ? gammaPQ(df / 2, G2 / 2).Q : null,
      expected: categoryProbs(dist, windows).map(p => p * total),
      sd: dist.sd, shape: spec.shape(best.x)
    };
  }

  // ---------- 有界分布（三態模型用）----------

  // 有界對稱 Beta：X = μ + a(2Y − 1)，Y ~ Beta(α, α)。只在 |X − μ| ≤ a 有值，SD = a / √(2α + 1)
  // α = 1 是均勻分布，α 越大中間越尖，α 很大時接近常態
  function boundedScale(a, mu, alpha) {
    const lnB = 2 * lnGamma(alpha) - lnGamma(2 * alpha);
    const y = x => (x - mu) / a;
    return withWindows({
      cdf: x => { const v = y(x); return v <= -1 ? 0 : v >= 1 ? 1 : betaI(alpha, alpha, (1 + v) / 2); },
      sf: x => { const v = y(x); return v <= -1 ? 1 : v >= 1 ? 0 : betaI(alpha, alpha, (1 - v) / 2); },
      pdf: x => { const v = y(x); return Math.abs(v) >= 1 ? 0 : Math.exp((alpha - 1) * Math.log((1 - v * v) / 4) - lnB) / (2 * a); },
      sd: a / Math.sqrt(2 * alpha + 1),
      info: [['半寬 a', a]]
    });
  }

  // 對稱均勻帶：一半均勻落在 (−hi, −lo)、一半落在 (lo, hi)
  function bandDist(lo, hi) {
    const w = hi - lo;
    const cdf = x => x <= -hi ? 0 : x < -lo ? 0.5 * (x + hi) / w : x <= lo ? 0.5 : x < hi ? 0.5 + 0.5 * (x - lo) / w : 1;
    return withWindows({ cdf, sf: x => cdf(-x), pdf: x => (Math.abs(x) > lo && Math.abs(x) < hi ? 0.5 / w : 0), info: [] });
  }

  // 落在 ±w 以外的質量（MISS 用），沒有時間誤差可畫，所以 pdf 為 0
  function beyondDist(w) {
    const e = w + 1;
    return withWindows({
      cdf: x => (x < -e ? 0 : x < e ? 0.5 : 1),
      sf: x => (x < -e ? 1 : x < e ? 0.5 : 0),
      pdf: () => 0,
      info: []
    });
  }

  // 一般混合：parts = [[權重, 分布], …]
  function mixDist(parts, sd) {
    const sum = f => x => parts.reduce((s, [w, d]) => (w > 0 ? s + w * d[f](x) : s), 0);
    return withWindows({ cdf: sum('cdf'), sf: sum('sf'), pdf: sum('pdf'), sd, info: [] });
  }

  // ---------- DDR：三態模型 ----------
  // 每一步屬於三種狀態之一：
  //   超準：誤差落在 ±16.67 ms（MARVELOUS 窗）內，有界對稱 Beta(αA)
  //   不太準：落在 ±b 內，b 最寬到 GREAT 窗（±91.67），有界對稱 Beta(αB)
  //   出事：踩錯、漏踩或嚴重失準，直接變成 GOOD 或 MISS；乾淨的場次幾乎不會有
  // 超準與不太準以タイミング平均 μ 為中心。不太準的比例 p 隨顯示 SD 平滑上升，
  // 寬度 b 由 SD 反解；出事率隨 SD 指數上升。顯示的 SD 不含 MISS，出事的 GOOD 視為均勻落在 GOOD 區間。
  //   p(SD) = 1 / (1 + e^−(p0 + p1·(SD − 12)))
  //   每步 GOOD 率 = e^(g0 + c1·(SD − 12))，MISS 率 = e^(m0 + c1·(SD − 12))
  const DW = GAMES.ddr.windows;
  const TRI_REF = 12;
  const GOOD_V = (DW[3] ** 3 - DW[2] ** 3) / (3 * (DW[3] - DW[2]));   // GOOD 區間均勻分布的 E[x²]
  const RATE_MAX = 0.1;
  // 用 ddr-plays.js 的 48 場實際成績擬合的值
  const TRI_DEFAULT = { alA: 1.731, alB: 11.25, p0: -0.2516, p1: 0.1331, g0: -7.678, m0: -6.762, c1: 0.3239 };

  function triRates(sd, prm) {
    const d = sd - TRI_REF;
    return {
      pg: Math.min(RATE_MAX, Math.exp(prm.g0 + prm.c1 * d)),
      pm: Math.min(RATE_MAX, Math.exp(prm.m0 + prm.c1 * d)),
      p: 1 / (1 + Math.exp(-(prm.p0 + prm.p1 * d)))
    };
  }

  function triModel(sd, mu, prm) {
    const { alA, alB } = prm;
    let { pg, pm, p } = triRates(sd, prm);
    const acc = pg + pm, kA = 2 * alA + 1, kB = 2 * alB + 1;
    let aA = DW[0], b = DW[2], state = 'ok';
    // 不含 MISS 的變異數是 SD²；扣掉出事 GOOD 的部分，剩下的分給超準與不太準
    const core = Math.max(0, (sd * sd * (1 - pm) - pg * GOOD_V) / (1 - acc));
    if (core <= aA * aA / kA) {
      // SD 比超準態本身還小：全部視為超準，超準的寬度跟著縮小
      p = 0; aA = Math.sqrt(core * kA); state = 'tight';
    } else {
      const bRaw = Math.sqrt((core - (1 - p) * aA * aA / kA) / p * kB);
      if (bRaw > DW[2]) state = 'capped'; else b = bRaw;
    }
    const vHit = ((1 - acc) * ((1 - p) * aA * aA / kA + p * b * b / kB) + pg * GOOD_V) / (1 - pm);
    const dist = mixDist([
      [(1 - acc) * (1 - p), boundedScale(Math.max(aA, 1e-3), mu, alA)],
      [(1 - acc) * p, boundedScale(b, mu, alB)],
      [pg, bandDist(DW[2], DW[3])],
      [pm, beyondDist(DW[3])]
    ], sd);
    return { dist, p, b, aA, pg, pm, state, modelSd: Math.sqrt(vHit) };
  }

  // 假設這一場沒有 MISS：把 MISS 機率拿掉，其餘判定重新正規化
  function withoutMiss(cat) {
    const s = 1 - cat[4];
    return s > 0 ? [cat[0] / s, cat[1] / s, cat[2] / s, cat[3] / s, 0] : [0, 0, 0, 1, 0];
  }

  // 由分布算出 DDR 的各項期望值與 FC 機率
  const ddrPredict = (dist, chart) => ddrFromCat(categoryProbs(dist, GAMES.ddr.windows), chart);
  function ddrFromCat(cat, chart) {
    const r = ddrScore(cat, chart);
    const n = chart.steps;
    const allAbove = q => Math.exp(n * Math.log1p(-Math.min(q, 1 - 1e-15)));
    return Object.assign(r, {
      cat,
      counts: cat.map(q => q * n),
      pfc: allAbove(cat[2] + cat[3] + cat[4]),   // 沒有 GREAT 以下
      gfc: allAbove(cat[3] + cat[4]),            // 沒有 GOOD 以下
      fc: allAbove(cat[4])                       // 沒有 MISS
    });
  }

  // ---------- DDR：用實際成績校準 ----------
  // 每一場：顯示的 SD、タイミング平均 mean、各判定數（marv／perf／great／good／miss）、freeze O.K. 數 ok、
  // freeze N.G. 數 ng（畫面沒有直接顯示，可由分數反推；沒有就省略）
  const playCounts = p => [p.marv, p.perf, p.great, p.good, p.miss];
  const playSteps = p => p.marv + p.perf + p.great + p.good + p.miss;
  const playChart = p => ({ steps: playSteps(p), freezes: p.ok + (p.ng || 0), ng: p.ng || 0 });
  const playScore = p => floor10(ddrScore(playCounts(p).map(c => c / playSteps(p)), playChart(p)).score);
  const playEx = p => 3 * (p.marv + p.ok) + 2 * p.perf + p.great;

  // 第一階段：出事率。GOOD、MISS 各自一個截距、共用 SD 斜率的 Poisson 迴歸
  function fitAccidents(plays) {
    const rate = (a, c, d) => Math.exp(Math.max(-16, a) + c * d);
    const nll = th => -plays.reduce((s, p) => {
      const n = playSteps(p), d = p.sd - TRI_REF;
      const lg = n * rate(th[0], th[2], d), lm = n * rate(th[1], th[2], d);
      return s + p.good * Math.log(lg) - lg + p.miss * Math.log(lm) - lm;
    }, 0);
    let r = nelderMead(nll, [-7.5, -7.5, 0.3], { step: 0.5, iters: 3000 });
    r = nelderMead(nll, r.x, { step: 0.1, iters: 3000 });
    return { g0: Math.max(-16, r.x[0]), m0: Math.max(-16, r.x[1]), c1: r.x[2] };
  }

  // 第二階段：超準、不太準的形狀與比例，用全部判定數的最大概似
  function fitTri(plays) {
    const acc = fitAccidents(plays);
    const unpack = th => Object.assign({ alA: 1 + Math.exp(th[0]), alB: 1 + Math.exp(th[1]), p0: th[2], p1: th[3] }, acc);
    const nll = th => {
      const prm = unpack(th);
      const v = -plays.reduce((s, p) => s + logLik(categoryProbs(triModel(p.sd, p.mean, prm).dist, DW), playCounts(p)), 0);
      return isFinite(v) ? v : 1e300;
    };
    let best = null;
    for (const x0 of [[0, 2.7, -0.4, 0.2], [0.5, 1, -1, 0], [1, 2, -1.5, 0.1], [0.3, 2.5, 0, -0.1]]) {
      let r = nelderMead(nll, x0, { step: 0.5, iters: 2000 });
      r = nelderMead(nll, r.x, { step: 0.12, iters: 2000 });
      if (!best || r.f < best.f) best = r;
    }
    return { prm: unpack(best.x), nll: best.f };
  }

  // 兩個模型都用判定數的最大概似擬合，再比較分數、EX 分數、各判定數的預測誤差
  const TRI_K = 7;
  function calibrateDdr(plays) {
    const rms = a => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    const summarize = (preds, nll, k) => {
      const scoreErr = preds.map((pr, i) => pr.score - playScore(plays[i]));
      const exErr = preds.map((pr, i) => pr.ex - playEx(plays[i]));
      const judgeErr = [0, 1, 2, 3, 4].map(j => rms(preds.map((pr, i) => pr.counts[j] - playCounts(plays[i])[j])));
      return { preds, scoreErr, rmse: rms(scoreErr), exRmse: rms(exErr), judgeErr, ll: -nll, aic: 2 * nll + 2 * k, k };
    };
    const normalAt = (k, p) => ddrPredict(normalDist(k * p.sd, p.mean), playChart(p));
    const nllN = th => -plays.reduce((s, p) => s + logLik(normalAt(Math.exp(th[0]), p).cat, playCounts(p)), 0);
    let bn = nelderMead(nllN, [0], { step: 0.1 });
    bn = nelderMead(nllN, bn.x, { step: 0.02 });
    const kScale = Math.exp(bn.x[0]);
    const normal = Object.assign(summarize(plays.map(p => normalAt(kScale, p)), bn.f, 1), { kScale });

    let tri = null;
    if (plays.length >= 4) {
      const f = fitTri(plays);
      tri = Object.assign(summarize(plays.map(p => ddrPredict(triModel(p.sd, p.mean, f.prm).dist, playChart(p))), f.nll, TRI_K), {
        prm: f.prm, states: plays.map(p => triModel(p.sd, p.mean, f.prm))
      });
    }
    return { normal, tri };
  }

  const api = {
    erfc, Phi, PhiC, PhiInv, lnGamma, gammaPQ, betaI, bisect,
    MODELS, GAMES, makeDist, judge, scoreSpread, rankOf, sdForRate, absQuantile,
    normalSdFromRatio, fitGN, ddrScore, floor10, sdForDdr, nelderMead, fitCounts, categoryProbs, logLik,
    normalDist, mixtureScale, tScale, gnScale, shiftScale, plateauScale, ddrPredict, ddrFromCat, withoutMiss,
    boundedScale, bandDist, beyondDist, mixDist, TRI_DEFAULT, TRI_REF, triRates, triModel,
    playCounts, playSteps, playChart, playScore, playEx, fitAccidents, fitTri, calibrateDdr
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScoreModel = api;
})(this);
