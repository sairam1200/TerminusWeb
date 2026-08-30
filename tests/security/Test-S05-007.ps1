[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AgentWorktree,

    [string]$ProductSha = 'e13c4c8d2659125476c7458b45720892ee49fc24'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path $AgentWorktree).Path
$moduleRoot = Join-Path $repositoryRoot 'apps/windows-agent'
$reviewTest = Join-Path $PSScriptRoot 's05-007-endpoint-review_test.go'
$overlayTarget = Join-Path $moduleRoot 'internal/endpoint/s05_007_review_test.go'

& git -C $repositoryRoot cat-file -e "$ProductSha^{commit}"
if ($LASTEXITCODE -ne 0) {
    throw "Missing exact S03 product commit $ProductSha."
}

& git -C $repositoryRoot diff --quiet "$ProductSha..HEAD" -- apps/windows-agent
if ($LASTEXITCODE -ne 0) {
    throw "The supplied worktree's Windows-agent source differs from exact product $ProductSha."
}

$overlayPath = [IO.Path]::GetTempFileName()
$telemetryRoot = Join-Path ([IO.Path]::GetTempPath()) 'terminus-s05-go-telemetry'
$cacheRoot = Join-Path ([IO.Path]::GetTempPath()) 'terminus-s05-go-build'
[IO.Directory]::CreateDirectory($telemetryRoot) | Out-Null
[IO.Directory]::CreateDirectory($cacheRoot) | Out-Null
$previousAppData = $env:APPDATA
$previousTelemetry = $env:GOTELEMETRY
$previousCache = $env:GOCACHE

try {
    $overlay = @{ Replace = @{ $overlayTarget = $reviewTest } } | ConvertTo-Json -Depth 3
    [IO.File]::WriteAllText($overlayPath, $overlay)
    $env:APPDATA = $telemetryRoot
    $env:GOTELEMETRY = 'off'
    $env:GOCACHE = $cacheRoot

    Push-Location $moduleRoot
    try {
        & go test -count=1 -v -overlay $overlayPath -run '^TestS05007' ./internal/endpoint
        if ($LASTEXITCODE -ne 0) {
            throw "S05-007 independent endpoint tests failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    $env:APPDATA = $previousAppData
    $env:GOTELEMETRY = $previousTelemetry
    $env:GOCACHE = $previousCache
    Remove-Item -LiteralPath $overlayPath -Force -ErrorAction SilentlyContinue
}

Write-Output "PASS: S05-007 reviewer tests ran against exact Windows-agent product $ProductSha."
