<#
.SYNOPSIS
  Remi on the APEX server: install, update, start, stop and check it.

.DESCRIPTION
  Remi runs on this Windows computer as a background task that starts with Windows. Two shapes:
    behind APEX's proxy (install -PublicUrl https://apex.example.com/remi): Remi listens on
      127.0.0.1 only and IIS forwards https://.../remi/ to it; no firewall port (ADR-0013);
    server mode (install without -PublicUrl): other computers open http://<this computer>:8765/
      through a firewall port (ADR-0012).
  The .bat files beside this script are double-click shortcuts for the commands below.
  The full guide is docs/deploy/APEX.md in the Remi repository.

  Layout (default C:\Remi):
    releases\<version>\   each installed version (Python, dependencies, backend, dashboard)
    current.txt           the version that runs; previous.txt, the one before (rollback)
    server.env            Remi's settings on this server (port, names, data folder)
    data\                 Remi's database, charts and backups (kept across updates)
    logs\                 remi.log (the server's log), service.log (starts and stops)

  Commands:
    install    first install from an unzipped bundle (run as administrator);
               -PublicUrl <address> installs behind APEX's proxy
    update     download the latest release from GitHub and switch to it (-Zip <file> to
               install a zip you downloaded yourself; -Force to reinstall the same version)
    rollback   go back to the version before the last update
    start | stop | restart | status
    uninstall  remove the task, the firewall rule and the program (keeps data\)
    run        what the startup task runs: Remi in the foreground, restarted if it stops

  Keep this file plain ASCII: Windows PowerShell 5.1 reads it in the ANSI code page.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'update', 'rollback', 'start', 'stop', 'restart', 'status', 'uninstall', 'run')]
  [string] $Command = 'status',
  [string] $InstallDir = 'C:\Remi',
  [int] $Port = 8765,
  [string] $Zip = '',
  [string] $Repo = 'justinstoddart1217/remi',
  [string] $PublicUrl = '',
  [switch] $Force
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Remi'
$FirewallGroup = 'Remi'
$AssetPattern = 'remi-*-windows.zip'
$HealthTimeoutSeconds = 90

# Which parameters were given (functions have their own $PSBoundParameters).
$PortGiven = $PSBoundParameters.ContainsKey('Port')
$RepoGiven = $PSBoundParameters.ContainsKey('Repo')

# Installed copies of this script live in the install folder, beside server.env.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PSBoundParameters.ContainsKey('InstallDir') -and (Test-Path -LiteralPath (Join-Path $ScriptDir 'server.env'))) {
  $InstallDir = $ScriptDir
}
$ReleasesDir = Join-Path $InstallDir 'releases'
$DataDir = Join-Path $InstallDir 'data'
$LogDir = Join-Path $InstallDir 'logs'
$EnvFile = Join-Path $InstallDir 'server.env'
$CurrentFile = Join-Path $InstallDir 'current.txt'
$PreviousFile = Join-Path $InstallDir 'previous.txt'
$TokenFile = Join-Path $InstallDir 'github-token.dat'
$PidFile = Join-Path $LogDir 'remi.pid'
$ServiceLog = Join-Path $LogDir 'service.log'
$LocalServiceSid = 'S-1-5-19'

# ------------------------------------------------------------------ helpers
function Say([string] $Message) { Write-Host $Message }

function Fail([string] $Message) {
  Write-Host ''
  Write-Host "Remi: $Message" -ForegroundColor Red
  exit 1
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin {
  if (-not (Test-Admin)) {
    Fail 'this needs administrator rights. Right-click the .bat file and choose "Run as administrator".'
  }
}

function Assert-Installed {
  if (-not (Test-Path -LiteralPath $CurrentFile)) {
    Fail "Remi is not installed in $InstallDir. Run install-remi.bat from the unzipped bundle first."
  }
}

function Read-ServerEnv {
  $values = [ordered]@{}
  if (Test-Path -LiteralPath $EnvFile) {
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
      $text = $line.Trim()
      if ($text -eq '' -or $text.StartsWith('#')) { continue }
      $at = $text.IndexOf('=')
      if ($at -lt 1) { continue }
      $values[$text.Substring(0, $at).Trim()] = $text.Substring($at + 1).Trim()
    }
  }
  return $values
}

