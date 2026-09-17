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
#   -Whatsapp       envoie data-import/whatsapp/ (~plusieurs Go, peut prendre du temps)
#                   et lance l'import des fils de discussion (au lieu de xlsx/csv)
#   -VpsUser -VpsHost -VpsPath   pour surcharger la cible

param(
  [string]$VpsUser = "bricoloc",
  [string]$VpsHost = "136.144.209.157",
  [string]$VpsPath = "/opt/jjd",
  [string]$IdentityFile = "$HOME\.ssh\bricoloc_vps",
  [switch]$XlsxOnly,
  [switch]$Whatsapp
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$target = "$VpsUser@$VpsHost"
$sshArgs = @()
$scpArgs = @()
if (Test-Path $IdentityFile) {
  $sshArgs = @("-i", $IdentityFile)
  $scpArgs = @("-i", $IdentityFile)
}

function Invoke-Ssh([string]$cmd) {
  & ssh @sshArgs $target $cmd
  if ($LASTEXITCODE -ne 0) { throw "Echec ssh (code $LASTEXITCODE) : $cmd" }
}

function Invoke-Scp([string[]]$scpCmdArgs) {
  & scp @scpArgs @scpCmdArgs
  if ($LASTEXITCODE -ne 0) { throw "Echec scp (code $LASTEXITCODE)" }
}

if (-not (Test-Path "data-import")) {
  throw "Dossier data-import introuvable - lance ce script depuis le dossier du projet."
}

Write-Host "-> Creation du dossier distant" -ForegroundColor Cyan
Invoke-Ssh "mkdir -p $VpsPath/data-import"

if ($Whatsapp) {
  if (-not (Test-Path "data-import/whatsapp")) {
    throw "Dossier data-import/whatsapp introuvable."
  }
  Write-Host "-> Envoi de data-import/whatsapp/ (ca peut prendre un moment, plusieurs Go)..." -ForegroundColor Cyan
  Invoke-Scp @("-r", "data-import/whatsapp", "${target}:$VpsPath/data-import/")

  Write-Host "-> Import des fils de discussion dans le conteneur..." -ForegroundColor Cyan
  $inner = 'cd /repo/apps/api && npx tsx scripts/import-whatsapp.ts'
  $dockerRun = "cd $VpsPath && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -v $VpsPath/data-import:/repo/data-import:ro api sh -c '$inner'"
  Invoke-Ssh $dockerRun

  Write-Host ""
  Write-Host "OK - Discussions WhatsApp importees." -ForegroundColor Green
  exit 0
}

Write-Host "-> Envoi des fichiers sources..." -ForegroundColor Cyan
$srcFiles = Get-ChildItem "data-import" -File | Where-Object { $_.Extension -eq ".xlsx" -or $_.Extension -eq ".ics" }
foreach ($f in $srcFiles) {
  Write-Host "   $($f.Name)"
  Invoke-Scp @($f.FullName, "${target}:$VpsPath/data-import/")
}

if (-not $XlsxOnly) {
  # CSV des exports TrustUp (dans leurs sous-dossiers invoice-* / quote-*)
  foreach ($dir in (Get-ChildItem "data-import" -Directory | Where-Object { $_.Name -like "invoice-*" -or $_.Name -like "quote-*" })) {
    Invoke-Ssh "mkdir -p '$VpsPath/data-import/$($dir.Name)'"
    foreach ($csv in (Get-ChildItem $dir.FullName -File -Filter *.csv)) {
      Invoke-Scp @($csv.FullName, "${target}:$VpsPath/data-import/$($dir.Name)/")
    }
  }
}

Write-Host "-> Import dans le conteneur (peut prendre 1-2 min)..." -ForegroundColor Cyan
if ($XlsxOnly) {
  $inner = 'cd /repo/apps/api && npx tsx scripts/import-xlsx.ts'
} else {
  $inner = 'cd /repo/apps/api && npx tsx scripts/import-xlsx.ts && npx tsx scripts/import-vehicles.ts && npx tsx scripts/import-trustup.ts && npx tsx scripts/import-agenda.ts'
}
$dockerRun = "cd $VpsPath && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -v $VpsPath/data-import:/repo/data-import:ro api sh -c '$inner'"
Invoke-Ssh $dockerRun

Write-Host ""
Write-Host "OK - Donnees importees." -ForegroundColor Green
Write-Host "  App : connexion david@jjd-consult.be / jjd" -ForegroundColor Green
Write-Host ""
Write-Host "Facultatif - PDF TrustUp + medias WhatsApp :" -ForegroundColor DarkGray
Write-Host "  scp -r data-import/invoice-*/documents  ${target}:$VpsPath/data-import/<dossier>/" -ForegroundColor DarkGray
Write-Host "  powershell -File scripts\deploy-data.ps1 -Whatsapp" -ForegroundColor DarkGray
