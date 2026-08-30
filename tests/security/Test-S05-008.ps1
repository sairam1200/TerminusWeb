[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProtocolWorktree,

    [Parameter(Mandatory = $true)]
    [string]$WebWorktree,

    [Parameter(Mandatory = $true)]
    [string]$AgentWorktree,

    [string]$ProtocolSha = 'f9a70299974734c3eeb920697d2dfa4717148a9a',
    [string]$WebSha = 'd8a9b52d3448958d8c1a53eeb7a5ee378813eff9',
    [string]$AgentSha = '92a29e1673751893d3ef0b5ee9c937b91d0f93d0'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$protocolRoot = (Resolve-Path $ProtocolWorktree).Path
$webRoot = (Resolve-Path $WebWorktree).Path
$agentRoot = (Resolve-Path $AgentWorktree).Path
$reviewTest = Join-Path $PSScriptRoot 's05-008-remembered-session-review_test.go'
$agentModule = Join-Path $agentRoot 'apps/windows-agent'
$overlayTarget = Join-Path $agentModule 'internal/endpoint/s05_008_security_review_test.go'

function Assert-ExactTree {
    param([string]$Root, [string]$Sha, [string[]]$Paths)
    & git -C $Root cat-file -e "$Sha^{commit}"
    if ($LASTEXITCODE -ne 0) { throw "Missing exact commit $Sha." }
    & git -C $Root diff --quiet "$Sha..HEAD" -- @Paths
    if ($LASTEXITCODE -ne 0) { throw "Worktree $Root differs from exact product $Sha for $($Paths -join ', ')." }
}

Assert-ExactTree -Root $protocolRoot -Sha $ProtocolSha -Paths @('packages/protocol', 'packages/security')
Assert-ExactTree -Root $webRoot -Sha $WebSha -Paths @('apps/web')
Assert-ExactTree -Root $agentRoot -Sha $AgentSha -Paths @('apps/windows-agent')

Push-Location (Join-Path $protocolRoot 'packages/protocol')
try {
    & npm run verify
    if ($LASTEXITCODE -ne 0) { throw 'Exact protocol verification failed.' }
}
finally { Pop-Location }

Push-Location (Join-Path $webRoot 'apps/web')
try {
    & npm test -- protocol/sessionFragment.test.ts protocol/terminalPersistence.test.ts protocol/canonicalFixtures.test.ts terminal/protocolTerminalAdapter.test.ts components/TerminalShell.test.tsx
    if ($LASTEXITCODE -ne 0) { throw 'Exact web remembered-session tests failed.' }
}
finally { Pop-Location }

$overlayPath = [IO.Path]::GetTempFileName()
$telemetryRoot = Join-Path ([IO.Path]::GetTempPath()) 'terminus-s05-008-go-telemetry'
$cacheRoot = Join-Path ([IO.Path]::GetTempPath()) 'terminus-s05-008-go-build'
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
    Push-Location $agentModule
    try {
        & go test -short -count=1 -v -overlay $overlayPath -run '^TestS05008' ./internal/endpoint
        if ($LASTEXITCODE -ne 0) { throw 'S05-008 independent endpoint tests failed.' }
        & go test -short -count=20 -run 'Test(SessionIDFormatUniquenessAndCollisionRetriesBeforeOpen|HistoryBudgetsEvictOldestBytesWithoutClosingSessions|AtomicReopenRequiresCredentialAndSourceDevice|ReplayBackpressureReturnsRunningSessionToDetached|ReplaySnapshotBarrierPrecedesResizeOutput|DetachedHistoryTruncationAndRevocationCleanup|AuthorizationExpiryDetachesRunningSession|CredentialExpiryClosesDetachedSessionAndHistory|RejectedReopenRateLimitUsesTwentyAttemptWindow|CredentialRevocationClosesAllAuthorizationsAndSessions|CredentialRevocationSendsAuthenticationFailureBeforeBlockingTerminalClose|EndpointShutdownRejectsOpenWhileCleanupInProgressAndReturnsCleanupError|AttachedClientLossDetachesAndReopensTerminal|PrivateWSSLifecycleDetachReopenHistoryAndCleanup)$' ./internal/endpoint
        if ($LASTEXITCODE -ne 0) { throw 'Exact agent adversarial regression tests failed.' }
    }
    finally { Pop-Location }
}
finally {
    $env:APPDATA = $previousAppData
    $env:GOTELEMETRY = $previousTelemetry
    $env:GOCACHE = $previousCache
    Remove-Item -LiteralPath $overlayPath -Force -ErrorAction SilentlyContinue
}

$fragmentSource = (& git -C $webRoot show "${WebSha}:apps/web/protocol/sessionFragment.ts") -join "`n"
$shellSource = (& git -C $webRoot show "${WebSha}:apps/web/components/TerminalShell.tsx") -join "`n"
$agentSessionSource = (& git -C $agentRoot show "${AgentSha}:apps/windows-agent/internal/endpoint/session.go") -join "`n"
if ($fragmentSource -notmatch '#/s/\$\{sessionId\}' -or $fragmentSource -match 'searchParams|location\.search|pathname') {
    throw 'Session locator is not confined to the URL fragment helper.'
}
if ($shellSource -notmatch 'registerOscHandler' -or $shellSource -notmatch '\[8, 9, 52, 777\]') {
    throw 'Terminal renderer side-effect guards are missing.'
}
if ($agentSessionSource -notmatch 'managed\.credentialID != owner\.credentialID\(\)' -or $agentSessionSource -notmatch 'managed\.deviceIdentity != owner\.device') {
    throw 'Reopen ownership is not bound to credential and source device.'
}
if ($agentSessionSource -notmatch 'protocol\.MaxSessionHistory' -or $agentSessionSource -notmatch 'protocol\.MaxAgentHistory') {
    throw 'Agent history limits are not enforced in the exact session registry.'
}

Write-Output "PASS with finding reproduced: exact S01/S02/S03 remembered-session gates passed; stalled replay snapshots exceed the live 16 MiB history budget."
