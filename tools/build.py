import re, sys

CLOUD = "--local" not in sys.argv
FIREBASE_SDK = """
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js"></script>
""" if CLOUD else ""
FIREBASE = """
// Firebase — accounts + cloud save. Web config values are public by design.
firebase.initializeApp({
  apiKey: "AIzaSyCGOk2uuIixyfxQFsEsFLEuuG4n2zVkofA",
  authDomain: "super-human-e6074.web.app",
  projectId: "super-human-e6074",
  storageBucket: "super-human-e6074.firebasestorage.app",
  messagingSenderId: "258918214306",
  appId: "1:258918214306:web:00bbe79bd06ffe9f9445fb"
});
window._fbAuth = firebase.auth();
window._fbDb   = firebase.firestore();
""" if CLOUD else """
// Local mode — no accounts; data stays in this browser
window._fbAuth = null;
window._fbDb   = null;
"""

JS_PATH  = "build/app.js"
OUT_PATH = "public_deploy/index.html"

with open(JS_PATH, "r", encoding="utf-8") as f:
    js = f.read()

# The transpiled output uses "use strict" and may reference React as a global
# Babel preset-env with modules:false leaves import/export — strip any remaining
js = re.sub(r'"use strict";\s*', '', js)
js = re.sub(r'^import\s+.*?;\s*$', '', js, flags=re.MULTILINE)
js = re.sub(r'export\s+\{[^}]*\};\s*', '', js)
js = re.sub(r'export\s+default\s+', '', js)

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Superhuman Physique</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Shippori+Mincho+B1:wght@700;800&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>""" + FIREBASE_SDK + """
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0E0D0C; color: #E6DFD2; font-family: 'Barlow', sans-serif; }
  #root { height: 100%; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #151311; }
  ::-webkit-scrollbar-thumb { background: #3A342C; border-radius: 2px; }
  input, textarea, select { font-family: inherit; }
</style>
</head>
<body>
<div id="root"></div>
<script>
// Expose React hooks as globals (Babel transpiles them as React.useState etc)
const { useState, useEffect, useRef, useCallback, useMemo, useContext,
        createContext, Fragment, forwardRef, memo } = React;

""" + FIREBASE + """
</script>
<script>
""" + js + """

// Mount
const _root = ReactDOM.createRoot(document.getElementById('root'));
_root.render(React.createElement(App));
</script>
</body>
</html>"""

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write(html)

size = len(html)
print(f"Built: {OUT_PATH}")
print(f"Size: {size:,} chars ({size/1024/1024:.1f} MB)")
