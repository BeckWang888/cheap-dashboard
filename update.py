"""每次排程執行：抓最新資料 → 算分數與訊號 → 寫 site/data.json → 有新事件就推播。
python update.py [--no-notify]"""
import json
import sys
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from cheapdash import backtest, data, notify
from cheapdash.model import SIGNAL_NAMES, compute
from cheapdash.summary import current, lev_info, lev_target, num

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
STATE = ROOT / "state"
VARIANTS = {"full": None, "5y": 1260}
THIN_YEARS = 3
MARKETS = {
    "TW": (ZoneInfo("Asia/Taipei"), time(13, 35)),
    "US": (ZoneInfo("America/New_York"), time(16, 5)),
}
CHART_DAYS = 520  # 展開後的小圖顯示最近約 2 年


def bt_summary(res: dict) -> dict:
    keep = ["任意日買進（基準）", "分數跨上 20", "分數跨上 50", "分數跨上 80", "狀態變成「轉折確認」"]
    rows = [{k: e[k] for k in ("label", "n", "r126", "win126", "mae_med")} for e in res["events"] if e["label"] in keep]
    z = res["zones"]
    return {"rows": rows, "cheap_share": z["cheap_share"], "cheap_per_year": z["cheap_per_year"],
            "longest_gap": z["longest_gap"], "years": z["years"]}


def analyze(item: dict) -> dict:
    tz, close_t = MARKETS[item["market"]]
    now = datetime.now(tz)
    lev = item["type"] == "leveraged"
    base = item["underlying"] if lev else item["symbol"]
    close = data.load(base, refresh=True)["Close"]
    last_day = close.index[-1].date()
    closed_today = last_day < now.date() or now.time() >= close_t
    target = lev_target(close, item["x"]) if lev else close
    naive_now = now.replace(tzinfo=None)

    out = {k: item.get(k) for k in ("symbol", "name", "market", "type", "group")}
    out["base"] = base
    out["intraday"] = not closed_today
    out["quote"] = quote(close)
    out["v"] = {}
    tail = close.index[-CHART_DAYS:]
    out["chart"] = {"d": [d.strftime("%Y-%m-%d") for d in tail], "p": [num(v, 4) for v in close.loc[tail]]}
    for name, window in VARIANTS.items():
        m = compute(close, window, now=naive_now, closed_today=closed_today)
        res = backtest.run(m, target)
        out["v"][name] = {"current": current(m), "bt": bt_summary(res)}
        out["chart"]["s_" + name] = [num(v, 1) for v in m["score"].loc[tail]]
    out["thin"] = out["v"]["full"]["bt"]["years"] < THIN_YEARS
    out["lev"] = None
    if lev:
        real = data.load(item["symbol"], refresh=True)["Close"]
        out["lev"] = lev_info(real, close, item["x"], base)
        out["quote"] = quote(real)
    out["price"] = out["quote"]["price"]
    return out


def quote(s: pd.Series) -> dict:
    """最新價、日期、前一日收盤與漲跌幅。"""
    s = s.dropna()
    prev = s.iloc[-2] if len(s) > 1 else None
    return {"price": num(s.iloc[-1], 4), "date": s.index[-1].strftime("%Y-%m-%d"),
            "prev": num(prev, 4), "chg": num(s.iloc[-1] / prev - 1, 5) if prev else None}


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def log_signals(results: list, today: str):
    """每天記一筆，日後用來檢驗「當時說便宜的，後來怎麼樣」。同一天重跑會覆蓋。"""
    path = STATE / "signal_log.csv"
    rows = [{"date": today, "symbol": r["symbol"], "score": r["v"]["full"]["current"]["score"],
             "score_5y": r["v"]["5y"]["current"]["score"], "state": r["v"]["full"]["current"]["state"],
             "n_sig": sum(r["v"]["full"]["current"]["sigs"]), "heat": r["v"]["full"]["current"]["heat"],
             "price": r["price"]} for r in results]
    new = pd.DataFrame(rows)
    if path.exists():
        old = pd.read_csv(path, dtype={"symbol": str})
        old = old[old["date"] != today]
        new = pd.concat([old, new], ignore_index=True)
    new.to_csv(path, index=False)


def main():
    cfg = read_json(ROOT / "config.json", {})
    items = read_json(ROOT / "watchlist.json", [])
    results, failed = [], []
    for it in items:
        try:
            print("更新", it["symbol"])
            results.append(analyze(it))
        except Exception as e:
            print(f"[錯誤] {it['symbol']}：{e}")
            failed.append(it["symbol"])

    groups = {}
    for r in results:
        c = r["v"]["full"]["current"]
        if r.get("group") and c["score"] is not None and c["score"] >= 20:
            groups.setdefault(r["group"], []).append(r["symbol"])

    now_tw = datetime.now(MARKETS["TW"][0])
    SITE.mkdir(exist_ok=True)
    STATE.mkdir(exist_ok=True)
    payload = {"generated": now_tw.strftime("%Y-%m-%d %H:%M"), "signal_names": SIGNAL_NAMES,
               "thresholds": cfg.get("thresholds", [20, 50, 80]), "group_alert_min": cfg.get("group_alert_min", 3),
               "groups": groups, "failed": failed, "items": results}
    (SITE / "data.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    log_signals(results, now_tw.strftime("%Y-%m-%d"))

    prev = read_json(STATE / "notify_state.json", None)
    cur = [{"symbol": r["symbol"], "current": r["v"]["full"]["current"]} for r in results]
    events, state = notify.find_events(cur, prev or {}, cfg)
    events += notify.group_events(groups, prev or {}, cfg)
    state["groups"] = {g: len(s) for g, s in groups.items()}
    if failed:
        # 抓不到的標的保留舊狀態，避免下次恢復時重複通知
        for s in failed:
            if prev and s in prev.get("items", {}):
                state["items"][s] = prev["items"][s]

    send = "--no-notify" not in sys.argv
    click = cfg.get("site_url", "")
    if prev is None:
        cheap = [f"{r['symbol']} {r['v']['full']['current']['score']:.0f}" for r in results
                 if (r['v']['full']['current']['score'] or -999) >= 20]
        msg = "推播設定成功，之後有新事件才會通知。\n目前在便宜區：" + ("、".join(cheap) if cheap else "沒有")
        if send:
            notify.send("便宜度 dashboard 已啟動", msg, 3, click)
    else:
        events = notify.apply_cooldown(events, state, cfg, now_tw.date())
        if events and send:
            scores = {r["symbol"]: r["v"]["full"]["current"]["score"] for r in results}
            title, msg, pri = notify.compose(events, scores)
            notify.send(title, msg, pri, click)
        print(f"新事件 {len(events)} 項")
    if failed and send:
        notify.send("便宜度：部分資料抓取失敗", "、".join(failed) + "\n其餘標的已更新。", 2, click)
    (STATE / "notify_state.json").write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    print("完成", payload["generated"])


if __name__ == "__main__":
    main()
