$ErrorActionPreference = 'SilentlyContinue'
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdoutLog = Join-Path $logDir 'backend-stdout.log'
$stderrLog = Join-Path $logDir 'backend-stderr.log'
Get-ChildItem $logDir -Filter 'backend*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-2) } | Remove-Item -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath 'node.exe' -ArgumentList 'backend/src/server_npmfree.js' -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
Write-Output $proc.Id
