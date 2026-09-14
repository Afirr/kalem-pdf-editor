@echo off
REM Kalem PDF editoru - elle deploy script'i.
REM Statik site: Caddy dogrudan dist/ klasorunu sunuyor (NSSM/Node sureci YOK),
REM bu yuzden "restart" adimi gerekmiyor - Caddy her istekte diskten okur.
setlocal enabledelayedexpansion
cd /d C:\kalem

echo === Onceki commit kaydediliyor ===
for /f %%i in ('git rev-parse HEAD') do set PREV_COMMIT=%%i
echo Onceki commit: %PREV_COMMIT%

echo === git pull ===
git pull origin main
if errorlevel 1 (
  echo HATA: git pull basarisiz. Hicbir sey degistirilmedi.
  exit /b 1
)

echo === npm ci ===
call npm ci
if errorlevel 1 (
  echo HATA: npm ci basarisiz. %PREV_COMMIT% commit'ine donuluyor.
  git reset --hard %PREV_COMMIT%
  call npm ci
  echo Geri donuldu, eski hal calisir durumda kalmali.
  exit /b 1
)

echo === npm run build ===
call npm run build
if errorlevel 1 (
  echo HATA: build basarisiz. %PREV_COMMIT% commit'ine donuluyor.
  git reset --hard %PREV_COMMIT%
  call npm ci
  call npm run build
  echo Geri donuldu, eski hal calisir durumda kalmali.
  exit /b 1
)

echo === Saglik kontrolu: dist\index.html var mi ===
if not exist "C:\kalem\dist\index.html" (
  echo HATA: build cikti eksik ^(dist\index.html yok^). %PREV_COMMIT% commit'ine donuluyor.
  git reset --hard %PREV_COMMIT%
  call npm ci
  call npm run build
  exit /b 1
)

echo === Basarili ===
git log -1 --oneline
echo Caddy dist/ klasorunu dogrudan sundugu icin ek bir restart/reload gerekmiyor.
echo Tarayicidan https://kalem.tuvalcreative.com adresini kontrol et.
