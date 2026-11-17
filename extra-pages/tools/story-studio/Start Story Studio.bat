@echo off
title Story Studio
cd /d "%~dp0..\..\.."
echo Starting the Story Studio. Leave this window open while you use it; close it to stop.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:4177"
node --no-warnings extra-pages\tools\story-studio\server.mts
pause
