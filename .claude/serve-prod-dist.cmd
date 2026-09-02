@echo off
REM Yayindaki (C:\kalem\dist) URETIM build'ini yerelde 5199'da sunar.
REM Amac: Browser pane disariya cikamadigi icin, yayindakiyle BYTE-BYTE ayni
REM oldugu SHA256 ile dogrulanmis bundle uzerinde uctan uca PDF testi yapmak.
set "PATH=C:\Program Files\nodejs;%PATH%"
node "%~dp0serve-prod-dist.mjs"
