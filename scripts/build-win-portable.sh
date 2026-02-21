#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
PACKAGE_DIR="${DIST_DIR}/HolyFlow-Windows-Portable"
ZIP_FILE="${DIST_DIR}/HolyFlow-Windows-Portable.zip"

rm -rf "${PACKAGE_DIR}"
mkdir -p "${PACKAGE_DIR}/assets"

cp "${ROOT_DIR}/index.html" "${PACKAGE_DIR}/"
cp "${ROOT_DIR}/styles.css" "${PACKAGE_DIR}/"
cp "${ROOT_DIR}/app.js" "${PACKAGE_DIR}/"
cp "${ROOT_DIR}/sw.js" "${PACKAGE_DIR}/"
cp "${ROOT_DIR}/manifest.webmanifest" "${PACKAGE_DIR}/"
cp "${ROOT_DIR}/assets/icon.svg" "${PACKAGE_DIR}/assets/"
cp "${ROOT_DIR}/portable/windows/start-holy-flow.bat" "${PACKAGE_DIR}/"
cp "${ROOT_DIR}/portable/windows/Start-HolyFlow.ps1" "${PACKAGE_DIR}/"

cat > "${PACKAGE_DIR}/README-WINDOWS.txt" <<'EOF'
Holy Flow - Windows Portable
============================

1) Unzip this folder anywhere.
2) Double-click start-holy-flow.bat
3) The browser opens at http://localhost:4173

Tips
- To use another port: start-holy-flow.bat 8080
- Keep the PowerShell window open while using the app.
EOF

if command -v zip >/dev/null 2>&1; then
  rm -f "${ZIP_FILE}"
  (
    cd "${DIST_DIR}"
    zip -rq "$(basename "${ZIP_FILE}")" "$(basename "${PACKAGE_DIR}")"
  )
  echo "Created zip: ${ZIP_FILE}"
fi

echo "Portable package ready: ${PACKAGE_DIR}"
