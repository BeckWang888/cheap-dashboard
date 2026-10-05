"""回測報告：python run_backtest.py [--refresh]
讀 watchlist.json，抓資料、算分數與訊號、回測，輸出 report.html。"""
import json
import sys
from pathlib import Path

from cheapdash import backtest, data
from cheapdash.indicators import closed_bars
from cheapdash.model import SIGNAL_NAMES, compute
from cheapdash.report import write_report
from cheapdash.summary import current, lev_info, lev_target, num

ROOT = Path(__file__).resolve().parent
VARIANTS = {"full": None, "5y": 1260}  # 百分位基準：全部歷史 / 近 5 年
THIN_YEARS = 3  # 有分數的歷史少於 3 年 → 資料不足
REFRESH = "--refresh" in sys.argv


def analyze(item: dict) -> dict:
    lev = item["type"] == "leveraged"
    base = item["underlying"] if lev else item.get("proxy") or item["symbol"]
    close = data.load(base, REFRESH)["Close"]
    target = lev_target(close, item["x"]) if lev else close

    out = {k: item.get(k) for k in ("symbol", "name", "market", "type")}
    out["base"] = base
    out["first_date"] = close.index[0].strftime("%Y-%m-%d")
    wk = closed_bars(close, "W-FRI")
    out["chart"] = {"d": [d.strftime("%Y-%m-%d") for d in wk.index], "p": [round(float(v), 4) for v in wk]}
    out["v"] = {}
    for name, window in VARIANTS.items():
        m = compute(close, window)
        res = backtest.run(m, target)
        res["current"] = current(m)
        out["v"][name] = res
        out["chart"]["s_" + name] = [num(v, 1) for v in m["score"].reindex(wk.index)]
    out["thin"] = out["v"]["full"]["zones"]["years"] < THIN_YEARS
    out["lev"] = None
    if lev:
        real = data.load(item["symbol"], REFRESH)["Close"]
        out["lev"] = lev_info(real, close, item["x"], base)
    return out


if __name__ == "__main__":
    items = json.loads((ROOT / "watchlist.json").read_text(encoding="utf-8"))
    results = []
    for it in items:
        print("計算", it["symbol"], "...")
        results.append(analyze(it))
    path = write_report(results, SIGNAL_NAMES, ROOT / "report.html")
    print("完成：", path)
