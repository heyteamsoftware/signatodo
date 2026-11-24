@echo off
rem Arranca Signatodo en este ordenador y abre el navegador. Cierra esta ventana para pararlo.
cd /d "%~dp0"
echo.
echo   Signatodo en http://localhost:8765/
echo   Deja esta ventana abierta mientras lo usas. Cierrala para parar.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:8765/"
py servidor.py
echo.
echo   El servidor se ha parado. Si el puerto estaba ocupado, es que ya habia otro en marcha:
echo   abre http://localhost:8765/ directamente.
pause
