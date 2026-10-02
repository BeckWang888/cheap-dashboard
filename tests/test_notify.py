"""通知邏輯：跨門檻、遲滯、冷卻、群組。"""
from datetime import date

from cheapdash import notify

CFG = {"thresholds": [20, 50, 80], "cooldown_days": 7, "group_alert_min": 3,
       "notify": {"cross": True, "confirm": True, "trough": True, "heat": False, "group": True}}


def cur(score, state="觀察中", trough=False, forming=False, heat=""):
    return {"score": score, "state": state, "trough": trough, "trough_forming": forming, "heat": heat}


def run(score_seq, **kw):
    state, all_events = {}, []
    for s in score_seq:
        ev, state = notify.find_events([{"symbol": "X", "current": cur(s, **kw)}], state, CFG)
        all_events.append([k for _, k, _ in ev])
    return all_events


def test_cross_once_with_hysteresis():
    ev = run([10, 25, 18, 24, 5, 30])
    assert ev == [[], ["cross20"], [], [], [], ["cross20"]]  # 18 沒低於 10，不重新 armed；5 才重新 armed


def test_jump_multiple_levels():
    assert run([10, 55])[1] == ["cross20", "cross50"]


def test_first_sight_above_threshold_is_silent():
    assert run([60, 65]) == [[], []]


def test_confirm_and_trough_transitions():
    st = {"items": {"X": {"state": "轉折初現", "trough": "", "armed": {}}}}
    ev, st = notify.find_events([{"symbol": "X", "current": cur(30, "轉折確認", forming=True)}], st, CFG)
    assert [k for _, k, _ in ev] == ["confirm", "trough形成中"]
    ev, st = notify.find_events([{"symbol": "X", "current": cur(30, "轉折確認", trough=True)}], st, CFG)
    assert [k for _, k, _ in ev] == ["trough已確認"]


def test_cooldown():
    state = {"sent": {}}
    e = [("X", "cross20", "跨上 20")]
    assert notify.apply_cooldown(e, state, CFG, date(2026, 10, 1)) == e
    assert notify.apply_cooldown(e, state, CFG, date(2026, 10, 5)) == []
    assert notify.apply_cooldown(e, state, CFG, date(2026, 10, 9)) == e


def test_group_alert_only_when_reaching_min():
    g = {"半導體/AI": ["A", "B", "C"]}
    assert len(notify.group_events(g, {"groups": {"半導體/AI": 2}}, CFG)) == 1
    assert notify.group_events(g, {"groups": {"半導體/AI": 3}}, CFG) == []


def test_compose_sorted_by_score():
    title, msg, pri = notify.compose([("A", "cross20", "跨上 20"), ("B", "cross80", "跨上 80")], {"A": 22, "B": 81})
    assert msg.splitlines()[0].startswith("B 81") and pri == 4
