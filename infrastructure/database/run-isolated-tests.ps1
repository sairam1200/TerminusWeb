param(
  [string]$Image = "postgres:17.11-alpine3.24@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"
)

$ErrorActionPreference = "Stop"
$containerName = "terminus-s04-001-$([guid]::NewGuid().ToString('N'))"
$databaseRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$migrationPath = Join-Path $databaseRoot "migrations\0001_control_plane.sql"
$testPath = Join-Path $databaseRoot "test\001_invariants.sql"

if (-not (Test-Path -LiteralPath $migrationPath)) {
  throw "Migration file is missing: $migrationPath"
}
if (-not (Test-Path -LiteralPath $testPath)) {
  throw "Invariant test is missing: $testPath"
}

try {
  docker run --detach --rm --name $containerName --env POSTGRES_HOST_AUTH_METHOD=trust $Image | Out-Null

  $ready = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    docker exec $containerName pg_isready --username postgres --dbname postgres *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw "Disposable PostgreSQL did not become ready after 30 seconds"
  }

  docker cp $migrationPath "${containerName}:/tmp/0001_control_plane.sql" | Out-Null
  docker cp $testPath "${containerName}:/tmp/001_invariants.sql" | Out-Null
  docker exec $containerName psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 --file /tmp/0001_control_plane.sql
  if ($LASTEXITCODE -ne 0) {
    throw "Migration dry run failed"
  }
  docker exec $containerName psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 --file /tmp/001_invariants.sql
  if ($LASTEXITCODE -ne 0) {
    throw "Database invariant tests failed"
  }

  $ownerRaceScript = {
    param([string]$RaceContainer, [string]$AssignmentId, [bool]$HoldLock)
    $holdSql = if ($HoldLock) { "SELECT pg_sleep(3) /* S04_OWNER_RACE_A */;" } else { "" }
    $sql = @"
BEGIN;
UPDATE terminus_cp.role_assignments
SET revoked_at = transaction_timestamp()
WHERE tenant_id = '33333333-3333-4333-8333-333333333333'
  AND id = '$AssignmentId';
$holdSql
COMMIT;
"@
    $commandOutput = @(
      & docker exec $RaceContainer psql --username postgres --dbname postgres --set ON_ERROR_STOP=1 --command $sql 2>&1
    )
    [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = ($commandOutput -join "`n")
    }
  }

  $ownerJobA = $null
  $ownerJobB = $null
  try {
    $ownerJobA = Start-Job -ScriptBlock $ownerRaceScript -ArgumentList @(
      $containerName,
      "33333333-0001-4000-8000-333333333331",
      $true
    )

    $firstRevocationActive = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
      $activityCount = docker exec $containerName psql --username postgres --dbname postgres --tuples-only --no-align --command "SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query LIKE '%S04_OWNER_RACE_A%' AND state = 'active';"
      if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect concurrent owner-revocation activity"
      }
      if ([int]$activityCount -ge 1) {
        $firstRevocationActive = $true
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if (-not $firstRevocationActive) {
      throw "First owner revocation did not reach its lock-holding state"
    }

    $ownerJobB = Start-Job -ScriptBlock $ownerRaceScript -ArgumentList @(
      $containerName,
      "33333333-0002-4000-8000-333333333332",
      $false
    )

    Wait-Job -Job @($ownerJobA, $ownerJobB) -Timeout 15 | Out-Null
    if ($ownerJobA.State -ne "Completed" -or $ownerJobB.State -ne "Completed") {
      throw "Concurrent owner-revocation jobs did not complete"
    }

    $ownerResults = @(
      Receive-Job -Job $ownerJobA
      Receive-Job -Job $ownerJobB
    )
    $exitCodes = @($ownerResults | ForEach-Object { [int]$_.ExitCode } | Sort-Object)
    if (($exitCodes -join ",") -ne "0,1") {
      throw "Expected one owner revocation to pass and one to fail; exits were $($exitCodes -join ',')"
    }
    $rejectedResult = $ownerResults | Where-Object { [int]$_.ExitCode -eq 1 } | Select-Object -First 1
    if ($rejectedResult.Output -notmatch "cannot revoke the final active owner role") {
      throw "Concurrent revocation failed for an unexpected reason: $($rejectedResult.Output)"
    }

    $remainingOwnerCount = docker exec $containerName psql --username postgres --dbname postgres --tuples-only --no-align --command "SELECT active_owner_count FROM terminus_cp.tenants WHERE id = '33333333-3333-4333-8333-333333333333';"
    if ($LASTEXITCODE -ne 0 -or $remainingOwnerCount.Trim() -ne "1") {
      throw "Concurrent revocations did not preserve exactly one owner counter"
    }
    $remainingOwnerRows = docker exec $containerName psql --username postgres --dbname postgres --tuples-only --no-align --command "SELECT count(*) FROM terminus_cp.role_assignments WHERE tenant_id = '33333333-3333-4333-8333-333333333333' AND role = 'owner' AND revoked_at IS NULL;"
    if ($LASTEXITCODE -ne 0 -or $remainingOwnerRows.Trim() -ne "1") {
      throw "Concurrent revocations did not preserve exactly one active owner role"
    }
    Write-Output "S04-001 concurrent final-owner invariant: PASS"
  }
  finally {
    @($ownerJobA, $ownerJobB) | Where-Object { $null -ne $_ } | ForEach-Object {
      if ($_.State -eq "Running") {
        Stop-Job -Job $_
      }
      Remove-Job -Job $_ -Force
    }
  }
}
finally {
  $existing = docker ps --all --filter "name=^/${containerName}$" --format "{{.Names}}"
  if ($existing -eq $containerName) {
    docker rm --force $containerName | Out-Null
  }
}
