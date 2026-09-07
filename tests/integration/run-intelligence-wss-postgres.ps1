$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$candidate = "a6adf52afeeb87ad9e6907c79baa9c9023c562a4"
if (-not $env:TERMINUS_INTELLIGENCE_TEST_DATABASE_URL) {
  throw "TERMINUS_INTELLIGENCE_TEST_DATABASE_URL required; no implicit database"
}
$snapshot = Join-Path $repoRoot "tmp/s06-wss-postgres-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $snapshot | Out-Null
$archive = Join-Path $snapshot "agent.tar"
git -C $repoRoot archive --format=tar "--output=$archive" $candidate apps/windows-agent
if ($LASTEXITCODE -ne 0) { throw "Immutable candidate archive failed" }
tar -xf $archive -C $snapshot
if ($LASTEXITCODE -ne 0) { throw "Immutable candidate extraction failed" }
$module = Join-Path $snapshot "apps/windows-agent"
$testPath = Join-Path $module "internal/s06integration"
New-Item -ItemType Directory -Path $testPath | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "intelligence_wss_postgres_test.go") -Destination $testPath
Push-Location $module
try {
  go test -count=1 -v ./internal/s06integration
  if ($LASTEXITCODE -ne 0) { throw "Combined WSS/service/PostgreSQL verification failed" }
  go vet ./internal/s06integration
  if ($LASTEXITCODE -ne 0) { throw "Independent integration source vet failed" }
} finally {
  Pop-Location
}
Write-Output "S06-009 combined immutable WSS/service/PostgreSQL verification: PASS"
