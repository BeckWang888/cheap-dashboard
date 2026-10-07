# 量化左側交易 Dashboard（原名便宜度 Dashboard）— 給 Claude 的專案說明

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
- `cheapdash/model.py` 分數與訊號；`backtest.py`；`market.py` 市場溫度；`meta.py` 新標的自動判斷（名稱、類型、槓桿對應與倍數）；`notify.py`；`summary.py`；`winrate.py` 回測勝率。
- `update.py` 排程主程式（也產生 `site/k/<代碼>.json` 給 K 線圖：約 5 年日線 OHLC＋近 5 日 5 分鐘走勢）；`dip_backtest.py` 定投點回測；`run_backtest.py` → `report.html`（本機回測報告）；`calibrate.py` 權重校準。
- `site/index.html`（便宜度頁）、`chart.js`（走勢圖，TradingView Lightweight Charts v5，jsdelivr 載入）、`holdings.js`（持倉頁）、`parser.js`（語音句型解析）、`watchlist.js`（清單編輯、拖曳）、`scan.js`（截圖辨識）、`settings.js`、`gh.js`。
- 資料：`watchlist.json`（50 檔，欄位 symbol/name/market/type/group/theme，槓桿有 underlying/x，AU9901 有 proxy）、`holdings.json`（lots、cash、names、targets、manual）、`config.json`（門檻、通知開關、冷卻、族群門檻、position_cap）。
- 測試：`python -m pytest -q tests`、`node --test tests/parser.test.js tests/scan.test.js`。

## 已定的設計決策
- 便宜度分數 −100～100：各指標換成「相對自身歷史百分位」。**權重 回撤 50%／MA200 0%／RSI 50%**（calibrate.py 校準結果；權重 0 的指標不參與）。級距 ≥80 極便宜、≥50 很便宜、≥20 便宜、−10~20 合理、−33~−10 小貴、−66~−33 中貴、≤−66 很貴。百分位基準可切「全部歷史／近 5 年」。
- 回測要點：80 分最穩定（勝過任意日約 +9 個百分點）；20 分只是開始分批的紀律、優勢小。分批規則 20／50／80 各投入 20%／30%／50%。
- **甜蜜點**＝分數 ≥80，或月線 MACD 谷底已確認且分數 ≥20（2026-10-06 使用者要求由 50 放寬；便宜區＋谷底勝率最高）。金框＋推播。
- 轉折訊號 5 顆＋月線谷底；週／月線未收盤標「形成中」。
- **強勢谷底**（2026-10-06 使用者提出）＝月線 MACD 谷底（確認或形成中）時分數 <20、價格在 200 日均線之上。狀態「強勢谷底」（藍框、計入候選），推播文字標明甜蜜點／強勢／弱勢。回測（谷底當天買）：強勢谷底 6 個月勝率各標的中位數比平常 +8 個百分點、2/3 標的優於平常，各檔差異大（TSLA 較差）；跌破年線的弱勢谷底 −4、沒有優勢；甜蜜點（谷底＋≥20）+18。月線綠柱「剛出現」不是買點（站上年線時反而勝率 48%）。月線谷底不是不敗（全部谷底 6 個月勝率 66%≈平常）。
- 月K 標記：金▲甜蜜（谷底時分數 ≥20）、藍▲強勢（站上年線）、灰▲弱（跌破年線）。
- 個股乖離過熱與美股市場過熱指標回測**沒有預測力**（強勢延續），只當「別追高」提醒；台股市場溫度略有參考性。市場溫度指標：標普/台灣50 乖離、VIX、FINRA 美股融資、FinMind 台股融資。巴菲特指標、AAII、NAAIM 因資料來源不可用而不做。
- 槓桿 ETF 以一倍標的計分（SOXL→SOXX×3、USD→SMH×2、GGLL→GOOGL×2、SOXL.L→SOXX×4、台股正2→0050×2、SKUU→000660.KS×2、MAGX→MAGS×2、SNXX→SNDK×2）。歷史太短的新 ETF 顯示「資料不足」。
- AU9901 臺銀金：櫃買中心交易，**單位是台錢（3.75 公克）**，價格用櫃買 API，分數用國際金價 GC=F。
- 持倉成本：第一金用「投資成本÷股數」（含手續費），華南金用畫面「成本均」。賣出用平均成本法；尚無已實現損益。
- 漲跌色預設**紅漲綠跌**（可切換）。持倉頁有環圈圖（資產配置／風險類別／產業主題／帳戶）、持股排行、損益條圖、提醒與建議。持股排行可點開：跨帳戶合計（股數、平均成本、現價、漲幅、市值、損益、今日、佔比、目標、便宜度）＋各帳戶明細卡片，並可跳到便宜度頁看該檔走勢。
- 產業主題（theme）是 Claude 先分類的，使用者可能要調整。
- **回測勝率**（0～100）＝歷史上同樣狀態買進後 3 個月／6 個月／1 年上漲的機率，加上「6 個月內通常再跌」（MAE 中位數）交叉比對；卡片顯示 6 個月，✓＝在便宜區（≥20）或強勢谷底，且三個期間都高於這檔平常。過熱、很貴時勝率也可能偏高（強勢延續），不打勾。計算方式：這檔任意日基準＋各狀態共通差異（所有一倍標的等權平均），再和這檔自身同狀態歷史加權（每 21 天算 1 個樣本，10 個樣本時各半）。數字主要反映長期趨勢；過熱時偏高是強勢延續＋存活者偏差，不代表該追高。
- 2026-10 回測結論：勝率較高的徵兆是 極便宜／甜蜜點（約 +5～7 個百分點）、便宜區＋月線谷底（約 +7～11）；便宜區內訊號多寡、週線綠柱縮短幾乎沒差。
- **定投點**（使用者提的「RSI<50＋MACD 綠柱」改良）：RSI<50、綠柱開始縮短、站上 200 日均線。回測只比任意日好約 0.5～1 個百分點；「等訊號才買」輸給每月定額（約 95% 標的）。所以只在日K 標箭頭當「不是在追高」參考，週K 不標（加過濾後 5 年才 1 次且表現差），不推播。
- 網站標題「量化左側交易 Dashboard」（2026-10-06 使用者要求，不要再叫便宜度）。上方統計（甜蜜點、候選進場、強勢谷底…）可點，點了清單只顯示那幾檔，再點一次或「顯示全部」取消。
- 釘選存在各裝置瀏覽器 localStorage（`cd_pins`），手機和電腦各自獨立。排序：自訂／分數／漲跌幅（再按一次反向）／勝率。
- 走勢圖分當日／五日／日K／週K／月K；月K 用完整歷史合成，標月線 MACD 谷底。
- **立即更新價格**按鈕（頁首）：用存檔權杖改寫 `refresh.json` → push 觸發 update.yml（不需 Actions 權限）→ 約 2～3 分鐘後網頁自動重新載入。5 分鐘內（跨裝置）只觸發一次。FinMind 免費每小時約 300 次、每次更新用 60～80 次，所以不能狂按。不花 Claude token。
- 排程實測（2026-10-06）：常延遲 1～5 小時、偶爾跳過；要準時需 cron-job.org。
- 便宜度頁每檔顯示「我的持倉」：卡片價格下一行「持有 N 股・成本 X ±%」，展開最上方藍框（股數、均價、現價、漲幅、市值、損益、佔總資產、各帳戶），「到持倉頁」跳到持股排行並展開；上方統計多「我的持股」可篩選。資料由 holdings.js 的 `Holdings.preload()/held()` 背景載入。
- 截圖上傳按鈕用透明 file input 蓋在按鈕上（手機瀏覽器用 label 開隱藏欄位會沒反應），選完自動辨識。
- **截圖辨識持倉**（2026-10-07）：持倉頁「新增／修改持倉」上方上傳券商截圖 → 瀏覽器直接呼叫 **Gemini 免費 API**（使用者選的；預設 `gemini-3.8-flash`，可改，金鑰存 localStorage `cd_gemini_key`）→ 持股畫面與帳上比對算出買賣差額（新買價＝(新總成本−舊總成本)÷新增股數；賣出價先填現價）、成交回報逐筆加入 → 放進既有表格，黃色列是 AI 提醒，**使用者確認才存**。帳上有但截圖沒有的只提醒、不自動賣出。存檔後新代碼自動加入 watchlist（type auto）。免費版 Google 可能用內容訓練／人工審閱。
- 當日／五日走勢只在排程時抓（Yahoo 5 分鐘線），不是即時；瀏覽器不能直接抓 Yahoo（CORS）。6940 格斯在 Yahoo 沒有資料。

