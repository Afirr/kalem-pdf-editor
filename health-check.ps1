# Kalem icin HTTP saglik izleyicisi (watchdog). Kalem'in kendi Windows
# servisi YOK (Caddy dist/'i statik sunuyor) - bu yuzden agency'nin
# watchdog.cmd'sindeki "servis dustuyse net start" deseni burada uygulanamaz.
# Bilincli tercih: agency-caddy'yi OTOMATIK yeniden baslatmiyoruz - bu,
# tuval-panel'i de etkileyen PAYLASILAN bir servis; kor bir restart yanlis
# tesbihte islenmis bir hatayi gizleyebilir. Bu script yalniz IZLER + LOGLAR.
$ErrorActionPreference = "SilentlyContinue"
$logDir = "C:\kalem\logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "health-check.log"
$alertFile = Join-Path $logDir "health-alerts.log"

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
try {
    $r = Invoke-WebRequest -Uri "https://kalem-pdf.duckdns.org/" -TimeoutSec 15 -UseBasicParsing
    $status = $r.StatusCode
} catch {
    $status = "HATA: $($_.Exception.Message)"
}

"$ts  status=$status" | Add-Content -Path $logFile -Encoding UTF8

if ($status -ne 200) {
    "$ts  UYARI: kalem-pdf.duckdns.org saglik kontrolu basarisiz -> $status" | Add-Content -Path $alertFile -Encoding UTF8
}

# Log dosyasi sinirsiz buyumesin (agency/IsTakip ile ayni disk).
$maxLines = 20000
foreach ($f in @($logFile, $alertFile)) {
    if (Test-Path $f) {
        $lines = Get-Content $f
        if ($lines.Count -gt $maxLines) {
            $lines[-$maxLines..-1] | Set-Content $f -Encoding UTF8
        }
    }
}
