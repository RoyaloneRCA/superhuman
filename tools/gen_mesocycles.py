"""Builds the two mesocycle programs (Apex, Wave) as data/programs/apex.json and wave.json.

Every exercise's set count comes from a weekly per-muscle target, split across the
exercises that train that muscle (largest-remainder rounding), so the weekly totals
are exact and can be audited. Loads are not prescribed: the app's own logs drive them.
"""
import json, math, sys

# slot = movement, share of that muscle's weekly sets, reps, rest, kind (c compound / i isolation)
def S(m, name, share, reps, rest, kind="i"): return dict(m=m, name=name, share=share, reps=reps, rest=rest, kind=kind)
# fixed (non-ramped) shoulder press slot: sets come from the press value, not a muscle target
def FX(name, reps, rest): return dict(m="press", name=name, share=1.0, reps=reps, rest=rest, kind="c")

T5 = {  # 5 days: Push / Pull / Legs / Upper / Lower
 "Push": [
  S("chest","Chest Press (Elbows Tucked)",.30,("3–6","6–10"),("3–5 min","2–3 min"),"c"),
  S("chest","Incline Chest Press (Elbows Flared)",.25,("4–6","8–12"),("3–4 min","2–3 min"),"c"),
  FX("Vertical Press (Elbows Flared)",("3–6","6–10"),("3–5 min","2–3 min")),
  S("side","Lateral Raise",.35,("8–12","12–20"),("90s","60s")),
  S("tri","Double Joint Tricep",.50,("5–8","8–12"),("2 min","90s"),"c"),
 ],
 "Pull": [
  S("back","Pull-Ups",.26,("3–6","6–10"),("3–4 min","2–3 min"),"c"),
  S("back","Upper Back Row",.26,("4–6","8–12"),("3 min","2 min"),"c"),
  S("rear","Rear Delt Fly",.40,("8–12","12–20"),("90s","60s")),
  S("bi","Supinated Curl",.45,("6–8","8–12"),("2 min","90s")),
 ],
 "Legs": [
  S("quads","Squat",.35,("3–6","5–8"),("3–5 min","3 min"),"c"),
  S("quads","Hack Squat",.20,("5–8","8–12"),("3 min","2 min"),"c"),
  S("hams","Straight Knee Hinge",.40,("4–6","6–10"),("3–4 min","2–3 min"),"c"),
  S("calves","Calf Raise",.5,("6–10","8–12"),("2 min","90s")),
  S("abs","Ab Crunch",.5,("8–12","12–20"),("90s","60s")),
 ],
 "Upper": [
  S("chest","Chest Fly",.25,("6–10","12–15"),("2 min","90s")),
  S("chest","Low to High Fly/Press",.20,("6–10","10–15"),("2 min","90s")),
  S("back","Lat Biased Row",.17,("5–8","10–12"),("2–3 min","2 min"),"c"),
  S("back","Lat Sweep",.16,("6–10","12–15"),("2 min","90s")),
  S("back","Pullover",.15,("6–10","12–15"),("2 min","90s")),
  S("side","Lateral Raise (Top Partials)",.30,("8–12","12–20"),("90s","60s")),
  S("rear","Rear Delt Fly",.30,("8–12","12–20"),("90s","60s")),
  S("bi","Hammer Curl",.25,("6–10","10–15"),("90s","60s")),
  S("tri","Single Joint Tricep",.50,("6–10","12–15"),("90s","60s")),
 ],
 "Lower": [
  S("quads","Quad Extension",.45,("6–10","12–20"),("2 min","90s")),
  S("hams","Hamstring Curl",.35,("6–10","10–15"),("2 min","90s")),
  S("hams","Bent Knee Hinge",.25,("5–8","8–12"),("3 min","2 min"),"c"),
  S("calves","Leg Press Calf Raise",.5,("8–12","12–20"),("90s","60s")),
  S("abs","Ab Crunch",.5,("8–12","12–20"),("90s","60s")),
  S("side","Lateral Raise",.35,("8–12","12–20"),("90s","60s")),
  S("rear","Rear Delt Fly",.30,("8–12","12–20"),("90s","60s")),
  S("bi","Supinated Curl",.30,("6–8","8–12"),("2 min","90s")),
 ],
}
T4 = {  # 4 days: Upper A / Lower A / Upper B / Lower B
 "Upper A": [
  S("chest","Chest Press (Elbows Tucked)",.30,("3–6","6–10"),("3–5 min","2–3 min"),"c"),
  S("chest","Low to High Fly/Press",.20,("6–10","10–15"),("2 min","90s")),
  S("back","Pull-Ups",.25,("3–6","6–10"),("3–4 min","2–3 min"),"c"),
  S("back","Upper Back Row",.25,("4–6","8–12"),("3 min","2 min"),"c"),
  FX("Vertical Press (Elbows Flared)",("3–6","6–10"),("3–5 min","2–3 min")),
  S("side","Lateral Raise",.20,("8–12","12–20"),("90s","60s")),
  S("rear","Rear Delt Fly",.30,("8–12","12–20"),("90s","60s")),
  S("bi","Supinated Curl",.35,("6–8","8–12"),("2 min","90s")),
  S("tri","Double Joint Tricep",.35,("5–8","8–12"),("2 min","90s"),"c"),
 ],
 "Lower A": [
  S("quads","Squat",.45,("3–6","5–8"),("3–5 min","3 min"),"c"),
  S("quads","Quad Extension",.15,("6–10","12–20"),("2 min","90s")),
  S("hams","Straight Knee Hinge",.50,("4–6","6–10"),("3–4 min","2–3 min"),"c"),
  S("calves","Calf Raise",.5,("6–10","8–12"),("2 min","90s")),
  S("abs","Ab Crunch",.5,("8–12","12–20"),("90s","60s")),
  S("side","Lateral Raise (Top Partials)",.30,("8–12","12–20"),("90s","60s")),
  S("tri","Single Joint Tricep",.30,("6–10","12–15"),("90s","60s")),
 ],
 "Upper B": [
  S("chest","Incline Chest Press (Elbows Flared)",.30,("4–6","8–12"),("3–4 min","2–3 min"),"c"),
  S("chest","Chest Fly",.20,("6–10","12–15"),("2 min","90s")),
  S("back","Lat Biased Row",.20,("5–8","10–12"),("2–3 min","2 min"),"c"),
  S("back","Lat Sweep",.15,("6–10","12–15"),("2 min","90s")),
  S("back","Pullover",.15,("6–10","12–15"),("2 min","90s")),
  S("side","Lateral Raise (Top Partials)",.25,("8–12","12–20"),("90s","60s")),
  S("rear","Rear Delt Fly",.30,("8–12","12–20"),("90s","60s")),
  S("bi","Hammer Curl",.35,("6–10","10–15"),("90s","60s")),
  S("tri","Single Joint Tricep",.35,("6–10","12–15"),("90s","60s")),
 ],
 "Lower B": [
  S("quads","Hack Squat",.40,("5–8","8–12"),("3 min","2 min"),"c"),
  S("hams","Hamstring Curl",.30,("6–10","10–15"),("2 min","90s")),
  S("hams","Bent Knee Hinge",.20,("5–8","8–12"),("3 min","2 min"),"c"),
  S("calves","Leg Press Calf Raise",.5,("8–12","12–20"),("90s","60s")),
  S("abs","Ab Crunch",.5,("8–12","12–20"),("90s","60s")),
  S("side","Lateral Raise",.25,("8–12","12–20"),("90s","60s")),
  S("rear","Rear Delt Fly",.40,("8–12","12–20"),("90s","60s")),
  S("bi","Supinated Curl",.30,("6–8","8–12"),("2 min","90s")),
 ],
}
T6 = {  # 6 days: Push A / Pull A / Legs A / Push B / Pull B / Legs B
 "Push A": [
  S("chest","Chest Press (Elbows Tucked)",.28,("3–6","6–10"),("3–5 min","2–3 min"),"c"),
  S("chest","Low to High Fly/Press",.22,("6–10","10–15"),("2 min","90s")),
  FX("Vertical Press (Elbows Flared)",("3–6","6–10"),("3–5 min","2–3 min")),
  S("side","Lateral Raise",.50,("8–12","12–20"),("90s","60s")),
  S("tri","Double Joint Tricep",.50,("5–8","8–12"),("2 min","90s"),"c"),
 ],
 "Pull A": [
  S("back","Pull-Ups",.26,("3–6","6–10"),("3–4 min","2–3 min"),"c"),
  S("back","Upper Back Row",.24,("4–6","8–12"),("3 min","2 min"),"c"),
  S("rear","Rear Delt Fly",.50,("8–12","12–20"),("90s","60s")),
  S("bi","Supinated Curl",.50,("6–8","8–12"),("2 min","90s")),
 ],
 "Legs A": [
  S("quads","Squat",.45,("3–6","5–8"),("3–5 min","3 min"),"c"),
  S("quads","Quad Extension",.10,("6–10","12–20"),("2 min","90s")),
  S("hams","Straight Knee Hinge",.50,("4–6","6–10"),("3–4 min","2–3 min"),"c"),
  S("calves","Calf Raise",.5,("6–10","8–12"),("2 min","90s")),
  S("abs","Ab Crunch",.5,("8–12","12–20"),("90s","60s")),
 ],
 "Push B": [
  S("chest","Incline Chest Press (Elbows Flared)",.28,("4–6","8–12"),("3–4 min","2–3 min"),"c"),
  S("chest","Chest Fly",.22,("6–10","12–15"),("2 min","90s")),
  S("side","Lateral Raise (Top Partials)",.50,("8–12","12–20"),("90s","60s")),
  S("tri","Single Joint Tricep",.50,("6–10","12–15"),("90s","60s")),
 ],
 "Pull B": [
  S("back","Lat Biased Row",.20,("5–8","10–12"),("2–3 min","2 min"),"c"),
  S("back","Lat Sweep",.16,("6–10","12–15"),("2 min","90s")),
  S("back","Pullover",.14,("6–10","12–15"),("2 min","90s")),
  S("rear","Rear Delt Fly",.50,("8–12","12–20"),("90s","60s")),
  S("bi","Hammer Curl",.50,("6–10","10–15"),("90s","60s")),
 ],
 "Legs B": [
  S("quads","Hack Squat",.45,("5–8","8–12"),("3 min","2 min"),"c"),
  S("hams","Hamstring Curl",.30,("6–10","10–15"),("2 min","90s")),
  S("hams","Bent Knee Hinge",.20,("5–8","8–12"),("3 min","2 min"),"c"),
  S("calves","Leg Press Calf Raise",.5,("8–12","12–20"),("90s","60s")),
  S("abs","Ab Crunch",.5,("8–12","12–20"),("90s","60s")),
 ],
}
WEEK6 = ["Push A","Pull A","Legs A","Push B","Pull B","Legs B","rest"]
WEEK5 = ["Push","Pull","Legs","rest","Upper","Lower","rest"]
WEEK4 = ["Upper A","Lower A","rest","Upper B","Lower B","rest","rest"]
TEMPLATES = {6:(T6, WEEK6), 5:(T5, WEEK5), 4:(T4, WEEK4)}

