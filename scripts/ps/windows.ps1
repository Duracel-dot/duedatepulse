# SupervisionNG - couche "systeme" des machines Windows via CIM.
# Cibles distantes : WinRM (WS-Man) ou DCOM ; 'localhost' / '.' / nom local : sans session distante.
#
# Parametres (JSON dans la variable d'environnement SNG_PARAMS) :
#   targets        : noms ou IP des machines
#   flows          : $true pour relever les connexions TCP etablies
#   opTimeoutSec   : delai max par requete CIM (defaut 20)
#   protocol       : 'wsman' (defaut) ou 'dcom'
#   port / useSsl  : port WinRM et HTTPS (WS-Man uniquement ; defaut 5985 sans SSL)
#   serviceExclude : motifs (jokers) de services a ignorer en plus de la liste par defaut
# Identifiants optionnels : SNG_USER / SNG_PASS (ignores pour la machine locale).
# Sortie : UN document JSON { version, targets: [ { name, ok, error?, ... } ] } sur stdout.
# Fichier volontairement en ASCII pur (Windows PowerShell 5.1 lit les fichiers sans BOM en ANSI).

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'

# PS 5.1 : sans cela, ConvertTo-Json peut serialiser certains tableaux en { value, Count }
if ($PSVersionTable.PSVersion.Major -lt 6) {
  try { Remove-TypeData -TypeName System.Array -ErrorAction Stop } catch { }
}

function Format-Error($Err) {
  $msg = $null
  if ($Err -and $Err.Exception) { $msg = $Err.Exception.Message } else { $msg = [string]$Err }
  if (-not $msg) { $msg = 'erreur inconnue' }
  $msg = ($msg -replace '\s+', ' ').Trim()
  if ($msg.Length -gt 500) { $msg = $msg.Substring(0, 500) }
  return $msg
}

# JSON compact ; caracteres non ASCII echappes en \uXXXX (independant de l'encodage de la console)
function Write-JsonOutput($Object) {
  $json = ConvertTo-Json -InputObject $Object -Depth 8 -Compress
  $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
    param($m)
    return ('\u{0:x4}' -f [int][char]$m.Value)
  }
  $json = [regex]::Replace($json, '[^\x00-\x7F]', $evaluator)
  [Console]::Out.Write($json)
}

function Test-LocalTarget([string]$Name) {
  if (-not $Name) { return $true }
  $n = $Name.Trim().ToLowerInvariant()
  if ($n -eq 'localhost' -or $n -eq '.' -or $n -eq '127.0.0.1' -or $n -eq '::1') { return $true }
  $cn = ([string]$env:COMPUTERNAME).ToLowerInvariant()
  if ($cn -and ($n -eq $cn -or $n.StartsWith($cn + '.'))) { return $true }
  return $false
}

# Services "Auto" arretes mais sans interet (mises a jour, services a declenchement...)
$script:ServiceExclude = @(
  'gupdate', 'gupdatem', 'GoogleUpdater*', 'edgeupdate', 'edgeupdatem', 'MicrosoftEdgeElevationService',
  'sppsvc', 'RemoteRegistry', 'MapsBroker', 'TrustedInstaller', 'tiledatamodelsvc', 'WbioSrvc', 'CDPSvc',
  'clr_optimization_*', 'ShellHWDetection', 'Net Driver HPZ12', 'Pml Driver HPZ12'
)

function Test-ServiceExcluded($Svc) {
  $n = [string]$Svc.Name
  foreach ($pat in $script:ServiceExclude) {
    if ($n -like $pat) { return $true }
  }
  # instances de services par utilisateur (ex. CDPUserSvc_4f2c1)
  if ($n -match '_[0-9a-fA-F]{5,8}$') { return $true }
  # demarrage differe termine proprement : bruit habituel
  if ($Svc.DelayedAutoStart -eq $true -and $Svc.ExitCode -eq 0) { return $true }
  return $false
}

