@echo off
REM Lance Metro pour l'appli chantier (Expo Go). L'API doit tourner (LANCER-JJD.cmd).
cd /d "%~dp0\apps\mobile"
echo Scanne le QR code avec Expo Go sur ton telephone (meme WiFi que le PC).
echo Si "Network request failed" : ouvre le pare-feu Windows pour le port 4100.
call npx expo start
