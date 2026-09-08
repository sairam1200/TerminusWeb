param(
  [Parameter(Mandatory=$true)][string]$AgentCommit,
  [Parameter(Mandatory=$true)][string]$WebCommit,
  [Parameter(Mandatory=$true)][string]$WebRoot,
  [string]$BrowserTools = 'E:/terminus/tests/browser'
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$webRepo = (Resolve-Path (Join-Path $WebRoot '../..')).Path
git -C $webRepo diff $WebCommit --exit-code -- apps/web
if ($LASTEXITCODE -ne 0) { throw 'Web source does not match immutable target' }
$snapshot = Join-Path $repoRoot "tmp/s06-recovery-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $snapshot | Out-Null
$archive = Join-Path $snapshot 'agent.tar'
git -C $repoRoot archive --format=tar "--output=$archive" $AgentCommit apps/windows-agent
if ($LASTEXITCODE -ne 0) { throw 'Agent snapshot failed' }
tar -xf $archive -C $snapshot
if ($LASTEXITCODE -ne 0) { throw 'Snapshot extraction failed' }
$module = Join-Path $snapshot 'apps/windows-agent'
$fixtureRoot = Join-Path $module 'internal/s06recovery'
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'main.go') -Destination $fixtureRoot
$executable = Join-Path $snapshot 'fixture.exe'
Push-Location $module
try {
  go build -buildvcs=false -o $executable ./internal/s06recovery
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture build failed' }
  go vet ./internal/s06recovery
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture vet failed' }
} finally { Pop-Location }
node (Join-Path $PSScriptRoot 'verify.cjs') $WebRoot $executable $BrowserTools
$verificationExit = $LASTEXITCODE
git -C $webRepo diff $WebCommit --exit-code -- apps/web
if ($LASTEXITCODE -ne 0) { throw 'Web source changed during verification' }
exit $verificationExit
