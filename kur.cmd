@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Piksel Ofis kurulumu

rem Prefers the Claude Code that ships with the VS Code extension (always current),
rem then the newest one on PATH.
set "CLAUDE="
set "EXT=%USERPROFILE%\.vscode\extensions"
if exist "%EXT%" (
  for /f "delims=" %%D in ('dir /b /ad /o-d "%EXT%\anthropic.claude-code-*" 2^>nul') do (
    if not defined CLAUDE if exist "%EXT%\%%D\resources\native-binary\claude.exe" set "CLAUDE=%EXT%\%%D\resources\native-binary\claude.exe"
  )
)
if not defined CLAUDE (
  for /f "delims=" %%P in ('where claude 2^>nul') do if not defined CLAUDE set "CLAUDE=%%P"
)
if not defined CLAUDE (
  echo Claude Code bulunamadi. Once VS Code'a "Claude Code" eklentisini kurun, sonra bu dosyayi yeniden calistirin.
  pause
  exit /b 1
)

echo Piksel Ofis kuruluyor...
"%CLAUDE%" plugin install pixel-ofis --marketplace musabhc/pixel-ofis --scope user
if errorlevel 1 (
  echo.
  echo Kurulum basarisiz oldu. Git kurulu degilse https://git-scm.com adresinden kurup yeniden deneyin.
  pause
  exit /b 1
)
echo.
echo Kuruldu. VS Code'da yeni bir Claude sohbeti acin; Piksel Ofis paneli kendiliginden acilir (ya da /ofis yazin).
pause
