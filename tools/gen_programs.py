import json,re,os
D='data/programs/'
L=lambda f:json.load(open(D+f))
# keyword -> (muscles, fiber, pattern)
RULES=[
 ("calf",["Calves (Gastrocnemius)","Calves (Soleus)"],"slow","push"),
 ("abductor",["Abductors","Glute Med"],"slow","push"),("adductor bias",["Quads","Adductors","Glutes"],"fast","squat"),
 ("adductor",["Adductors"],"slow","push"),("hip thrust",["Glutes"],"fast","hinge"),
 ("bulgarian",["Quads","Glutes"],"fast","squat"),("lunge",["Quads","Glutes"],"mixed","squat"),
 ("squat",["Quads","Glutes"],"fast","squat"),("deadlift",["Hamstrings","Glutes","Lower Back"],"fast","hinge"),
 ("rdl",["Hamstrings","Glutes"],"fast","hinge"),("straight knee hinge",["Hamstrings","Glutes"],"fast","hinge"),
 ("bent knee hinge",["Glutes","Hamstrings"],"fast","hinge"),("hyperextension",["Lower Back","Glutes"],"mixed","hinge"),
 ("erector",["Lower Back"],"mixed","hinge"),("hamstring",["Hamstrings"],"mixed","pull"),("quad",["Quads"],"mixed","push"),
 ("z-twist",["Obliques","Core (rotational)"],"slow","pull"),("ab ",["Abs"],"slow","pull"),("ab rotation",["Obliques"],"slow","pull"),("ab crunch",["Abs"],"slow","pull"),
 ("rear delt",["Rear Delt"],"slow","pull"),("lateral raise",["Lateral Delt"],"slow","push"),("around the world",["Lateral Delt","Front Delt"],"slow","push"),
 ("front delt",["Front Delt"],"slow","push"),("upright row",["Lateral Delt","Traps"],"mixed","pull"),("bradford",["Front Delt","Lateral Delt"],"mixed","push"),
 ("shrug",["Traps"],"mixed","pull"),("vertical press",["Front Delt","Lateral Delt","Triceps"],"fast","push"),("military",["Front Delt","Lateral Delt","Triceps"],"fast","push"),
 ("landmine",["Front Delt","Upper Chest"],"fast","push"),
 ("curl",["Biceps","Brachialis"],"mixed","pull"),("hammer",["Brachialis","Brachioradialis"],"mixed","pull"),
 ("tricep",["Triceps"],"mixed","push"),("skullcrusher",["Triceps"],"mixed","push"),("bench dip",["Triceps"],"mixed","push"),("close grip",["Triceps","Chest"],"fast","push"),
 ("dip",["Chest","Triceps"],"fast","push"),("diamond",["Triceps","Chest"],"mixed","push"),("push-up",["Chest","Triceps"],"mixed","push"),
 ("incline",["Upper Chest","Front Delt"],"fast","push"),("low to high",["Upper Chest"],"slow","push"),("high to low",["Chest"],"slow","push"),
 ("fly",["Chest"],"slow","push"),("karate",["Chest"],"slow","push"),("pec deck",["Chest"],"slow","push"),("squeeze press",["Chest"],"mixed","push"),
 ("guillotine",["Upper Chest","Chest"],"fast","push"),("block press",["Chest","Triceps"],"fast","push"),("bench",["Chest","Triceps","Front Delt"],"fast","push"),("chest press",["Chest","Triceps"],"fast","push"),
 ("pull-up",["Lats","Biceps"],"fast","pull"),("pulldown",["Lats"],"mixed","pull"),("pullover",["Lats"],"slow","pull"),("lat sweep",["Lats"],"slow","pull"),
 ("row",["Mid Back","Lats","Rear Delt"],"fast","pull"),("trap",["Traps"],"mixed","pull"),
]
def classify(n):
    l=n.lower()
    for k,m,f,p in RULES:
        if k in l: return m,f,p
    return ["Core (stability)"],"mixed","pull"
