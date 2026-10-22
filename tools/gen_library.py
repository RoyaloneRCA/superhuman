import json, re
G = json.load(open('data/programs/movement_groups.json'))
slug = lambda n: "g_" + re.sub(r'[^a-z0-9]+', '_', n.lower()).strip('_')

M = {
"Ab Crunch": (["Abs"],["Obliques"],"Torso","Flexion","slow","Curl the ribcage down toward the pelvis; round the spine, don't just bend at the hips. Exhale hard at the bottom and control the return.","Spinal flexion under load. Builds the front of the abs."),
"Ab Rotation": (["Obliques"],["Abs"],"Torso","Rotation","slow","Rotate through the ribcage with hips locked square. Move slow and stop the rotation with the abs, not momentum.","Rotational strength for the obliques."),
"Abductor": (["Abductors","Glute Med"],[],"Hip","Abduction","slow","Drive the knees out against the pads and pause at full width. Lean slightly forward to bias the upper glute.","Hip stability and side-glute shape."),
"Adductor": (["Adductors"],[],"Hip","Adduction","slow","Start in a deep stretch and squeeze the thighs together under control. Don't let the weight snap you back open.","Inner-thigh strength protects the groin and hips under heavy squats."),
"Adductor Bias Squat": (["Adductors","Quads","Glutes"],[],"Legs","Squat","fast","Take a wide stance with toes turned out and push the knees out over the toes. Sit straight down between the heels.","Wide-stance squat that shifts work to the inner thighs and glutes."),
"Bent Knee Hinge": (["Glutes","Hamstrings"],["Lower Back"],"Hip","Hinge","fast","Soft knees, push the hips back and keep the spine neutral. Finish by squeezing the glutes, not by leaning back.","Hip extension with bent knees: glute-dominant."),
"Bodyweight Abs": (["Abs","Obliques"],["Core (stability)"],"Torso","Isometric","slow","Brace like you're about to be punched and keep the ribs down. Quality reps over speed.","Core control and stability work."),
"Calf Raise": (["Calves (Gastrocnemius)","Calves (Soleus)"],[],"Legs","Extension","slow","Pause in the deep stretch at the bottom, then rise as high as possible on the big toe. No bouncing.","Calves respond to full range and time under tension more than heavy load."),
"Chest Fly": (["Chest"],["Front Delt"],"Torso","Push (Horizontal)","slow","Keep a slight fixed bend in the elbows and open wide into the stretch. Bring the arms together by squeezing the chest, like hugging a barrel.","Chest isolation with a big stretch."),
"Chest Press (Elbows Flared)": (["Chest"],["Front Delt","Triceps"],"Torso","Push (Horizontal)","fast","Elbows travel out wider to load the chest through a long stretch. Keep the shoulder blades pinned back the whole set.","Chest-biased press."),
"Chest Press (Elbows Tucked)": (["Chest","Triceps"],["Front Delt"],"Torso","Push (Horizontal)","fast","Shoulder blades back and down, slight arch, feet planted. Lower to mid-chest and drive back up and slightly toward the face.","Primary horizontal press. Strongest pressing position."),
"Deadlift": (["Glutes","Hamstrings","Lower Back"],["Traps","Quads"],"Full Body","Hinge","fast","Bar over mid-foot, take the slack out of the bar and brace before it leaves the floor. Push the floor away and lock out with the glutes.","Full posterior-chain strength anchor."),
"Double Joint Tricep": (["Triceps"],["Chest","Front Delt"],"Arms","Push","mixed","Keep elbows close and let the triceps finish the lockout. Control the lowering; don't drop into the bottom.","Compound triceps work that allows heavy loading."),
"Erector Crunches": (["Lower Back"],["Glutes"],"Spine","Extension","mixed","Round the lower back forward, then extend segment by segment back to neutral. Smooth, no jerking.","Lower-back strength through a controlled range."),
"Front Delt Raise": (["Front Delt"],["Upper Chest"],"Shoulder","Flexion","slow","Raise to eye level with a slight elbow bend. Don't swing the torso to start the rep.","Front delt isolation."),
"Hammer Curl": (["Brachialis","Brachioradialis"],["Biceps"],"Arms","Flexion","mixed","Thumbs up, elbows pinned to your sides. Curl without letting the elbows drift forward.","Neutral-grip curl that thickens the arm and forearm."),
"Hamstring Curl": (["Hamstrings"],["Calves (Gastrocnemius)"],"Knee","Flexion","mixed","Line the knee up with the machine pivot and curl all the way in. Lower slowly; the hamstrings grow on the way down.","Knee-flexion hamstring isolation."),
"Hamstring Curl (Pulse Reps)": (["Hamstrings"],[],"Knee","Flexion","slow","Work short pulses in the hardest, fully curled part of the range. Keep constant tension; never rest at the bottom.","Partial-range finisher for maximum hamstring tension."),
"High to Low Fly/Press": (["Chest"],["Triceps","Front Delt"],"Torso","Push (Horizontal)","mixed","Press or sweep downward toward the lower ribs. Lead with the chest, not the shoulders.","Biases the lower chest fibers."),
"Incline Chest Press (Elbows Flared)": (["Upper Chest"],["Front Delt","Triceps"],"Torso","Push (Horizontal)","fast","Bench at 30–45°, elbows out to load the upper chest. Lower to the collarbone line and press up and back.","Upper-chest-biased press."),
"Incline Fly": (["Upper Chest"],["Front Delt"],"Torso","Push (Horizontal)","slow","On an incline, open wide into the stretch and bring the hands together above the upper chest.","Upper-chest isolation."),
"Lat Biased Row": (["Lats"],["Mid Back","Biceps"],"Torso","Pull (Vertical)","fast","Pull the elbows down and back toward the hips. Think 'elbows to back pockets' to keep the lats working.","Pulling angle that targets lat width."),
"Lat Sweep": (["Lats"],["Rear Delt"],"Torso","Pull","slow","Arms nearly straight, sweep the hand in an arc toward the hip. Feel the lat stretch at the top of each rep.","Lat isolation through a long arc."),
"Lateral Raise": (["Lateral Delt"],["Traps"],"Shoulder","Abduction","slow","Lead with the elbows and raise out to the side to shoulder height. Keep the traps quiet; no shrugging.","Side-delt isolation for shoulder width."),
"Lateral Raise (Top Partials)": (["Lateral Delt"],[],"Shoulder","Abduction","slow","Stay in the top half of the range. Short, controlled reps with constant tension.","Partial-range finisher for the side delts."),
"Low to High Fly/Press": (["Upper Chest"],["Front Delt"],"Torso","Push (Horizontal)","mixed","Drive up and in toward eye level. Squeeze the upper chest at the top.","Biases the upper chest fibers."),
"Middle/Lower Trap Shrug": (["Traps","Mid Back"],["Rear Delt"],"Shoulder","Pull","mixed","Pull the shoulder blades back and down; don't shrug up to the ears. Pause in the squeeze.","Mid and lower trap strength for posture and back thickness."),
"Pullover": (["Lats"],["Chest","Triceps"],"Shoulder","Extension","slow","Keep a slight elbow bend and arc the weight from overhead down to the hips. Feel the stretch on the way up.","Lat isolation through shoulder extension."),
"Quad Extension": (["Quads"],[],"Knee","Extension","mixed","Line the knee up with the pivot and kick to full lockout. Squeeze the quads and lower slowly.","Quad isolation."),
"Rear Delt Fly": (["Rear Delt"],["Mid Back","Traps"],"Shoulder","Pull (Horizontal)","slow","Lead with the pinkies and move the arms wide, not back. Light weight, strict reps.","Rear-delt isolation for shoulder health and 3D delts."),
"Reverse Curl": (["Brachioradialis","Brachialis"],["Biceps"],"Arms","Flexion","mixed","Overhand grip, wrists neutral, elbows pinned. Curl with the forearms and lower slowly.","Forearm and brachialis builder."),
"Single Joint Tricep": (["Triceps"],[],"Arms","Extension","mixed","Only the elbow moves. Get a full stretch and lock out hard.","Triceps isolation."),
"Squat": (["Quads","Glutes"],["Adductors","Lower Back"],"Legs","Squat","fast","Brace hard, knees track over the toes, sit down between the hips. Drive up through the whole foot.","Primary lower-body strength movement."),
"Straight Knee Hinge": (["Hamstrings","Glutes"],["Lower Back"],"Hip","Hinge","fast","Legs nearly straight, push the hips back until you feel a deep hamstring stretch. Stand up by driving the hips forward.","Hamstring-dominant hip hinge."),
"Supinated Curl": (["Biceps"],["Brachialis"],"Arms","Flexion","mixed","Palms up, elbows pinned. Curl and turn the pinky up at the top to fully contract.","Classic biceps builder."),
"Upper Back Row": (["Mid Back","Traps","Rear Delt"],["Lats","Biceps"],"Torso","Pull (Horizontal)","fast","Pull with the elbows wide toward the upper ribs. Squeeze the shoulder blades together at the top.","Upper-back thickness."),
"Upper Trap Shrug": (["Traps"],[],"Shoulder","Elevation","mixed","Shrug straight up toward the ears and hold a second. No rolling the shoulders.","Upper-trap builder."),
"Vertical Press (Elbows Flared)": (["Front Delt","Lateral Delt"],["Triceps","Traps"],"Shoulder","Push (Vertical)","fast","Elbows out to the side, press straight overhead. Brace the core so the lower back doesn't arch.","Overhead press biased toward the side delts."),
"Vertical Press (Elbows Tucked)": (["Front Delt"],["Triceps","Upper Chest"],"Shoulder","Push (Vertical)","fast","Elbows slightly in front of the bar, press overhead and finish with the head through. Glutes tight.","Strongest overhead pressing position."),
"Pull-Ups": (["Lats","Biceps"],["Mid Back","Brachialis"],"Torso","Pull (Vertical)","fast","Start from a dead hang, pull the chest toward the bar and lower all the way down. No kipping.","Vertical pulling strength."),
}
OTHER = {
"Barbell Bradfords": (["Front Delt","Lateral Delt"],["Triceps"],"Shoulder","Push (Vertical)","mixed","Press just over the head, alternating front and back of the head without locking out. Keep constant tension.","Overhead press variation for continuous delt tension."),
"Barbell Bulgarian Split Squat": (["Quads","Glutes"],["Adductors"],"Legs","Lunge","fast","Rear foot on the bench, drop straight down and drive through the front heel.","Single-leg strength and balance."),
"Seated Cable Row (Retraction/Depression)": (["Mid Back","Traps"],["Lats"],"Torso","Pull (Horizontal)","mixed","Arms stay straight; pull the shoulder blades back and down only.","Scapular control for the mid and lower traps."),
"Z-Twists": (["Obliques"],["Abs"],"Torso","Rotation","slow","Control the rotation from the ribcage, hips steady.","Rotational core strength."),
}
EQ = [("smith machine","Smith Machine"),("seated cable row","Seated Cable Row"),("lat pulldown","Lat Pulldown"),("leg press","Leg Press"),
 ("hack squat","Hack Squat"),("pendulum","Pendulum"),("belt squat","Belt Squat"),("trap bar","Trap Bar"),("t-bar","T-Bar"),("v-squat","V-Squat"),
 ("pec deck","Pec Deck"),("preacher","Preacher"),("ez bar","EZ Bar"),("weight plate","Plate"),("plate curl","Plate"),("resistance band","Band"),
 ("medicine ball","Medicine Ball"),("kettlebell","Kettlebell"),("barbell","Barbell"),("dumbbell","Dumbbell"),("farmer","Dumbbell"),("suitcase","Dumbbell"),
 ("cable","Cable"),("karate","Cable"),("machine","Machine"),("hyperextension","Machine")]
