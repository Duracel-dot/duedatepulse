# Simulations des cmdlets CIM / Hyper-V pour executer windows.ps1 et hyperv.ps1 sans
# infrastructure (test/ps-integration.test.js). Les fonctions globales masquent les cmdlets.
# Usage : . .\test\fixtures\ps-mocks.ps1 ; & .\scripts\ps\hyperv.ps1
# Fichier en ASCII pur : les accents sont produits par [char].

$global:SngMockEacute = [string][char]0xE9
$global:SngMockBoot = New-Object DateTime 2025, 9, 20, 6, 0, 0, ([DateTimeKind]::Utc)

function global:New-CimSessionOption { param($Protocol, [switch]$UseSsl) if ($UseSsl) { 'ssl' } else { 'opt' } }
function global:Remove-CimSession { param($CimSession) }
function global:New-CimSession {
  [CmdletBinding()] param($ComputerName, $Credential, $OperationTimeoutSec, $SessionOption, $Port)
  if ($ComputerName -like 'down*') { throw ("WinRM ne peut pas terminer l'op" + $global:SngMockEacute + "ration sur " + $ComputerName) }
  if ($env:SNG_MOCK_EXPECT_SSL -and ($SessionOption -ne 'ssl' -or $Port -ne 5986)) { throw ('session attendue en HTTPS sur 5986, recu ' + $SessionOption + ' / ' + $Port) }
  New-Object PSObject -Property @{ ComputerName = $ComputerName }
}

