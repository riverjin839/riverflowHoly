#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
WORK_DIR="${ROOT_DIR}/build/pyinstaller-macos"
SPEC_DIR="${ROOT_DIR}/build/spec-macos"
APP_NAME="${APP_NAME:-HolyFlow}"
TARGET_ARCH="${TARGET_ARCH:-}"
OUTPUT_DIR="${DIST_DIR}/${APP_NAME}-macOS-App"
ZIP_FILE="${DIST_DIR}/${APP_NAME}-macOS-App.zip"
ENTRY_SCRIPT="${ROOT_DIR}/portable/macos/HolyFlowPortable.py"

if [[ ! -f "${ENTRY_SCRIPT}" ]]; then
  echo "Entry script not found: ${ENTRY_SCRIPT}" >&2
  exit 1
fi

rm -rf "${OUTPUT_DIR}" "${WORK_DIR}" "${SPEC_DIR}"
mkdir -p "${OUTPUT_DIR}" "${WORK_DIR}" "${SPEC_DIR}"

python3 -m pip install --upgrade pip pyinstaller

PYINSTALLER_ARGS=(
  --noconfirm
  --clean
  --windowed
  --name "${APP_NAME}"
  --distpath "${OUTPUT_DIR}"
  --workpath "${WORK_DIR}"
  --specpath "${SPEC_DIR}"
  --add-data "${ROOT_DIR}/index.html:."
  --add-data "${ROOT_DIR}/styles.css:."
  --add-data "${ROOT_DIR}/app.js:."
  --add-data "${ROOT_DIR}/sw.js:."
  --add-data "${ROOT_DIR}/manifest.webmanifest:."
  --add-data "${ROOT_DIR}/assets/icon.svg:assets"
)

if [[ -n "${TARGET_ARCH}" ]]; then
  PYINSTALLER_ARGS+=(--target-architecture "${TARGET_ARCH}")
fi

python3 -m PyInstaller \
  "${PYINSTALLER_ARGS[@]}" \
  "${ENTRY_SCRIPT}"

cat > "${OUTPUT_DIR}/README-MACOS.txt" <<EOF
Holy Flow - macOS App (${APP_NAME})
====================================

1) Open ${APP_NAME}.app
2) Browser opens automatically
3) Keep Holy Flow window open while using the app

Tips
- If macOS blocks the app, right-click ${APP_NAME}.app and choose Open.
- If port 4173 is busy, the app chooses another free localhost port.
- To stop the app, click the "앱 종료" button in the top bar.
EOF

rm -f "${ZIP_FILE}"
if command -v ditto >/dev/null 2>&1; then
  ditto -c -k --sequesterRsrc --keepParent "${OUTPUT_DIR}" "${ZIP_FILE}"
else
  (cd "${DIST_DIR}" && zip -rq "$(basename "${ZIP_FILE}")" "$(basename "${OUTPUT_DIR}")")
fi

echo "Built app folder: ${OUTPUT_DIR}"
echo "Built zip: ${ZIP_FILE}"
