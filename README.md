# 判定誤差・分數模型

把音樂遊戲的「判定誤差分布」換算成期望分數、各判定數與 PFC／GFC 機率。純 HTML＋JavaScript，不用安裝任何東西，直接開網頁就能用。

網頁：<https://xkamome.github.io/score-calculator/>

| 頁面 | 內容 |
|---|---|
| [`index.html`](https://xkamome.github.io/score-calculator/) | beatmania IIDX、pop'n music：判定誤差 → 分數，比較多種誤差分布 |
| [`ddr.html`](https://xkamome.github.io/score-calculator/ddr.html) | DDR（A 系列～WORLD 計分）：判定誤差 → 分數 |
| [`ddr-model.html`](https://xkamome.github.io/score-calculator/ddr-model.html) | DDR 準度模型：輸入結算畫面的バラつき（SD），比較常態模型與三態模型 |

## DDR 三態模型

每一步屬於三種狀態之一：

- **超準**：誤差一定在 ±16.67 ms（MARVELOUS 窗）以內
- **不太準**：誤差在 ±b 以內，b 由 SD 反推，最寬到 GREAT 窗（±91.67 ms），不會出 GOOD
- **出事**：踩錯、漏踩或嚴重失準，直接變成 GOOD 或 MISS；出事率隨 SD 指數上升

超準與不太準用有界對稱 Beta 分布 `f(x) ∝ (1 − (x − μ)²/a²)^(α − 1)`，`|x − μ| ≤ a`。

### 用 48 場實際成績驗證

資料是 2026 年 2～6 月 DDR WORLD 結算畫面的 48 場（[`ddr-plays.js`](ddr-plays.js)），每場都用判定數反算過分數，與畫面一致。以下是留一驗證（拿掉一場、用其餘 47 場擬合再預測它）的結果：

| | 常態 | 三態 |
|---|---|---|
| EX 分數誤差（中位數） | 58 | **10** |
| MARVELOUS 步數誤差（中位數） | 55 步 | **9 步** |
| 分數誤差（中位數） | **2,752** | 3,275 |
| 分數誤差（中位數，只看沒有 MISS 的 27 場、假設沒有 MISS） | 1,746 | **1,297** |

- 出事率：SD 每 +1 ms 約 ×1.38（95% 區間 ×1.33～×1.44），指數形式明顯比線性好。
- 分數誤差主要來自出事：同樣的 SD，每一場出事的次數差很多，所以只看分數時兩個模型差不多；判定數與 EX 三態準很多。

## 測試

```bash
node test.js       # IIDX / pop'n
node test-ddr.js   # DDR：計分、有界分布、三態模型還原參數、實際成績比較
```

## 檔案

| 檔案 | 內容 |
|---|---|
| `model.js` | 所有數學：分布、判定機率、DDR 計分、三態模型、最大概似校準 |
| `ui.js` | 共用的圖表與 UI 工具 |
| `app.js`／`ddr.js`／`ddr-model.js` | 各頁面的互動 |
| `ddr-plays.js` | 48 場實際成績 |
| `style.css` | 共用樣式（支援深色模式） |