function Get-TargetInfo([string]$Target, [hashtable]$Cim, [bool]$IsLocal) {
  $errs = [System.Collections.Generic.List[string]]::new()

  # Obligatoires : une erreur ici rend la cible injoignable
  $cs = Get-CimInstance @Cim -ClassName Win32_ComputerSystem | Select-Object -First 1
  $os = Get-CimInstance @Cim -ClassName Win32_OperatingSystem | Select-Object -First 1

  $bios = $null
  try { $bios = Get-CimInstance @Cim -ClassName Win32_BIOS | Select-Object -First 1 } catch { $errs.Add('bios: ' + (Format-Error $_)) }
  $prod = $null
  try { $prod = Get-CimInstance @Cim -ClassName Win32_ComputerSystemProduct | Select-Object -First 1 } catch { $errs.Add('product: ' + (Format-Error $_)) }

  # Charge CPU moyenne (LoadPercentage peut etre vide sur certaines VM : repli sur le compteur de perf)
  $cpuLoad = $null
  try {
    $loads = @(Get-CimInstance @Cim -ClassName Win32_Processor | Where-Object { $null -ne $_.LoadPercentage } | ForEach-Object { [double]$_.LoadPercentage })
    if ($loads.Count -gt 0) { $cpuLoad = [math]::Round(($loads | Measure-Object -Average).Average, 1) }
  } catch { $errs.Add('cpu: ' + (Format-Error $_)) }
  if ($null -eq $cpuLoad) {
    try {
      $perf = Get-CimInstance @Cim -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" | Select-Object -First 1
      if ($perf) { $cpuLoad = [double]$perf.PercentProcessorTime }
    } catch { $errs.Add('cpu-perf: ' + (Format-Error $_)) }
  }

  $uptime = $null
  if ($os.LocalDateTime -is [datetime] -and $os.LastBootUpTime -is [datetime]) {
    $uptime = [int64](($os.LocalDateTime - $os.LastBootUpTime).TotalSeconds)
  }

  $disks = @()
  try {
    $disks = @(Get-CimInstance @Cim -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, VolumeName, Size, FreeSpace)
  } catch { $errs.Add('disks: ' + (Format-Error $_)) }

  $nics = @()
  try {
    $nics = @(Get-CimInstance @Cim -ClassName Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=TRUE' | ForEach-Object {
        [pscustomobject]@{
          Description = [string]$_.Description
          MACAddress  = [string]$_.MACAddress
          IPAddress   = @($_.IPAddress | Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' })
        }
      })
  } catch { $errs.Add('nics: ' + (Format-Error $_)) }

  $stopped = @()
  try {
    $stopped = @(Get-CimInstance @Cim -ClassName Win32_Service -Filter "StartMode='Auto' AND State<>'Running'" |
      Where-Object { -not (Test-ServiceExcluded $_) } |
      Select-Object Name, DisplayName, State, ExitCode)
  } catch { $errs.Add('services: ' + (Format-Error $_)) }

  # Connexions TCP (MSFT_NetTCPConnection = Get-NetTCPConnection) : 2 = Listen, 5 = Established
  $conns = $null
  $listen = $null
  if ($script:WantFlows) {
    try {
      $tcp = @(Get-CimInstance @Cim -Namespace 'root/StandardCimv2' -ClassName MSFT_NetTCPConnection -Filter 'State = 2 OR State = 5')
      $procs = @{}
      if ($tcp.Count -gt 0) {
        foreach ($pr in @(Get-CimInstance @Cim -ClassName Win32_Process -Property ProcessId, Name)) {
          $procs[[string]$pr.ProcessId] = [string]$pr.Name
        }
      }
      $loopRx = '^(127\.|::1$|::ffff:127\.|0\.0\.0\.0$|::$)'
      $ports = @{}
      $list = [System.Collections.Generic.List[object]]::new()
      foreach ($c in $tcp) {
        $st = [int]$c.State
        if ($st -eq 2) {
          $ports[[string]$c.LocalPort] = $true
          continue
        }
        $la = [string]$c.LocalAddress
        $ra = [string]$c.RemoteAddress
        if ($la -match $loopRx -or $ra -match $loopRx) { continue }
        if ($list.Count -ge 20000) { continue }
        $list.Add([pscustomobject]@{
            LocalAddress  = $la
            LocalPort     = [int]$c.LocalPort
            RemoteAddress = $ra
            RemotePort    = [int]$c.RemotePort
            Process       = $procs[[string]$c.OwningProcess]
          })
      }
      $conns = $list.ToArray()
      $listen = @($ports.Keys | ForEach-Object { [int]$_ })
    } catch { $errs.Add('flows: ' + (Format-Error $_)) }
  }

  $biosSerial = $null
  if ($bios) { $biosSerial = [string]$bios.SerialNumber }
  $uuid = $null
  if ($prod) { $uuid = [string]$prod.UUID }

  $info = [pscustomobject]@{
    name            = $Target
    ok              = $true
    local           = $IsLocal
    cs              = [pscustomobject]@{
      Name                      = [string]$cs.Name
      DNSHostName               = [string]$cs.DNSHostName
      Domain                    = [string]$cs.Domain
      PartOfDomain              = [bool]$cs.PartOfDomain
      Manufacturer              = [string]$cs.Manufacturer
      Model                     = [string]$cs.Model
      TotalPhysicalMemory       = $cs.TotalPhysicalMemory
      NumberOfLogicalProcessors = $cs.NumberOfLogicalProcessors
    }
    bios            = [pscustomobject]@{ SerialNumber = $biosSerial }
    product         = [pscustomobject]@{ UUID = $uuid }
    os              = [pscustomobject]@{
      Caption                = [string]$os.Caption
      Version                = [string]$os.Version
      LastBootUpTime         = $os.LastBootUpTime
      FreePhysicalMemory     = $os.FreePhysicalMemory
      TotalVisibleMemorySize = $os.TotalVisibleMemorySize
    }
    uptimeS         = $uptime
    cpuLoad         = $cpuLoad
    disks           = $disks
    nics            = $nics
    stoppedServices = $stopped
    conns           = $conns
    listen          = $listen
    errors          = $errs.ToArray()
  }
  return $info
}

