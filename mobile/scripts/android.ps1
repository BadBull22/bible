# Builds (or runs) the Android app.
#
#   pwsh -File mobile\scripts\android.ps1                 # a debug APK to try on a phone
#   pwsh -File mobile\scripts\android.ps1 -Release        # the signed APK to hand out
#   pwsh -File mobile\scripts\android.ps1 -Install        # build, then install on the phone plugged in
#   pwsh -File mobile\scripts\android.ps1 -Release -Play  # the signed .aab for Google Play (upload that file)
#   pwsh -File mobile\scripts\android.ps1 -Release -Play -TestApk -Targets x86_64   # the same app as an APK for the PC's emulator
#
# -Play is the Google Play build: no update check or Install button (Play updates the app, and does
# not allow an app to install its own updates) and none of the permissions Play restricts
# (REQUEST_INSTALL_PACKAGES, the exact alarms, the battery question). The website APK keeps them.
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
    # the Google Play build (see above); with -Release it makes an .aab, or with -TestApk an APK to try
    [switch]$Play,
    [switch]$TestApk,
    # Android's internal build number. Normally worked out from the version (2.9.8 -> 2009008). Google Play never
    # accepts the same number twice, even for an upload that was discarded, so a re-upload of the same version
    # needs a higher one here, e.g. -VersionCode 2009009. The version people see (2.9.8) does not change.
    [int]$VersionCode = 0,
    # added to the file name, so a test build never overwrites a file already in installer\ (e.g. -Suffix "-v3test1")
    [string]$Suffix = "",
    # a test copy that installs NEXT TO the real app instead of over it: its own package name (com.ghostclaw.bibleconcordance.v3test), its own
    # name under the icon ("Bible v3 Test") and its own data. Use it for every test build on a phone that has the real app (a tester's phone:
    # an install over the real app would also take the tester's place in Google Play's closed test away).
    [switch]$SideBySide,
    # where the finished file goes (default: installer\ beside the project). A build only for checking on the emulator goes elsewhere, so that no new
    # installer shows up in installer\ before the owner asks for one.
    [string]$OutDir = "",
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
# Android 15+ phones can run with 16 KB memory pages and Google Play wants the native library laid out for
# them ("Recompile your app with 16 KB native library alignment"). The installed NDK (27) still links for 4 KB
# pages, so the linker is told. 64-bit only: 32-bit ARM phones keep 4 KB pages. Check a built file afterwards:
# the library's LOAD segments should show align 16384 (0x4000).
foreach ($t in "AARCH64", "X86_64") { Set-Item "env:CARGO_TARGET_${t}_LINUX_ANDROID_RUSTFLAGS" "-C link-arg=-Wl,-z,max-page-size=16384" }
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
# the desktop's "Ask a question" (since 2.9.3): its code and its data (see mobile/src-tauri/src/ask.rs); since 3.0.0 also its answer gate,
# spelling help and family questions (people_qa.rs, with the name spellings in name_aliases.json)
foreach ($f in "qa.rs", "qa_parser.rs", "firsts.rs", "answer_gate.rs", "spell.rs", "people_qa.rs") { Copy-Item "$root\src-tauri\src\$f" "$Mirror\src-tauri\src\$f" -Force }
New-Item -ItemType Directory -Force "$Mirror\src-tauri\resources" | Out-Null
foreach ($f in "qa.json", "qa_index.json", "firsts.json", "name_aliases.json") { Copy-Item "$root\src-tauri\resources\$f" "$Mirror\src-tauri\resources\$f" -Force }
# what the desktop and the phone app share (module readers, references, keeping in step)
Mirror-Dir "$root\crates" "$Mirror\crates" @("target", ".cargo")
# Browse (since 3.0.0): the desktop's pages (JSON) and the rules that find them, used from their source (mobile\src\Browse.tsx imports ..\..\src\browse);
# the children's pictures stay out (they are optional downloads on the phone)
Mirror-Dir "$root\src\browse" "$Mirror\src\browse" @("pictures")
# the themes (since 3.0.0): the desktop's own theme code, wordmark pictures, screen packages and verses of the season, used from their source
Mirror-Dir "$root\src\themes" "$Mirror\src\themes" @()

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
# --- the permissions: the Play build drops the ones Play restricts, the website APK keeps them. The
# generated manifest stays between builds, so it is set one way or the other every time.
$manifest = "src-tauri\gen\android\app\src\main\AndroidManifest.xml"
$m = Get-Content $manifest -Raw
$m = [regex]::Replace($m, '\s*<!-- play:start -->.*?<!-- play:end -->', '', 'Singleline')
if ($Play) {
    if ($m -notmatch 'xmlns:tools=') { $m = $m.Replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ') }
    $q = [char]34
    $drop = foreach ($p in "REQUEST_INSTALL_PACKAGES", "SCHEDULE_EXACT_ALARM", "USE_EXACT_ALARM", "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS") {
        "    <uses-permission android:name=${q}android.permission.$p${q} tools:node=${q}remove${q} />"
    }
    $block = "    <!-- play:start -->" + [Environment]::NewLine + ($drop -join [Environment]::NewLine) + [Environment]::NewLine + "    <!-- play:end -->"
    $at = $m.IndexOf("<application")
    if ($at -lt 0) { throw "No <application> in $manifest" }
    $m = $m.Insert($at, $block + [Environment]::NewLine + "    ")
}
Set-Content -Path $manifest -Value $m -NoNewline
$features = if ($Play) { @("--features", "play") } else { @() }

# the Android shell's start-up code (MainActivity.kt: it hands the size of the status bar and navigation bar
# to the page, which Android 15+ draws under). The generated project is not kept in git, so the copy that is
# kept in src-tauri\android replaces the generated one on every build.
$identifier = (Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).identifier
$activityDir = "src-tauri\gen\android\app\src\main\java\" + ($identifier -replace '\.', '\')
if (-not (Test-Path $activityDir)) { throw "No generated Android sources at $activityDir" }
Copy-Item "src-tauri\android\MainActivity.kt" "$activityDir\MainActivity.kt" -Force
# the release build shrinks the code (R8): the page's call into the shell must survive
$rules = "src-tauri\gen\android\app\proguard-rules.pro"
if (-not (Select-String -Path $rules -SimpleMatch "JavascriptInterface" -Quiet)) {
    Add-Content -Path $rules -Value "`n-keep class $identifier.MainActivity** { *; }`n-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }"
}
if ($VersionCode -gt 0) {
    # Tauri's own setting (bundle.android.versionCode), merged over tauri.conf.json for this build only
    $override = "$Mirror\mobile\src-tauri\versioncode.conf.json"
    Set-Content -Path $override -Value ('{"bundle":{"android":{"versionCode":' + $VersionCode + '}}}') -Encoding ascii
    $features += @("--config", $override)
    Write-Host "Android versionCode set to $VersionCode" -ForegroundColor Yellow
}

# the package name and the name under the icon: the real app's, or a test copy that sits next to it (-SideBySide). Set every build, one way
# or the other, because the generated project stays between builds. The code's own package (the namespace) never changes.
$appId = if ($SideBySide) { "$identifier.v3test" } else { $identifier }
$appLabel = if ($SideBySide) { "Bible v3 Test" } else { "Bible Concordance" }
$gradleApp = "src-tauri\gen\android\app\build.gradle.kts"
$g = Get-Content $gradleApp -Raw
$g = [regex]::Replace($g, 'applicationId = "[^"]*"', ('applicationId = "' + $appId + '"'))
Set-Content -Path $gradleApp -Value $g -NoNewline
$stringsXml = "src-tauri\gen\android\app\src\main\res\values\strings.xml"
$x = Get-Content $stringsXml -Raw
$x = [regex]::Replace($x, '(<string name="app_name">)[^<]*(</string>)', ('${1}"' + $appLabel + '"${2}'))
Set-Content -Path $stringsXml -Value $x -NoNewline
Write-Host "Package name: $appId  ($appLabel)" -ForegroundColor Yellow

# the app icon (three crosses, since 2026-10-20) into the Android project's launcher icons; the
# generated project lives only here, so it is applied on every build from src-tauri\app-icon.png
npx tauri icon src-tauri\app-icon.png | Out-Null
if ($LASTEXITCODE -ne 0) { throw "tauri icon failed" }

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
    if ($Play -and -not $TestApk) {
        npx tauri android build --aab --target @Targets @features
    } else {
        npx tauri android build --apk --target @Targets @features
    }
} else {
    npx tauri android build --apk --debug --target @Targets @features
}
if ($LASTEXITCODE -ne 0) { throw "tauri android build failed" }

