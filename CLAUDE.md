# 便宜度 Dashboard — 給 Claude 的專案說明

## 使用者與溝通方式
- 一律用**繁體中文**、白話解釋；術語要說明。使用者偏好先討論再動工，但已授權「能做的直接做，有疑慮的再問」。
- 使用者在台灣，投資台股＋美股，集中在半導體／AI，做**左側分批**；單一標的通常 ≤10%。不要給投資建議，工具只是紀律輔助。
- 使用者常從**手機（Remote Control）**傳券商截圖，請 Claude 直接登打持倉。登打前以**截圖上的幣別／欄位**為準（使用者口頭描述曾把台幣、美元說反）。
- 做完 UI 變更要實際在瀏覽器看過（手機寬度 375px 為主）；測完把瀏覽器窗格切回正式網站，避免使用者誤看本機測試頁。

## 網址與架構
- 正式網站：https://beckwang888.github.io/cheap-dashboard/ （`#holdings` 持倉、`#settings` 設定）
- Repo：`BeckWang888/cheap-dashboard`（**公開**；持倉 holdings.json 也公開，使用者知情同意不加密）
- GitHub Actions `update.yml`：每個交易日 14 次排程（避開整點，GitHub 常延遲數小時）＋改 `holdings.json / watchlist.json / config.json / site/**` 時自動跑。流程：`update.py` → `site/data.json`、`site/prices.json` → Pages 部署 → ntfy 推播 → bot 提交 `state/`。
- 推播：ntfy，頻道名在 repo secret `NTFY_TOPIC`（不要寫進任何檔案）。使用者手機三星 Z Fold 7。
- 網頁存檔：瀏覽器用使用者自建的 fine-grained token（存 localStorage）透過 GitHub API 寫回 JSON。使用者覺得麻煩，**偏好直接請 Claude 改**。
- 本機：`.venv`（Python 3.14），`gh` 在 `C:\Program Files\GitHub CLI`（bash 需 `export PATH="$PATH:/c/Program Files/GitHub CLI"`）。

## 主要檔案
- `cheapdash/data.py` 資料層：美股 Yahoo（完整歷史＋近 5 天補最新日）；台股 FinMind 原始價＋除權息／分割自行還原，盤中用 Yahoo 補當天（上櫃 .TWO）；FinMind 失敗（402 額度）改用 Yahoo；`tpex_gold()` 櫃買黃金報價。
- `cheapdash/model.py` 分數與訊號；`backtest.py`；`market.py` 市場溫度；`meta.py` 新標的自動判斷（名稱、類型、槓桿對應與倍數）；`notify.py`；`summary.py`。
- `update.py` 排程主程式；`run_backtest.py` → `report.html`（本機回測報告）；`calibrate.py` 權重校準。
- `site/index.html`（便宜度頁）、`holdings.js`（持倉頁）、`parser.js`（語音句型解析）、`watchlist.js`（清單編輯、拖曳）、`settings.js`、`gh.js`。
- 資料：`watchlist.json`（40 檔，欄位 symbol/name/market/type/group/theme，槓桿有 underlying/x，AU9901 有 proxy）、`holdings.json`（lots、cash、names、targets、manual）、`config.json`（門檻、通知開關、冷卻、族群門檻、position_cap）。
- 測試：`python -m pytest -q tests`、`node --test tests/parser.test.js`。

## 已定的設計決策
- 便宜度分數 −100～100：各指標換成「相對自身歷史百分位」。**權重 回撤 50%／MA200 0%／RSI 50%**（calibrate.py 校準結果；權重 0 的指標不參與）。級距 ≥80 極便宜、≥50 很便宜、≥20 便宜、−10~20 合理、−33~−10 小貴、−66~−33 中貴、≤−66 很貴。百分位基準可切「全部歷史／近 5 年」。
- 回測要點：80 分最穩定（勝過任意日約 +9 個百分點）；20 分只是開始分批的紀律、優勢小。分批規則 20／50／80 各投入 20%／30%／50%。
- **甜蜜點**＝分數 ≥80，或月線 MACD 谷底已確認且分數 ≥50（回測勝率最高的兩種）。金框＋推播。
- 轉折訊號 5 顆＋月線谷底；週／月線未收盤標「形成中」。
- 個股乖離過熱與美股市場過熱指標回測**沒有預測力**（強勢延續），只當「別追高」提醒；台股市場溫度略有參考性。市場溫度指標：標普/台灣50 乖離、VIX、FINRA 美股融資、FinMind 台股融資。巴菲特指標、AAII、NAAIM 因資料來源不可用而不做。
- 槓桿 ETF 以一倍標的計分（SOXL→SOXX×3、USD→SMH×2、GGLL→GOOGL×2、SOXL.L→SOXX×4、台股正2→0050×2、SKUU→000660.KS×2、MAGX→MAGS×2、SNXX→SNDK×2）。歷史太短的新 ETF 顯示「資料不足」。
- AU9901 臺銀金：櫃買中心交易，**單位是台錢（3.75 公克）**，價格用櫃買 API，分數用國際金價 GC=F。
- 持倉成本：第一金用「投資成本÷股數」（含手續費），華南金用畫面「成本均」。賣出用平均成本法；尚無已實現損益。
- 漲跌色預設**紅漲綠跌**（可切換）。持倉頁有環圈圖（資產配置／風險類別／產業主題／帳戶）、持股排行、損益條圖、提醒與建議。
- 產業主題（theme）是 Claude 先分類的，使用者可能要調整。

## 帳戶（holdings.json 的 acct）
`hn-tw` 華南金台股、`hn-us` 華南金美股、`fb-tw` 第一金台股、`fb-us` 第一金美股、`moomoo`、`etoro`。2026-10-05 已依截圖登打全部 6 個帳戶的持股與現金。新增持股時也要加進 watchlist（使用者要求：有持倉就一定要觀察）。

## 已知陷阱
- 專案路徑含中文：curl_cffi 讀不到憑證，`data._fix_ca_bundle()` 會把 certifi 複製到英文路徑。
- Git 在 Windows 會轉 CRLF；已設 `core.autocrlf false`。用 python 改檔時寫入 `newline="\n"`；bash heredoc 遇長中文內容容易壞，改用 Write 工具寫暫存檔。
- 本機跑 `update.py` 會改到 `state/`，提交前 `git checkout -- state/`。本機頻繁執行會用光 FinMind 免費額度。
- 只改 workflow 檔不會觸發部署；需要時 `gh workflow run update.yml`。
- Moomoo 顯示夜盤即時價，和網站收盤價會有落差。