# third weekly exposure for the muscles being specialised
def _chest_arms(): return [S("chest","High to Low Fly/Press",.25,"10–15","90s"),S("bi","Reverse Curl",.2,"10–15","60s"),S("tri","Single Joint Tricep",.2,"12–20","60s")]
def _back_delts(): return [S("back","Upper Back Row",.25,"10–12","2 min","c"),S("side","Lateral Raise",.15,"15–20","60s"),S("rear","Rear Delt Fly",.25,"15–20","60s")]
def _legs(): return [S("quads","Leg Press (Quad Bias)",.25,"10–15","2 min","c"),S("hams","Hamstring Curl",.2,"12–15","90s"),S("calves","Calf Raise",.25,"12–20","60s")]
ADDON = {
 "chest_arms": {"label":"Chest & Arms","prio":["chest","bi","tri"],6:{"Legs A":_chest_arms()},5:{"Lower":_chest_arms()},4:{"Lower A":_chest_arms()}},
 "back_delts": {"label":"Back & Delts","prio":["back","side","rear"],6:{"Legs B":_back_delts()},5:{"Lower":_back_delts()},4:{"Lower A":_back_delts()}},
 "legs":       {"label":"Legs","prio":["quads","hams","calves"],6:{"Pull B":_legs()},5:{"Pull":_legs()},4:{"Upper A":_legs()}},
}
MUSCLES = ["chest","back","quads","hams","side","rear","bi","tri","calves","abs"]
LABEL = dict(chest="Chest",back="Back",quads="Quads",hams="Hams",side="SideD",rear="RearD",bi="Bi",tri="Tri",calves="Calves",abs="Abs",press="Press")

