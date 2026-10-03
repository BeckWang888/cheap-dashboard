"""市場溫度：整體市場是否過熱。每個指標換成「相對自身歷史的百分位」（1 = 歷史上最熱），
並回測「進入過熱後」大盤 6 個月的表現，和任意日比較。只用當天以前就拿得到的資料。"""
import io
import json
import ssl
import urllib.request

import numpy as np
import pandas as pd

from . import backtest, data
from .indicators import sma
from .model import past_pct_rank

HOT, VERY_HOT = 0.90, 0.97
FINRA = "https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx"


def _get(url: str) -> bytes:
    import certifi
    ctx = ssl.create_default_context(cafile=certifi.where())
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=ctx, timeout=60) as r:
        return r.read()


def finra_margin() -> pd.Series:
    """美股融資餘額（FINRA 月資料，百萬美元）。公布約晚一個月，所以把可用日設在次月 25 日。"""
    x = pd.read_excel(io.BytesIO(_get(FINRA)))
    s = pd.Series(x.iloc[:, 1].to_numpy(float), index=pd.to_datetime(x.iloc[:, 0].astype(str) + "-01")).sort_index().dropna()
    s.index = s.index + pd.offsets.MonthEnd(0) + pd.Timedelta(days=25)
    return s


def tw_margin() -> pd.Series:
    """台股融資餘額（金額，FinMind，每日）。"""
    rows = json.loads(_get("https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockTotalMarginPurchaseShortSale&start_date=2001-01-01"))["data"]
    d = {r["date"]: r["TodayBalance"] for r in rows if r["name"] == "MarginPurchaseMoney"}
    return pd.Series(d, dtype=float).set_axis(pd.to_datetime(list(d))).sort_index()


def _pct_daily(s: pd.Series, index: pd.DatetimeIndex, min_obs: int) -> pd.Series:
    p = pd.Series(past_pct_rank(s.to_numpy(float), None, min_obs), index=s.index)
    return p.reindex(index.union(p.index)).ffill().reindex(index)


def _event_stats(hot: pd.Series, fwd: pd.DataFrame) -> dict:
    """進入過熱（之前不熱）的日子，至少隔 20 個交易日算一次。"""
    entering = hot & ~hot.shift(1, fill_value=False)
    events, last = [], -10**9
    for i in np.flatnonzero(entering.to_numpy()):
        if i - last >= backtest.MIN_GAP:
            events.append(hot.index[i])
            last = i
    ev = backtest.summarize("過熱後", fwd, events)
    return {k: ev[k] for k in ("n", "n6", "r21", "r63", "r126", "win126", "mae_med", "mae_p10")}


def build() -> dict:
    spy = data.load("SPY", refresh=True)["Close"]
    tw50 = data.load("0050.TW", refresh=True)["Close"]
    vix = data.load("^VIX", refresh=True)["Close"]
    us_idx, tw_idx = spy.index, tw50.index
    fwd_us, fwd_tw = backtest.forward_stats(spy), backtest.forward_stats(tw50)

    ind = []   # (key, 名稱, 市場, 目前值的說明, 熱度百分位序列, 遠期報酬)
    dev = spy / sma(spy, 200) - 1
    ind.append(("us_dev", "標普 500 高於 200 日線", "US", dev, _pct_daily(dev.dropna(), us_idx, 756), fwd_us, "pct"))
    v20 = vix.rolling(20).mean()  # VIX 越低代表市場越安心、越熱
    ind.append(("vix", "VIX 恐慌指數偏低（20 日平均）", "US", v20, 1 - _pct_daily(v20.dropna(), us_idx, 756), fwd_us, "num"))
    try:
        fm = finra_margin()
        yoy = (fm / fm.shift(12) - 1).dropna()
        ind.append(("us_margin", "美股融資餘額年增率", "US", yoy, _pct_daily(yoy, us_idx, 36), fwd_us, "pct"))
    except Exception as e:
        print(f"[警告] FINRA 融資資料抓取失敗：{e}")
    dev_tw = tw50 / sma(tw50, 200) - 1
    ind.append(("tw_dev", "台灣 50 高於 200 日線", "TW", dev_tw, _pct_daily(dev_tw.dropna(), tw_idx, 756), fwd_tw, "pct"))
    try:
        tm = tw_margin()
        yoy_tw = (tm / tm.shift(245) - 1).dropna()
        ind.append(("tw_margin", "台股融資餘額年增率", "TW", yoy_tw, _pct_daily(yoy_tw, tw_idx, 756), fwd_tw, "pct"))
    except Exception as e:
        print(f"[警告] 台股融資資料抓取失敗：{e}")

    out = []
    for key, name, mkt, raw, heat, fwd, fmt in ind:
        h = heat.dropna()
        if h.empty:
            continue
        cur = float(h.iloc[-1])
        raw_now = raw.dropna()
        out.append({
            "key": key, "name": name, "market": mkt, "fmt": fmt,
            "value": float(raw_now.iloc[-1]), "value_date": raw_now.index[-1].strftime("%Y-%m-%d"),
            "heat": round(cur, 4),
            "status": "嚴重過熱" if cur >= VERY_HOT else "過熱" if cur >= HOT else "",
            "since": h.index[0].strftime("%Y-%m-%d"),
            "bt_hot": _event_stats(h >= HOT, fwd),
            "bt_base": {k: v for k, v in backtest.summarize("基準", fwd, h.index).items() if k in ("n", "r126", "win126", "mae_med")},
        })
    summary = {}
    for mkt in ("US", "TW"):
        xs = [x for x in out if x["market"] == mkt]
        summary[mkt] = {"hot": sum(1 for x in xs if x["status"]), "total": len(xs)}
    return {"indicators": out, "summary": summary}
