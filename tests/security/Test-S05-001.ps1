[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

function Assert-SequenceEqual {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Actual,

        [Parameter(Mandatory = $true)]
        [object[]]$Expected,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $actualJson = ConvertTo-Json -InputObject @($Actual) -Compress
    $expectedJson = ConvertTo-Json -InputObject @($Expected) -Compress
    Assert-True ($actualJson -ceq $expectedJson) "$Message (actual $actualJson; expected $expectedJson)"
}

function Find-PolicyTest {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Tests,

        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Protocol
    )

    $matches = @($Tests | Where-Object { $_.src -ceq $Source -and $_.proto -ceq $Protocol })
    Assert-True ($matches.Count -eq 1) "expected one policy test for $Source over $Protocol"
    return $matches[0]
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$policyPath = Join-Path $repositoryRoot 'infrastructure\tailscale\policy.fragment.template.hujson'
$policyText = Get-Content -Raw -LiteralPath $policyPath
$policy = $policyText | ConvertFrom-Json

$operatorGroup = 'group:terminus-terminal-operators'
$tagAdminGroup = 'group:terminus-agent-tag-admins'
$agentTag = 'tag:terminus-windows-agent'
$portToken = '__TERMINUS_SERVE_HTTPS_PORT__'
$operatorToken = '__TERMINUS_OPERATOR_IDENTITY__'
$tagAdminToken = '__TERMINUS_TAG_ADMIN_IDENTITY__'
$deniedToken = '__TERMINUS_DENIED_IDENTITY__'
$serveCapability = "tcp:$portToken"
$serveDestination = "${agentTag}:$portToken"

Assert-True ($null -ne $policy.groups) 'groups section must exist'
Assert-SequenceEqual @($policy.groups.$operatorGroup) @($operatorToken) 'operator group must contain only the unresolved exact identity token'
Assert-SequenceEqual @($policy.groups.$tagAdminGroup) @($tagAdminToken) 'tag-admin group must contain only the unresolved exact identity token'
Assert-SequenceEqual @($policy.tagOwners.$agentTag) @($tagAdminGroup) 'explicit tag-owner entry must name only the dedicated tag-admin group'

Assert-True (@($policy.grants).Count -eq 1) 'proposal must contain exactly one Terminus grant'
$grant = @($policy.grants)[0]
Assert-SequenceEqual @($grant.src) @($operatorGroup) 'grant source must be the explicit operator group'
Assert-SequenceEqual @($grant.dst) @($agentTag) 'grant destination must be the Windows agent tag'
Assert-SequenceEqual @($grant.ip) @($serveCapability) 'grant must allow only TCP on the unresolved private Serve port'

Assert-True ($null -eq $policy.PSObject.Properties['ssh']) 'proposal must not introduce or replace Tailscale SSH policy'
Assert-True ($null -eq $policy.PSObject.Properties['acls']) 'proposal must not introduce legacy ACLs'
Assert-True ($null -eq $policy.PSObject.Properties['nodeAttrs']) 'proposal must not introduce Funnel or other node attributes'
Assert-True ($null -eq $policy.PSObject.Properties['autoApprovers']) 'proposal must not introduce route auto-approvers'

$broadSelectors = @('*', 'autogroup:member', 'autogroup:admin', 'autogroup:owner')
$grantSelectors = @($grant.src) + @($grant.dst) + @($grant.ip)
foreach ($selector in $broadSelectors) {
    Assert-True ($grantSelectors -cnotcontains $selector) "grant must not use broad selector $selector"
}
Assert-True ($policyText -notmatch '(?i)funnel') 'policy template must not contain a Funnel capability'
Assert-True ($policyText -notmatch '(?i)autogroup:internet') 'policy template must not grant exit-node/internet access'

$tests = @($policy.tests)
Assert-True ($tests.Count -eq 5) 'proposal must contain the five required policy test records'

$operatorTcp = Find-PolicyTest $tests $operatorGroup 'tcp'
Assert-SequenceEqual @($operatorTcp.accept) @($serveDestination) 'operator TCP test must accept only the private Serve destination'
Assert-SequenceEqual @($operatorTcp.deny) @("${agentTag}:22", "${agentTag}:3389") 'operator TCP test must deny SSH and RDP'

$deniedTcp = Find-PolicyTest $tests $deniedToken 'tcp'
Assert-SequenceEqual @($deniedTcp.deny) @($serveDestination, "${agentTag}:22", "${agentTag}:3389") 'non-operator TCP test must deny Serve, SSH, and RDP'
Assert-True ($null -eq $deniedTcp.PSObject.Properties['accept']) 'non-operator test must not contain accepted destinations'

$operatorUdp = Find-PolicyTest $tests $operatorGroup 'udp'
Assert-SequenceEqual @($operatorUdp.deny) @($serveDestination) 'operator UDP test must deny the Serve port'

$operatorIcmp = Find-PolicyTest $tests $operatorGroup 'icmp'
Assert-SequenceEqual @($operatorIcmp.deny) @("${agentTag}:0") 'operator ICMP test must deny ping access'

$reverseTcp = Find-PolicyTest $tests $agentTag 'tcp'
Assert-SequenceEqual @($reverseTcp.deny) @("${operatorGroup}:$portToken") 'directional test must deny agent-initiated TCP to operator devices'

$requiredTokens = @($operatorToken, $tagAdminToken, $deniedToken, $portToken)
foreach ($token in $requiredTokens) {
    Assert-True ($policyText.Contains($token)) "unverified token $token must remain conspicuous in the proposal"
}

Write-Output 'PASS: S05-001 policy proposal is narrow, non-applicable, and contains required allow/deny assertions.'
Write-Output 'NOTE: This static check did not compile policy with Tailscale, inspect live state, or test a service.'