# Version guidance where the research favors a position. Shown ahead of the movement's own note.
TIPS = {
 "Single Joint Tricep": "Pick an overhead version: training the triceps stretched tends to grow them more.",
 "Hamstring Curl": "Pick the seated version: it works the hamstring in a lengthened position.",
 "Supinated Curl": "Incline or preacher versions load the stretched position.",
 "Calf Raise": "Knee straight, full stretch at the bottom, one-second pause.",
}

def alloc(total, shares):
    """Largest-remainder split of `total` sets over slots; keeps the exact total."""
    s = sum(shares); raw = [total*x/s for x in shares]
    base = [math.floor(r) for r in raw]; rem = total - sum(base)
    for i in sorted(range(len(raw)), key=lambda i: raw[i]-base[i], reverse=True)[:rem]: base[i] += 1
    return base

def build_week(tpl, targets, fixed_sets, addon=None):
    """Allocate one week. Returns {session: [(slot, sets)]} and {muscle: total sets}."""
    addon = addon or {}
    allslots = []
    for sess, slots in tpl.items():
        for i, sl in enumerate(slots): allslots.append((sess, ("b", i), sl))
    for sess, slots in addon.items():
        for i, sl in enumerate(slots): allslots.append((sess, ("a", i), sl))
    res, totals = {}, {}
    for m in MUSCLES:
        mine = [(s, k, sl) for s, k, sl in allslots if sl["m"] == m]
        if not mine: continue
        add_total = sum(sl["share"] for _, k, sl in mine if k[0] == "a")
        shares = [sl["share"] * (1 - add_total) if k[0] == "b" else sl["share"] for _, k, sl in mine]
        for (s, k, sl), n in zip(mine, alloc(targets[m], shares)): res[(s, k)] = n
        totals[m] = targets[m]
    out = {}
    for sess, slots in tpl.items():
        lst = []
        for i, sl in enumerate(slots):
            n = fixed_sets if sl["m"] == "press" else res.get((sess, ("b", i)), 0)
            if n > 0: lst.append((sl, n))
        for i, sl in enumerate(addon.get(sess, [])):
            n = res.get((sess, ("a", i)), 0)
            if n > 0: lst.append((sl, n))
        lst.sort(key=lambda t: 0 if t[0]["kind"] == "c" else 1)   # heavy lifts first
        out[sess] = lst
    totals["press"] = fixed_sets
    return out, totals

