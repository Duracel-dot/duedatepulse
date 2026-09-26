# SupervisionNG - hotes Hyper-V : materiel (CIM), hyperviseur, commutateurs virtuels et VM.
# Cibles distantes : CIM/WinRM (module Hyper-V 2.0 : -CimSession) ; 'localhost' / nom local : en local.
#
# Parametres (JSON dans la variable d'environnement SNG_PARAMS) :
#   targets      : noms des hotes Hyper-V
#   opTimeoutSec : delai max par requete CIM (defaut 20)
#   vlan         : $false pour ne pas lire le VLAN des cartes des VM (defaut $true)
#   kvp          : $false pour ne pas lire les donnees invitees KVP (defaut $true)
#   port / useSsl : port WinRM et HTTPS (defaut 5985 sans SSL)
# Identifiants optionnels : SNG_USER / SNG_PASS (ignores pour la machine locale).
# Sortie : UN document JSON { version, targets: [ { name, ok, error?, vms: [...] } ] } sur stdout.
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

# JSON compact ; caracteres non ASCII echappes en \uXXXX (independant de l'encodage de la console).
# Profondeur 10 : targets[] > hote > vms[] > vm > Adapters[] > carte > IPAddresses[] (les tableaux comptent)
function Write-JsonOutput($Object) {
  $json = ConvertTo-Json -InputObject $Object -Depth 10 -Compress
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

# Donnees invitees KVP (nom DNS, OS) indexees par VMId
function Get-KvpData([hashtable]$Cim) {
  $map = @{}
  $wanted = @('FullyQualifiedDomainName', 'OSName', 'OSVersion')
  foreach ($k in @(Get-CimInstance @Cim -Namespace 'root/virtualization/v2' -ClassName Msvm_KvpExchangeComponent)) {
    $g = @{}
    foreach ($xmlText in @($k.GuestIntrinsicExchangeItems | Where-Object { $_ })) {
      try {
        $x = [xml]$xmlText
        $n = $null
        $d = $null
        foreach ($prop in @($x.INSTANCE.PROPERTY)) {
          if ($prop.NAME -eq 'Name') { $n = [string]$prop.VALUE }
          elseif ($prop.NAME -eq 'Data') { $d = [string]$prop.VALUE }
        }
        if ($n -and ($wanted -contains $n)) { $g[$n] = $d }
      } catch { }
    }
    if ($g.Count -gt 0) { $map[([string]$k.SystemName).ToLowerInvariant()] = [pscustomobject]$g }
  }
  return $map
}

# GUID et numero de serie BIOS des VM (= UUID / numero de serie vus depuis l'invite)
function Get-VmBiosData([hashtable]$Cim) {
  $map = @{}
  $filter = "VirtualSystemType = 'Microsoft:Hyper-V:System:Realized'"
  foreach ($s in @(Get-CimInstance @Cim -Namespace 'root/virtualization/v2' -ClassName Msvm_VirtualSystemSettingData -Filter $filter)) {
    $map[([string]$s.VirtualSystemIdentifier).ToLowerInvariant()] = [pscustomobject]@{
      BiosGuid   = [string]$s.BIOSGUID
      BiosSerial = [string]$s.BIOSSerialNumber
    }
  }
  return $map
}

function Get-ClusterName([string]$Target, [hashtable]$Cim, [bool]$IsLocal) {
  try {
    $cl = Get-CimInstance @Cim -Namespace 'root/MSCluster' -ClassName MSCluster_Cluster | Select-Object -First 1
    if ($cl -and $cl.Name) { return [string]$cl.Name }
    return $null
  } catch {
    # espace de noms absent : pas de cluster sur cet hote
    if ([string]$_.Exception.NativeErrorCode -eq 'InvalidNamespace') { return $null }
  }
  if (-not $script:HasGetCluster) { return $null }
  if (-not $IsLocal -and $script:Cred) { return $null }
  try {
    $c2 = $null
    if ($IsLocal) { $c2 = Get-Cluster -ErrorAction Stop } else { $c2 = Get-Cluster -Name $Target -ErrorAction Stop }
    if ($c2) { return [string]$c2.Name }
  } catch { }
  return $null
}

function Get-HostInfo([string]$Target, [hashtable]$Cim, [hashtable]$Hv, [bool]$IsLocal) {
  $errs = [System.Collections.Generic.List[string]]::new()

  # Obligatoires : une erreur ici rend l'hote injoignable
  $cs = Get-CimInstance @Cim -ClassName Win32_ComputerSystem | Select-Object -First 1
  $os = Get-CimInstance @Cim -ClassName Win32_OperatingSystem | Select-Object -First 1

  $bios = $null
  try { $bios = Get-CimInstance @Cim -ClassName Win32_BIOS | Select-Object -First 1 } catch { $errs.Add('bios: ' + (Format-Error $_)) }
  $prod = $null
  try { $prod = Get-CimInstance @Cim -ClassName Win32_ComputerSystemProduct | Select-Object -First 1 } catch { $errs.Add('product: ' + (Format-Error $_)) }

  # CPU : temps d'execution de l'hyperviseur (toutes partitions), sinon charge de la partition parente
  $cpuLoad = $null
  try {
    $hvp = Get-CimInstance @Cim -ClassName Win32_PerfFormattedData_HvStats_HyperVHypervisorLogicalProcessor -Filter "Name='_Total'" | Select-Object -First 1
    if ($hvp -and $null -ne $hvp.PercentTotalRunTime) { $cpuLoad = [double]$hvp.PercentTotalRunTime }
  } catch { }
  if ($null -eq $cpuLoad) {
    try {
      $loads = @(Get-CimInstance @Cim -ClassName Win32_Processor | Where-Object { $null -ne $_.LoadPercentage } | ForEach-Object { [double]$_.LoadPercentage })
      if ($loads.Count -gt 0) { $cpuLoad = [math]::Round(($loads | Measure-Object -Average).Average, 1) }
    } catch { $errs.Add('cpu: ' + (Format-Error $_)) }
  }

  $uptime = $null
  if ($os.LocalDateTime -is [datetime] -and $os.LastBootUpTime -is [datetime]) {
    $uptime = [int64](($os.LocalDateTime - $os.LastBootUpTime).TotalSeconds)
  }

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

  $cluster = Get-ClusterName -Target $Target -Cim $Cim -IsLocal $IsLocal

  # Partie Hyper-V : une erreur ici n'empeche pas de publier le materiel
  $hvError = $null
  $vmhost = $null
  $switches = @()
  $vmList = [System.Collections.Generic.List[object]]::new()
  if (-not $script:HvModuleOk) {
    $hvError = $script:HvModuleError
  } else {
    try {
      $vh = Get-VMHost @Hv
      $vmhost = [pscustomobject]@{
        LogicalProcessorCount    = $vh.LogicalProcessorCount
        MemoryCapacity           = $vh.MemoryCapacity
        FullyQualifiedDomainName = [string]$vh.FullyQualifiedDomainName
      }

      $switches = @(Get-VMSwitch @Hv | ForEach-Object {
          [pscustomobject]@{
            Name                           = [string]$_.Name
            SwitchType                     = [string]$_.SwitchType
            NetAdapterInterfaceDescription = [string]$_.NetAdapterInterfaceDescription
          }
        })

      $vms = @(Get-VM @Hv)

      # Cartes reseau des VM, indexees par VMId
      $adByVm = @{}
      try {
        foreach ($a in @(Get-VMNetworkAdapter -All @Hv)) {
          if ($a.IsManagementOs) { continue }
          $key = ([string]$a.VMId).ToLowerInvariant()
          if (-not $adByVm.ContainsKey($key)) { $adByVm[$key] = [System.Collections.Generic.List[object]]::new() }
          $vlanMode = $null
          $vlanId = $null
          if ($script:WantVlan) {
            try {
              $vs = $a.VlanSetting
              if ($vs) {
                $vlanMode = [string]$vs.OperationMode
                if ($vs.AccessVlanId) { $vlanId = [int]$vs.AccessVlanId }
              }
            } catch { }
          }
          $adByVm[$key].Add([pscustomobject]@{
              Name        = [string]$a.Name
              MacAddress  = [string]$a.MacAddress
              SwitchName  = [string]$a.SwitchName
              IPAddresses = @($a.IPAddresses | Where-Object { $_ } | ForEach-Object { [string]$_ })
              VlanMode    = $vlanMode
              VlanId      = $vlanId
            })
        }
      } catch { $errs.Add('adapters: ' + (Format-Error $_)) }

      $biosMap = @{}
      try { $biosMap = Get-VmBiosData -Cim $Cim } catch { $errs.Add('vmbios: ' + (Format-Error $_)) }
      $kvpMap = @{}
      if ($script:WantKvp) {
        try { $kvpMap = Get-KvpData -Cim $Cim } catch { $errs.Add('kvp: ' + (Format-Error $_)) }
      }

      foreach ($vm in $vms) {
        $id = ([string]$vm.VMId).ToLowerInvariant()
        $adapters = @()
        if ($adByVm.ContainsKey($id)) { $adapters = $adByVm[$id].ToArray() }
        $biosGuid = $null
        $biosSerial = $null
        if ($biosMap.ContainsKey($id)) {
          $biosGuid = $biosMap[$id].BiosGuid
          $biosSerial = $biosMap[$id].BiosSerial
        }
        $guest = $null
        if ($kvpMap.ContainsKey($id)) { $guest = $kvpMap[$id] }
        $up = $null
        if ($vm.Uptime -is [timespan]) { $up = [int64]$vm.Uptime.TotalSeconds }
        $opStatus = @($vm.OperationalStatus | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ })

        $vmList.Add([pscustomobject]@{
            Name                     = [string]$vm.Name
            VMId                     = $id
            State                    = [string]$vm.State
            Status                   = [string]$vm.Status
            OperationalStatus        = $opStatus
            CPUUsage                 = $vm.CPUUsage
            MemoryAssigned           = $vm.MemoryAssigned
            MemoryDemand             = $vm.MemoryDemand
            MemoryStartup            = $vm.MemoryStartup
            DynamicMemoryEnabled     = [bool]$vm.DynamicMemoryEnabled
            ProcessorCount           = $vm.ProcessorCount
            UptimeS                  = $up
            Generation               = $vm.Generation
            Version                  = [string]$vm.Version
            ReplicationState         = [string]$vm.ReplicationState
            ReplicationHealth        = [string]$vm.ReplicationHealth
            ReplicationMode          = [string]$vm.ReplicationMode
            IntegrationServicesState = [string]$vm.IntegrationServicesState
            IsClustered              = [bool]$vm.IsClustered
            BiosGuid                 = $biosGuid
            BiosSerial               = $biosSerial
            Guest                    = $guest
            Adapters                 = $adapters
          })
      }
    } catch {
      $hvError = Format-Error $_
    }
  }

  $biosSerialNumber = $null
  if ($bios) { $biosSerialNumber = [string]$bios.SerialNumber }
  $uuid = $null
  if ($prod) { $uuid = [string]$prod.UUID }

  $info = [pscustomobject]@{
    name     = $Target
    ok       = $true
    local    = $IsLocal
    cs       = [pscustomobject]@{
      Name                      = [string]$cs.Name
      DNSHostName               = [string]$cs.DNSHostName
      Domain                    = [string]$cs.Domain
      PartOfDomain              = [bool]$cs.PartOfDomain
      Manufacturer              = [string]$cs.Manufacturer
      Model                     = [string]$cs.Model
      TotalPhysicalMemory       = $cs.TotalPhysicalMemory
      NumberOfLogicalProcessors = $cs.NumberOfLogicalProcessors
    }
    bios     = [pscustomobject]@{ SerialNumber = $biosSerialNumber }
    product  = [pscustomobject]@{ UUID = $uuid }
    os       = [pscustomobject]@{
      Caption                = [string]$os.Caption
      Version                = [string]$os.Version
      LastBootUpTime         = $os.LastBootUpTime
      FreePhysicalMemory     = $os.FreePhysicalMemory
      TotalVisibleMemorySize = $os.TotalVisibleMemorySize
    }
    uptimeS  = $uptime
    cpuLoad  = $cpuLoad
    nics     = $nics
    cluster  = $cluster
    vmhost   = $vmhost
    switches = $switches
    vms      = $vmList.ToArray()
    hvError  = $hvError
    errors   = $errs.ToArray()
  }
  return $info
}

