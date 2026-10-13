from datetime import date

from cheapdash.notify import avg_costs, plan_events

RULES = {"signal": {"syms": ["MU"], "min_sig": 2, "msg": "s"},
         "rebound": {"syms": ["SOXL"], "pct": 0.08, "cooldown": 7, "msg": "r"},
         "breakeven": {"syms": ["SNXX"], "msg": "b"},
         "dates": [{"date": "2027-03-31", "msg": "d"}]}


def test_avg_costs_average_method():
    h = {"lots": [{"acct": "a", "sym": "X", "date": "2026-01-01", "qty": 10, "px": 10},
                  {"acct": "a", "sym": "X", "date": "2026-02-01", "qty": -5, "px": 20},
                  {"acct": "b", "sym": "X", "date": "2026-03-01", "qty": 5, "px": 16}]}
    assert avg_costs(h)["X"] == 13   # 剩 5 股成本 10，加 5 股成本 16


def test_signal_only_on_transition():
    ev, st = plan_events({"MU": {"n_sig": 3}}, {}, {}, RULES, date(2026, 10, 14))
    assert ev == []                                   # 第一次只記錄
    ev, st = plan_events({"MU": {"n_sig": 1}}, {}, st, RULES, date(2026, 10, 15))
    ev, st = plan_events({"MU": {"n_sig": 2}}, {}, st, RULES, date(2026, 10, 16))
    assert len(ev) == 1 and "2 顆" in ev[0][2]


def test_rebound_cooldown_and_breakeven_and_dates():
    rows = {"SOXL": {"r5": 0.1}, "SNXX": {"price": 12}}
    ev, st = plan_events(rows, {"SNXX": 19}, {}, RULES, date(2026, 10, 14))
    assert [e[0] for e in ev] == ["SOXL"]
    ev, st = plan_events(rows, {"SNXX": 19}, st, RULES, date(2026, 10, 16))
    assert ev == []                                   # 7 天冷卻
    ev, st = plan_events({"SNXX": {"price": 19.5}}, {"SNXX": 19}, st, RULES, date(2026, 11, 1))
    assert [e[0] for e in ev] == ["SNXX"]             # 從成本下回到成本上
    ev, st = plan_events({}, {}, st, RULES, date(2027, 4, 2))
    assert ev and ev[0][0] == "計畫"
    ev, st = plan_events({}, {}, st, RULES, date(2027, 4, 3))
    assert ev == []                                   # 日期只提醒一次