def ex_dict(sl, n, mode):
    reps, rest = sl["reps"], sl["rest"]
    if isinstance(reps, tuple): reps = reps[0] if mode == "strength" else reps[1]
    if isinstance(rest, tuple): rest = rest[0] if mode == "strength" else rest[1]
    d = {"name": sl["name"], "sets": n, "reps": reps, "rest": rest}
    if sl["name"] in TIPS: d["note"] = TIPS[sl["name"]]
    return d

# ---------------------------------------------------------------- Apex
APEX_SIZE = {  # weeks 1-6 (6 = deload)
 "chest":[10,11,13,14,16,6],"back":[11,13,15,17,18,7],"quads":[8,9,11,13,14,5],"hams":[6,7,9,10,11,4],
 "side":[8,9,11,13,14,5],"rear":[5,6,7,8,8,3],"bi":[7,8,10,11,12,4],"tri":[7,8,9,11,12,4],
 "calves":[6,7,8,10,10,4],"abs":[4,4,5,6,6,3]}
APEX_PRESS = [3,3,4,4,4,2]
APEX_EFFORT = ["3 RIR","2 RIR","2 RIR","1 RIR","0–1 RIR · isolations to failure","5 RIR · deload"]
APEX_BLOCK = ["Size block · build 1 of 5","Size block · build 2 of 5","Size block · build 3 of 5","Size block · build 4 of 5","Size block · build 5 of 5","Size block · deload"]
SPEC_PRIO = {"chest":[16,19,22],"back":[18,21,24],"quads":[12,15,18],"hams":[10,12,14],"side":[14,18,22],"rear":[8,11,14],
             "bi":[12,15,18],"tri":[12,14,16],"calves":[10,13,16]}
