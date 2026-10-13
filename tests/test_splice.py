import pandas as pd
import pytest

from cheapdash.data import splice_history


def test_splice_scales_proxy_and_keeps_own():
    proxy = pd.Series([10.0, 11.0, 12.0, 24.0], index=pd.to_datetime(["2020-01-01", "2020-01-02", "2020-01-03", "2020-01-06"]))
    own = pd.Series([50.0, 100.0], index=pd.to_datetime(["2020-01-03", "2020-01-06"]))
    out = splice_history(own, proxy)
    assert list(out.index) == list(proxy.index)
    assert out.loc["2020-01-03"] == 50.0 and out.loc["2020-01-06"] == 100.0   # 上市後完全用本身
    assert out.loc["2020-01-01"] == pytest.approx(10 * 50 / 12) and out.loc["2020-01-02"] == pytest.approx(11 * 50 / 12)   # 上市前等比例接上


def test_splice_without_earlier_proxy_returns_own():
    own = pd.Series([1.0, 2.0], index=pd.to_datetime(["2020-01-01", "2020-01-02"]))
    proxy = pd.Series([5.0], index=pd.to_datetime(["2020-01-02"]))
    assert splice_history(own, proxy).equals(own)
