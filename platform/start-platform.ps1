param([int]$PatrolPort=14550,[int]$SuppressionPort=14560,[int]$WebPort=8790,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$mutex=New-Object Threading.Mutex($false,"Local\LinhuoDesktop$WebPort")
$locked=$false
try {
  $locked=$mutex.WaitOne(15000)
  if(!$locked){throw 'Another launcher is busy. Please wait and try again.'}
  $url="http://127.0.0.1:$WebPort"
  $health=$null
  try {$health=Invoke-RestMethod "$url/api/health" -TimeoutSec 2} catch {}
  if($health){
    if($health.appId -ne 'linhuo-desktop-0.4-layout' -or $health.root -ne $PSScriptRoot){throw 'An older/different platform is using this port. Exit the old platform first, then launch this version.'}
  } else {
    $nodeCommand=Get-Command node -ErrorAction SilentlyContinue
    $nodePath=if($nodeCommand){$nodeCommand.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
    if(!(Test-Path $nodePath)){throw 'Node.js 20 or newer is required.'}
    $env:PORT="$WebPort";$env:HOST='127.0.0.1'
    if($PSBoundParameters.ContainsKey('PatrolPort')){$env:PATROL_UDP_PORT="$PatrolPort"}else{Remove-Item Env:PATROL_UDP_PORT -ErrorAction SilentlyContinue}
    if($PSBoundParameters.ContainsKey('SuppressionPort')){$env:SUPPRESSION_UDP_PORT="$SuppressionPort"}else{Remove-Item Env:SUPPRESSION_UDP_PORT -ErrorAction SilentlyContinue}
    $logs=Join-Path $PSScriptRoot 'data'
    New-Item -ItemType Directory -Force -Path $logs | Out-Null
    $proc=Start-Process -FilePath $nodePath -ArgumentList @(('"'+(Join-Path $PSScriptRoot 'server.mjs')+'"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-error.log') -PassThru
    for($i=0;$i -lt 40;$i++){
      Start-Sleep -Milliseconds 250
      if($proc.HasExited){throw 'Startup failed. See data/server-error.log; an old platform may still be running.'}
      try {$health=Invoke-RestMethod "$url/api/health" -TimeoutSec 1} catch {}
      if($health -and $health.appId -eq 'linhuo-desktop-0.4-layout' -and $health.root -eq $PSScriptRoot){break}
    }
    if(!$health -or $health.root -ne $PSScriptRoot){if(!$proc.HasExited){Stop-Process -Id $proc.Id};throw 'Platform did not become ready. See data/server-error.log.'}
  }
  if(!$NoBrowser){Start-Process $url}
  Write-Host "Ready: $url . Use Exit Platform on the page to release ports."
} catch {Write-Host $_ -ForegroundColor Red;exit 1} finally {if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
