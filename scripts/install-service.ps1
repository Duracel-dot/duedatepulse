<#
.SYNOPSIS
  Installe SupervisionNG comme tache planifiee lancee au demarrage de Windows
  (fonctionnement de type service, redemarrage automatique en cas d'arret).

.DESCRIPTION
  A lancer dans une console PowerShell "Executer en tant qu'administrateur" :
    powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 -OpenFirewall

  Par defaut la tache tourne sous le compte SYSTEM : les acces WinRM / Hyper-V
  vers d'autres serveurs se font alors avec le compte ordinateur (DOMAINE\SERVEUR$).
  Pour utiliser un compte de service dedie : -User DOMAINE\svc-supervision

.PARAMETER TaskName
  Nom de la tache planifiee (defaut : SupervisionNG).
.PARAMETER User
  Compte d'execution (defaut : SYSTEM). Le mot de passe est demande.
.PARAMETER Port
  Port HTTP de la vue (defaut : 8080), utilise pour la regle de pare-feu.
.PARAMETER OpenFirewall
  Cree une regle de pare-feu entrante pour le port HTTP (profils Domaine et Prive).
.PARAMETER NetFlowPort
  Si superieur a 0, ouvre aussi ce port UDP (recepteur NetFlow / IPFIX, ex. 2055).
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'SupervisionNG',
  [string]$User = 'SYSTEM',
  [int]$Port = 8080,
  [switch]$OpenFirewall,
  [int]$NetFlowPort = 0
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Ce script doit etre lance dans une console PowerShell ouverte en tant qu'administrateur."
}

$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $root 'node\node.exe'
if (-not (Test-Path $node)) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source } else { throw 'node.exe introuvable : installer Node.js 20+ ou utiliser le paquet autonome.' }
}
if (-not (Test-Path (Join-Path $root 'node_modules\three\package.json'))) {
  throw "Dependances absentes : lancer d'abord 'npm ci --omit=dev' dans $root (ou utiliser le paquet autonome)."
}
if (-not (Test-Path (Join-Path $root 'config\supervisionng.json'))) {
  Write-Warning 'config\supervisionng.json absent : le service demarrera en mode demonstration.'
}

$entry = Join-Path $root 'server\index.js'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $entry + '"') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$description = 'SupervisionNG - vue 3D unifiee de l infrastructure (serveur web et collecteurs).'

if ($User -eq 'SYSTEM') {
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force | Out-Null
} else {
  $cred = Get-Credential -UserName $User -Message 'Mot de passe du compte de service SupervisionNG'
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Description $description -Force | Out-Null
}
Write-Host "Tache planifiee '$TaskName' installee (compte : $User)."

if ($OpenFirewall) {
  Get-NetFirewallRule -DisplayName 'SupervisionNG*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName 'SupervisionNG HTTP' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain,Private | Out-Null
  Write-Host "Pare-feu : TCP $Port autorise en entree (profils Domaine et Prive)."
  if ($NetFlowPort -gt 0) {
    New-NetFirewallRule -DisplayName 'SupervisionNG NetFlow' -Direction Inbound -Protocol UDP -LocalPort $NetFlowPort -Action Allow -Profile Domain,Private | Out-Null
    Write-Host "Pare-feu : UDP $NetFlowPort (NetFlow / IPFIX) autorise en entree."
  }
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ("Etat : " + (Get-ScheduledTask -TaskName $TaskName).State + " - dernier resultat : " + $info.LastTaskResult)
Write-Host "Vue 3D : http://localhost:$Port/   (journal : $root\logs\supervisionng.log)"