SETUP = {
 "Barbell":"Set the bar at the right height, collars on, and brace before every rep.",
 "Dumbbell":"Pick a weight you can control through the full range on both sides.",
 "Cable":"Set the pulley to match the line of pull and step out so the stack is off the pins at the start.",
 "Machine":"Adjust the seat so the working joint lines up with the machine's pivot.",
 "Smith Machine":"Set the safeties first and place your feet so the bar path stays over the working joint.",
 "Bodyweight":"Own the full range with bodyweight before adding load.",
 "Leg Press":"Feet flat on the platform; lower until just before the lower back lifts off the pad.",
 "Hack Squat":"Shoulders and back tight to the pads; let the knees travel forward.",
 "Pendulum":"Back flat on the pad, sit deep and drive through the mid-foot.",
 "Lat Pulldown":"Lock the knees under the pad so the torso stays still.",
 "Seated Cable Row":"Sit tall with a slight knee bend; don't rock the torso to move weight.",
 "Preacher":"Armpits tight to the top of the pad; don't let the elbows lift.",
 "Pec Deck":"Set the handles so they start just behind the chest line.",
 "Band":"Anchor the band securely and keep tension through the whole rep.",
 "EZ Bar":"Use the angled grip to keep the wrists comfortable.",
 "Plate":"Grip the plate firmly at the edges and keep the wrists neutral.",
 "T-Bar":"Chest on the pad if available; pull with the elbows, not the hands.",
 "Trap Bar":"Stand in the center of the bar and push the floor away.",
 "Belt Squat":"Belt sits low on the hips; torso stays upright.",
 "V-Squat":"Back flat on the pad; move through the machine's fixed path.",
 "Medicine Ball":"Hold the ball close to the chest and rotate under control.",
 "Kettlebell":"Hold the bell close to the body to keep it stable.",
}
MODS = [
 (r"\bpause\b","Hold a dead 2-second pause at the hardest point. No bounce."),
 (r"\btempo\b","Lower for 3–4 seconds on every rep."),
 (r"\b(pin|box|block|rack)\b","Start each rep from a dead stop at the set height."),
 (r"deficit","Stand on a 1–3 inch platform to lengthen the range."),
 (r"unilateral|single","Train one side at a time; start with your weaker side and match the reps."),
 (r"pulse","Work short pulses in the hardest part of the range."),
 (r"top partials","Stay in the top half of the range for constant tension."),
 (r"elbows tucked","Keep the elbows about 30–45° from the torso."),
 (r"elbows flared","Let the elbows travel out toward 75–90° from the torso."),
 (r"\bincline\b","Set the bench at 30–45°."),
 (r"\bdecline\b","Use a slight decline with the head lower than the hips."),
 (r"squeeze","Press the weights together hard for the whole rep."),
 (r"b-stance","The front leg does the work; the back foot is a kickstand on the toes."),
 (r"\bweighted\b","Add load with a belt or vest once you clear the top of the rep range."),
 (r"assisted","Use the least assistance that still lets you hit the target reps."),
 (r"low bar","Bar sits on the rear delts; expect a bit more hip hinge."),
 (r"high bar","Bar sits on the traps; stay upright and let the knees travel."),
 (r"front squat|goblet|zercher","Weight in front keeps the torso upright and the quads loaded."),
 (r"lunge|bulgarian|split squat|step back","Take a long enough stride that the front shin stays close to vertical."),
 (r"sumo|cossack","Wide stance, toes out, knees track the toes."),
 (r"hip thrust|kickback","Ribs down and squeeze the glutes at lockout; don't arch the lower back."),
 (r"sissy","Knees travel far forward while the hips stay extended. Hold support for balance."),
 (r"skullcrusher|overhead","Let the elbows bend fully to stretch the long head of the triceps."),
 (r"carry","Walk tall with short steps; don't let the weight pull you sideways."),
 (r"plank","Hold position with a hard brace and steady breathing."),
 (r"hanging|leg raise","Curl the pelvis up; avoid swinging."),
 (r"drag curl","Drag the bar up the torso with the elbows moving back."),
 (r"waiter","Cup the top of one dumbbell with both hands and keep it level."),
 (r"chest supported","Chest on the pad removes momentum."),
]
MUSCLE_ADD = [
 (r"lunge|bulgarian|split squat|step back",["Glutes","Quads"],"Lunge"),
 (r"hip thrust|kickback",["Glutes"],"Hip Extension"),
 (r"glute bias",["Glutes"],None),
 (r"carry",["Core (stability)","Traps"],"Carry"),
 (r"plank|copenhagen|crunch hold",["Core (stability)"],"Isometric"),
 (r"leg raise",["Abs","Hip Flexors"],"Flexion"),
 (r"twist|rotation|rainbow|open book",["Obliques"],"Rotation"),
 (r"dumbbell pullover",["Lats","Chest"],None),
 (r"upright row",["Lateral Delt","Traps"],"Pull (Vertical)"),
 (r"pull-up|chin-up",["Lats","Biceps"],"Pull (Vertical)"),
]
def equip(n):
    l=n.lower()
    for k,v in EQ:
        if k in l: return v
    return "Bodyweight"