lib={x['id']:x for x in json.load(open('data/programs/movement_library.json'))}
def mid(n):
    s="g_"+re.sub(r'[^a-z0-9]+','_',n.lower()).strip('_')
    if s not in lib:
        m,f,p=classify(n)
        eq=[] 
        lib[s]={"id":s,"name":n,"muscles":m,"primary":m[:1],"secondary":m[1:],"fiber":f,"equipment":eq,"gear":"Any","region":"","movement":"","level":2,"pattern":p,"cue":"","note":"","group":None,"isGroup":False}
    return s
def reps_str(r):
    if isinstance(r,list): return " / ".join(r)
    return str(r)
def conv_ex(lst):
    out=[];g=0
    for x in lst:
        if "superset" in x:
            g+=1;tag="ABCDEFGH"[g-1];items=x["superset"]
            for i,y in enumerate(items):
                o=conv1(y); o["superset"]=tag; o["note"]=f"Superset {tag}{i+1} of {len(items)} — go straight to the next movement"; out.append(o)
        else: out.append(conv1(x))
    return out
ALIAS={"Adductors":"Adductor","Abductors":"Abductor","High to Low Press/Fly":"High to Low Fly/Press","Double Joint Tricep Extension":"Double Joint Tricep","Barbell Bench Press (Elbows Tucked)":"Barbell Bench Press"}
def conv1(x):
    o={"id":mid(ALIAS.get(x["name"],x["name"])),"sets":x["sets"],"reps":reps_str(x["reps"])}
    if isinstance(x["reps"],list): o["repsBySet"]=x["reps"]
    if x.get("perSide"): o["reps"]+=" each side"
    if x.get("rest"): o["rest"]=x["rest"]
    return o
def phase_of(lbl,pid,s):
    l=lbl.lower()
    if "strength" in l or pid.startswith("power") or "low" in pid: return "strength"
    if "hypertrophy" in l or "volume" in l: return "hypertrophy"
    return "hypertrophy"
def build(pid,f,schedules):
    p=L(f); sess={}
    for k,v in p["sessions"].items():
        ex=conv_ex(v["exercises"]); mus=[]
        for e in ex:
            for m in lib[e["id"]]["muscles"]:
                if m not in mus: mus.append(m)
        lbl=re.sub(r'^Day \d+ - ','',v["label"]); lbl=re.sub(r'\s*\((Strength|Hypertrophy|Volume)\)$','',lbl)
        if k.startswith("W"): lbl=f"Week {k[1]} · {v['label'].split('(')[1].rstrip(')')}"
        sess[k]={"label":lbl,"phase":v.get("phase","").lower().replace("volume","hypertrophy") if v.get("phase") else phase_of(v["label"],pid,k),"muscles":mus[:6],"exercises":ex}
        if sess[k]["phase"] not in("strength","hypertrophy"): sess[k]["phase"]=phase_of(v["label"],pid,k)
    sch={}
    for key,(label,days) in schedules(p).items(): sch[key]={"label":label,"days":days}
    return {"sessions":sess,"schedules":sch}
one=lambda lab:(lambda p:{"default":(lab,p["schedule"])})
def dictsch(names):
    return lambda p:{k:(names.get(k,k),v) for k,v in p["schedules"].items()}
def bro(p):
    o={}
    for v,vv in p["variants"].items():
        for k,days in vv["schedules"].items(): o[f"{v}_{k}"]=(f"{v[0]} days a week · {k.replace('option','Option ')}",days)
    return o
