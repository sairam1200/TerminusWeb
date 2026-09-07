# Disposable synthetic fixture only. The coordinator owns stopping this exact container.
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$container = "terminus-intelligence-s06-tests"
$image = "postgres:17.11-alpine3.24@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73"
$existing = docker ps -a --filter "name=^/$container`$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw "Docker inspection failed" }
if ($existing) { throw "Existing test container preserved; refusing replacement" }
$snapshot = Join-Path $repoRoot "tmp/s06-db-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $snapshot | Out-Null
git -C $repoRoot archive --format=tar "--output=$snapshot/db.tar" 33cc6383ff6af9a049113206a6a57d8690936de2 infrastructure/database
if ($LASTEXITCODE -ne 0) { throw "Immutable database archive failed" }
tar -xf (Join-Path $snapshot "db.tar") -C $snapshot
if ($LASTEXITCODE -ne 0) { throw "Immutable database extraction failed" }
docker run --detach --rm --name $container --publish 127.0.0.1:55439:5432 --env POSTGRES_HOST_AUTH_METHOD=trust $image | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Disposable fixture start failed" }
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  docker exec $container pg_isready -U postgres *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw "Disposable fixture readiness failed; preserve for coordinator inspection" }
foreach ($file in @("migrations/0001_control_plane.sql", "migrations/0002_private_intelligence.sql", "intelligence-role.sql")) {
  docker cp (Join-Path $snapshot "infrastructure/database/$file") "${container}:/tmp/setup.sql"
  if ($LASTEXITCODE -ne 0) { throw "Fixture migration copy failed" }
  docker exec $container psql -U postgres -v ON_ERROR_STOP=1 -f /tmp/setup.sql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Fixture migration failed; preserve for coordinator inspection" }
}
docker exec $container psql -U postgres -v ON_ERROR_STOP=1 -c 'ALTER ROLE terminus_intelligence_app LOGIN;' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Fixture role login setup failed" }
docker inspect --format '{{json .HostConfig.PortBindings}}' $container
if ($LASTEXITCODE -ne 0) { throw "Fixture binding verification failed" }
Write-Output "Synthetic test fixture ready; set TERMINUS_INTELLIGENCE_TEST_DATABASE_URL for loopback capability role"
