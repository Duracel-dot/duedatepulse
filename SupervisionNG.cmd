@echo off
rem SupervisionNG - lanceur Windows
rem Double-cliquer pour demarrer la vue 3D (mode demonstration tant que
rem config\supervisionng.json n'existe pas). Options : voir README.md
setlocal EnableExtensions
title SupervisionNG
cd /d "%~dp0"

set "NODE_EXE=node"
if exist "%~dp0node\node.exe" set "NODE_EXE=%~dp0node\node.exe"

"%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>&1
if not errorlevel 1 goto deps

rem Node.js absent : telechargement automatique de Node.js portable (nodejs.org)
echo Node.js 20+ introuvable : telechargement de Node.js portable depuis nodejs.org...
set "PSModulePath="
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\get-node.ps1"
if errorlevel 1 goto nonode
set "NODE_EXE=%~dp0node\node.exe"

:deps
if exist "%~dp0node_modules\three\package.json" goto run
echo Installation des dependances - premier lancement...
call npm ci --omit=dev --no-audit --no-fund
if errorlevel 1 goto npmfail

:run
"%NODE_EXE%" "%~dp0server\index.js" --open %*
if errorlevel 1 pause
exit /b %errorlevel%

:nonode
echo.
echo  Node.js version 20 ou plus recente est requis et n'a pas pu etre telecharge.
echo   - installer Node.js LTS depuis https://nodejs.org
echo   - ou copier node.exe dans le dossier node\ de SupervisionNG
echo   - ou utiliser le paquet hors-ligne qui embarque node.exe
echo.
pause
exit /b 1

:npmfail
echo.
echo  Echec de l'installation des dependances.
echo  Verifier l'acces a registry.npmjs.org, ou utiliser le paquet autonome.
echo.
pause
exit /b 1
