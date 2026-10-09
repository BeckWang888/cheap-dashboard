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
HIGH = 0.80      # 總經壓力：前 20% 偏高、前 10% 過高、前 3% 超高
YEARS20 = 5040   # 利率水準只和近 20 年比（1980 年代的兩位數利率不適合當基準）
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


def bls_unrate() -> pd.Series:
    """美國失業率（BLS 月資料，免金鑰版只給近 3 年，夠算 Sahm 規則）。同一天只抓一次（免金鑰每天限 25 次）。"""
    path = data.CACHE / "bls_unrate.json"
    if path.exists() and pd.Timestamp(path.stat().st_mtime, unit="s").date() == pd.Timestamp.now().date():
        j = json.loads(path.read_text(encoding="utf-8"))
    else:
        j = json.loads(_get("https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000"))
        if j.get("status") != "REQUEST_SUCCEEDED":
            raise RuntimeError(j.get("message"))
        data.CACHE.mkdir(exist_ok=True)
        path.write_text(json.dumps(j), encoding="utf-8")
    rows = j["Results"]["series"][0]["data"]
    d = {f"{r['year']}-{r['period'][1:]}-01": float(r["value"]) for r in rows
         if r["period"].startswith("M") and r["period"] != "M13" and r["value"].replace(".", "", 1).isdigit()}  # 2025 年政府停擺有月份是「-」
    return pd.Series(d).set_axis(pd.to_datetime(list(d))).sort_index()


def sahm(u: pd.Series) -> pd.Series:
    """Sahm 規則：失業率 3 個月平均，比過去 12 個月內最低的 3 個月平均高出多少（百分點）；>= 0.5 代表衰退可能已開始。"""
    a = u.rolling(3).mean()
    return (a - a.rolling(13).min()).dropna()


def _pct_daily(s: pd.Series, index: pd.DatetimeIndex, min_obs: int, window: int | None = None) -> pd.Series:
    p = pd.Series(past_pct_rank(s.to_numpy(float), window, min_obs), index=s.index)
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
    return {"indicators": out, "summary": summary, "macro": build_macro(us_idx, fwd_us)}


def _raw_yahoo(symbol: str) -> pd.Series:
    """不經 data._clean：油價 2020-04 曾為負、短債利率曾為 0，_clean 會把那之前的歷史整段砍掉。"""
    try:
        s = data._load_yahoo(symbol)["Close"].dropna()
        if not s.empty:
            return s
    except Exception as e:
        print(f"[警告] {symbol} 完整歷史抓取失敗：{e}")
    return data.load(symbol, refresh=True)["Close"].dropna()


def _macro_status(cur: float) -> str:
    return "超高" if cur >= VERY_HOT else "過高" if cur >= HOT else "偏高" if cur >= HIGH else ""


def build_macro(us_idx: pd.DatetimeIndex, fwd_us: pd.DataFrame) -> dict:
    """總經壓力：油價、利率、殖利率曲線、失業率。和過熱指標分開，回測對象是標普 500（SPY）。
    2026-10 回測：只有「油價年漲幅前 10%」之後 6 個月明顯偏弱；利率高、殖利率倒掛在 6 個月內沒有一致影響。"""
    out = []

    def add(key, name, raw, heat, fmt, note, extra=None, status=None, hot=None):
        h = heat.dropna()
        if h.empty:
            return
        cur = float(h.iloc[-1])
        raw_now = raw.dropna()
        hot = (h >= HOT) if hot is None else hot.reindex(h.index).fillna(False).astype(bool)
        out.append({
            "key": key, "name": name, "market": "MACRO", "fmt": fmt, "note": note, "extra": extra,
            "value": float(raw_now.iloc[-1]), "value_date": raw_now.index[-1].strftime("%Y-%m-%d"),
            "heat": round(cur, 4), "status": _macro_status(cur) if status is None else status,
            "since": h.index[0].strftime("%Y-%m-%d"),
            "bt_hot": _event_stats(hot, fwd_us),
            "bt_base": {k: v for k, v in backtest.summarize("基準", fwd_us, h.index).items() if k in ("n", "r126", "win126", "mae_med")},
        })

    try:
        oil = _raw_yahoo("CL=F")
        oil = oil[oil > 0]
        yoy = (oil / oil.shift(252) - 1).dropna()
        add("oil", "油價年漲幅（WTI 原油）", yoy, _pct_daily(yoy, us_idx, 756), "pct",
            "油價急漲會推升通膨、升息壓力並壓縮企業獲利；回測中唯一明顯偏空的總經指標。",
            extra=f"每桶 {oil.iloc[-1]:.1f} 美元")
    except Exception as e:
        print(f"[警告] 油價抓取失敗：{e}")
    try:
        tnx = _raw_yahoo("^TNX")
        irx = _raw_yahoo("^IRX")
        add("us10y", "美債 10 年期殖利率（長天期）", tnx, _pct_daily(tnx, us_idx, 756, YEARS20), "rate",
            "和近 20 年比。利率高讓股票估值（尤其科技股）承壓，但回測 6 個月內沒有一致的下跌。")
        add("us3m", "美債 3 個月期殖利率（短天期）", irx, _pct_daily(irx, us_idx, 756, YEARS20), "rate",
            "和近 20 年比，大致跟著聯準會的政策利率。")
        curve = (tnx - irx.reindex(tnx.index).ffill()).dropna()
        add("curve", "殖利率曲線（10 年 − 3 個月）", curve, 1 - _pct_daily(curve, us_idx, 756, YEARS20), "pp",
            "長天期利率低於短天期叫「倒掛」，歷史上常在衰退前 6～18 個月出現，但股市短期內未必下跌。",
            status="倒掛" if curve.iloc[-1] < 0 else "", hot=(curve < 0).reindex(us_idx).ffill())
    except Exception as e:
        print(f"[警告] 美債殖利率抓取失敗：{e}")
    try:
        u = bls_unrate()
        sm = sahm(u)
        s_now = float(sm.iloc[-1])
        out.append({
            "key": "sahm", "name": "失業率升溫（Sahm 衰退規則）", "market": "MACRO", "fmt": "pp",
            "note": "把就業數據濃縮成一個衰退警訊：失業率 3 個月平均比一年內低點高 0.5 個百分點以上就觸發。1970 年以來每次衰退開始時都觸發過，但 2024 年也曾觸發而沒有衰退。月資料，晚約一週公布。",
            "extra": f"失業率 {u.iloc[-1]:.1f}%（{u.index[-1]:%Y-%m}）",
            "value": s_now, "value_date": sm.index[-1].strftime("%Y-%m-%d"),
            "heat": round(min(1.0, max(0.0, s_now / 0.5)), 4),
            "status": "觸發" if s_now >= 0.5 else "升溫" if s_now >= 0.3 else "",
            "since": None, "bt_hot": None, "bt_base": None,
        })
    except Exception as e:
        print(f"[警告] 失業率抓取失敗：{e}")
    warn = sum(1 for x in out if x["status"] in ("過高", "超高", "倒掛", "觸發"))
    return {"indicators": out, "warn": warn, "total": len(out)}
