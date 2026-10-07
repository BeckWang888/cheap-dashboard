"""新增標的時只填代碼，其餘自動判斷：名稱、類型（ETF／個股／槓桿）、槓桿的對應標的與倍數。"""
import re

import numpy as np
import pandas as pd

from . import data

# 槓桿 ETF 找對應標的時的候選（再加上名稱裡出現的代碼與觀察清單裡的標的）
CANDIDATES = ["SPY", "QQQ", "SOXX", "SMH", "IWM", "XLK", "XLF", "XLE", "TLT", "GLD", "ARKK", "FNGS"]
LEV_WORDS = re.compile(r"(\d(?:\.\d+)?)\s*[xX]\b|ultrapro|ultra\b|leveraged|daily .*bull|bull .*daily", re.I)


# 台股槓桿 ETF 名稱關鍵字 → 一倍對應標的（依序比對）
TW_LEV_MAP = [("黃金", "GC=F"), ("原油", "CL=F"), ("白銀", "SI=F"), ("費城半導體", "SOXX"), ("半導體", "SOXX"),
              ("NASDAQ", "QQQ"), ("那斯達克", "QQQ"), ("S&P500", "SPY"), ("標普500", "SPY"), ("美債", "TLT")]


def _tw_lev_underlying(name: str) -> str:
    n = (name or "").upper().replace(" ", "")
    for kw, sym in TW_LEV_MAP:
        if kw.upper().replace(" ", "") in n:
            return sym
    return "0050.TW"


def _tw(code: str) -> dict:
    rows = data._finmind("TaiwanStockInfo", code)
    name = rows[-1]["stock_name"] if rows else code
    cat = rows[-1].get("industry_category", "") if rows else ""
    if code.endswith("L"):          # 台股槓桿 ETF：依名稱找對應標的，找不到才當台灣 50／加權指數
        return {"name": name, "type": "leveraged", "underlying": _tw_lev_underlying(name), "x": 2}
    is_etf = "ETF" in cat.upper() or "基金" in cat or code.startswith("00")
    return {"name": name, "type": "etf" if is_etf else "stock"}


def _returns(sym: str) -> pd.Series:
    df = data._load_yahoo_recent(sym, "1y", auto_adjust=True)
    return df["Close"].pct_change().dropna() if not df.empty else pd.Series(dtype=float)


def _guess_underlying(sym: str, name: str, extra: list) -> tuple[str, float, float]:
    """回傳 (對應標的, 迴歸倍數, 相關係數)。"""
    y = _returns(sym)
    if len(y) < 60:
        return "", 0.0, 0.0
    in_name = [w for w in re.findall(r"\b[A-Z]{1,5}\b", name or "") if w not in {"ETF", "X", "DAILY", "BULL", "LONG", "USD"}]
    best = ("", 0.0, 0.0)
    for c in dict.fromkeys(in_name + CANDIDATES + extra):
        if c == sym:
            continue
        x = _returns(c)
        j = pd.concat([y, x], axis=1, keys=["y", "x"]).dropna()
        if len(j) < 60:
            continue
        corr = float(j["y"].corr(j["x"]))
        if abs(corr) > abs(best[2]):
            best = (c, float(np.polyfit(j["x"], j["y"], 1)[0]), corr)
    return best


def resolve(item: dict, watch_syms: list) -> dict:
    """補齊缺少的欄位。只改空白或 type 為 auto 的欄位，使用者自己填的不動。"""
    sym = item["symbol"]
    out = dict(item)
    try:
        if sym.endswith(".TW"):
            info = _tw(sym[:-3])
        else:
            data._fix_ca_bundle()
            import yfinance as yf
            inf = yf.Ticker(sym).info or {}
            name = inf.get("shortName") or inf.get("longName") or sym
            info = {"name": name, "type": "etf" if inf.get("quoteType") == "ETF" else "stock"}
            if info["type"] == "etf" and LEV_WORDS.search(inf.get("longName", "") + " " + name):
                u, beta, corr = _guess_underlying(sym, inf.get("longName", "") + " " + name,
                                                  [s for s in watch_syms if not s.endswith(".TW")])
                if u and corr > 0.8 and beta > 1.3:
                    info.update(type="leveraged", underlying=u, x=round(beta))
    except Exception as e:
        print(f"[警告] {sym} 自動判斷失敗：{e}")
        info = {"name": sym.replace(".TW", ""), "type": "stock"}
    if not out.get("name") or out.get("name") == sym.replace(".TW", ""):
        out["name"] = info["name"]
    if out.get("type") in (None, "", "auto"):
        out["type"] = info["type"]
        if info["type"] == "leveraged":
            out["underlying"], out["x"] = info["underlying"], info["x"]
    out["market"] = "TW" if sym.endswith(".TW") else "US"
    out.setdefault("group", "")
    return out
