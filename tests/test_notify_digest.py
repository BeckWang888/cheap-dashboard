"""減少推播：跨上門檻下限、只通知持股＋重點、每日摘要。"""
from datetime import datetime

from cheapdash import notify

CFG = {"thresholds": [20, 50, 80], "cooldown_days": 7, "notify_cross_min": 50,
       "notify": {"cross": True, "confirm": False, "trough": False, "heat": False, "group": True}}


def cur(score):
    return {"score": score, "state": "觀察中", "trough": False, "trough_forming": False, "heat": ""}


def test_cross20_not_notified_but_cross50_is():
    _, st = notify.find_events([{"symbol": "X", "current": cur(10)}], {}, CFG)
    ev, st = notify.find_events([{"symbol": "X", "current": cur(25)}], st, CFG)
    assert ev == []
    ev, st = notify.find_events([{"symbol": "X", "current": cur(55)}], st, CFG)
    assert [k for _, k, _ in ev] == ["cross50"]


def test_scope_held_focus_and_plan():
    cfg = {"notify_scope": "held", "focus": ["2330.TW"], "plan_alerts": {"signal": {"syms": ["MU"]}}}
    h = {"lots": [{"acct": "a", "sym": "0050", "qty": 1, "px": 1}, {"acct": "a", "sym": "OLD", "qty": 0, "px": 1}]}
    syms = notify.scope_syms(cfg, h)
    assert syms == {"0050", "2330", "MU"}
    ev = [("0050.TW", "k", ""), ("2330.TW", "k", ""), ("OLD", "k", ""), ("NVDA", "k", ""), ("半導體", "group", "")]
    watch = {"0050.TW", "2330.TW", "OLD", "NVDA"}
    assert [e[0] for e in notify.filter_scope(ev, syms, watch)] == ["0050.TW", "2330.TW", "半導體"]
    assert notify.scope_syms({}, h) is None


def test_digest_once_per_day():
    cfg = {"digest": True, "digest_hour": 6}
    out, d = notify.digest([("A", "k", "t")], {"last": "2026-10-14"}, cfg, datetime(2026, 10, 14, 22))
    assert out == [] and d["pending"] == [["A", "k", "t"]]       # 今天已發過 → 存起來
    out, d = notify.digest([("B", "k", "t")], d, cfg, datetime(2026, 10, 15, 4))
    assert out == [] and len(d["pending"]) == 2                  # 隔天但還沒到 6 點
    out, d = notify.digest([], d, cfg, datetime(2026, 10, 15, 6, 12))
    assert [e[0] for e in out] == ["A", "B"] and d == {"pending": [], "last": "2026-10-15"}
    out, d = notify.digest([("C", "k", "t")], d, cfg, datetime(2026, 10, 15, 9))
    assert out == []                                             # 同一天只發一次


def test_digest_off_passes_through():
    ev = [("A", "k", "t")]
    assert notify.digest(ev, {}, {}, datetime(2026, 10, 15, 9)) == (ev, {})
