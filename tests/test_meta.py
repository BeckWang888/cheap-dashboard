from cheapdash.meta import _tw_lev_underlying


def test_tw_leveraged_underlying_by_name():
    assert _tw_lev_underlying("期元大S&P黃金正2") == "GC=F"
    assert _tw_lev_underlying("期元大S&P原油正2") == "CL=F"
    assert _tw_lev_underlying("元大台灣50正2") == "0050.TW"
