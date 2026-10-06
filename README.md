# 量化左側交易 Dashboard（原名便宜度 Dashboard）

避免 FOMO、輔助左側分批進場的工具。規格見 [SPEC.md](SPEC.md)。不提供投資建議。

## 運作方式
- GitHub Actions 每個交易日自動執行 6 次（台股、美股各在開盤後、盤中、收盤後），見 `.github/workflows/update.yml`。
- 每次執行 `update.py`：抓資料 → 算分數與訊號 → 產生 `site/data.json` → 發布到 GitHub Pages → 有新事件就用 ntfy 推播。
- `state/` 由 Actions 自動提交：通知狀態（避免重複通知）與每日訊號紀錄 `signal_log.csv`（日後檢驗用）。

## 持倉分頁
- 網頁上方切到「持倉」。資料存在 `holdings.json`（公開），價格由排程抓到 `site/prices.json`。
- 新增修改要先在頁面的「存檔設定」貼上 GitHub fine-grained token（只給這個 repo 的 Contents 讀寫），存在該裝置瀏覽器。
- 用手機鍵盤語音輸入一連串持倉 → 「整理成表格」（`site/parser.js`，固定句型解析）→ 確認存入。存檔後 workflow 會自動跑一次，約 2 分鐘後新代碼有價格。

## 常改的地方
- `watchlist.json`：標的清單。`type` 為 `etf` / `stock` / `leveraged`；槓桿型要填 `underlying` 和 `x`（倍數）；`group` 用來提醒同族群同時便宜。台股代碼加 `.TW`。
- `config.json`：通知門檻 `thresholds`、各類通知開關 `notify`、冷卻天數 `cooldown_days`、族群提醒門檻 `group_alert_min`。

直接在 GitHub 網頁上編輯這兩個檔案、按 Commit，下一次排程就會套用。

## 本機
```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest -q tests      # 測試
.venv/Scripts/python run_backtest.py         # 回測報告 report.html
.venv/Scripts/python update.py --no-notify   # 產生 site/data.json（不推播）
```

## 資料來源（都免 key）
- 美股：Yahoo Finance（yfinance，非官方）。
- 台股：FinMind 原始價 + 除權息／分割資料自行還原；盤中用 Yahoo 延遲報價補上當天。
