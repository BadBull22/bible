# Builds the Microsoft Store version of the Windows app as an MSIX package, into installer\.
#
#   powershell -ExecutionPolicy Bypass -File scripts\msix.ps1 -IdentityName "<from Partner Center>" -Publisher "CN=<from Partner Center>" -PublisherDisplayName "<your name>"
#
# The Store version is built with `--features store` (src-tauri): no optional extras that are
# downloaded and run, no program downloads and no in-app updater, because the Store updates it. The natural voice
# (src-tauri\resources\voice, about 280 MB) is packed INSIDE the package instead of being
# downloaded and run later, which the Store's rules do not allow. Nothing here is published.
#
# The package is NOT signed: Microsoft signs it when it is submitted in Partner Center. The
# three identity values must be copied from Partner Center (Product management > Product
# identity) once the app name is reserved; until then the placeholders below make a package
# that can be checked but not submitted. NEVER put a real certificate or key in the repository.
#
# -SkipBuild packs a build that already ran (target\release\bible-concordance.exe).

param(
    [string]$IdentityName = "BibleConcordance.PLACEHOLDER",
    [string]$Publisher = "CN=PLACEHOLDER",
    [string]$PublisherDisplayName = "GhostClaw",
    [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# --- one version everywhere (the Store wants four numbers, the last one 0)
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$conf = Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json
$cargo = (Select-String -Path src-tauri\Cargo.toml -Pattern '^version = "(.+)"').Matches[0].Groups[1].Value
if ($conf.version -ne $version -or $cargo -ne $version) {
    throw "Version mismatch: package.json $version, tauri.conf.json $($conf.version), Cargo.toml $cargo"
}
$msixVersion = "$version.0"
Write-Host "Building the Microsoft Store version of Bible Concordance $msixVersion" -ForegroundColor Cyan

# --- the program, built without the program downloads and the updater
if (-not $SkipBuild) {
    npm run tauri build -- --no-bundle --features store
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
}
Push-Location src-tauri
$target = (cargo metadata --format-version 1 --no-deps | ConvertFrom-Json).target_directory
Pop-Location
$exe = Join-Path $target "release\bible-concordance.exe"
if (-not (Test-Path $exe)) { throw "Not built: $exe" }

# --- the package folder: the program, the files listed in tauri.conf.json (bundle.resources), the logos
$stage = Join-Path $root "installer\msix"
$layout = Join-Path $stage "layout"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $layout, "$layout\Assets" | Out-Null
Copy-Item $exe $layout
foreach ($pattern in $conf.bundle.resources) {
    $src = Join-Path "src-tauri" $pattern
    $dest = Join-Path $layout (Split-Path $pattern -Parent)
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $items = Get-ChildItem -Path $src -File
    if (-not $items) { throw "Resource not found: $pattern" }
    Copy-Item $items.FullName $dest
}

# the natural read-aloud voice travels inside the package (voice.rs finds it there as "bundled")
$voice = "src-tauri\resources\voice"
foreach ($f in "kokoro-v1.0.fp16.onnx", "voices-en.bin", "voice-sidecar\voice-sidecar.exe") {
    if (-not (Test-Path (Join-Path $voice $f))) { throw "The natural voice is missing: $voice\$f" }
}
Copy-Item $voice (Join-Path $layout "resources\voice") -Recurse

Add-Type -AssemblyName System.Drawing
function Save-Logo([string]$name, [int]$w, [int]$h) {
    $src = [System.Drawing.Image]::FromFile((Join-Path $root "src-tauri\app-icon.png"))
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::FromArgb(28, 36, 64))   # the site's navy, for the wide tile's sides
    $side = [Math]::Min($w, $h)
    $g.DrawImage($src, [int](($w - $side) / 2), [int](($h - $side) / 2), $side, $side)
    $g.Dispose(); $src.Dispose()
    $bmp.Save((Join-Path $layout "Assets\$name"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Save-Logo "StoreLogo.png" 50 50
Save-Logo "Square44x44Logo.png" 44 44
Save-Logo "Square150x150Logo.png" 150 150
Save-Logo "Wide310x150Logo.png" 310 150

@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="$IdentityName" Publisher="$Publisher" Version="$msixVersion" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Bible Concordance</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="BibleConcordance" Executable="bible-concordance.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="Bible Concordance"
                          Description="A free, offline Bible study app: concordance, Hebrew and Greek, commentaries, sermon builder."
                          BackgroundColor="#1c2440"
                          Square150x150Logo="Assets\Square150x150Logo.png"
                          Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@ | Set-Content -Encoding UTF8 (Join-Path $layout "AppxManifest.xml")

# --- pack it
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName | Select-Object -Last 1
if (-not $makeappx) { throw "makeappx.exe not found (install the Windows 10/11 SDK)" }
$out = Join-Path $root "installer\BibleConcordance_Windows_$version.msix"
if (Test-Path $out) { Remove-Item $out }
& $makeappx.FullName pack /d $layout /p $out /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed" }
Write-Host "Made $out ($([math]::Round((Get-Item $out).Length / 1MB)) MB). Unsigned: Microsoft signs it in the Store." -ForegroundColor Green
if ($IdentityName -like "*PLACEHOLDER*") {
    Write-Host "It carries placeholder identity values: re-run with the ones from Partner Center before submitting." -ForegroundColor Yellow
}
