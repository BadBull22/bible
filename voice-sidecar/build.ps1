# Builds the read-aloud voice into src-tauri\resources\voice\ (gitignored, ~260 MB):
#   voice-sidecar\          the server (PyInstaller one-FOLDER build: starts in ~1.5 s,
#                           where a one-file exe unpacks itself on every launch, ~60 s)
#   kokoro-v1.0.fp16.onnx   Kokoro 82M, fp16 (same speed as fp32 at half the size;
#                           int8 is smaller but 4-5x slower on CPU)
#   voices-en.bin           the 28 English voices from voices-v1.0.bin
# Everything is built on local disk (not the network share) and copied in at the end.
# Needs Python 3.12 (`py -3.12`). Run from anywhere:  powershell -File voice-sidecar\build.ps1
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$work = Join-Path $env:LOCALAPPDATA "bible-concordance-build"
$venv = Join-Path $work "voice-venv"
$models = Join-Path $work "kokoro"
$dest = Join-Path $here "..\src-tauri\resources\voice"
$release = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

New-Item -ItemType Directory -Force $models | Out-Null
if (-not (Test-Path "$venv\Scripts\python.exe")) { py -3.12 -m venv $venv }
$py = "$venv\Scripts\python.exe"
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r "$here\requirements.txt"

foreach ($f in "kokoro-v1.0.fp16.onnx", "voices-v1.0.bin") {
    if (-not (Test-Path "$models\$f")) {
        Write-Host "Downloading $f..."
        Invoke-WebRequest "$release/$f" -OutFile "$models\$f.part" -UseBasicParsing
        Move-Item "$models\$f.part" "$models\$f" -Force
    }
}
& $py "$here\make_voices.py" "$models\voices-v1.0.bin" "$models\voices-en.bin"

Write-Host "Running PyInstaller..."
Push-Location $work
try {
    & $py -m PyInstaller --noconfirm --clean --onedir --console --name voice-sidecar `
        --distpath "$work\voice-dist" --workpath "$work\voice-build" --specpath "$work\voice-build" `
        --collect-all kokoro_onnx --collect-all onnxruntime --collect-all espeakng_loader `
        --collect-all phonemizer --collect-all segments --collect-all csvw --collect-all language_tags `
        --exclude-module tkinter --exclude-module matplotlib `
        "$here\server.py"
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
} finally { Pop-Location }

Write-Host "Copying into $dest..."
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Recurse "$work\voice-dist\voice-sidecar" "$dest\voice-sidecar"
Copy-Item "$models\kokoro-v1.0.fp16.onnx", "$models\voices-en.bin" $dest
# espeak-ng only needs its English pronunciation dictionary here; the other ~100 languages'
# dictionaries are ~16 MB we'd otherwise ship for nothing.
Get-ChildItem "$dest\voice-sidecar\_internal\espeakng_loader\espeak-ng-data" -Filter "*_dict" |
    Where-Object { $_.Name -ne "en_dict" } | Remove-Item -Force
$size = (Get-ChildItem -Recurse $dest | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Done: {0:N0} MB in {1}" -f $size, (Resolve-Path $dest))
