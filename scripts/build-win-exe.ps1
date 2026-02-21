param(
  [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distDir = Join-Path $root "dist"
$workDir = Join-Path $root "build\pyinstaller"
$specDir = Join-Path $root "build\spec"
$outputDir = Join-Path $distDir "HolyFlow-Windows-EXE"
$zipFile = Join-Path $distDir "HolyFlow-Windows-EXE.zip"
$entryScript = Join-Path $root "portable\windows\HolyFlowPortable.py"

if (!(Test-Path $entryScript -PathType Leaf)) {
  throw "Entry script not found: $entryScript"
}

if (Test-Path $outputDir) {
  Remove-Item -Path $outputDir -Recurse -Force
}

New-Item -Path $outputDir -ItemType Directory -Force | Out-Null
New-Item -Path $workDir -ItemType Directory -Force | Out-Null
New-Item -Path $specDir -ItemType Directory -Force | Out-Null

& $PythonExe -m pip install --upgrade pip pyinstaller

$pyinstallerArgs = @(
  "--noconfirm",
  "--clean",
  "--onefile",
  "--windowed",
  "--name", "HolyFlow",
  "--distpath", $outputDir,
  "--workpath", $workDir,
  "--specpath", $specDir,
  "--add-data", "$root\index.html;.",
  "--add-data", "$root\styles.css;.",
  "--add-data", "$root\app.js;.",
  "--add-data", "$root\sw.js;.",
  "--add-data", "$root\manifest.webmanifest;.",
  "--add-data", "$root\assets\icon.svg;assets",
  $entryScript
)

& $PythonExe -m PyInstaller @pyinstallerArgs

$readmeContent = @"
Holy Flow - Single EXE
======================

1) Double-click HolyFlow.exe
2) Browser opens automatically.
3) Use the app in your browser.

Tips
- If port 4173 is busy, the app automatically uses another free localhost port.
- To stop the app, click the "앱 종료" button in the top bar.
"@

Set-Content -Path (Join-Path $outputDir "README-EXE.txt") -Value $readmeContent -Encoding UTF8

if (Test-Path $zipFile) {
  Remove-Item -Path $zipFile -Force
}
Compress-Archive -Path $outputDir -DestinationPath $zipFile -CompressionLevel Optimal

Write-Host "Built EXE folder: $outputDir"
Write-Host "Built EXE zip: $zipFile"