function Get-ServerPort {
  $values = Read-ServerEnv
  if ($values.Contains('REMI_PORT') -and $values['REMI_PORT'] -match '^\d+$') { return [int] $values['REMI_PORT'] }
  return 8765
}

function Get-UpdateRepo {
  $values = Read-ServerEnv
  if (-not $RepoGiven -and $values.Contains('REMI_UPDATE_REPO') -and $values['REMI_UPDATE_REPO']) {
    return $values['REMI_UPDATE_REPO']
  }
  return $Repo
}

function Get-PublicUrl {
  $values = Read-ServerEnv
  if ($values.Contains('REMI_PUBLIC_URL') -and $values['REMI_PUBLIC_URL']) { return $values['REMI_PUBLIC_URL'].TrimEnd('/') }
  return ''
}

function Test-NetworkMode {
  $values = Read-ServerEnv
  return ($values.Contains('REMI_NETWORK') -and @('1', 'true', 'yes', 'on') -contains $values['REMI_NETWORK'].ToLower())
}

function Get-DataDir {
  $values = Read-ServerEnv
  if ($values.Contains('REMI_DATA_DIR') -and $values['REMI_DATA_DIR']) { return $values['REMI_DATA_DIR'] }
  return $DataDir
}

function Get-Version([string] $Path) {
  $file = Join-Path $Path 'VERSION'
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  return (Get-Content -LiteralPath $file -TotalCount 1).Trim()
}

function Get-CurrentVersion {
  if (-not (Test-Path -LiteralPath $CurrentFile)) { return $null }
  return (Get-Content -LiteralPath $CurrentFile -TotalCount 1).Trim()
}

function Get-PreviousVersion {
  if (-not (Test-Path -LiteralPath $PreviousFile)) { return $null }
  return (Get-Content -LiteralPath $PreviousFile -TotalCount 1).Trim()
}

function Write-Ascii([string] $Path, [string] $Text) {
  [IO.File]::WriteAllText($Path, $Text, [Text.Encoding]::ASCII)
}

function Write-ServiceLog([string] $Message) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $ServiceLog -Value "$stamp  $Message" -Encoding ASCII
}

function Get-MachineUrls([int] $ServerPort) {
  $urls = @("http://$($env:COMPUTERNAME.ToLower()):$ServerPort/")
  try {
    $fqdn = [Net.Dns]::GetHostEntry('').HostName.ToLower()
    if ($fqdn -and $fqdn -ne $env:COMPUTERNAME.ToLower()) { $urls += "http://${fqdn}:$ServerPort/" }
  } catch { }
  return $urls
}

function Get-LocalServiceName {
  return (New-Object Security.Principal.SecurityIdentifier($LocalServiceSid)).Translate([Security.Principal.NTAccount]).Value
}

# ------------------------------------------------------------------ health
function Get-Health([int] $ServerPort) {
  # Straight to loopback, never through a proxy.
  try {
    $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$ServerPort/api/health")
    $request.Proxy = $null
    $request.Timeout = 3000
    $response = $request.GetResponse()
    $reader = New-Object IO.StreamReader($response.GetResponseStream())
    $body = $reader.ReadToEnd()
    $response.Close()
    $health = $body | ConvertFrom-Json
    if ($health.app -eq 'remi') { return $health }
  } catch { }
  return $null
}

