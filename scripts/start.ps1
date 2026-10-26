param([switch]$StopBridge, [switch]$NoOpen, [ValidateRange(1024,65535)][int]$Port = 19731)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPort = $Port
$taskBase = "http://127.0.0.1:$taskPort"
$taskServer = Join-Path $taskRoot 'python\mcp_server.py'
$taskMutex = $null
$taskMutexHeld = $false

function Get-BridgeStatus {
    try { Invoke-RestMethod -Uri "$taskBase/api/status" -TimeoutSec 2 }
    catch { return $null }
}

function Open-Workspace {
    if ($NoOpen) { return }
    # The bridge coalesces double-clicks, including launches from another copy.
    try {
        $taskBoot = Invoke-RestMethod -Uri "$taskBase/api/bootstrap" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 3
        $taskClaimBody = @{ token = $taskBoot.bridgeToken; instance_id = $taskBoot.instance_id } | ConvertTo-Json -Compress
        $taskClaim = Invoke-RestMethod -Uri "$taskBase/api/ui/claim" -Method Post -ContentType 'application/json' -Body $taskClaimBody -TimeoutSec 3
        if ($taskClaim.ok -and -not $taskClaim.open_ui) { return }
    } catch { }
    Start-Process -FilePath "$taskBase/app"
}

