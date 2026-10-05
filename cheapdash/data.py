"""資料層：美股用 yfinance、台股用 FinMind（都免 key），日線快取在 data/。"""
import json
import os
import shutil
import ssl
import tempfile
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

CACHE = Path(__file__).resolve().parent.parent / "data"


def _fix_ca_bundle():
    # curl_cffi 讀不了中文路徑下的憑證檔（本資料夾名稱含中文），複製一份到純英文路徑
    if os.environ.get("CURL_CA_BUNDLE"):
        return
    import certifi
    src = certifi.where()
    if src.isascii():
        return
    base = os.environ.get("PUBLIC") or tempfile.gettempdir()
    dst = Path(base) / "cheapdash-cacert.pem"
    if not dst.exists() or dst.stat().st_size != os.path.getsize(src):
        shutil.copyfile(src, dst)
    os.environ["CURL_CA_BUNDLE"] = str(dst)


FINMIND = "https://api.finmindtrade.com/api/v4/data"


def _finmind(dataset: str, stock_id: str) -> list:
    import certifi
    ctx = ssl.create_default_context(cafile=certifi.where())
    url = f"{FINMIND}?dataset={dataset}&data_id={stock_id}&start_date=1990-01-01"
    with urllib.request.urlopen(url, context=ctx, timeout=60) as r:
        j = json.load(r)
    if j.get("status") != 200:
        raise RuntimeError(f"FinMind {dataset} {stock_id}: {j.get('msg')}")
    return j["data"]


def _load_tw(stock_id: str) -> pd.DataFrame:
    """台股：FinMind 原始價（免 token），再用除權息與分割的前後參考價自己還原。"""
    raw = pd.DataFrame(_finmind("TaiwanStockPrice", stock_id))
    df = pd.DataFrame({
        "Open": raw["open"], "High": raw["max"], "Low": raw["min"], "Close": raw["close"],
        "Volume": raw["Trading_Volume"],
    }).set_axis(pd.to_datetime(raw["date"]))
    df = df[df["Close"] > 0]
    events = _finmind("TaiwanStockDividendResult", stock_id) + _finmind("TaiwanStockSplitPrice", stock_id)
    factor = pd.Series(1.0, index=df.index)
    for e in events:
        if e.get("before_price") and e.get("after_price"):
            factor[factor.index < pd.Timestamp(e["date"])] *= e["after_price"] / e["before_price"]
    for c in ["Open", "High", "Low", "Close"]:
        df[c] = df[c] * factor
    return df


def _load_yahoo(symbol: str) -> pd.DataFrame:
    _fix_ca_bundle()
    import yfinance as yf
    df = yf.Ticker(symbol).history(period="max", auto_adjust=True)
    if not df.empty:
        df.index = df.index.tz_localize(None).normalize()
    return df


def _load_yahoo_recent(symbol: str, period: str = "5d", auto_adjust: bool = False) -> pd.DataFrame:
    try:
        _fix_ca_bundle()
        import yfinance as yf
        df = yf.Ticker(symbol).history(period=period, auto_adjust=auto_adjust)
    except Exception as e:
        print(f"[警告] {symbol} 盤中報價抓取失敗：{e}")
        return pd.DataFrame()
    if not df.empty:
        df.index = df.index.tz_localize(None).normalize()
    return df