## 帳戶（holdings.json 的 acct）
`hn-tw` 華南金台股、`hn-us` 華南金美股、`fb-tw` 第一金台股、`fb-us` 第一金美股、`moomoo`、`etoro`。2026-10-05 已依截圖登打全部 6 個帳戶的持股與現金。新增持股時也要加進 watchlist（使用者要求：有持倉就一定要觀察）。

## 後續可做（2026-10-05 列給使用者，尚未決定；使用者問「後續可以做什麼」時列出這份）
持倉：1 已實現損益與交易紀錄　2 資產走勢圖（每日記總資產畫曲線）　3 配息追蹤與除息提醒　4 持倉頁拖曳排序　5 調整產業分類與提醒門檻
便宜度：6 每日總結推播　7 用 state/signal_log.csv 驗證訊號準確度　8 估值參考（本益比，只當參考欄）　9 新聞標題與財報日
穩定與方便：10 cron-job.org 讓排程準時（需使用者註冊）　11 加到手機主畫面（PWA）　~~12 網頁直接上傳截圖用 AI 辨識~~（已完成，改用 Gemini 免費 API）
Claude 的建議優先順序：6 每日總結推播、2 資產走勢圖。

## 已知陷阱
- 專案路徑含中文：curl_cffi 讀不到憑證，`data._fix_ca_bundle()` 會把 certifi 複製到英文路徑。
- Git 在 Windows 會轉 CRLF；已設 `core.autocrlf false`。用 python 改檔時寫入 `newline="\n"`；bash heredoc 遇長中文內容容易壞，改用 Write 工具寫暫存檔。
- 本機跑 `update.py` 會改到 `state/`，提交前 `git checkout -- state/`。本機頻繁執行會用光 FinMind 免費額度。
- 只改 workflow 檔不會觸發部署；需要時 `gh workflow run update.yml`。
- Lightweight Charts 陷阱：多格圖表用 `setStretchFactor` 分高度（`setHeight` 在 autoSize 第一次畫之前無效）；某一格唯一的價格軸設 `visible:false` 或 RSI 設 `autoScale:false` 會整張圖畫不出來（Value is null）。
- 瀏覽器窗格被遮住時 requestAnimationFrame 不跑，圖表量不到高度；要截圖才會真的畫。
- Yahoo 還原價早期可能是負數（000660.KS 2002 年以前）、0050.TW 的 Yahoo 資料 2014-01-02 有錯誤跳空；`data._clean` 會砍掉負價以前的資料，`lev_target` 單日虧損上限 −99%。
- Moomoo 顯示夜盤即時價，和網站收盤價會有落差。