function global:Get-CimInstance {
  [CmdletBinding()] param($ClassName, $Namespace, $Filter, $Property, $CimSession, $OperationTimeoutSec)
  switch ($ClassName) {
    'Win32_ComputerSystem' {
      [pscustomobject]@{ Name = 'SRV01'; DNSHostName = 'srv01'; Domain = 'corp.local'; PartOfDomain = $true
        Manufacturer = 'Dell Inc.'; Model = 'PowerEdge R740'; TotalPhysicalMemory = [uint64]68719476736; NumberOfLogicalProcessors = [uint32]16 }
    }
    'Win32_OperatingSystem' {
      [pscustomobject]@{ Caption = 'Microsoft Windows Server 2019 Standard'; Version = '10.0.17763'
        LastBootUpTime = $global:SngMockBoot; LocalDateTime = $global:SngMockBoot.AddSeconds(7200)
        FreePhysicalMemory = [uint64]16777216; TotalVisibleMemorySize = [uint64]67108864 }
    }
    'Win32_BIOS' { [pscustomobject]@{ SerialNumber = 'ABC1234' } }
    'Win32_ComputerSystemProduct' { [pscustomobject]@{ UUID = '4C4C4544-0058-4B10-8032-B7C04F513533' } }
    'Win32_Processor' {
      [pscustomobject]@{ LoadPercentage = [uint16]20 }
      [pscustomobject]@{ LoadPercentage = [uint16]31 }
      [pscustomobject]@{ LoadPercentage = $null }
    }
    'Win32_PerfFormattedData_HvStats_HyperVHypervisorLogicalProcessor' { throw 'Classe non valide' }
    'Win32_LogicalDisk' { [pscustomobject]@{ DeviceID = 'C:'; VolumeName = ('Syst' + [char]0xE8 + 'me'); Size = [uint64]100000000000; FreeSpace = [uint64]5000000000 } }
    'Win32_NetworkAdapterConfiguration' {
      [pscustomobject]@{ Description = 'Intel NIC'; MACAddress = '24:6E:96:12:34:56'; IPAddress = @('10.0.0.5', 'fe80::1') }
    }
    'Win32_Service' {
      [pscustomobject]@{ Name = 'W32Time'; DisplayName = 'Temps Windows'; State = 'Stopped'; ExitCode = [uint32]1067; DelayedAutoStart = $false }
      [pscustomobject]@{ Name = 'sppsvc'; DisplayName = 'x'; State = 'Stopped'; ExitCode = [uint32]0; DelayedAutoStart = $true }
      [pscustomobject]@{ Name = 'CDPUserSvc_4f2c1'; DisplayName = 'x'; State = 'Stopped'; ExitCode = [uint32]0; DelayedAutoStart = $false }
      [pscustomobject]@{ Name = 'BITS'; DisplayName = 'x'; State = 'Stopped'; ExitCode = [uint32]0; DelayedAutoStart = $true }
      [pscustomobject]@{ Name = 'MonService'; DisplayName = 'x'; State = 'Stopped'; ExitCode = [uint32]1; DelayedAutoStart = $false }
    }
    'MSFT_NetTCPConnection' {
      [pscustomobject]@{ State = [byte]2; LocalAddress = '0.0.0.0'; LocalPort = [uint16]1433; RemoteAddress = '0.0.0.0'; RemotePort = [uint16]0; OwningProcess = [uint32]1200 }
      [pscustomobject]@{ State = [byte]5; LocalAddress = '10.0.0.5'; LocalPort = [uint16]1433; RemoteAddress = '10.0.0.9'; RemotePort = [uint16]50001; OwningProcess = [uint32]1200 }
      [pscustomobject]@{ State = [byte]5; LocalAddress = '127.0.0.1'; LocalPort = [uint16]5000; RemoteAddress = '127.0.0.1'; RemotePort = [uint16]50002; OwningProcess = [uint32]1200 }
      [pscustomobject]@{ State = [byte]5; LocalAddress = '10.0.0.5'; LocalPort = [uint16]49800; RemoteAddress = '10.0.0.1'; RemotePort = [uint16]389; OwningProcess = [uint32]700 }
    }
    'Win32_Process' {
      [pscustomobject]@{ ProcessId = [uint32]1200; Name = 'sqlservr.exe' }
      [pscustomobject]@{ ProcessId = [uint32]700; Name = 'lsass.exe' }
    }
    'MSCluster_Cluster' { [pscustomobject]@{ Name = 'CL01' } }
    'Msvm_VirtualSystemSettingData' {
      [pscustomobject]@{ VirtualSystemIdentifier = 'B3A1C9D2-7E4F-4A6B-8C1D-2E3F4A5B6C7D'
        BIOSGUID = '{D5B6F8E2-1C3A-4E5B-9A7D-2F4E6C8A0B1D}'; BIOSSerialNumber = '5175-2891-3316-8812-9460-3517-24' }
    }
    'Msvm_KvpExchangeComponent' {
      $fqdn = '<INSTANCE CLASSNAME="Msvm_KvpExchangeDataItem"><PROPERTY NAME="Caption" PROPAGATED="true" TYPE="string"></PROPERTY>' +
        '<PROPERTY NAME="Data" TYPE="string"><VALUE>srv-web01.corp.local</VALUE></PROPERTY>' +
        '<PROPERTY NAME="Name" TYPE="string"><VALUE>FullyQualifiedDomainName</VALUE></PROPERTY>' +
        '<PROPERTY NAME="Source" TYPE="uint16"><VALUE>2</VALUE></PROPERTY></INSTANCE>'
      $osName = '<INSTANCE CLASSNAME="Msvm_KvpExchangeDataItem"><PROPERTY NAME="Data" TYPE="string"><VALUE>Windows Server 2022 Datacenter</VALUE></PROPERTY>' +
        '<PROPERTY NAME="Name" TYPE="string"><VALUE>OSName</VALUE></PROPERTY></INSTANCE>'
      $other = '<INSTANCE CLASSNAME="Msvm_KvpExchangeDataItem"><PROPERTY NAME="Data" TYPE="string"><VALUE>9</VALUE></PROPERTY>' +
        '<PROPERTY NAME="Name" TYPE="string"><VALUE>ProcessorArchitecture</VALUE></PROPERTY></INSTANCE>'
      [pscustomobject]@{ SystemName = 'B3A1C9D2-7E4F-4A6B-8C1D-2E3F4A5B6C7D'; GuestIntrinsicExchangeItems = @($fqdn, $osName, $other, 'pas du xml') }
      [pscustomobject]@{ SystemName = 'C4D5E6F7-0A1B-4C2D-9E3F-405162738495'; GuestIntrinsicExchangeItems = $null }
    }
    default { throw ('classe inattendue ' + $ClassName) }
  }
}

