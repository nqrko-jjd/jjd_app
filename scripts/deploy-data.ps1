# Charge les données réelles dans l'app déployée (VPS).
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-data.ps1
#
# Envoie ~8 Mo de fichiers sources (Excel, CSV TrustUp, agenda .ics) sur le VPS
# puis lance l'import dans le conteneur. À faire UNE fois (ou quand les fichiers
# sources changent). Les photos/PDF/WhatsApp (~900 Mo) sont facultatifs et se
# synchronisent séparément (voir la fin du script).

param(
  [string]$VpsUser = "bricoloc",
  [string]$VpsHost = "136.144.209.157",
  [string]$VpsPath = "/opt/jjd"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$target = "$VpsUser@$VpsHost"

if (-not (Test-Path "data-import")) { throw "Dossier data-import/ introuvable — lance ce script depuis le dossier du projet." }

Write-Host "→ Création du dossier distant" -ForegroundColor Cyan
ssh $target "mkdir -p $VpsPath/data-import"

Write-Host "→ Envoi des fichiers sources (~8 Mo)…" -ForegroundColor Cyan
# xlsx + ics à la racine de data-import/
Get-ChildItem "data-import" -File -Include *.xlsx, *.ics | ForEach-Object {
  scp $_.FullName "${target}:$VpsPath/data-import/"
}
# CSV des exports TrustUp (dans leurs sous-dossiers)
Get-ChildItem "data-import" -Directory -Filter "invoice-*" | ForEach-Object {
  ssh $target "mkdir -p '$VpsPath/data-import/$($_.Name)'"
  Get-ChildItem $_.FullName -File -Filter *.csv | ForEach-Object { scp $_.FullName "${target}:$VpsPath/data-import/$($_.Directory.Name)/" }
}
Get-ChildItem "data-import" -Directory -Filter "quote-*" | ForEach-Object {
  ssh $target "mkdir -p '$VpsPath/data-import/$($_.Name)'"
  Get-ChildItem $_.FullName -File -Filter *.csv | ForEach-Object { scp $_.FullName "${target}:$VpsPath/data-import/$($_.Directory.Name)/" }
}

Write-Host "→ Import dans le conteneur (peut prendre 1-2 min)…" -ForegroundColor Cyan
$importCmd = "cd $VpsPath && docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -v $VpsPath/data-import:/repo/data-import:ro api sh -c 'cd /repo/apps/api && tsx scripts/import-xlsx.ts && tsx scripts/import-vehicles.ts && tsx scripts/import-trustup.ts && tsx scripts/import-agenda.ts'"
ssh $target $importCmd

Write-Host ""
Write-Host "✔ Données importées." -ForegroundColor Green
Write-Host "  - App     : connexion david@jjd-consult.be / jjd" -ForegroundColor Green
Write-Host "  - Portail : les comptes syndic@portail.demo etc. existent maintenant" -ForegroundColor Green
Write-Host ""
Write-Host "Facultatif — envoyer aussi les PDF TrustUp + médias WhatsApp (~900 Mo) :" -ForegroundColor DarkGray
Write-Host "  scp -r data-import/invoice-*/documents  $target`:$VpsPath/data-import/<dossier>/" -ForegroundColor DarkGray
Write-Host "  scp -r data-import/whatsapp             $target`:$VpsPath/data-import/" -ForegroundColor DarkGray
Write-Host "  puis relancer l'import trustup + whatsapp." -ForegroundColor DarkGray
