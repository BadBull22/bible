# Builds (or runs) the Android app.
#
#   pwsh -File mobile\scripts\android.ps1                 # a debug APK to try on a phone
#   pwsh -File mobile\scripts\android.ps1 -Release        # the signed APK to hand out
#   pwsh -File mobile\scripts\android.ps1 -Install        # build, then install on the phone plugged in
#
# The project lives on a network share, where the Android tools cannot work (Tauri's
# Android setup refuses the share's path, and Gradle does thousands of small writes), so the
# source is mirrored to local disk and built there. The mirror keeps the same layout
# (mobile\ beside src-tauri\src\sermon.rs), because the phone app uses the desktop app's
# search from its source. Only the finished APK is copied back, into installer\.
#
# Needs: Android Studio (its SDK and bundled Java), the NDK in <sdk>\ndk, and the Rust
# Android targets (rustup target add aarch64-linux-android armv7-linux-androideabi).

param(
    [switch]$Release,
    [switch]$Install,
    # phones are 64-bit ARM (32-bit ARM is included for older ones); the emulator on a PC is x86_64
    [string[]]$Targets = @("aarch64", "armv7"),
    [string]$Mirror = "$env:LOCALAPPDATA\bible-concordance-build\mobile-mirror",
    # the signing key of the released app -- outside the repository, never committed
    [string]$Keystore = "$HOME\.tauri\bible-concordance-android.jks"
)
$ErrorActionPreference = "Stop"
$mobile = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $mobile