$results = [System.Collections.Generic.List[object]]::new()
try {
  $p = $null
  if ($env:SNG_PARAMS) { $p = $env:SNG_PARAMS | ConvertFrom-Json }
  if ($null -eq $p) { $p = New-Object PSObject }

  $cred = $null
  if ($env:SNG_USER) {
    $sec = New-Object System.Security.SecureString
    if ($env:SNG_PASS) { $sec = ConvertTo-SecureString $env:SNG_PASS -AsPlainText -Force }
    $cred = New-Object System.Management.Automation.PSCredential($env:SNG_USER, $sec)
  }

  $targets = @($p.targets | Where-Object { $_ } | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  $script:WantFlows = [bool]$p.flows
  $opTimeout = 20
  if ($p.opTimeoutSec) { $opTimeout = [int]$p.opTimeoutSec }
  $useDcom = ([string]$p.protocol -eq 'dcom')
  $useSsl = [bool]$p.useSsl
  $port = 0
  if ($p.port) { $port = [int]$p.port }
  if ($p.serviceExclude) {
    $script:ServiceExclude = @($script:ServiceExclude) + @($p.serviceExclude | Where-Object { $_ } | ForEach-Object { [string]$_ })
  }

  foreach ($t in $targets) {
    $session = $null
    try {
      $isLocal = Test-LocalTarget $t
      $cim = @{ OperationTimeoutSec = $opTimeout }
      if (-not $isLocal) {
        $sa = @{ ComputerName = $t; OperationTimeoutSec = $opTimeout }
        if ($cred) { $sa.Credential = $cred }
        if ($useDcom) { $sa.SessionOption = New-CimSessionOption -Protocol Dcom }
        elseif ($useSsl) { $sa.SessionOption = New-CimSessionOption -UseSsl }
        if ($port -gt 0 -and -not $useDcom) { $sa.Port = [uint32]$port }
        $session = New-CimSession @sa
        $cim.CimSession = $session
      }
      $info = Get-TargetInfo -Target $t -Cim $cim -IsLocal $isLocal
      $results.Add($info)
    } catch {
      $results.Add([pscustomobject]@{ name = $t; ok = $false; error = (Format-Error $_) })
    } finally {
      if ($session) {
        try { Remove-CimSession -CimSession $session } catch { }
      }
    }
  }

  Write-JsonOutput ([pscustomobject]@{
      version = 1
      ps      = $PSVersionTable.PSVersion.ToString()
      targets = $results.ToArray()
    })
} catch {
  Write-JsonOutput ([pscustomobject]@{
      version = 1
      error   = (Format-Error $_)
      targets = $results.ToArray()
    })
  exit 1
}
