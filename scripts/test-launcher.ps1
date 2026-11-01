$ErrorActionPreference = 'Stop'
$testRoot = Split-Path -Parent $PSScriptRoot
$testVersion = (Get-Content (Join-Path $testRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$testFolder = Join-Path $testRoot ('.mcp_cache\launcher with spaces ' + [guid]::NewGuid().ToString('N'))
$testNew = Join-Path $testFolder 'new'
$testOld = Join-Path $testFolder 'old'
$testArchive = Join-Path $testRoot ".mcp_cache\release\argon-mcp-$testVersion.zip"
$testPython = (Get-Command python.exe).Source
$env:ARGON_PYTHON_PATH = $testPython
$env:HELIUM_PYTHON_PATH = $testPython
$testReservation = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$testReservation.Start()
$testPort = $testReservation.LocalEndpoint.Port
$testReservation.Stop()
$testBase = "http://127.0.0.1:$testPort"
$testOwned = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Status { try { Invoke-RestMethod "$testBase/api/status" -TimeoutSec 2 } catch { $null } }
function Wait-Version($version) {
    for ($i = 0; $i -lt 40; $i++) {
        $status = Status
        if ($status -and $status.version -eq $version) { return $status }
        Start-Sleep -Milliseconds 200
    }
    throw "Bridge $version did not become ready."
}
function Launch([switch]$Stop, [switch]$ExpectFailure) {
    $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $testNew 'release\scripts\start.ps1'),'-NoOpen','-Port',"$testPort")
    if ($Stop) { $arguments += '-StopBridge' }
    & powershell.exe @arguments
    if (-not $ExpectFailure -and $LASTEXITCODE -ne 0) { throw "Launcher failed with $LASTEXITCODE." }
    if ($ExpectFailure -and $LASTEXITCODE -eq 0) { throw 'Launcher accepted an unrelated listener.' }
}
try {
    New-Item -ItemType Directory -Path $testFolder -Force | Out-Null
    Expand-Archive -LiteralPath $testArchive -DestinationPath $testNew
    Expand-Archive -LiteralPath $testArchive -DestinationPath $testOld
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $testNew 'release\scripts\start.ps1'), [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count) { throw ($errors | Out-String) }

    $launches = @()
    for ($i = 0; $i -lt 3; $i++) {
        $file = Join-Path $testNew 'release\scripts\start.ps1'
        $process = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $file + '"'),'-NoOpen','-Port',"$testPort") -PassThru -RedirectStandardOutput (Join-Path $testFolder "launch-$i.out") -RedirectStandardError (Join-Path $testFolder "launch-$i.err")
        $null = $process.Handle
        $testOwned.Add($process); $launches += $process
    }
    foreach ($process in $launches) {
        $finished = $process.WaitForExit(45000)
        $process.Refresh()
        if (-not $finished -or $process.ExitCode -ne 0) {
            Get-ChildItem -LiteralPath $testFolder -File | Where-Object { $_.Extension -in '.out','.err' } | ForEach-Object { Write-Host $_.Name; Get-Content -LiteralPath $_.FullName | Out-Host }
            throw "Concurrent launcher failed: PID $($process.Id), finished=$finished, exit=$($process.ExitCode)."
        }
    }
    $first = Wait-Version $testVersion
    $listeners = @(Get-NetTCPConnection -LocalPort $testPort -State Listen | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($listeners.Count -ne 1 -or $listeners[0] -ne $first.pid) { throw 'Expected exactly one bridge listener.' }
    Launch
    if ((Status).instance_id -ne $first.instance_id) { throw 'Healthy bridge was replaced on duplicate launch.' }
    Write-Host 'PASS simultaneous and repeated launches reuse one bridge'
    Launch -Stop

    # Same version, previous brand: do not silently reuse the old UI/root.
    $oldServer = Join-Path $testOld 'release\python\mcp_server.py'
    $oldManifest = Join-Path $testOld 'plugin\manifest.json'
    $canonicalSource = [System.IO.File]::ReadAllText($oldServer)
    $canonicalManifest = [System.IO.File]::ReadAllText($oldManifest)
    $heliumSource = $canonicalSource.Replace('ArgonMCP/', 'HeliumMCP/').Replace('"argon-mcp"', '"helium-mcp"').Replace('"queue": queue_count', '"queue": int((Path(__file__).parent / "busy.fixture").exists())')
    [System.IO.File]::WriteAllText($oldServer, $heliumSource)
    $heliumManifest = $canonicalManifest | ConvertFrom-Json
    $heliumManifest.name = 'Helium — Local Bridge for Roblox Studio'
    [System.IO.File]::WriteAllText($oldManifest, ($heliumManifest | ConvertTo-Json -Depth 20))
    $writtenHeliumManifest = Get-Content -LiteralPath $oldManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($writtenHeliumManifest.name -ne 'Helium — Local Bridge for Roblox Studio' -or $writtenHeliumManifest.version -ne $testVersion) { throw 'Helium fixture manifest identity/version was not written correctly.' }
    $busyFlag = Join-Path $testOld 'release\python\busy.fixture'
    [System.IO.File]::WriteAllText($busyFlag, 'fixture')
    $sameVersion = Start-Process $testPython -ArgumentList @('-u',('"' + $oldServer + '"'),'--port',"$testPort") -PassThru -RedirectStandardOutput (Join-Path $testFolder 'same-version.out') -RedirectStandardError (Join-Path $testFolder 'same-version.err')
    $testOwned.Add($sameVersion)
    $previous = Wait-Version $testVersion
    if ($previous.service -ne 'helium-mcp') { throw 'Expected the same-version Helium fixture.' }
    Launch -ExpectFailure
    if ($sameVersion.HasExited -or (Status).pid -ne $previous.pid) { throw 'Busy legacy bridge must not be replaced.' }
    Remove-Item -LiteralPath $busyFlag
    Launch
    $upgraded = Wait-Version $testVersion
    if ($upgraded.service -ne 'argon-mcp' -or $upgraded.pid -eq $previous.pid -or -not $sameVersion.WaitForExit(5000)) { throw 'Same-version Helium was reused instead of safely replaced.' }
    Write-Host 'PASS same-version Helium upgrades to Argon and active tools block replacement'
    Launch -Stop
    [System.IO.File]::WriteAllText($oldServer, $canonicalSource)
    [System.IO.File]::WriteAllText($oldManifest, $canonicalManifest)

    # Reproduce a pre-rename Miracle release in a different extracted directory. Its disk
    # manifest and served version identify it before the new launcher replaces it.
    $oldServer = Join-Path $testOld 'release\python\mcp_server.py'
    $source = [System.IO.File]::ReadAllText($oldServer).Replace(('VERSION = "' + $testVersion + '"'),'VERSION = "2.8.0"').Replace('"graceful_shutdown",','').Replace('ArgonMCP/', 'MiraclesMCP/').Replace('"argon-mcp"', '"miracle-mcp"')
    [System.IO.File]::WriteAllText($oldServer, $source)
    $oldManifest = Join-Path $testOld 'plugin\manifest.json'
    $miracleManifest = $canonicalManifest | ConvertFrom-Json
    $miracleManifest.name = 'Miracle — Local Bridge for Roblox Studio'
    $miracleManifest.version = '2.8.0'
    [System.IO.File]::WriteAllText($oldManifest, ($miracleManifest | ConvertTo-Json -Depth 20))
    $writtenMiracleManifest = Get-Content -LiteralPath $oldManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($writtenMiracleManifest.name -ne 'Miracle — Local Bridge for Roblox Studio' -or $writtenMiracleManifest.version -ne '2.8.0') { throw 'Miracle fixture manifest identity/version was not written correctly.' }
    $legacy = Start-Process $testPython -ArgumentList @('-u',('"' + $oldServer + '"'),'--port',"$testPort") -PassThru -RedirectStandardOutput (Join-Path $testFolder 'legacy.out') -RedirectStandardError (Join-Path $testFolder 'legacy.err')
    $testOwned.Add($legacy)
    Wait-Version '2.8.0' | Out-Null
    Launch
    $replacement = Wait-Version $testVersion
    if ($replacement.pid -eq $legacy.Id -or -not $legacy.WaitForExit(5000)) { throw 'Previous bridge was not cleaned up.' }
    Write-Host 'PASS verified previous release is replaced and stopped'
    Launch -Stop

    $otherServer = Join-Path $testFolder 'unrelated.py'
    $otherCode = @'
import json,sys
from http.server import BaseHTTPRequestHandler,HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        data=json.dumps({"online":True,"service":"unrelated","studio_mode":"other"}).encode()
        self.send_response(200);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
'@
    [System.IO.File]::WriteAllText($otherServer, $otherCode)
    $other = Start-Process $testPython -ArgumentList @('-u',('"' + $otherServer + '"'),"$testPort") -PassThru -RedirectStandardOutput (Join-Path $testFolder 'other.out') -RedirectStandardError (Join-Path $testFolder 'other.err')
    $testOwned.Add($other)
    for ($i = 0; $i -lt 30; $i++) { if ((Status).service -eq 'unrelated') { break }; Start-Sleep -Milliseconds 200 }
    Launch -ExpectFailure
    if ($other.HasExited -or (Status).service -ne 'unrelated') { throw 'Unrelated process was affected.' }
    Write-Host 'PASS unrelated port owner is left running'
} finally {
    try { Launch -Stop } catch { }
    foreach ($process in $testOwned) { if (-not $process.HasExited) { Stop-Process -InputObject $process -Force -ErrorAction SilentlyContinue } }
    Remove-Item -LiteralPath $testFolder -Recurse -Force -ErrorAction SilentlyContinue
}
# Expected refusal in the unrelated-listener test must not become the job exit code.
exit 0