function Wait-Healthy([int] $ServerPort, [string] $Version) {
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $health = Get-Health $ServerPort
    if ($health -and (-not $Version -or $health.version -eq $Version)) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Show-LogTail {
  $log = Join-Path $LogDir 'remi.log'
  if (Test-Path -LiteralPath $log) {
    Say ''
    Say "The end of $log :"
    Get-Content -LiteralPath $log -Tail 25 | ForEach-Object { Say "  $_" }
  }
}

# ------------------------------------------------------------------ run (the startup task)
function Invoke-Run {
  $values = Read-ServerEnv
  foreach ($key in $values.Keys) {
    if ($key -like 'REMI_*') { Set-Item -Path "env:$key" -Value $values[$key] }
  }
  if (-not $env:REMI_DATA_DIR) { $env:REMI_DATA_DIR = $DataDir }
  $env:PYTHONUTF8 = '1'
  $env:PYTHONUNBUFFERED = '1'
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:PYTHONNOUSERSITE = '1'
  Remove-Item -Path env:PYTHONHOME -ErrorAction SilentlyContinue
  $log = Join-Path $LogDir 'remi.log'
  $out = Join-Path $LogDir 'remi.out.log'
  # Never give up: a stopped or failed Remi is started again, and a problem is logged.
  while ($true) {
    try {
      $version = Get-CurrentVersion
      $release = Join-Path $ReleasesDir "$version"
      $python = Join-Path $release 'python\python.exe'
      if (-not $version -or -not (Test-Path -LiteralPath $python)) {
        Write-ServiceLog "No Remi at $release; trying again in 60 seconds."
        Start-Sleep -Seconds 60
        continue
      }
      $env:PYTHONPATH = Join-Path $release 'site-packages'
      if (Test-Path -LiteralPath $log) {
        Move-Item -LiteralPath $log -Destination (Join-Path $LogDir 'remi.previous.log') -Force -ErrorAction SilentlyContinue
      }
      Write-ServiceLog "Starting Remi $version."
      $process = Start-Process -FilePath $python -ArgumentList @('-m', 'app.main', '--no-browser') `
        -WorkingDirectory (Join-Path $release 'backend') -RedirectStandardError $log -RedirectStandardOutput $out `
        -NoNewWindow -PassThru
      $null = $process.Handle  # keeps ExitCode readable after the process ends
      Write-Ascii $PidFile "$($process.Id)"
      $process.WaitForExit()
      Write-ServiceLog "Remi stopped (exit code $($process.ExitCode)); starting it again in 10 seconds."
      Start-Sleep -Seconds 10
    } catch {
      try { Write-ServiceLog "Could not run Remi: $($_.Exception.Message). Trying again in 30 seconds." } catch { }
      Start-Sleep -Seconds 30
    }
  }
}

# ------------------------------------------------------------------ start and stop
function Stop-Remi {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName | Out-Null }
  if (Test-Path -LiteralPath $PidFile) {
    $id = (Get-Content -LiteralPath $PidFile -TotalCount 1).Trim()
    if ($id -match '^\d+$') {
      $process = Get-Process -Id ([int] $id) -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -eq 'python') { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }
  # Anything of Remi's still listening (never another program on the same port).
  $serverPort = Get-ServerPort
  for ($i = 0; $i -lt 20; $i++) {
    $owners = @(Get-NetTCPConnection -LocalPort $serverPort -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -eq 0) { return }
    foreach ($owner in $owners) {
      $process = Get-Process -Id $owner -ErrorAction SilentlyContinue
      if ($process -and $process.Path -and $process.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
      } elseif ($process) {
        Fail "port $serverPort is used by another program ($($process.ProcessName)). Change REMI_PORT in $EnvFile."
      }
    }
    Start-Sleep -Milliseconds 500
  }
}

function Start-Remi {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Fail "the '$TaskName' startup task is missing. Run install-remi.bat again." }
  Start-ScheduledTask -TaskName $TaskName | Out-Null
}

function Invoke-StartAndCheck([string] $Version) {
  Start-Remi
  $serverPort = Get-ServerPort
  Say "Waiting for Remi to answer on port $serverPort ..."
  return (Wait-Healthy $serverPort $Version)
}

function Show-Running {
  $serverPort = Get-ServerPort
  $publicUrl = Get-PublicUrl
  Say ''
  if ($publicUrl -and -not (Test-NetworkMode)) {
    Say "Remi $(Get-CurrentVersion) is running behind the proxy. Open it from your laptop at:"
    Say "  $publicUrl/"
    Say "(It listens on 127.0.0.1:$serverPort only; IIS forwards $publicUrl/ to it.)"
    Say ''
    Say "There is no sign-in: anyone who can open $publicUrl/ can use Remi."
    return
  }
  Say "Remi $(Get-CurrentVersion) is running. Open it from your laptop at:"
  foreach ($url in Get-MachineUrls $serverPort) { Say "  $url" }
  Say ''
  Say 'There is no sign-in: anyone on the network who can reach this port can use Remi.'
}

