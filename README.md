# Superhuman Physique

Periodized strength and physique training app (Solutus Nexus). Single-page React 18 app, served as one self-contained HTML file on Firebase Hosting.

**Live:** Firebase project `super-human-e6074`. Every push to `main` deploys automatically (`.github/workflows/deploy.yml`).

## What's in it
- **12 programs** (First Gate, The Forge, Gauntlet, Split, Triad, Rotation, Power I/II, Upper Hand, Balance, Total, Ember) with schedule options, low-volume variants and set-by-set rep targets
- **Phases** (Recomp / Lean Bulk / Cut / Peak): change calories and macros, never training
- **Movement library**: 539 movements; general movements (e.g. "Squat") let the user pick a version, tracked separately
- Calendar that follows each program's real cycle, rest days included
- Progress tracking, Muscle Science dashboard, Learn tab

## Repo layout
| Path | Purpose |
|---|---|
| `src/superhuman_v3.jsx` | App source (single file) |
| `data/programs/*.json` | Program data and movement library |
| `tools/` | Generators and build scripts |
| `public_deploy/index.html` | Built app, the only file Firebase serves |

## Build
```bash
npm install
npm run build        # src/superhuman_v3.jsx -> public_deploy/index.html
```
Program and library data are embedded in the source. To regenerate after editing `data/programs/`:
```bash
python3 tools/gen_library.py     # movement_groups.json -> movement_library.json
python3 tools/gen_programs.py    # programs + library -> build/programs_block.js
```
then replace the `const GENERIC_LIBRARY` and `const PROGRAMS_V2` lines in the source with the ones from `build/programs_block.js`.

## Notes
- Data is stored in the browser (localStorage). Firebase Auth/Firestore sync is coded but not enabled (`window._fbAuth` is null in the build).
- Program content came from a third-party app; keep this repository **private**.
