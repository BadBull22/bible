@echo off
REM Launches the Bible Concordance dev build (see HANDOVER.md).
setlocal
cd /d "%~dp0"

echo Checking Rust backend (cargo check)...
pushd src-tauri
cargo check
if errorlevel 1 (
    echo.
    echo cargo check FAILED - see errors above.
    popd
    goto :end
)
popd

echo Starting Tauri dev server...
call npm run tauri dev
if errorlevel 1 (
    echo.
    echo npm run tauri dev exited with an error - see output above.
)

:end
endlocal
echo.
pause