# ------------------------------------------------------------------ install a release
function Copy-Release([string] $Bundle, [string] $Version) {
  $target = Join-Path $ReleasesDir $Version
  if (Test-Path -LiteralPath $target) {
    if ((Get-CurrentVersion) -eq $Version) { Stop-Remi }
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Say "Copying Remi $Version into $target ..."
  & robocopy.exe $Bundle $target /E /NFL /NDL /NJH /NJS /NP /R:2 /W:2 | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "could not copy the bundle into $target (robocopy exit $LASTEXITCODE)." }
  # Files unzipped by Explorer carry an 'Internet' mark; this computer made the copy its own.
  Get-ChildItem -LiteralPath $target -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  return $target
}

function Copy-ManagementFiles([string] $Release) {
  $server = Join-Path $Release 'server'
  foreach ($file in Get-ChildItem -LiteralPath $server -File) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $InstallDir $file.Name) -Force
  }
}

function Assert-Bundle([string] $Bundle) {
  foreach ($part in @('VERSION', 'python\python.exe', 'site-packages', 'backend\app\main.py', 'frontend\dist\index.html', 'server\remi-server.ps1')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Bundle $part))) {
      Fail "$Bundle is not a complete Remi bundle (no $part). Unzip remi-<version>-windows.zip and run install-remi.bat from inside it."
    }
  }
}

function Backup-Database([string] $Release) {
  $python = Join-Path $Release 'python\python.exe'
  $dataDir = Get-DataDir
  if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'remi.db'))) { return }
  if (-not (Test-Path -LiteralPath $python)) {
    Say "No Remi in $Release to back up with; Remi backs the database up itself before changing it."
    return
  }
  $saved = @{ PYTHONPATH = $env:PYTHONPATH; PYTHONDONTWRITEBYTECODE = $env:PYTHONDONTWRITEBYTECODE; PYTHONUTF8 = $env:PYTHONUTF8 }
  $env:PYTHONPATH = Join-Path $Release 'site-packages'
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:PYTHONUTF8 = '1'
  Push-Location (Join-Path $Release 'backend')
  try {
    Say 'Backing up the database ...'
    & $python -m app.main db backup --data-dir $dataDir
    if ($LASTEXITCODE -ne 0) { Fail 'the database backup failed, so nothing was changed. See the message above.' }
  } finally {
    Pop-Location
    foreach ($key in $saved.Keys) { Set-Item -Path "env:$key" -Value $saved[$key] }
  }
}

