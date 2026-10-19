$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPort = 19731
$taskBase = "http://127.0.0.1:$taskPort"

function Get-BridgeStatus {
    try { Invoke-RestMethod -Uri "$taskBase/api/status" -TimeoutSec 2 }
    catch { return $null }
}

try {
    $taskExisting = Get-BridgeStatus
    if ($taskExisting) {
        if ($taskExisting.studio_mode -ne 'native_mcp') {
            throw 'Порт 19731 занят старым мостом Miracles. Закройте старый сервер и запустите run.bat снова. Новая версия использует встроенный MCP Studio.'
        }
        Start-Process -FilePath "$taskBase/app"
        exit 0
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
    $taskServer = Join-Path $taskRoot 'python\mcp_server.py'
    $taskArgs = @('-u', ('"' + $taskServer + '"'), '--port', "$taskPort")
    $taskProcess = Start-Process -FilePath $taskPython -ArgumentList $taskArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskLogs 'bridge.stdout.log') -RedirectStandardError (Join-Path $taskLogs 'bridge.stderr.log')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        $taskProcess.Refresh()
        if ($taskProcess.HasExited) { throw "Мост завершился. Подробности: $taskLogs\bridge.stderr.log" }
        $taskStatus = Get-BridgeStatus
        if ($taskStatus -and $taskStatus.studio_mode -eq 'native_mcp') { $taskReady = $true; break }
        Start-Sleep -Milliseconds 350
    }
    if (-not $taskReady) { throw "Не удалось запустить мост. Подробности: $taskLogs\bridge.stderr.log" }
    Start-Process -FilePath "$taskBase/app"
} catch {
    Write-Host ('[Miracles MCP] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
