# SupervisionNG - chiffre un secret (mot de passe, communaute SNMP, jeton...) avec DPAPI,
# portee LocalMachine : seul CE serveur peut le dechiffrer (server/util/secrets.js).
#
# Usage : powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\protect-secret.ps1
# Copier ensuite la valeur "dpapi:..." affichee dans config/supervisionng.json, par exemple :
#   "credential": { "username": "CORP\\svc-supervision", "password": "dpapi:AQAAANCMnd8BFdERjHoAwE..." }
# Fichier volontairement en ASCII pur (Windows PowerShell 5.1 lit les fichiers sans BOM en ANSI).

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# System.Security (Windows PowerShell 5.1) ; PowerShell 7 : assembly ProtectedData dediee
try { Add-Type -AssemblyName System.Security } catch { }
if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {
  try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData } catch { }
}
if (-not ('System.Security.Cryptography.ProtectedData' -as [type])) {
  Write-Host 'DPAPI indisponible : lancer ce script avec powershell.exe (Windows PowerShell 5.1).' -ForegroundColor Red
  exit 1
}

function Read-Plain([string]$Prompt) {
  $sec = Read-Host -AsSecureString -Prompt $Prompt
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$plain = Read-Plain 'Secret a chiffrer'
if (-not $plain) {
  Write-Host 'Secret vide : abandon.' -ForegroundColor Red
  exit 1
}
$again = Read-Plain 'Confirmer le secret'
if ($plain -cne $again) {
  Write-Host 'Les deux saisies different : abandon.' -ForegroundColor Red
  exit 1
}

# Octets UTF-8 : secrets.js les relit avec Buffer.toString('utf8')
$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)
$scope = [System.Security.Cryptography.DataProtectionScope]::LocalMachine
$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
[Array]::Clear($bytes, 0, $bytes.Length)
$plain = $null
$again = $null

Write-Host ''
Write-Host 'Valeur a copier dans la configuration (dechiffrable uniquement sur ce serveur) :'
Write-Output ('dpapi:' + [Convert]::ToBase64String($enc))
