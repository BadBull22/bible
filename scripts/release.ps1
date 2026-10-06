# Builds a signed release into installer\ and prepares everything for GitHub Releases --
# but never publishes: it ends by printing the `gh release create` command to run once
# you've tested the installer.
#
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Notes "What changed"
#
# Needs the updater signing key outside the repository (made once with
# `npx tauri signer generate --ci -w $HOME\.tauri\bible-concordance-updater.key`; back it
# up -- without it, installed copies can't be updated any more). The public half is in
# src-tauri\tauri.conf.json (plugins.updater.pubkey). NEVER commit the private key.
#
# The natural voice is not in the installer: scripts\package_voice.py packs it once into
# installer\voice-<platform>-v<n>.zip and records its URL + SHA-256 in
# src-tauri\resources\voice.json; that zip is uploaded with the release its URL names.

param(
    [string]$Notes = "",
    [string]$Key = "$HOME\.tauri\bible-concordance-updater.key"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# --- one version everywhere
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$conf = Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json
$cargo = (Select-String -Path src-tauri\Cargo.toml -Pattern '^version = "(.+)"').Matches[0].Groups[1].Value
if ($conf.version -ne $version -or $cargo -ne $version) {
    throw "Version mismatch: package.json $version, tauri.conf.json $($conf.version), Cargo.toml $cargo"
}
$tag = "v$version"
Write-Host "Building Bible Concordance $version" -ForegroundColor Cyan

# --- sign the updater artifacts with the private key (kept outside the repo)
if (-not (Test-Path $Key)) { throw "Signing key not found at $Key" }
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $Key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
try {
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }
} finally {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

# --- collect the bundles (the cargo target dir is on local disk, see src-tauri\.cargo)
Push-Location src-tauri
$target = (cargo metadata --format-version 1 --no-deps | ConvertFrom-Json).target_directory
Pop-Location
$bundle = Join-Path $target "release\bundle"
$out = Join-Path $root "installer"
New-Item -ItemType Directory -Force $out | Out-Null

# GitHub turns spaces in asset names into dots, so the published names have none
$assets = @{}
foreach ($kind in @(@{ dir = "nsis"; ext = "exe"; suffix = "x64-setup.exe" }, @{ dir = "msi"; ext = "msi"; suffix = "x64_en-US.msi" })) {
    $file = Get-ChildItem (Join-Path $bundle $kind.dir) -Filter "*_${version}_*.$($kind.ext)" | Select-Object -First 1
    if (-not $file) { throw "No $($kind.dir) bundle for $version in $bundle" }
    $name = "BibleConcordance_${version}_$($kind.suffix)"
    Copy-Item $file.FullName (Join-Path $out $name) -Force
    Copy-Item "$($file.FullName).sig" (Join-Path $out "$name.sig") -Force
    $assets[$kind.dir] = $name
}

# --- latest.json, which installed copies read to find this version
$base = "https://github.com/BadBull22/bible/releases/download/$tag"
$sig = { param($n) (Get-Content (Join-Path $out "$n.sig") -Raw).Trim() }
$nsis = @{ signature = (& $sig $assets.nsis); url = "$base/$($assets.nsis)" }
$msi = @{ signature = (& $sig $assets.msi); url = "$base/$($assets.msi)" }
$latest = [ordered]@{
    version   = $version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        # each copy updates with the same kind of installer it was installed with
        "windows-x86_64-nsis" = $nsis
        "windows-x86_64-msi"  = $msi
        "windows-x86_64"      = $nsis
    }
}
$latestPath = Join-Path $out "latest.json"
[IO.File]::WriteAllText($latestPath, ($latest | ConvertTo-Json -Depth 5))  # UTF-8, no BOM

# --- the voice archive, if this release is the one voice.json points at
$upload = @($assets.nsis, "$($assets.nsis).sig", $assets.msi, "$($assets.msi).sig", "latest.json")
$voice = Get-Content src-tauri\resources\voice.json -Raw | ConvertFrom-Json
foreach ($p in $voice.platforms.PSObject.Properties) {
    if ($p.Value.url -like "$base/*") {
        $zip = Split-Path $p.Value.url -Leaf
        if (-not (Test-Path (Join-Path $out $zip))) { throw "voice.json names $zip for this release but installer\$zip is missing (run scripts\package_voice.py)" }
        $upload += $zip
    }
}

Write-Host "`nRelease files in installer\:" -ForegroundColor Cyan
foreach ($f in $upload) {
    $path = Join-Path $out $f
    "{0,-48} {1,8:N0} MB  {2}" -f $f, ((Get-Item $path).Length / 1MB), (Get-FileHash $path -Algorithm SHA256).Hash
}
Write-Host "`nTest the installer first. To publish (makes it public, and every installed copy will offer it):" -ForegroundColor Yellow
$files = ($upload | ForEach-Object { "`"installer\$_`"" }) -join " "
Write-Host "  gh release create $tag $files --title `"Bible Concordance $version`" --notes-file <notes.md>"
