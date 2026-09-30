@echo off
set GIT="C:\Users\tvald\Downloads\Contador de esencia - Anaquel\cmd\git.exe"
set REPO="c:\Users\tvald\Downloads\Contador de esencia - Anaquel\INVENTARIO1.1"
%GIT% -C %REPO% add .
%GIT% -C %REPO% commit -m "Tara 29.5/30.5, contador F/M, fecha en tarjeta"
%GIT% -C %REPO% push
echo.
echo Listo! Cambios subidos a GitHub.
pause
