@echo off
REM Launch the LifeLog app: starts the local server and opens it in your browser.
cd /d "%~dp0"
start "" http://localhost:5173
node server.js
