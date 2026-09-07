param(
  [string]$Image = "postgres:17.11-alpine3.24@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"
)
$ErrorActionPreference = "Stop"
$databaseRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$containerName = "terminus-s04-003-$([guid]::NewGuid().ToString('N'))"
$raceJobs = @()
function Invoke-TestSql([string]$Sql) {
  $result = & docker exec $containerName psql -U postgres -v ON_ERROR_STOP=1 -At -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "Disposable database SQL failed" }
  return $result
}
try {
  docker run --detach --rm --name $containerName --env POSTGRES_HOST_AUTH_METHOD=trust $Image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not start disposable PostgreSQL" }
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $containerName pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Disposable PostgreSQL readiness timed out" }
  foreach ($file in @("migrations/0001_control_plane.sql", "migrations/0002_private_intelligence.sql", "intelligence-role.sql", "test/002_intelligence_invariants.sql")) {
    $source = Join-Path $databaseRoot $file
    docker cp $source "${containerName}:/tmp/test.sql" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not copy test artifact" }
    docker exec $containerName psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/test.sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Migration or invariant failed: $file" }
  }
  Write-Output "S04-003 migrations and private SQL invariants: PASS"
  Invoke-TestSql "INSERT INTO terminus_intelligence.owners(id) VALUES ('44444444-4444-4444-8444-444444444444');" | Out-Null
  Invoke-TestSql "INSERT INTO terminus_intelligence.quota_principals(credential_id,device_id,owner_id) VALUES ('synthetic-race','synthetic-race','44444444-4444-4444-8444-444444444444');" | Out-Null
  $raceScript = {
    param($Container, $Request, $Hold)
    $holdSql = if ($Hold) { "SELECT pg_sleep(3) /* S04_QUOTA_RACE */;" } else { "" }
    $sql = "BEGIN; SET LOCAL ROLE terminus_intelligence_app; SELECT terminus_intelligence.reserve_tokens('44444444-4444-4444-8444-444444444444','$Request',date_trunc('month',now() AT TIME ZONE 'UTC')::date,80000,now()+interval '30 seconds'); $holdSql COMMIT;"
    $result = & docker exec $Container psql -U postgres -v ON_ERROR_STOP=1 -At -c $sql
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Result = ($result -join "`n") }
  }
  $raceJobs += Start-Job -ScriptBlock $raceScript -ArgumentList $containerName, '44444444-4444-4444-8444-444444444441', $true
  $locked = $false
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $active = Invoke-TestSql "SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query LIKE '%S04_QUOTA_RACE%' AND state='active';"
    if ([int]$active -gt 0) { $locked = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $locked) { throw "First quota request never reached lock" }
  $raceJobs += Start-Job -ScriptBlock $raceScript -ArgumentList $containerName, '44444444-4444-4444-8444-444444444442', $false
  $raceJobs | Wait-Job -Timeout 20 | Out-Null
  foreach ($job in $raceJobs) { if ($job.State -ne 'Completed') { throw "Quota race timed out" } }
  $results = @($raceJobs | Receive-Job)
  if (@($results | Where-Object { $_.ExitCode -ne 0 }).Count -ne 0) { throw "Quota race SQL failed" }
  $accepted = @($results | Where-Object { $_.Result -match '(?m)^t$' }).Count
  $rejected = @($results | Where-Object { $_.Result -match '(?m)^f$' }).Count
  if ($accepted -ne 1 -or $rejected -ne 1) { throw "Quota race expected exactly one accepted reservation" }
  $reserved = Invoke-TestSql "SELECT reserved_tokens FROM terminus_intelligence.quota_months WHERE owner_id='44444444-4444-4444-8444-444444444444';"
  if ([long]$reserved -ne 80000) { throw "Quota race counter mismatch" }
  Write-Output "S04-003 two-connection quota race: PASS (one accepted, one rejected)"
  Invoke-TestSql "DROP SCHEMA terminus_intelligence CASCADE;" | Out-Null
  $preserved = Invoke-TestSql "SELECT to_regclass('terminus_cp.accounts') IS NOT NULL;"
  if ($preserved -ne 't') { throw "Rollback changed metadata schema" }
  Write-Output "S04-003 isolated rollback preserves terminus_cp: PASS"
}
finally {
  foreach ($job in $raceJobs) {
    if ($job.State -eq 'Running') { Stop-Job $job }
    Remove-Job $job -Force
  }
  $existing = docker ps --all --filter "name=^/${containerName}$" --format '{{.Names}}'
  if ($existing -eq $containerName) { docker rm --force $containerName | Out-Null }
}