function Remove-OldReleases {
  $keep = @((Get-CurrentVersion), (Get-PreviousVersion)) | Where-Object { $_ }
  foreach ($folder in Get-ChildItem -LiteralPath $ReleasesDir -Directory) {
    if ($keep -notcontains $folder.Name) {
      Remove-Item -LiteralPath $folder.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Switch-To([string] $Version) {
  $current = Get-CurrentVersion
  Stop-Remi
  if ($current -and $current -ne $Version) { Write-Ascii $PreviousFile $current }
  Write-Ascii $CurrentFile $Version
  Copy-ManagementFiles (Join-Path $ReleasesDir $Version)
  if (Invoke-StartAndCheck $Version) {
    Remove-OldReleases
    return $true
  }
  Show-LogTail
  if ($current -and $current -ne $Version) {
    Say ''
    Say "Remi $Version did not start, so going back to $current ..."
    Stop-Remi
    Write-Ascii $CurrentFile $current
    Copy-ManagementFiles (Join-Path $ReleasesDir $current)
    if (Invoke-StartAndCheck $current) {
      Fail "Remi $Version did not start; $current is running again. Nothing was lost."
    }
    Fail "neither $Version nor $current started. See $LogDir\remi.log, and docs/deploy/APEX.md."
  }
  Fail "Remi $Version did not start. See $LogDir\remi.log."
}

function Write-DefaultEnv([int] $ServerPort, [string] $Url) {
  if ($Url) {
    $text = @"
# Remi on this server, behind APEX's proxy. After changing anything here, run restart-remi.bat.
#
# IIS serves Remi at REMI_PUBLIC_URL and forwards it to 127.0.0.1:REMI_PORT with the path
# prefix removed (ADR-0013). Remi listens on this computer only; no firewall port is open.
# There is no sign-in: anyone who can open the public address can use Remi.
REMI_HOST=127.0.0.1
REMI_PORT=$ServerPort
REMI_PUBLIC_URL=$Url
# Remi's database, charts and backups. Updates never touch this folder.
REMI_DATA_DIR=$DataDir
# Where update-remi.bat downloads releases from (owner/repository on GitHub).
REMI_UPDATE_REPO=$Repo
"@
    Write-Ascii $EnvFile ($text -replace "`r?`n", "`r`n")
    return
  }
  $text = @"
# Remi on this server. After changing anything here, run restart-remi.bat.
#
# Server mode: other computers on the network can open Remi. There is no sign-in, so anyone
# who can reach this port can use Remi.
REMI_NETWORK=1
REMI_HOST=0.0.0.0
REMI_PORT=$ServerPort
# Remi answers to this computer's own name and addresses. Add any other name you use to reach
# the server (a DNS alias, say), comma-separated, without http:// or a port: REMI_ALLOWED_HOSTS=apex
REMI_ALLOWED_HOSTS=
# Remi's database, charts and backups. Updates never touch this folder.
REMI_DATA_DIR=$DataDir
# Where update-remi.bat downloads releases from (owner/repository on GitHub).
REMI_UPDATE_REPO=$Repo
"@
  Write-Ascii $EnvFile ($text -replace "`r?`n", "`r`n")
}

function Grant-Access {
  $sid = "*$LocalServiceSid"
  & icacls.exe $InstallDir /grant "${sid}:(OI)(CI)RX" /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not let Remi's account read $InstallDir (icacls exit $LASTEXITCODE)." }
  foreach ($folder in @($DataDir, $LogDir)) {
    & icacls.exe $folder /grant "${sid}:(OI)(CI)M" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "could not let Remi's account write $folder (icacls exit $LASTEXITCODE)." }
  }
}

function Register-RemiTask {
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script = Join-Path $InstallDir 'remi-server.ps1'
  $action = New-ScheduledTaskAction -Execute $powershell -WorkingDirectory $InstallDir `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" run"
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId (Get-LocalServiceName) -LogonType ServiceAccount -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Remi: the planning dashboard, opened from APEX. Starts with Windows. See C:\Remi\server.env.' -Force | Out-Null
}

function Remove-Firewall {
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}

function ConvertTo-PublicUrl([string] $Value) {
  $url = $Value.Trim().TrimEnd('/')
  if ($url -notmatch '^https?://[^/?#\s@]+(/[^?#\s]*)?$') {
    Fail "-PublicUrl must be the address people open, such as https://apex.example.com/remi (no query), not '$Value'."
  }
  return $url
}

function Register-Firewall([int] $ServerPort) {
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName "Remi (TCP $ServerPort)" -Group $FirewallGroup -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $ServerPort -Profile Any | Out-Null
}

function Invoke-Install {
  Assert-Admin
  $bundle = Split-Path -Parent $ScriptDir
  Assert-Bundle $bundle
  $version = Get-Version $bundle
  Say "Installing Remi $version into $InstallDir"
  foreach ($folder in @($InstallDir, $ReleasesDir, $DataDir, $LogDir)) {
    if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
  }
  Grant-Access
  $url = if ($PublicUrl) { ConvertTo-PublicUrl $PublicUrl } else { '' }
  if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-DefaultEnv $Port $url
  } else {
    Say "Keeping the existing $EnvFile (install never rewrites it)."
    if ($PortGiven) { Say "  To move Remi to port $Port, change REMI_PORT there." }
    if ($url -and (Get-PublicUrl) -ne $url) {
      Say '  To move Remi behind the proxy, edit it by hand (docs/deploy/APEX.md, "Moving behind the proxy"):'
      Say "    REMI_HOST=127.0.0.1, REMI_PORT=8765, REMI_PUBLIC_URL=$url;"
      Say '    delete REMI_NETWORK and REMI_ALLOWED_HOSTS; then run install-remi.bat again.'
    }
  }
  $serverPort = Get-ServerPort
  $null = Copy-Release $bundle $version
  Copy-ManagementFiles (Join-Path $ReleasesDir $version)
  if (Test-NetworkMode) {
    Say 'Opening the firewall for Remi (server mode) ...'
    Register-Firewall $serverPort
  } else {
    Say 'No firewall port: Remi listens on 127.0.0.1 only.'
    Remove-Firewall
  }
  Say 'Registering the startup task ...'
  Register-RemiTask
  $null = Switch-To $version
  Show-Running
  Say ''
  if (Get-PublicUrl) {
    Say "APEX's landing page carries the remi tile (a link to /remi/); IIS forwards it here (APEX docs/remi/IIS_RULE.md)."
  } else {
    Say "Link to http://$($env:COMPUTERNAME.ToLower()):$serverPort/ from APEX's landing page."
  }
  Say "Update later with $InstallDir\update-remi.bat."
}

# ------------------------------------------------------------------ GitHub (read-only)
function Get-PlainText([Security.SecureString] $Secure) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-GitHubToken([switch] $Ask) {
  if ($env:REMI_GITHUB_TOKEN) { return $env:REMI_GITHUB_TOKEN }
  if (-not $Ask -and (Test-Path -LiteralPath $TokenFile)) {
    try {
      return Get-PlainText (Get-Content -LiteralPath $TokenFile -TotalCount 1 | ConvertTo-SecureString)
    } catch {
      Say 'The saved GitHub token was saved by another Windows account, so it cannot be read here.'
    }
  }
  Say ''
  Say 'Updates come from the Remi repository on GitHub, which needs a read-only token.'
  Say 'Make one on github.com: Settings > Developer settings > Fine-grained tokens > Generate:'
  Say "  repository access: only $(Get-UpdateRepo); permissions: Contents = Read-only."
  Say 'It is saved encrypted for this Windows account, so you paste it only once.'
  $secure = Read-Host -AsSecureString 'Paste the token (it stays hidden) and press Enter'
  $token = (Get-PlainText $secure).Trim()
  if (-not $token) { Fail 'no token, so nothing was downloaded. You can also run update-remi.bat -Zip <file>.' }
  ConvertTo-SecureString $token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $TokenFile -Encoding ASCII
  return $token
}

function New-GitHubRequest([string] $Url, [string] $Token, [string] $Accept) {
  $request = [Net.HttpWebRequest]::Create($Url)
  $request.UserAgent = 'remi-server'
  $request.Accept = $Accept
  $request.Headers.Add('Authorization', "Bearer $Token")
  $request.Headers.Add('X-GitHub-Api-Version', '2022-11-28')
  $request.AllowAutoRedirect = $false
  $request.Timeout = 60000
  $request.Proxy = [Net.WebRequest]::GetSystemWebProxy()
  $request.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
  return $request
}

function Get-WebStatus($ErrorRecord) {
  $response = Get-WebResponse $ErrorRecord
  if ($response) { return [int] $response.StatusCode }
  return 0
}

function Get-WebResponse($ErrorRecord) {
  $exception = $ErrorRecord.Exception
  while ($exception -and -not ($exception -is [Net.WebException])) { $exception = $exception.InnerException }
  if ($exception) { return $exception.Response }
  return $null
}

function Invoke-GitHubJson([string] $Url, [string] $Token) {
  $request = New-GitHubRequest $Url $Token 'application/vnd.github+json'
  $response = $request.GetResponse()
  try {
    $reader = New-Object IO.StreamReader($response.GetResponseStream())
    return ($reader.ReadToEnd() | ConvertFrom-Json)
  } finally { $response.Close() }
}

function Save-GitHubAsset([string] $Url, [string] $Token, [string] $OutFile) {
  # The API answers with a redirect to a signed download link, which must not get the token.
  $request = New-GitHubRequest $Url $Token 'application/octet-stream'
  try {
    $response = $request.GetResponse()
  } catch {
    $response = Get-WebResponse $_
    if (-not $response) { throw }
  }
  $status = [int] $response.StatusCode
  if ($status -ge 400) {
    $response.Close()
    Fail "GitHub answered $status when downloading $Url."
  }
  $location = $response.Headers['Location']
  if ($status -ge 300 -and $status -lt 400 -and $location) {
    $response.Close()
    $client = New-Object Net.WebClient
    $client.Headers.Add('User-Agent', 'remi-server')
    $client.Proxy = [Net.WebRequest]::GetSystemWebProxy()
    $client.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
    $client.DownloadFile($location, $OutFile)
    return
  }
  try {
    $stream = [IO.File]::Create($OutFile)
    try { $response.GetResponseStream().CopyTo($stream) } finally { $stream.Close() }
  } finally { $response.Close() }
}

function Get-LatestRelease([string] $UpdateRepo) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $url = "https://api.github.com/repos/$UpdateRepo/releases/latest"
  $token = Get-GitHubToken
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    try {
      return @{ Release = (Invoke-GitHubJson $url $token); Token = $token }
    } catch {
      $status = Get-WebStatus $_
      if (($status -eq 401 -or $status -eq 403) -and -not $env:REMI_GITHUB_TOKEN -and $attempt -eq 0) {
        Say 'GitHub did not accept the saved token (expired or revoked?).'
        Remove-Item -LiteralPath $TokenFile -Force -ErrorAction SilentlyContinue
        $token = Get-GitHubToken -Ask
        continue
      }
      if ($status -eq 404) {
        Fail "no release found in $UpdateRepo (or the token cannot see that repository). Tag a version on the Mac with make release."
      }
      if ($status -eq 0) {
        Fail "could not reach GitHub ($($_.Exception.Message)). You can also download the zip yourself and run update-remi.bat -Zip <file>."
      }
      Fail "GitHub answered $status for $url."
    }
  }
  Fail 'GitHub did not accept the token.'
}

function Get-ReleaseZip([string] $Downloads) {
  $updateRepo = Get-UpdateRepo
  Say "Checking $updateRepo on GitHub for the latest release ..."
  $found = Get-LatestRelease $updateRepo
  $release = $found.Release
  $latest = "$($release.tag_name)".TrimStart('v')
  if ($latest -eq (Get-CurrentVersion) -and -not $Force) {
    Say "Remi $latest is already the latest version. (update-remi.bat -Force reinstalls it.)"
    return $null
  }
  $asset = @($release.assets | Where-Object { $_.name -like $AssetPattern }) | Select-Object -First 1
  if (-not $asset) { Fail "release $($release.tag_name) has no $AssetPattern yet (is the release build still running on GitHub?)." }
  $zipPath = Join-Path $Downloads $asset.name
  Say "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB) ..."
  Save-GitHubAsset $asset.url $found.Token $zipPath
  $checksum = @($release.assets | Where-Object { $_.name -eq "$($asset.name).sha256" }) | Select-Object -First 1
  if ($checksum) {
    $sumPath = "$zipPath.sha256"
    Save-GitHubAsset $checksum.url $found.Token $sumPath
    $expected = ((Get-Content -LiteralPath $sumPath -TotalCount 1) -split '\s+')[0].ToLower()
    $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { Fail "the download of $($asset.name) is damaged (checksum mismatch). Try again." }
  }
  return $zipPath
}

# ------------------------------------------------------------------ update and rollback
function Expand-Bundle([string] $ZipPath, [string] $Staging) {
  if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
  New-Item -ItemType Directory -Path $Staging | Out-Null
  Say "Unzipping $(Split-Path -Leaf $ZipPath) ..."
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Staging)
  $bundles = @(Get-ChildItem -LiteralPath $Staging -Directory)
  if ($bundles.Count -ne 1) { Fail "$ZipPath is not a Remi bundle (expected one folder inside)." }
  Assert-Bundle $bundles[0].FullName
  return $bundles[0].FullName
}

function Invoke-Update {
  Assert-Admin
  Assert-Installed
  $downloads = Join-Path $InstallDir 'downloads'
  if (-not (Test-Path -LiteralPath $downloads)) { New-Item -ItemType Directory -Path $downloads | Out-Null }
  if ($Zip) {
    if (-not (Test-Path -LiteralPath $Zip)) { Fail "no file at $Zip." }
    $zipPath = (Resolve-Path -LiteralPath $Zip).Path
  } else {
    $zipPath = Get-ReleaseZip $downloads
    if (-not $zipPath) { return }
  }
  $staging = Join-Path $InstallDir 'staging'
  try {
    $bundle = Expand-Bundle $zipPath $staging
    $version = Get-Version $bundle
    $current = Get-CurrentVersion
    if ($version -eq $current -and -not $Force) {
      Say "Remi $version is already installed. (update-remi.bat -Force reinstalls it.)"
      return
    }
    Say "Updating Remi $current to $version"
    $null = Copy-Release $bundle $version
  } finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
  Stop-Remi
  Backup-Database (Join-Path $ReleasesDir $current)
  $null = Switch-To $version
  Get-ChildItem -LiteralPath $downloads -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Show-Running
}

function Invoke-Rollback {
  Assert-Admin
  Assert-Installed
  $previous = Get-PreviousVersion
  if (-not $previous -or -not (Test-Path -LiteralPath (Join-Path $ReleasesDir $previous))) {
    Fail 'there is no earlier version to go back to.'
  }
  Say "Going back from Remi $(Get-CurrentVersion) to $previous ..."
  Say '(If the newer version changed the database, the older one will refuse it: see "Rolling back" in docs/deploy/APEX.md.)'
  $null = Switch-To $previous
  Show-Running
}

# ------------------------------------------------------------------ status and uninstall
function Invoke-Status {
  Assert-Installed
  $serverPort = Get-ServerPort
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $health = Get-Health $serverPort
  Say "Installed:  Remi $(Get-CurrentVersion) in $InstallDir"
  if (Get-PreviousVersion) { Say "Previous:   $(Get-PreviousVersion) (rollback-remi.bat goes back to it)" }
  Say "Task:       $(if ($task) { $task.State } else { 'missing (run install-remi.bat again)' })"
  $publicUrl = Get-PublicUrl
  if ($health) {
    Say "Answering:  yes, version $($health.version) on port $serverPort"
    if ($publicUrl) { Say "Open:       $publicUrl/  (behind the proxy)" }
    if (Test-NetworkMode) { foreach ($url in Get-MachineUrls $serverPort) { Say "Open:       $url" } }
  } else {
    Say "Answering:  no (nothing on port $serverPort)"
    Show-LogTail
  }
  Say "Settings:   $EnvFile"
  Say "Data:       $(Get-DataDir)"
  Say "Logs:       $LogDir"
}

function Invoke-Uninstall {
  Assert-Admin
  Stop-Remi
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-NetFirewallRule -Group $FirewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  foreach ($name in @('releases', 'downloads', 'staging')) {
    $path = Join-Path $InstallDir $name
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
  }
  foreach ($name in @('current.txt', 'previous.txt', 'github-token.dat')) {
    Remove-Item -LiteralPath (Join-Path $InstallDir $name) -Force -ErrorAction SilentlyContinue
  }
  Say "Remi is uninstalled. Its data is still in $DataDir, with server.env and the logs;"
  Say "delete $InstallDir yourself if you no longer need them."
}

switch ($Command) {
  'install' { Invoke-Install }
  'update' { Invoke-Update }
  'rollback' { Invoke-Rollback }
  'start' { Assert-Admin; Assert-Installed; if (Invoke-StartAndCheck (Get-CurrentVersion)) { Show-Running } else { Show-LogTail; Fail 'Remi did not start.' } }
  'stop' { Assert-Admin; Stop-Remi; Say 'Remi is stopped. It starts again with Windows, or with start-remi.bat.' }
  'restart' { Assert-Admin; Assert-Installed; Stop-Remi; if (Invoke-StartAndCheck (Get-CurrentVersion)) { Show-Running } else { Show-LogTail; Fail 'Remi did not start.' } }
  'status' { Invoke-Status }
  'uninstall' { Invoke-Uninstall }
  'run' { Invoke-Run }
}
