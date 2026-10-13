from datetime import date

import pandas as pd

from cheapdash.events import _dates, symbols_for


def test_dates_from_dict_and_range():
    assert _dates({"Earnings Date": [date(2026, 11, 18)]}) == [date(2026, 11, 18)]
    assert _dates({"Earnings Date": [pd.Timestamp("2026-11-20"), pd.Timestamp("2026-11-18")]}) == [date(2026, 11, 18), date(2026, 11, 20)]
    assert _dates({}) == [] and _dates(None) == []


def test_symbols_skip_etfs_and_tw():
    items = [{"symbol": "PLTR", "market": "US", "type": "stock", "name": "Palantir"},
             {"symbol": "SOXL", "market": "US", "type": "leveraged", "underlying": "SOXX"},
             {"symbol": "SNXX", "market": "US", "type": "leveraged", "underlying": "SNDK"},
             {"symbol": "SKUU", "market": "US", "type": "leveraged", "underlying": "000660.KS"},
             {"symbol": "0050.TW", "market": "TW", "type": "etf"}]
    s = symbols_for(items)
    assert "PLTR" in s and "SNDK" in s and "NVDA" in s
    assert "SOXX" not in s and "000660.KS" not in s and "0050.TW" not in s