$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$ndk = Get-ChildItem "$env:ANDROID_HOME\ndk" -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
if (-not $ndk) { throw "No Android NDK found under $env:ANDROID_HOME\ndk" }
$env:NDK_HOME = $ndk.FullName
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
if (-not (Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "Android Studio's Java not found at $env:JAVA_HOME" }
# Gradle downloads itself and its libraries with Java, which has its own list of trusted
# certificates. Where an antivirus scans HTTPS (Avast does, re-signing every site with its own
# certificate, which it adds to Windows' list only), Java refuses every download. So Java is
# given a list of its own made of its usual certificates plus the ones Windows trusts --
# certificates are still checked, against what this computer already trusts.
$trust = "$env:LOCALAPPDATA\bible-concordance-build\java-trust.jks"
if (-not (Test-Path $trust)) {
    Copy-Item "$env:JAVA_HOME\lib\security\cacerts" $trust
    $n = 0
    foreach ($cert in @(Get-ChildItem Cert:\LocalMachine\Root) + @(Get-ChildItem Cert:\CurrentUser\Root)) {
        $file = Join-Path $env:TEMP "win-root-$($cert.Thumbprint).cer"
        [IO.File]::WriteAllBytes($file, $cert.RawData)
        & "$env:JAVA_HOME\bin\keytool.exe" -importcert -noprompt -trustcacerts -keystore $trust -storepass changeit -alias "win-$($cert.Thumbprint)" -file $file 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $n++ }
        Remove-Item $file -Force
    }
    Write-Host "Java trust list made with $n certificates from Windows: $trust"
}
$env:JAVA_TOOL_OPTIONS = "-Djavax.net.ssl.trustStore=`"$trust`" -Djavax.net.ssl.trustStorePassword=changeit"
if (-not (Test-Path "$mobile\src-tauri\resources\phone.db.gz")) { throw "Build the database first: python mobile\data\build_phone_db.py" }

# --- mirror the source (robocopy: 0-7 are all success)
function Mirror-Dir($from, $to, $excludeDirs) {
    robocopy $from $to /MIR /NFL /NDL /NJH /NJS /NP /XD @excludeDirs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $from failed (robocopy $LASTEXITCODE)" }
}
New-Item -ItemType Directory -Force "$Mirror\src-tauri\src" | Out-Null
# node_modules, the generated Android project and build output belong to the mirror
Mirror-Dir $mobile "$Mirror\mobile" @("node_modules", "dist", "gen", "target", ".cargo", ".tauri", "build")
Copy-Item "$root\src-tauri\src\sermon.rs" "$Mirror\src-tauri\src\sermon.rs" -Force
# what the desktop and the phone app share (module readers, references, keeping in step)
Mirror-Dir "$root\crates" "$Mirror\crates" @("target", ".cargo")

Set-Location "$Mirror\mobile"
# the mirror has its own node_modules: install when there is none, or when the packages asked for have changed
$lock = (Get-FileHash package-lock.json).Hash
if (-not (Test-Path node_modules) -or -not (Test-Path node_modules\.installed-for) -or (Get-Content node_modules\.installed-for -Raw).Trim() -ne $lock) {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Set-Content -Path node_modules\.installed-for -Value $lock -Encoding ascii
}
if (-not (Test-Path "src-tauri\gen\android")) {
    npx tauri android init --ci
    if ($LASTEXITCODE -ne 0) { throw "tauri android init failed" }
}

# --- build
if ($Release) {
    # --- the signing key: made once, kept outside the repository with its password beside it.
    # Android only installs an update over an app signed with the same key, so BACK BOTH FILES UP.
    $secret = [IO.Path]::ChangeExtension($Keystore, ".properties")
    if (-not (Test-Path $Keystore)) {
        $bytes = [byte[]]::new(24)
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $password = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', 'x'
        New-Item -ItemType Directory -Force (Split-Path -Parent $Keystore) | Out-Null
        & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $Keystore -storetype PKCS12 -storepass $password -alias bible `
            -keyalg RSA -keysize 4096 -validity 20000 -dname "CN=Bible Concordance" 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Keystore)) { throw "The signing key could not be made" }
        Set-Content -Path $secret -Value "password=$password`nkeyAlias=bible" -Encoding ascii
        Write-Host "New signing key: $Keystore (password in $secret). Back both up." -ForegroundColor Yellow
    }
    if (-not (Test-Path $secret)) { throw "The signing key's password file is missing: $secret" }
    # where Gradle looks for it (in the mirror only), and the signing set-up in the generated project
    $store = $Keystore -replace '\\', '/'
    Set-Content -Path "src-tauri\gen\android\keystore.properties" -Value ((Get-Content $secret -Raw).Trim() + "`nstoreFile=$store") -Encoding ascii
    $gradle = "src-tauri\gen\android\app\build.gradle.kts"
    $text = Get-Content $gradle -Raw
    if ($text -notmatch 'signingConfigs') {
        $signing = @'
    signingConfigs {
        create("release") {
            val keystoreProperties = Properties().apply {
                rootProject.file("keystore.properties").inputStream().use { load(it) }
            }
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["password"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["password"] as String
        }
    }
    buildTypes {
'@
        $text = $text.Replace("    buildTypes {", $signing.TrimEnd("`r", "`n"))
        $text = $text.Replace('        getByName("release") {', "        getByName(`"release`") {`n            signingConfig = signingConfigs.getByName(`"release`")")
        if ($text -notmatch 'signingConfig = signingConfigs') { throw "Could not add signing to $gradle" }
        Set-Content -Path $gradle -Value $text -NoNewline
    }
    # the release build shrinks the Java code (R8), which renamed the notification plugin's fields
    # that its schedules are read into: the daily reminder's hour and minute were lost and the
    # alarm never set (a one-off test worked). The plugins' classes are kept whole.
    $rules = "src-tauri\gen\android\app\proguard-rules.pro"
    $keep = "-keep class app.tauri.** { *; }`n-keep class com.ghostclaw.phone.** { *; }"
    if (-not (Select-String -Path $rules -SimpleMatch "-keep class app.tauri.**" -Quiet)) { Add-Content -Path $rules -Value "`n$keep" }
    npx tauri android build --apk --target @Targets
} else {
    npx tauri android build --apk --debug --target @Targets
}
if ($LASTEXITCODE -ne 0) { throw "tauri android build failed" }

$apk = Get-ChildItem "src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter *.apk | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $apk) { throw "No APK was produced" }
$version = (Get-Content "$mobile\package.json" -Raw | ConvertFrom-Json).version
$name = "BibleConcordance_Android_$version" + $(if ($Release) { "" } else { "_debug" }) + ".apk"
New-Item -ItemType Directory -Force "$root\installer" | Out-Null
Copy-Item $apk.FullName "$root\installer\$name" -Force
Write-Host ("{0}  {1:N1} MB" -f "installer\$name", ($apk.Length / 1MB)) -ForegroundColor Green

if ($Install) {
    & "$env:ANDROID_HOME\platform-tools\adb.exe" install -r "$root\installer\$name"
}