SPEC_MAINT = {"chest":8,"back":10,"quads":6,"hams":5,"side":8,"rear":5,"bi":6,"tri":6,"calves":5,"abs":4}
SPEC_DELOAD = {"chest":6,"back":7,"quads":5,"hams":4,"side":5,"rear":3,"bi":4,"tri":4,"calves":4,"abs":3}
SPEC_EFFORT = ["2 RIR on priority muscles · 3 RIR on the rest","1 RIR on priority muscles · 3 RIR on the rest","0–1 RIR on priority muscles · 3 RIR on the rest","5 RIR · deload"]

def make_size():
    """6-week size block (5 build weeks + deload). Program id: wave."""
    p = {"id":"wave","name":"Wave","description":"Six weeks. Five weeks of rising volume, then a deload. Every muscle climbs together. Loads follow your logs.",
         "cycleDays":42,"schedules":{},"sessions":{}}
    audit = {}
    for ndays,(tpl,week_order) in TEMPLATES.items():
        for w in range(6):
            out, totals = build_week(tpl, {m: APEX_SIZE[m][w] for m in MUSCLES}, APEX_PRESS[w])
            audit[(ndays,"size",w+1)] = totals
            for sess, lst in out.items():
                p["sessions"][f"s{ndays}_{w+1}_{sess.replace(' ','')}"] = {"label":f"Wk {w+1} · {sess}","focus":sess,"phase":"hypertrophy",
                    "effort":APEX_EFFORT[w],"block":APEX_BLOCK[w],"exercises":[ex_dict(sl,n,"size") for sl,n in lst]}
        p["schedules"][f"{ndays}d"] = {"label":f"{ndays} days a week","days":
            ["rest" if s == "rest" else f"s{ndays}_{w+1}_{s.replace(' ','')}" for w in range(6) for s in week_order]}
    return p, audit

def make_focus():
    """4-week specialization block (3 build weeks + deload). Program id: focus."""
    p = {"id":"focus","name":"Focus","description":"Four weeks. Pick the muscles you want to bring up: they get a third weekly session and climb toward their limit while everything else holds at maintenance. Best after a size block.",
         "cycleDays":28,"schedules":{},"sessions":{}}
    audit = {}
    for ndays,(tpl,week_order) in TEMPLATES.items():
        for track,info in ADDON.items():
            for w in range(4):
                if w < 3:
                    tg = {m: (SPEC_PRIO[m][w] if m in info["prio"] else SPEC_MAINT[m]) for m in MUSCLES if m != "abs"}
                    tg["abs"] = SPEC_MAINT["abs"]; press = 3
                else:
                    tg = dict(SPEC_DELOAD); press = 2
                out, totals = build_week(tpl, tg, press, addon=info[ndays] if w < 3 else {})
                audit[(ndays,track,w+1)] = totals
                for sess, lst in out.items():
                    p["sessions"][f"f{ndays}_{w+1}_{track}_{sess.replace(' ','')}"] = {"label":f"Wk {w+1} · {sess}","focus":sess,"phase":"hypertrophy",
                        "effort":SPEC_EFFORT[w],"block":("Focus · "+info["label"]) if w<3 else "Focus · deload",
                        "exercises":[ex_dict(sl,n,"size") for sl,n in lst]}
            p["schedules"][f"{ndays}d_{track}"] = {"label":f"{ndays} days a week · Focus: {info['label']}","days":
                ["rest" if s == "rest" else f"f{ndays}_{w+1}_{track}_{s.replace(' ','')}" for w in range(4) for s in week_order]}
    return p, audit