lib={}
def make(name, meta, group=None, isGroup=False):
    pri,sec,region,movement,fiber,cue,note = meta
    pri=list(pri); sec=list(sec); l=name.lower()
    if not isGroup:
        for pat,add,mv in MUSCLE_ADD:
            if re.search(pat,l):
                for a in reversed(add):
                    if a in pri: pri.remove(a)
                    pri.insert(0,a)
                if mv: movement=mv
    e = "Any" if isGroup else equip(name)
    cues=[cue]
    if not isGroup:
        if e in SETUP: cues.insert(0,SETUP[e])
        for pat,txt in MODS:
            if re.search(pat,l) and txt not in cues: cues.append(txt)
    muscles=[]
    for m in pri+sec:
        if m not in muscles: muscles.append(m)
    sid=slug(name)
    lib[sid]={"id":sid,"name":name,"muscles":muscles,"primary":pri,"secondary":[m for m in sec if m not in pri],
      "fiber":fiber,"equipment":[],"gear":e,"region":region,"movement":movement,
      "pattern":"pull" if movement.startswith("Pull") or movement=="Flexion" else "push",
      "level":2,"cue":" ".join(cues),"note":note,"group":group,"isGroup":isGroup}
    return sid
for g,vs in G.items():
    if g.startswith('_'): continue
    if g=="Other":
        for v in vs: make(v, OTHER[v])
        continue
    ids=[make(v, M[g], group=g) for v in vs]
    gid=make(g, M[g], group=g, isGroup=True)
    lib[gid]["versions"]=[i for i in ids if i!=gid]
json.dump(list(lib.values()),open('data/programs/movement_library.json','w'),ensure_ascii=False)
import collections
print(len(lib),"entries;",sum(1 for x in lib.values() if x["isGroup"]),"groups")
print(collections.Counter(x["gear"] for x in lib.values()).most_common())
print(lib[slug("Barbell Pause Squat")]["cue"])
