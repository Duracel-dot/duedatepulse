<#
.SYNOPSIS
  Desinstalle la tache planifiee SupervisionNG et ses regles de pare-feu.
#>
[CmdletBinding()]
param([string]$TaskName = 'SupervisionNG')

$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tache planifiee '$TaskName' supprimee."
} else {
  Write-Host "Aucune tache planifiee '$TaskName'."
}
$rules = Get-NetFirewallRule -DisplayName 'SupervisionNG*' -ErrorAction SilentlyContinue
if ($rules) {
  $rules | Remove-NetFirewallRule
  Write-Host 'Regles de pare-feu SupervisionNG supprimees.'
}