def load(symbol: str, refresh: bool = False) -> pd.DataFrame:
    """回傳還原後的日線 OHLCV（index 為日期）。當天抓過就直接用快取。
    台股（.TW）走 FinMind，其餘走 Yahoo。"""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{symbol}.csv"
    if path.exists() and not refresh and date.fromtimestamp(path.stat().st_mtime) == date.today():
        return pd.read_csv(path, index_col=0, parse_dates=True)

    try:
        if symbol.endswith(".TW"):
            try:
                df = _load_tw(symbol[:-3])
            except Exception as e:
                # FinMind 免費額度用完（HTTP 402）或維護中：改用 Yahoo（已還原），上櫃再試 .TWO
                print(f"[警告] {symbol} FinMind 失敗（{e}），改用 Yahoo")
                df = _load_yahoo(symbol)
                if df.empty:
                    df = _load_yahoo(symbol[:-3] + ".TWO")
                if df.empty:
                    raise
            # FinMind 收盤後才更新，盤中用 Yahoo 的延遲報價補上今天這根
            # （還原是往回調整舊價格，最新價格本來就是原始價，可以直接接上）
            today = _load_yahoo_recent(symbol)
            if today.empty:  # 上櫃股票在 Yahoo 是 .TWO
                today = _load_yahoo_recent(symbol[:-3] + ".TWO")
            if not today.empty and today.index[-1] > df.index[-1]:
                df = pd.concat([df, today.iloc[[-1]][df.columns]])
        else:
            df = _load_yahoo(symbol)
            # Yahoo 的完整歷史有時會晚好幾個小時才補上最新一天（在 GitHub 主機上遇過），
            # 再用近 5 天的報價補上比較新的日子
            if not df.empty:
                recent = _load_yahoo_recent(symbol, "5d", auto_adjust=True)
                if not recent.empty and recent.index[-1] > df.index[-1]:
                    df = pd.concat([df, recent[recent.index > df.index[-1]][df.columns]])
    except Exception as e:
        print(f"[警告] {symbol} 下載錯誤：{e}")
        df = pd.DataFrame()
    if df.empty:
        if path.exists():
            print(f"[警告] {symbol} 下載失敗，改用舊快取")
            return pd.read_csv(path, index_col=0, parse_dates=True)
        raise RuntimeError(f"{symbol} 抓不到資料")
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
    df = df[~df.index.duplicated(keep="last")]

    jumps = df["Close"].pct_change().abs() if not symbol.startswith("^") else pd.Series(dtype=float)  # 指數（如 VIX）大幅波動是正常的
    for d, j in jumps[jumps > 0.4].items():
        print(f"[注意] {symbol} {d.date()} 單日變動 {j:.0%}，請確認是否為未還原的分割")
    df.to_csv(path)
    return df


def recent_close(symbol: str) -> tuple[str, pd.Series]:
    """持倉用：最近幾天的收盤價（不還原，就是券商 App 看到的價格）。
    台股代碼（純數字開頭）先試上市 .TW，再試上櫃 .TWO。回傳 (Yahoo 代碼, 收盤價序列)。"""
    cands = [symbol + ".TW", symbol + ".TWO"] if symbol[:1].isdigit() else [symbol]
    for ys in cands:
        df = _load_yahoo_recent(ys, "1mo")
        if not df.empty:
            return ys, df["Close"].dropna()
    return "", pd.Series(dtype=float)


def tpex_gold() -> dict:
    """櫃買中心黃金現貨最新報價（免 key）。回傳 {代碼: {price, date, prev, chg, ys, ccy}}，價格單位是台幣／台錢。"""
    import certifi
    ctx = ssl.create_default_context(cafile=certifi.where())
    req = urllib.request.Request("https://www.tpex.org.tw/openapi/v1/tpex_gold_latest", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
            rows = json.load(r)
    except Exception as e:
        print(f"[警告] 櫃買黃金報價抓取失敗：{e}")
        return {}
    out = {}
    for x in rows:
        try:
            price = float(x["TradingLatestTradingInfo.LatestPrice"] or x["QuotedBuyingB.Price"])
            chg = float(x["QuotedBuyingChange"]) / 100  # 欄位是百分比
            d = x["Date"]  # 民國年，例如 1151002
            date_s = f"{int(d[:-4]) + 1911}-{d[-4:-2]}-{d[-2:]}"
        except (KeyError, ValueError, TypeError):
            continue
        out[x["GoldCode"]] = {"price": price, "date": date_s, "prev": round(price / (1 + chg), 2),
                              "chg": round(chg, 5), "ys": "櫃買黃金現貨", "ccy": "TWD"}
    return out
