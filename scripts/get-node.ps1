<#
.SYNOPSIS
  Telecharge Node.js portable (node.exe seul) dans le dossier node\ de SupervisionNG.

.DESCRIPTION
  Appele automatiquement par SupervisionNG.cmd quand Node.js n'est pas installe.
  Source officielle : https://nodejs.org/dist/ ; la somme de controle SHA-256
  publiee par nodejs.org (SHASUMS256.txt) est verifiee avant extraction.
  Le proxy systeme de Windows (et ses identifiants) est utilise s'il existe.
#>
param(
  [string]$Version = '22.22.2'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { }

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'node'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' } else { $arch = 'x64' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows 64 bits requis.' }
$name = "node-v$Version-win-$arch"
$base = "https://nodejs.org/dist/v$Version"
$tmp = Join-Path ([IO.Path]::GetTempPath()) "$name.zip"

Write-Host "Telechargement de $base/$name.zip ..."
Invoke-WebRequest -Uri "$base/$name.zip" -OutFile $tmp -UseBasicParsing

$sums = Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -UseBasicParsing
$text = $sums.Content
if ($text -is [byte[]]) { $text = [Text.Encoding]::ASCII.GetString($text) }
$line = ($text -split "`n") | Where-Object { $_ -match ('\s' + [regex]::Escape("$name.zip") + '\s*$') } | Select-Object -First 1
if (-not $line) { throw "Somme de controle introuvable pour $name.zip" }
$expected = ($line.Trim() -split '\s+')[0].ToLower()
$actual = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) {
  Remove-Item $tmp -Force
  throw "Somme de controle SHA-256 invalide ($actual au lieu de $expected)"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($tmp)
try {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($file in @('node.exe', 'LICENSE')) {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq "$name/$file" } | Select-Object -First 1
    if (-not $entry) { throw "$file absent de l'archive Node.js" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $dest $file), $true)
  }
} finally {
  $zip.Dispose()
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}
Write-Host "Node.js $Version installe dans $dest"