function global:Import-Module { [CmdletBinding()] param($Name) if ($env:SNG_MOCK_NO_HYPERV) { throw ('module ' + $Name + ' introuvable') } }
function global:Get-VMHost {
  [CmdletBinding()] param($CimSession, $ComputerName)
  [pscustomobject]@{ LogicalProcessorCount = 64; MemoryCapacity = [int64]549755813888; FullyQualifiedDomainName = 'hv01.corp.local' }
}
function global:Get-VMSwitch {
  [CmdletBinding()] param($CimSession, $ComputerName)
  [pscustomobject]@{ Name = 'vSwitch-LAN'; SwitchType = 'External'; NetAdapterInterfaceDescription = 'NIC' }
}
function global:Get-VM {
  [CmdletBinding()] param($CimSession, $ComputerName)
  [pscustomobject]@{ Name = 'SRV-WEB01'; VMId = [guid]'b3a1c9d2-7e4f-4a6b-8c1d-2e3f4a5b6c7d'; State = 'Running'
    Status = 'Operating normally'; OperationalStatus = @('Ok'); CPUUsage = 7; MemoryAssigned = [int64]8589934592
    MemoryDemand = [int64]6442450944; MemoryStartup = [int64]4294967296; DynamicMemoryEnabled = $true; ProcessorCount = 4
    Uptime = [timespan]::FromSeconds(518400); Generation = 2; Version = '9.0'; ReplicationState = 'Disabled'
    ReplicationHealth = 'NotApplicable'; ReplicationMode = 'None'; IntegrationServicesState = 'Up to date'; IsClustered = $true }
  [pscustomobject]@{ Name = 'SRV-APP02'; VMId = [guid]'c4d5e6f7-0a1b-4c2d-9e3f-405162738495'; State = 'Off'
    Status = 'Operating normally'; OperationalStatus = $null; CPUUsage = 0; MemoryAssigned = [int64]0
    MemoryDemand = [int64]0; MemoryStartup = [int64]4294967296; DynamicMemoryEnabled = $false; ProcessorCount = 2
    Uptime = [timespan]::Zero; Generation = 2; Version = '9.0'; ReplicationState = 'Disabled'
    ReplicationHealth = 'NotApplicable'; ReplicationMode = 'None'; IntegrationServicesState = $null; IsClustered = $false }
}
function global:Get-VMNetworkAdapter {
  [CmdletBinding()] param([switch]$All, $CimSession, $ComputerName)
  [pscustomobject]@{ IsManagementOs = $true; VMId = $null; Name = 'Mgmt'; MacAddress = '00155D010A00'; SwitchName = 'vSwitch-LAN'
    IPAddresses = @('10.10.1.11'); VlanSetting = $null }
  [pscustomobject]@{ IsManagementOs = $false; VMId = [guid]'b3a1c9d2-7e4f-4a6b-8c1d-2e3f4a5b6c7d'; Name = 'LAN'; MacAddress = '00155D0A1B01'
    SwitchName = 'vSwitch-LAN'; IPAddresses = @('10.10.30.21', 'fe80::1'); VlanSetting = [pscustomobject]@{ OperationMode = 'Access'; AccessVlanId = 30 } }
  [pscustomobject]@{ IsManagementOs = $false; VMId = [guid]'c4d5e6f7-0a1b-4c2d-9e3f-405162738495'; Name = 'LAN'; MacAddress = '00155D0A1B02'
    SwitchName = 'vSwitch-LAN'; IPAddresses = $null; VlanSetting = [pscustomobject]@{ OperationMode = 'Untagged'; AccessVlanId = 0 } }
}
