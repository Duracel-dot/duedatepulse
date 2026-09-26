<#
.SYNOPSIS
  Exemple : pousser des donnees dans SupervisionNG via l'API d'ingestion.

.DESCRIPTION
  N'importe quel script (tache planifiee, outil existant, export d'un autre
  logiciel de supervision...) peut alimenter la vue 3D : il envoie un snapshot
  JSON complet (entites, liens, flux) sur POST /api/ingest/<source>.
  Voir docs/API.md pour le format.

  Sans jeton configure (server.ingestToken), seuls les envois depuis la machine
  locale sont acceptes.
#>
param(
  [string]$Url = 'http://localhost:8080',
  [string]$Source = 'exemple',
  [string]$Token = $env:SNG_INGEST_TOKEN
)
$ErrorActionPreference = 'Stop'

# Exemple : etat de deux services metier et d'un onduleur, rattaches a des equipements existants
$snapshot = @{
  entities = @(
    @{ id = 'ups-salle-a'; type = 'ups'; name = 'UPS-SALLE-A'; parent = 'A08'; status = 'ok'
       attrs = @{ vendor = 'Eaton'; model = '9PX 11kVA'; u = 1; height = 4 }
       metrics = @{ load = 38; battery = 100; runtimeMin = 42 } }
  )
  links = @()
  flows = @(
    @{ src = @{ ip = '10.10.40.21' }; dst = @{ ip = '10.10.50.11' }; proto = 'tcp'; port = 1433; bps = 25000000 }
  )
  staleAfterSeconds = 300
}

$headers = @{ 'Content-Type' = 'application/json' }
if ($Token) { $headers['Authorization'] = "Bearer $Token" }
$body = $snapshot | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "$Url/api/ingest/$Source" -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body))
Write-Host "Snapshot envoye (source ingest:$Source)."