$isAab = $Play -and $Release -and -not $TestApk
$apk = if ($isAab) {
    Get-ChildItem "src-tauri\gen\android\app\build\outputs\bundle" -Recurse -Filter *.aab | Sort-Object LastWriteTime | Select-Object -Last 1
} else {
    Get-ChildItem "src-tauri\gen\android\app\build\outputs\apk" -Recurse -Filter *.apk | Sort-Object LastWriteTime | Select-Object -Last 1
}
if (-not $apk) { throw "Nothing was produced" }
$version = (Get-Content "$mobile\package.json" -Raw | ConvertFrom-Json).version
$name = "BibleConcordance_Android_$version" + $(if ($Play) { "_play" } else { "" }) + $(if ($Release) { "" } else { "_debug" }) + $(if ($TestApk) { "_test" } else { "" }) + $Suffix + $(if ($isAab) { ".aab" } else { ".apk" })
$outDir = if ($OutDir) { $OutDir } else { "$root\installer" }
New-Item -ItemType Directory -Force $outDir | Out-Null
Copy-Item $apk.FullName "$outDir\$name" -Force
Write-Host ("{0}  {1:N1} MB" -f "$outDir\$name", ($apk.Length / 1MB)) -ForegroundColor Green

if ($Install) {
    & "$env:ANDROID_HOME\platform-tools\adb.exe" install -r "$outDir\$name"
}
