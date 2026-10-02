"""技術指標。EMA 與 RSI 都用 SMA 起始值，和 TA-Lib 的做法一致。"""
import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    v = s.to_numpy(float)
    out = np.full(len(v), np.nan)
    valid = np.flatnonzero(~np.isnan(v))
    if len(valid) < n:
        return pd.Series(out, s.index)
    start = valid[0]
    a = 2 / (n + 1)
    out[start + n - 1] = v[start:start + n].mean()
    for i in range(start + n, len(v)):
        out[i] = out[i - 1] + a * (v[i] - out[i - 1])
    return pd.Series(out, s.index)


def macd_hist(s: pd.Series, fast=12, slow=26, signal=9) -> pd.Series:
    line = ema(s, fast) - ema(s, slow)
    return line - ema(line, signal)


def rsi(s: pd.Series, n: int = 14) -> pd.Series:
    v = s.to_numpy(float)
    out = np.full(len(v), np.nan)
    if len(v) <= n:
        return pd.Series(out, s.index)
    d = np.diff(v, prepend=np.nan)
    g = np.where(d > 0, d, 0.0)
    l = np.where(d < 0, -d, 0.0)
    ag, al = g[1:n + 1].mean(), l[1:n + 1].mean()
    out[n] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(n + 1, len(v)):
        ag = (ag * (n - 1) + g[i]) / n
        al = (al * (n - 1) + l[i]) / n
        out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return pd.Series(out, s.index)


def closed_bars(close: pd.Series, period: str) -> pd.Series:
    """日線合成週線（'W-FRI'）或月線（'M'）。index 是該週／月最後一個交易日，
    也就是這根 K 棒收盤、可以確認的那一天。"""
    key = close.index.to_period(period)
    last_day = close.index.to_series().groupby(key).last()
    last_close = close.groupby(key).last()
    return pd.Series(last_close.to_numpy(), index=pd.DatetimeIndex(last_day.to_numpy()))
