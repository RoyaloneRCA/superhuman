#!/usr/bin/env bash
# One-command deploy from your Mac. Logs in as YOU (project owner),
# so it does not depend on the GitHub Actions service account.
set -e
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Install Node.js first: https://nodejs.org (LTS)"; exit 1; }

echo "1/4  Getting latest code from GitHub..."
git pull --ff-only origin main

echo "2/4  Checking Firebase CLI..."
command -v firebase >/dev/null || npm install -g firebase-tools

echo "3/4  Signing in to Firebase (browser opens the first time)..."
firebase login

echo "4/4  Deploying to super-human-e6074..."
firebase deploy --only hosting --project super-human-e6074

echo "Done. Live at https://super-human-e6074.web.app"
