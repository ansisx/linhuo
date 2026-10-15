param([int]$PatrolPort=14550,[int]$SuppressionPort=14560,[int]$WebPort=8790)
$ErrorActionPreference='Stop'
$nodeCommand=Get-Command node -ErrorAction SilentlyContinue
$nodePath=if($nodeCommand){$nodeCommand.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
if(!(Test-Path $nodePath)){throw '需要 Node.js 20 或更高版本'}
if($PSBoundParameters.ContainsKey('PatrolPort')){$env:PATROL_UDP_PORT="$PatrolPort"}else{Remove-Item Env:PATROL_UDP_PORT -ErrorAction SilentlyContinue}
if($PSBoundParameters.ContainsKey('SuppressionPort')){$env:SUPPRESSION_UDP_PORT="$SuppressionPort"}else{Remove-Item Env:SUPPRESSION_UDP_PORT -ErrorAction SilentlyContinue}
$env:PORT="$WebPort"
& $nodePath (Join-Path $PSScriptRoot 'server.mjs')
