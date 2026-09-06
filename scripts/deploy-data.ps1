# Charge les donnees reelles dans l'app deployee (VPS).
#
#   cd C:\Users\david\Documents\JJD
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-data.ps1
#
# Envoie les fichiers sources (Excel, CSV TrustUp, agenda .ics) sur le VPS puis
# lance l'import dans le conteneur. A relancer quand les fichiers sources changent.
# L'import est idempotent (purge les donnees "xlsx" puis reimporte).
#
# Options :
#   -XlsxOnly       n'importe que calculs-rentabilite.xlsx (chantiers/factures/pointages)
#   -VpsUser -VpsHost -VpsPath   pour surcharger la cible

param(
  [string]$VpsUser = "bricoloc",
  [string]$VpsHost = "136.144.209.157",
  [string]$VpsPath = "/opt/jjd",
  [switch]$XlsxOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$target = "$VpsUser@$VpsHost"

if (-not (Test-Path "data-import")) {
  throw "Dossier data-import introuvable - lance ce script depuis le dossier du projet."
}

Write-Host "-> Creation du dossier distant" -ForegroundColor Cyan
ssh $target "mkdir -p $VpsPath/data-import"

Write-Host "-> Envoi des fichiers sources..." -ForegroundColor Cyan
$srcFiles = Get-ChildItem "data-import" -File | Where-Object { $_.Extension -eq ".xlsx" -or $_.Extension -eq ".ics" }
foreach ($f in $srcFiles) {
  Write-Host "   $($f.Name)"
  scp $f.FullName "${target}:$VpsPath/data-import/"
}

if (-not $XlsxOnly) {
  # CSV des exports TrustUp (dans leurs sous-dossiers invoice-* / quote-*)
  foreach ($dir in (Get-ChildItem "data-import" -Directory | Where-Object { $_.Name -like "invoice-*" -or $_.Name -like "quote-*" })) {
    ssh $target "mkdir -p '$VpsPath/data-import/$($dir.Name)'"
    foreach ($csv in (Get-ChildItem $dir.FullName -File -Filter *.csv)) {
      scp $csv.FullName "${target}:$VpsPath/data-import/$($dir.Name)/"
    }
  }
}

Write-Host "-> Import dans le conteneur (peut prendre 1-2 min)..." -ForegroundColor Cyan
if ($XlsxOnly) {
  $inner = 'cd /repo/apps/api && tsx scripts/import-xlsx.ts'
} else {
  $inner = 'cd /repo/apps/api && tsx scripts/import-xlsx.ts && tsx scripts/import-vehicles.ts && tsx scripts/import-trustup.ts && tsx scripts/import-agenda.ts'
}
$dockerRun = "cd $VpsPath && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -v $VpsPath/data-import:/repo/data-import:ro api sh -c '$inner'"
ssh $target $dockerRun

Write-Host ""
Write-Host "OK - Donnees importees." -ForegroundColor Green
Write-Host "  App : connexion david@jjd-consult.be / jjd" -ForegroundColor Green
Write-Host ""
Write-Host "Facultatif - PDF TrustUp + medias WhatsApp (~900 Mo) :" -ForegroundColor DarkGray
Write-Host "  scp -r data-import/invoice-*/documents  ${target}:$VpsPath/data-import/<dossier>/" -ForegroundColor DarkGray
Write-Host "  scp -r data-import/whatsapp             ${target}:$VpsPath/data-import/" -ForegroundColor DarkGray
Write-Host "  puis relancer l'import trustup + whatsapp." -ForegroundColor DarkGray
