"""事件表的自動部分：美股財報日（Yahoo 的 calendar）。固定的總經、政治行事曆在 site/events.json，由 Claude 定期整理。"""
from datetime import date, datetime, timedelta

# 不在觀察清單、但財報會影響整個 AI／半導體的指標公司
MOVERS = {"NVDA": "輝達", "TSM": "台積電 ADR", "AVGO": "博通", "AMD": "超微", "MSFT": "微軟", "GOOGL": "Google",
          "META": "Meta", "AMZN": "亞馬遜", "AAPL": "蘋果", "ASML": "艾司摩爾"}
HORIZON_DAYS = 120


def _dates(cal) -> list:
    """yfinance 的 calendar 可能是 dict 或 DataFrame，取出財報日（可能是一段區間的兩個日期）。"""
    v = None
    if isinstance(cal, dict):
        v = cal.get("Earnings Date")
    elif cal is not None and hasattr(cal, "loc"):
        try:
            v = list(cal.loc["Earnings Date"])
        except Exception:
            v = None
    if v is None:
        return []
    out = []
    for d in (v if isinstance(v, (list, tuple)) else [v]):
        if isinstance(d, datetime):
            d = d.date()
        if isinstance(d, date):
            out.append(d)
        else:
            try:
                out.append(datetime.fromisoformat(str(d)[:10]).date())
            except ValueError:
                pass
    return sorted(set(out))


def earnings(symbols: dict, today: date | None = None) -> list:
    """symbols：{代碼: 名稱}。回傳未來 HORIZON_DAYS 天內的財報事件；個別抓不到就跳過。"""
    import yfinance as yf
    today = today or date.today()
    out = []
    for sym, name in symbols.items():
        try:
            ds = _dates(yf.Ticker(sym).calendar)
        except Exception as e:
            print(f"[財報日] {sym} 抓取失敗：{e}")
            continue
        ds = [d for d in ds if today - timedelta(days=3) <= d <= today + timedelta(days=HORIZON_DAYS)]
        if not ds:
            continue
        out.append({"date": ds[0].isoformat(), "end": ds[-1].isoformat() if len(ds) > 1 else None,
                    "sym": sym, "name": name, "est": len(ds) > 1})
    return sorted(out, key=lambda e: e["date"])


def symbols_for(items: list) -> dict:
    """觀察清單的美股個股、槓桿 ETF 對應的美股個股，加上指標公司。ETF 沒有財報，不抓。"""
    syms = dict(MOVERS)
    for it in items:
        if it.get("market") != "US":
            continue
        if it.get("type") == "stock":
            syms.setdefault(it["symbol"], it.get("name") or it["symbol"])
        u = it.get("underlying")
        if it.get("type") == "leveraged" and u and "." not in u and "=" not in u and u.isalpha() and len(u) <= 5 and u not in ("SOXX", "SMH", "QQQ", "SPY", "MAGS", "VOO", "VT"):
            syms.setdefault(u, u)
    return syms
