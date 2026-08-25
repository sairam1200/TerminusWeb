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
}
finally {
  $existing = docker ps --all --filter "name=^/${containerName}$" --format "{{.Names}}"
  if ($existing -eq $containerName) {
    docker rm --force $containerName | Out-Null
  }
}
