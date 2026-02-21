# Holy Flow Windows EXE Release Notes Template

## Title
Holy Flow Windows EXE v{{version}}

## Summary
- Release date: {{yyyy-mm-dd}}
- Target: Windows portable single executable
- File: `HolyFlow.exe`

## Downloads
- `HolyFlow.exe`
- `README-EXE.txt`
- `HolyFlow-Windows-EXE.zip`

## Integrity
- SHA256 (`HolyFlow.exe`): `{{sha256_here}}`
- SHA256 (`HolyFlow-Windows-EXE.zip`): `{{sha256_here}}`

## What's New
- {{feature_or_fix_1}}
- {{feature_or_fix_2}}
- {{feature_or_fix_3}}

## User Notes
- Double-click `HolyFlow.exe` to run.
- Browser opens automatically.
- Keep the Holy Flow window open while using the app.
- If port `4173` is occupied, the app automatically selects another localhost port.

## Compatibility
- Windows 10/11
- No separate Python/Node installation required

## Backup & Data
- Data is saved locally in the browser storage on the same device.
- Use backup export regularly (`JSON` or protected `.hfbak`) before PC migration.

## Known Issues
- {{known_issue_or_none}}

## Upgrade Guide
1. Close any running Holy Flow instance.
2. Replace old executable with the new `HolyFlow.exe`.
3. Run the new executable.

## Rollback
- If needed, run previous stable `HolyFlow.exe` build.
- Restore data from a backup file if state migration is required.
