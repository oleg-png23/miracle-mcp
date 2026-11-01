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

function Get-BridgeToken($taskStatus) {
    # Read credentials from the verified listener's own installation, never
    # from HTTP. This also supports releases extracted into a new directory.
    if (-not $taskStatus -or -not $taskStatus.pid) { throw 'The bridge identity is unavailable.' }
    $taskOwners = @(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($taskOwners.Count -ne 1 -or $taskOwners[0] -ne $taskStatus.pid) { throw 'The bridge listener could not be verified.' }
    $taskInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskStatus.pid)" -ErrorAction Stop
    if (-not $taskInfo -or $taskInfo.Name -notmatch '^python(?:w|3(?:\.\d+)?)?\.exe$') { throw 'The bridge process could not be verified.' }
    $taskMatch = [regex]::Match($taskInfo.CommandLine, '(?i)(?:^|\s)(?:"(?<path>[^"]*\\mcp_server\.py)"|(?<path>[^\s"]*\\mcp_server\.py))(?=\s|$)')
    if (-not $taskMatch.Success) { throw 'The bridge script could not be verified.' }
    $taskRunningServer = $taskMatch.Groups['path'].Value
    if (-not [System.IO.Path]::IsPathRooted($taskRunningServer) -or -not (Test-Path -LiteralPath $taskRunningServer -PathType Leaf)) { throw 'The bridge script could not be verified.' }
    $taskRunningRoot = Split-Path -Parent (Split-Path -Parent $taskRunningServer)
    $taskRunningUI = $taskRunningRoot
    if (-not (Test-Path -LiteralPath (Join-Path $taskRunningUI 'manifest.json'))) { $taskRunningUI = Join-Path (Split-Path -Parent $taskRunningRoot) 'plugin' }
    $taskManifest = Get-Content -LiteralPath (Join-Path $taskRunningUI 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $taskSource = Get-Content -LiteralPath $taskRunningServer -Raw -Encoding UTF8
    if ($taskManifest.name -notin @('Argon — Local Bridge for Roblox Studio', 'Helium — Local Bridge for Roblox Studio', 'Miracle — Local Bridge for Roblox Studio') -or $taskManifest.version -ne $taskStatus.version -or -not ($taskSource.Contains('ArgonMCP/') -or $taskSource.Contains('HeliumMCP/') -or $taskSource.Contains('MiraclesMCP/')) -or -not $taskSource.Contains('class BridgeServer(')) { throw 'The bridge installation could not be verified.' }
    $taskTokenPath = Join-Path (Split-Path -Parent $taskRunningServer) 'token.txt'
    $taskToken = (Get-Content -LiteralPath $taskTokenPath -Raw -Encoding UTF8).Trim()
    if (-not $taskToken) { throw 'The bridge token file is empty.' }
    return $taskToken
}

function Open-Workspace {
    if ($NoOpen) { return }
    # The bridge coalesces double-clicks, including launches from another copy.
    try {
        $taskStatus = Get-BridgeStatus
        $taskToken = Get-BridgeToken $taskStatus
        $taskClaimBody = @{ token = $taskToken; instance_id = $taskStatus.instance_id } | ConvertTo-Json -Compress
        $taskClaim = Invoke-RestMethod -Uri "$taskBase/api/ui/claim" -Method Post -ContentType 'application/json' -Body $taskClaimBody -TimeoutSec 3
        if ($taskClaim.ok -and -not $taskClaim.open_ui) { return }
    } catch { }
    Start-Process -FilePath "$taskBase/app"
}

function Stop-HeliumBridge($taskStatus) {
    if ($taskStatus -and $taskStatus.studio_mode -ne 'native_mcp') {
        throw 'The selected port belongs to another application. It was not stopped.'
    }
    if ($taskStatus -and $taskStatus.queue -gt 0) { throw 'A Studio task is still running. Wait for its result, then launch again.' }
    if ($taskStatus -and $taskStatus.capabilities -contains 'graceful_shutdown') {
        $taskToken = Get-BridgeToken $taskStatus
        $taskStopBody = @{ token = $taskToken; instance_id = $taskStatus.instance_id } | ConvertTo-Json -Compress
        # A changed instance or a running tool rejects shutdown. Do not force it.
        Invoke-RestMethod -Uri "$taskBase/api/bridge/shutdown" -Method Post -ContentType 'application/json' -Body $taskStopBody -TimeoutSec 5 | Out-Null
    } else {
        # Migration from older versions without a shutdown route. Verify the
        # listener PID, Python command and installed Argon/Helium package first.
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
                            $taskVerified = ($taskOlderManifest.name -in @('Argon — Local Bridge for Roblox Studio', 'Helium — Local Bridge for Roblox Studio', 'Miracle — Local Bridge for Roblox Studio')) -and $taskOlderManifest.version -eq $taskStatus.version -and ($taskOlderSource.Contains('ArgonMCP/') -or $taskOlderSource.Contains('HeliumMCP/') -or $taskOlderSource.Contains('MiraclesMCP/')) -and $taskOlderSource.Contains('class BridgeServer(')
                        } catch { $taskVerified = $false }
                    }
                }
            }
            if (-not $taskVerified) {
                throw 'An older or unrelated process owns the selected port. Its identity could not be verified, so it was not stopped. Close the previous Argon or Helium release and try again.'
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
    # Keep the shared legacy mutex so old and new installers serialize together.
    $taskMutex = [System.Threading.Mutex]::new($false, "Local\MiracleMCP-Bridge-$taskPort")
    try { $taskMutexHeld = $taskMutex.WaitOne([TimeSpan]::FromSeconds(20)) }
    catch [System.Threading.AbandonedMutexException] { $taskMutexHeld = $true }
    if (-not $taskMutexHeld) { throw 'Another Argon launch is still in progress. Wait a moment and try again.' }
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
        Stop-HeliumBridge $taskExisting
        Write-Host '[Argon MCP] Bridge stopped.'
        exit 0
    }
    if ($taskExisting -and $taskExisting.online -and $taskExisting.studio_mode -eq 'native_mcp' -and $taskExisting.version -eq $taskVersion -and $taskExisting.service -eq 'argon-mcp') {
        Write-Host '[Argon MCP] Reusing the running bridge.'
        Open-Workspace
        exit 0
    }
    if ($taskExisting -or @(Get-NetTCPConnection -LocalPort $taskPort -State Listen -ErrorAction SilentlyContinue).Count) {
        Stop-HeliumBridge $taskExisting
    }

    $taskCandidates = [System.Collections.Generic.List[string]]::new()
    if ($env:ARGON_PYTHON_PATH) { $taskCandidates.Add($env:ARGON_PYTHON_PATH) }
    if ($env:HELIUM_PYTHON_PATH) { $taskCandidates.Add($env:HELIUM_PYTHON_PATH) }
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
            $taskProbeInfo = [System.Diagnostics.ProcessStartInfo]::new()
            $taskProbeInfo.FileName = $taskCandidate
            $taskProbeInfo.Arguments = '-c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"'
            $taskProbeInfo.UseShellExecute = $false
            $taskProbeInfo.CreateNoWindow = $true
            $taskProbe = [System.Diagnostics.Process]::Start($taskProbeInfo)
            try {
                if ($taskProbe.WaitForExit(3000) -and $taskProbe.ExitCode -eq 0) { $taskPython = $taskCandidate; break }
                if (-not $taskProbe.HasExited) { $taskProbe.Kill() }
            } finally { $taskProbe.Dispose() }
        } catch { }
    }
    if (-not $taskPython) { throw 'Не найден Python 3.10 или новее. Установите Python с python.org, затем запустите run.bat снова.' }

    $taskLogs = Join-Path $taskRoot '.mcp_cache'
    New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
    $taskArgs = @('-u', ('"' + $taskServer + '"'), '--port', "$taskPort")
    $taskProcess = Start-Process -FilePath $taskPython -ArgumentList $taskArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskLogs 'bridge.stdout.log') -RedirectStandardError (Join-Path $taskLogs 'bridge.stderr.log')
    $null = $taskProcess.Handle
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
    Write-Host ('[Argon MCP] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($taskMutexHeld) { $taskMutex.ReleaseMutex() }
    if ($taskMutex) { $taskMutex.Dispose() }
}
