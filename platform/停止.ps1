param([int]$WebPort=8790)
$headers=@{'X-Platform-Action'='write'}
if($env:VIEW_TOKEN){$headers['X-View-Token']=$env:VIEW_TOKEN}
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$WebPort/api/stop" -ContentType 'application/json' -Body '{}' -Headers $headers
