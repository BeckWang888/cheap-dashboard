"""便宜度分數、五個轉折訊號、月線谷底與狀態。每一天都只用當天（含）以前的資料。"""
import numpy as np
import pandas as pd

from .indicators import closed_bars, macd_hist, rsi, sma

WEIGHTS = {"dd": 0.5, "ma": 0.0, "rsi": 0.5}  # 2026-10 依 calibrate.py 校準：各門檻表現最穩定
LEVELS = [(80, "極便宜"), (50, "很便宜"), (20, "便宜"), (-10, "合理"), (-33, "小貴"), (-66, "中貴")]
LEVEL_ORDER = ["極便宜", "很便宜", "便宜", "合理", "小貴", "中貴", "很貴"]
SIGNAL_NAMES = ["日線 MACD 綠柱縮短", "週線 MACD 綠柱縮短", "RSI 回升", "價格止穩", "站回 20 日均線"]
WARMUP = 756  # 每個指標至少累積 3 年歷史才開始算百分位
# 個股過熱：相對 MA200 的乖離落在自身歷史前 5%（或 RSI ≥ 80）＝過熱；前 1% ＝嚴重過熱
HOT_PCT, VERY_HOT_PCT, HOT_RSI = 0.95, 0.99, 80
# 甜蜜點（回測勝率較高的情境）：分數 ≥ 80，或月線 MACD 谷底已確認且分數 ≥ 50
SWEET_SCORE, SWEET_TROUGH_SCORE = 80, 50


def level(score: float) -> str:
    if score != score:
        return ""
    for th, name in LEVELS:
        if score >= th:
            return name
    return "很貴"


def past_pct_rank(x: np.ndarray, window: int | None = None, min_obs: int = WARMUP) -> np.ndarray:
    """x[t] 在「t 以前（含）的歷史」裡的百分位（0~1，同值算一半）。
    window=None 用全部歷史；否則只看最近 window 個交易日。"""
    out = np.full(len(x), np.nan)
    pos = np.flatnonzero(~np.isnan(x))
    v = x[pos]
    for i in range(min_obs - 1, len(v)):
        lo = 0 if window is None else max(0, i + 1 - window)
        h = v[lo:i + 1]
        out[pos[i]] = ((h < v[i]).sum() + 0.5 * ((h == v[i]).sum() - 1)) / (len(h) - 1)
    return out


def _shrinking(h: pd.Series) -> pd.Series:
    """柱狀圖為負，且連續 3 根縮短。"""
    return (h < 0) & (h > h.shift(1)) & (h.shift(1) > h.shift(2)) & (h.shift(2) > h.shift(3))


def _to_daily(flags: pd.Series, index: pd.DatetimeIndex) -> pd.Series:
    """週／月線訊號在收盤確認那天生效，之後沿用到下一根收盤。"""
    return flags.reindex(index).ffill().fillna(False).astype(bool)


def _bars(close: pd.Series, period: str, now, closed_today: bool):
    """回傳 (已收盤的 K 棒, 含形成中那根的 K 棒或 None)。
    now 為 None 時（回測）全部視為已收盤；否則最後一根若還在同一週／月且尚未收完，就是形成中。"""
    bars = closed_bars(close, period)
    if now is None:
        return bars, None
    last = bars.index[-1]
    per = last.to_period(period)
    if per != pd.Timestamp(now).to_period(period):
        return bars, None
    final_day = pd.offsets.BDay().rollback(per.end_time.normalize())
    if closed_today and last.normalize() >= final_day:
        return bars, None
    return bars.iloc[:-1], bars


def compute(close: pd.Series, window: int | None = None, now=None, closed_today: bool = True) -> pd.DataFrame:
    """now：即時模式下的市場當地時間，用來判斷週線、月線是否已收盤（回測時留 None）。"""
    df = pd.DataFrame({"close": close})
    df["dd52"] = close / close.rolling(252, min_periods=252).max() - 1
    df["dd_ath"] = close / close.cummax() - 1
    df["ma_dev"] = close / sma(close, 200) - 1
    df["rsi"] = rsi(close)

    # 便宜度：三項各自換成「相對自身歷史的便宜百分位」u（1 = 歷史上最便宜），
    # 再映射到 −1~+1 加權。跌越深、越低於 MA200、RSI 越低 → 越便宜。
    score = 0.0
    for key, col in [("dd", "dd52"), ("ma", "ma_dev"), ("rsi", "rsi")]:
        u = 1 - past_pct_rank(df[col].to_numpy(), window)
        df["u_" + key] = u
        if WEIGHTS[key]:  # 權重 0 的指標不參與，免得它缺資料時整個分數變成空值
            score = score + WEIGHTS[key] * (2 * u - 1)
    df["score"] = 100 * score

    r = df["rsi"]
    low20 = close <= close.rolling(20, min_periods=20).min()
    sig = pd.DataFrame(index=close.index)
    sig["s1"] = _shrinking(macd_hist(close))
    wk, wk_live = _bars(close, "W-FRI", now, closed_today)
    sig["s2"] = _to_daily(_shrinking(macd_hist(wk)), close.index)
    sig["s3"] = (r.rolling(10).min() < 40) & (r > r.shift(1)) & (r.shift(1) > r.shift(2)) & (r.shift(2) > r.shift(3))
    sig["s4"] = ~low20.rolling(10, min_periods=10).max().fillna(1).astype(bool)
    sig["s5"] = close > sma(close, 20)
    df = df.join(sig)
    df["n_sig"] = sig.sum(axis=1)

    # 月線 MACD 谷底：柱狀圖為負、上個月是谷底、本月開始縮短（只用已收盤的月）
    def is_trough(h):
        return (h < 0) & (h > h.shift(1)) & (h.shift(1) < h.shift(2))
    mo, mo_live = _bars(close, "M", now, closed_today)
    trough = is_trough(macd_hist(mo))
    df["trough_event"] = trough.reindex(close.index).fillna(False).astype(bool)
    df["trough"] = _to_daily(trough, close.index)
    # 月中提醒「形成中」：把這個月目前的價格當成月收盤試算
    df.attrs["trough_forming"] = bool(mo_live is not None and is_trough(macd_hist(mo_live)).iloc[-1])
    df.attrs["s2_forming"] = bool(wk_live is not None and _shrinking(macd_hist(wk_live)).iloc[-1])
    forming = pd.Series(False, index=close.index)
    forming.iloc[-1] = df.attrs["trough_forming"]

    above = 1 - df["u_ma"]  # 乖離百分位（1 = 歷史上離 MA200 最遠）
    heat = np.where(above >= VERY_HOT_PCT, "嚴重過熱",
                    np.where((above >= HOT_PCT) | (df["rsi"] >= HOT_RSI), "過熱", ""))
    df["heat"] = np.where(df["score"].isna(), "", heat)

    state = np.select(
        [df["score"] < 20,
         (df["n_sig"] >= 3) & (df["s1"] | df["s2"]),
         df["trough"] | forming,
         df["n_sig"] >= 1],
        ["未進便宜區", "轉折確認", "重點觀察", "轉折初現"],
        default="觀察中",
    )
    df["state"] = np.where(df["score"].isna(), "", state)
    sweet_hi = df["score"] >= SWEET_SCORE
    sweet_tr = df["trough"] & (df["score"] >= SWEET_TROUGH_SCORE)
    df["sweet"] = sweet_hi | sweet_tr
    df["sweet_why"] = np.where(sweet_hi, f"分數 ≥ {SWEET_SCORE}", np.where(sweet_tr, f"月線谷底確認且分數 ≥ {SWEET_TROUGH_SCORE}", ""))
    return df
