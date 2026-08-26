[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sql = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($sql)) {
    throw 'Expected migration SQL on stdin.'
}

$findings = [System.Collections.Generic.List[string]]::new()
function Require-Match {
    param([string]$Pattern, [string]$Message)
    if ($sql -notmatch $Pattern) { $findings.Add($Message) }
}

$forceRlsCount = ([regex]::Matches($sql, 'ALTER TABLE terminus_cp\.\w+ FORCE ROW LEVEL SECURITY;')).Count
if ($forceRlsCount -ne 11) { $findings.Add("Expected forced RLS on 11 tenant tables; observed $forceRlsCount.") }
Require-Match 'FOREIGN KEY \(tenant_id, host_id\)' 'Missing composite tenant/host foreign-key invariant.'
Require-Match 'FOREIGN KEY \(tenant_id, membership_id\)' 'Missing composite tenant/membership foreign-key invariant.'
Require-Match 'FOREIGN KEY \(tenant_id, pairing_id, membership_id, host_id\)' 'Missing composite lease-to-pairing invariant.'
Require-Match "current_setting\('terminus\.tenant_id', true\)" 'Missing transaction-local tenant context in RLS policies.'

# S04-001 claims the final owner cannot be revoked. The migration must enforce that
# invariant independently of a caller-supplied activeOwnerCount or a race-prone read.
$roleSection = [regex]::Match($sql, '(?is)CREATE TABLE terminus_cp\.role_assignments.*?(?=CREATE TABLE terminus_cp\.hosts)').Value
if ($roleSection -notmatch '(?i)(trigger|function|owner.{0,80}(count|minimum|at least)|count.{0,80}owner)') {
    $findings.Add('Missing database-level final-owner invariant; role_assignments has no owner-count guard or trigger.')
}

if ($findings.Count -gt 0) {
    $findings | ForEach-Object { Write-Error "FINDING CP-DB: $_" }
    exit 1
}

Write-Output 'PASS: cross-tenant SQL isolation structures are present and final-owner invariant is enforced.'