# ---------------------------------------------------------------- Wave (weeks 1,3,5,7 strength; 2,4,6,8 size; 9 deload)
_S = {"chest":[10,11,12,13],"back":[12,13,14,15],"quads":[8,9,10,11],"hams":[6,7,8,9],"side":[6,7,8,8],"rear":[4,5,5,6],
      "bi":[6,6,7,8],"tri":[6,6,7,8],"calves":[5,6,6,7],"abs":[4,4,5,5]}
_H = {"chest":[14,16,18,20],"back":[16,18,19,20],"quads":[12,14,16,18],"hams":[9,11,13,14],"side":[9,11,13,14],"rear":[5,6,7,8],
      "bi":[8,10,11,12],"tri":[8,10,11,12],"calves":[7,9,10,10],"abs":[5,5,6,6]}
_D = {"chest":8,"back":9,"quads":6,"hams":5,"side":5,"rear":3,"bi":4,"tri":4,"calves":4,"abs":3}
WAVE = {m:[v for i in range(4) for v in (_S[m][i],_H[m][i])]+[_D[m]] for m in _S}
WAVE_PRESS = [4,3,4,3,5,4,5,4,2]
WAVE_EFFORT = ["3 RIR","3 RIR","2 RIR","2 RIR","1–2 RIR","1 RIR","1 RIR","0–1 RIR · isolations to failure","5 RIR · deload"]

def make_strength_waves():
    """9-week strength/size waves. Program id: apex."""
    p = {"id":"apex","name":"Apex","description":"Nine weeks in four waves. Each wave is a heavy strength week followed by a high-volume size week, and every wave climbs. Isolation work stays in the strength weeks at lower volume.",
         "cycleDays":63,"schedules":{},"sessions":{}}
    audit = {}
    for ndays,(tpl,week_order) in TEMPLATES.items():
        for w in range(9):
            strength = w in (0,2,4,6)
            out, totals = build_week(tpl, {m: WAVE[m][w] for m in MUSCLES}, WAVE_PRESS[w])
            audit[(ndays,"wave",w+1)] = totals
            block = f"Wave {w//2+1} · strength week" if strength else (f"Wave {w//2+1} · size week" if w != 8 else "Deload")
            for sess, lst in out.items():
                p["sessions"][f"x{ndays}_{w+1}_{sess.replace(' ','')}"] = {"label":f"Wk {w+1} · {sess}","focus":sess,
                    "phase":"strength" if strength else "hypertrophy","effort":WAVE_EFFORT[w],"block":block,
                    "exercises":[ex_dict(sl,n,"strength" if strength else "size") for sl,n in lst]}
        p["schedules"][f"{ndays}d"] = {"label":f"{ndays} days a week","days":
            ["rest" if s == "rest" else f"x{ndays}_{w+1}_{s.replace(' ','')}" for w in range(9) for s in week_order]}
    return p, audit

if __name__ == "__main__":
    for name, fn in (("apex", make_strength_waves), ("wave", make_size), ("focus", make_focus)):
        p, audit = fn()
        json.dump(p, open(f"data/programs/{name}.json","w"), indent=1, ensure_ascii=False)
        print(name, len(p["sessions"]), "sessions;", {k:len(v["days"]) for k,v in p["schedules"].items()})
        if "--audit" in sys.argv:
            for (nd,tag,wk),t in sorted(audit.items(), key=lambda x:(x[0][0],str(x[0][1]),x[0][2])):
                print(nd, tag, wk, " ".join(f"{LABEL[m]}{t[m]}" for m in MUSCLES+["press"] if m in t))