P=[
("forge","The Forge","Every-other-day split, strength + size","Train every other day. Strength days and size days alternate so you never need a deload.",False,"#A0694B",
  {"standard":build("forge","mansour_upgraded.json",one("Every other day · 16-day cycle"))}),
("gauntlet","Gauntlet","The Forge, high-volume hard mode","Ridiculous volume. Supersets, giant sets and 10-set pyramids. Sleep, food and recovery all need to be on point.",True,"#B3261A",
  {"standard":build("gauntlet","mansour_nightmare.json",one("Every other day · 16-day cycle"))}),
("split","Split","Bro split, one muscle a day","Full attention on one muscle group per session. Less frequency, more effort.",False,"#7A7268",
  {"standard":build("split","bro_split.json",bro)}),
("triad","Triad","Push · Pull · Legs","A classic. Push day for chest, shoulders and triceps; pull day for back, rear delts and biceps; then legs.",False,"#4CC3DE",
  {"standard":build("triad","ppl.json",dictsch({"6day_option1":"6 days a week · Option 1","6day_option2":"6 days a week · Option 2","eod":"Every other day","4day_option1":"4 days a week"}))}),
("rotation","Rotation","Upper / Lower","Alternates full upper-body and full lower-body sessions. High frequency for every muscle.",False,"#3E6BC2",
  {"standard":build("rotation","upper_lower_mens.json",dictsch({"4day_option1":"4 days a week · Option 1","4day_option2":"4 days a week · Option 2","5day_option1":"5 days a week · Option 1","5day_option2":"5 days a week · Option 2","6day_option1":"6 days a week · Option 1","6day_option2":"6 days a week · Option 2","eod":"Every other day"}))}),
("power1","Power I","Beginner powerlifting","Squat, bench and deadlift built over a 4-week block. Top sets climb each week, week 4 backs off.",False,"#8E68CC",
  {"standard":build("power1","power1.json",one("5 days a week · 32-day block"))}),
("power2","Power II","Intermediate powerlifting","Heavier, longer top-set ladders with singles and AMRAP sets. Run Power I first.",True,"#E3B53C",
  {"standard":build("power2","power2.json",one("5 days a week · 32-day block"))}),
("upperhand","Upper Hand","80/20, upper-body focus","Push, pull, legs, push, pull. Mostly upper body without skipping legs entirely.",False,"#D9893A",
  {"standard":build("upperhand","p8020.json",one("9-day cycle")),"low":build("upperhand_low","p8020_low.json",one("18-day cycle"))}),
("balance","Balance","60/40, upper and lower","Push, pull, legs, then upper and lower. A balanced split across 8 days.",False,"#5DAA6A",
  {"standard":build("balance","p6040.json",one("8-day cycle")),"low":build("balance_low","p6040_low.json",one("16-day cycle"))}),
("total","Total","Full body","Every muscle, every session. Maximum frequency, small dose per muscle.",False,"#C9CED3",
  {"standard":build("total","full_body.json",one("4-day cycle")),"low":build("total_low","full_body_low.json",one("8-day cycle"))}),
("ember","Ember","Quick 5-day burn","Five fast supersetted sessions, two rest days. Short on time, high on output.",False,"#E0392B",
  {"standard":build("ember","quick_burn.json",one("5 days on, 2 off"))}),
]
progs={}
for pid,name,sub,desc,adv,col,vars_ in P:
    progs[pid]={"id":pid,"label":name,"sub":sub,"desc":desc,"advanced":adv,"color":col,"variants":vars_}
js="// ── PROGRAM LIBRARY (generated from user-supplied programs) ──\n"
js+="const GENERIC_LIBRARY = "+json.dumps(list(lib.values()),ensure_ascii=False)+";\n"
js+="const PROGRAMS_V2 = "+json.dumps(progs,ensure_ascii=False)+";\n"
__import__('os').makedirs('build',exist_ok=True) or open('build/programs_block.js','w').write(js)
print(len(lib),"movements;",len(js),"chars")
for pid,p in progs.items():
    for v,vv in p["variants"].items():
        for k,s in vv["schedules"].items():
            miss=[d for d in s["days"] if d!="rest" and d not in vv["sessions"]]
            if miss: print("MISSING",pid,v,k,miss)