$results = [System.Collections.Generic.List[object]]::new()
try {
  $p = $null
  if ($env:SNG_PARAMS) { $p = $env:SNG_PARAMS | ConvertFrom-Json }
  if ($null -eq $p) { $p = New-Object PSObject }

  $script:Cred = $null
  if ($env:SNG_USER) {
    $sec = New-Object System.Security.SecureString
    if ($env:SNG_PASS) { $sec = ConvertTo-SecureString $env:SNG_PASS -AsPlainText -Force }
    $script:Cred = New-Object System.Management.Automation.PSCredential($env:SNG_USER, $sec)
  }

  $targets = @($p.targets | Where-Object { $_ } | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  $opTimeout = 20
  if ($p.opTimeoutSec) { $opTimeout = [int]$p.opTimeoutSec }
  $script:WantVlan = ($p.vlan -ne $false)
  $script:WantKvp = ($p.kvp -ne $false)
  $useSsl = [bool]$p.useSsl
  $port = 0
  if ($p.port) { $port = [int]$p.port }

  # Module Hyper-V (RSAT-Hyper-V-Tools) : 2.0 accepte -CimSession, 1.1 seulement -ComputerName
  $script:HvModuleOk = $false
  $script:HvModuleError = $null
  $hvHasCim = $false
  try {
    Import-Module Hyper-V -ErrorAction Stop -WarningAction SilentlyContinue
    $cmd = Get-Command Get-VM -ErrorAction Stop
    $hvHasCim = $cmd.Parameters.ContainsKey('CimSession')
    $script:HvModuleOk = $true
  } catch {
    $script:HvModuleError = 'Module PowerShell Hyper-V indisponible (installer RSAT-Hyper-V-Tools) : ' + (Format-Error $_)
  }
  $script:HasGetCluster = $false
  if (Get-Command Get-Cluster -ErrorAction SilentlyContinue) { $script:HasGetCluster = $true }

  foreach ($t in $targets) {
    $session = $null
    try {
      $isLocal = Test-LocalTarget $t
      $cim = @{ OperationTimeoutSec = $opTimeout }
      $hv = @{}
      if (-not $isLocal) {
        $sa = @{ ComputerName = $t; OperationTimeoutSec = $opTimeout }
        if ($script:Cred) { $sa.Credential = $script:Cred }
        if ($useSsl) { $sa.SessionOption = New-CimSessionOption -UseSsl }
        if ($port -gt 0) { $sa.Port = [uint32]$port }
        $session = New-CimSession @sa
        $cim.CimSession = $session
        if ($hvHasCim) { $hv.CimSession = $session } else { $hv.ComputerName = $t }
      }
      $info = Get-HostInfo -Target $t -Cim $cim -Hv $hv -IsLocal $isLocal
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