function Stop-MiracleBridge($taskStatus) {
    if ($taskStatus -and $taskStatus.studio_mode -ne 'native_mcp') {
        throw 'The selected port belongs to another application. It was not stopped.'
    }
    if ($taskStatus -and $taskStatus.queue -gt 0) { throw 'A Studio task is still running. Wait for its result, then launch again.' }
    if ($taskStatus -and $taskStatus.capabilities -contains 'graceful_shutdown') {
        $taskBoot = Invoke-RestMethod -Uri "$taskBase/api/bootstrap" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 3
        $taskStopBody = @{ token = $taskBoot.bridgeToken; instance_id = $taskStatus.instance_id } | ConvertTo-Json -Compress
        # A changed instance or a running tool rejects shutdown. Do not force it.
        Invoke-RestMethod -Uri "$taskBase/api/bridge/shutdown" -Method Post -ContentType 'application/json' -Body $taskStopBody -TimeoutSec 5 | Out-Null
    } else {
        # Migration from older versions without a shutdown route. Verify the
        # listener PID, Python command and installed Miracle package first.
        $taskListeners = @(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue)
        $taskOwners = @($taskListeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if (-not $taskOwners.Count) { return }
        $taskExpected = [System.IO.Path]::GetFullPath($taskServer)
        $taskScriptPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($taskExpected) + '"?(?=\s|$)'
        foreach ($taskOwner in $taskOwners) {
            $taskInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $taskOwner" -ErrorAction Stop
            $taskVerified = $taskInfo -and $taskInfo.Name -match '^python(?:w|3(?:\.\d+)?)?\.exe$' -and $taskInfo.CommandLine -match $taskScriptPattern
            if (-not $taskVerified -and $taskStatus -and $taskInfo -and $taskInfo.Name -match '^python(?:w|3(?:\.\d+)?)?\.exe$') {
                $taskScriptMatch = [regex]::Match($taskInfo.CommandLine, '(?i)(?:^|\s)(?:"(?<path>[^"]*\\mcp_server\.py)"|(?<path>[^\s"]*\\mcp_server\.py))(?=\s|$)')
                if ($taskScriptMatch.Success) {
                    $taskOlderServer = $taskScriptMatch.Groups['path'].Value
                    if ([System.IO.Path]::IsPathRooted($taskOlderServer) -and (Test-Path -LiteralPath $taskOlderServer -PathType Leaf)) {
                        $taskOlderRoot = Split-Path -Parent (Split-Path -Parent $taskOlderServer)
                        $taskOlderUI = $taskOlderRoot
                        if (-not (Test-Path -LiteralPath (Join-Path $taskOlderUI 'manifest.json'))) { $taskOlderUI = Join-Path (Split-Path -Parent $taskOlderRoot) 'plugin' }
                        try {
                            $taskOlderManifest = Get-Content -LiteralPath (Join-Path $taskOlderUI 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
                            $taskOlderSource = Get-Content -LiteralPath $taskOlderServer -Raw -Encoding UTF8
                            $taskVerified = $taskOlderManifest.name -eq 'Miracle — Local Bridge for Roblox Studio' -and $taskOlderManifest.version -eq $taskStatus.version -and $taskOlderSource.Contains('MiraclesMCP/') -and $taskOlderSource.Contains('class BridgeServer(')
                        } catch { $taskVerified = $false }
                    }
                }
            }
            if (-not $taskVerified) {
                throw 'An older or unrelated process owns the selected port. Its identity could not be verified, so it was not stopped. Close the previous Miracle release and try again.'
            }
        }
        foreach ($taskOwner in $taskOwners) { Stop-Process -Id $taskOwner -Force -ErrorAction Stop }
    }
    for ($taskWait = 0; $taskWait -lt 30; $taskWait++) {
        if (-not @(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue).Count) { return }
        Start-Sleep -Milliseconds 200
    }
    throw 'The previous bridge has not stopped yet. Wait a moment and launch again.'
}

try {
    $taskMutex = [System.Threading.Mutex]::new($false, "Local\MiracleMCP-Bridge-$taskPort")
    try { $taskMutexHeld = $taskMutex.WaitOne([TimeSpan]::FromSeconds(20)) }
    catch [System.Threading.AbandonedMutexException] { $taskMutexHeld = $true }
    if (-not $taskMutexHeld) { throw 'Another Miracle launch is still in progress. Wait a moment and try again.' }
    $taskUIRoot = $taskRoot
    if (-not (Test-Path -LiteralPath (Join-Path $taskUIRoot 'manifest.json'))) {
        $taskUIRoot = Join-Path (Split-Path -Parent $taskRoot) 'plugin'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $taskUIRoot 'manifest.json'))) {
        throw 'Не найдена папка plugin. Распакуйте ZIP целиком и оставьте папки plugin и release рядом.'
    }
    $taskVersion = (Get-Content -LiteralPath (Join-Path $taskUIRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $taskExisting = Get-BridgeStatus
    if ($StopBridge) {
        Stop-MiracleBridge $taskExisting
        Write-Host '[Miracle MCP] Bridge stopped.'
        exit 0
    }
    if ($taskExisting -and $taskExisting.online -and $taskExisting.studio_mode -eq 'native_mcp' -and $taskExisting.version -eq $taskVersion) {
        Write-Host '[Miracle MCP] Reusing the running bridge.'
        Open-Workspace
        exit 0
    }
    if ($taskExisting -or @(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue).Count) {
        Stop-MiracleBridge $taskExisting
    }

    $taskCandidates = [System.Collections.Generic.List[string]]::new()
    if ($env:MIRACLES_PYTHON_PATH) { $taskCandidates.Add($env:MIRACLES_PYTHON_PATH) }
    foreach ($taskCommand in @(Get-Command python.exe, python3.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
        if ($taskCommand.Source -and $taskCommand.Source -notmatch '\\WindowsApps\\') { $taskCandidates.Add($taskCommand.Source) }
    }
    foreach ($taskPathDir in ($env:Path -split ';')) {
        if (-not $taskPathDir -or $taskPathDir -match '\\WindowsApps\\') { continue }
        foreach ($taskExe in @('python.exe', 'python3.exe')) {
            $taskPath = Join-Path $taskPathDir.Trim('"') $taskExe
            if (Test-Path -LiteralPath $taskPath -PathType Leaf) { $taskCandidates.Add($taskPath) }
        }
    }
    foreach ($taskHive in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore', 'HKLM:\Software\WOW6432Node\Python\PythonCore')) {
        if (-not (Test-Path $taskHive)) { continue }
        foreach ($taskVersionKey in Get-ChildItem -LiteralPath $taskHive -ErrorAction SilentlyContinue) {
            $taskInstallKey = Join-Path $taskVersionKey.PSPath 'InstallPath'
            $taskInstallItem = Get-Item -LiteralPath $taskInstallKey -ErrorAction SilentlyContinue
            $taskInstall = if ($taskInstallItem) { $taskInstallItem.GetValue('') } else { $null }
            if ($taskInstall) {
                foreach ($taskExe in @('python.exe', 'python3.exe')) {
                    $taskPath = Join-Path $taskInstall $taskExe
                    if (Test-Path -LiteralPath $taskPath -PathType Leaf) { $taskCandidates.Add($taskPath) }
                }
            }
        }
    }
    foreach ($taskBaseDir in @($env:LocalAppData, (Join-Path $env:LocalAppData 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $taskBaseDir) { continue }
        foreach ($taskInstall in Get-ChildItem -LiteralPath $taskBaseDir -Directory -Filter 'Python*' -ErrorAction SilentlyContinue) {
            $taskPath = Join-Path $taskInstall.FullName 'python.exe'
            if (Test-Path -LiteralPath $taskPath -PathType Leaf) { $taskCandidates.Add($taskPath) }
        }
    }
    try {
        foreach ($taskPackage in @(Get-AppxPackage -Name 'PythonSoftwareFoundation.Python*' -ErrorAction Stop)) {
            if (-not $taskPackage.InstallLocation) { continue }
            foreach ($taskExe in @(Get-ChildItem -LiteralPath $taskPackage.InstallLocation -File -Filter 'python*.exe' -ErrorAction SilentlyContinue)) {
                if ($taskExe.Name -notmatch '^python(?:3(?:\.\d+)?)?\.exe$') { continue }
                $taskCandidates.Add($taskExe.FullName)
            }
        }
    } catch { }
    # Package-specific aliases exist only for an installed Store Python; unlike
    # the generic WindowsApps alias, these do not lead to the Store installer.
    $taskStoreAliases = Join-Path $env:LocalAppData 'Microsoft\WindowsApps'
    foreach ($taskPackageDir in @(Get-ChildItem -LiteralPath $taskStoreAliases -Directory -Filter 'PythonSoftwareFoundation.Python*' -ErrorAction SilentlyContinue)) {
        foreach ($taskExe in @('python.exe', 'python3.exe')) {
            $taskAlias = Join-Path $taskPackageDir.FullName $taskExe
            if (Test-Path -LiteralPath $taskAlias -PathType Leaf) { $taskCandidates.Add($taskAlias) }
        }
    }

    $taskPython = $null
    foreach ($taskCandidate in ($taskCandidates | Select-Object -Unique)) {
        try {
            $taskProbeCode = '"import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"'
            $taskProbe = Start-Process -FilePath $taskCandidate -ArgumentList @('-c', $taskProbeCode) -WindowStyle Hidden -PassThru
            if ($taskProbe.WaitForExit(3000) -and $taskProbe.ExitCode -eq 0) { $taskPython = $taskCandidate; break }
            if (-not $taskProbe.HasExited) { Stop-Process -Id $taskProbe.Id -Force -ErrorAction SilentlyContinue }
        } catch { }
    }
    if (-not $taskPython) { throw 'Не найден Python 3.10 или новее. Установите Python с python.org, затем запустите run.bat снова.' }

    $taskLogs = Join-Path $taskRoot '.mcp_cache'
    New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
    $taskArgs = @('-u', ('"' + $taskServer + '"'), '--port', "$taskPort")
    $taskProcess = Start-Process -FilePath $taskPython -ArgumentList $taskArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskLogs 'bridge.stdout.log') -RedirectStandardError (Join-Path $taskLogs 'bridge.stderr.log')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        $taskProcess.Refresh()
        $taskStatus = Get-BridgeStatus
        if ($taskStatus -and $taskStatus.online -and $taskStatus.studio_mode -eq 'native_mcp' -and $taskStatus.version -eq $taskVersion) { $taskReady = $true; break }
        if ($taskProcess.HasExited) { throw "Мост завершился. Подробности: $taskLogs\bridge.stderr.log" }
        Start-Sleep -Milliseconds 350
    }
    if (-not $taskReady) { throw "Не удалось запустить мост. Подробности: $taskLogs\bridge.stderr.log" }
    Open-Workspace
} catch {
    Write-Host ('[Miracles MCP] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($taskMutexHeld) { $taskMutex.ReleaseMutex() }
    if ($taskMutex) { $taskMutex.Dispose() }
}
