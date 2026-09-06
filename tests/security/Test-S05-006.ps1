[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9A-Fa-f]{40}$')]
    [string]$ClientCertificateThumbprint,

    [int]$ExpectedProcessId = 5384,
    [string]$ExpectedHostName = 'sai.tailf8dcea.ts.net',
    [string]$ExpectedTailnetIPv4 = '100.82.31.104',
    [string]$ExpectedOrigin = 'https://terminus-web.vercel.app',
    [string]$ExpectedSubprotocol = 'terminus.v0_1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-TextHash {
    param([Parameter(Mandatory = $true)][string]$Text)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-SafeSnapshot {
    $status = (& tailscale status --json | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0) { throw 'tailscale status failed.' }
    $serveJsonText = (& tailscale serve status --json) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'tailscale serve status --json failed.' }
    $serve = $serveJsonText | ConvertFrom-Json
    $serveText = (& tailscale serve status) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'tailscale serve status failed.' }
    $funnelText = (& tailscale funnel status) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'tailscale funnel status failed.' }

    $tcpPorts = @($serve.TCP.PSObject.Properties.Name)
    if ($tcpPorts.Count -ne 1 -or $tcpPorts[0] -ne '443') {
        throw "Expected exactly one TCP Serve port, 443; observed: $($tcpPorts -join ',')."
    }
    if ($serve.TCP.'443'.TCPForward -ne '127.0.0.1:8443') {
        throw "Unexpected TCP forward target: $($serve.TCP.'443'.TCPForward)."
    }
    $topLevel = @($serve.PSObject.Properties.Name)
    if ($topLevel.Count -ne 1 -or $topLevel[0] -ne 'TCP') {
        throw "Unexpected Serve configuration sections: $($topLevel -join ',')."
    }
    if ($serveText -notmatch '\(tailnet only\)' -or $funnelText -notmatch '\(tailnet only\)') {
        throw 'Serve/Funnel status did not explicitly label the route tailnet only.'
    }

    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8443 | Sort-Object LocalAddress, LocalPort, OwningProcess)
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -ne $ExpectedProcessId) {
        throw 'The agent origin is not the one expected PID on IPv4 loopback only.'
    }
    $process = Get-Process -Id $ExpectedProcessId
    if ($process.ProcessName -ne 'integration-host') {
        throw "Unexpected origin process name: $($process.ProcessName)."
    }

    $firewall = @(Get-NetFirewallProfile | Sort-Object Name | ForEach-Object {
        "{0}:{1}:{2}" -f $_.Name, $_.Enabled, $_.DefaultInboundAction
    })
    $publicDns = @(Resolve-DnsName $ExpectedHostName -Type A -Server 1.1.1.1 -DnsOnly |
        Where-Object Type -eq 'A' | Select-Object -ExpandProperty IPAddress -Unique | Sort-Object)

    $selfTags = @()
    if ($status.Self.PSObject.Properties['Tags']) { $selfTags = @($status.Self.Tags) }
    $keyExpiry = $null
    if ($status.Self.PSObject.Properties['KeyExpiry']) { $keyExpiry = $status.Self.KeyExpiry }
    $snapshot = [ordered]@{
        backendState = $status.BackendState
        tailnet = $status.CurrentTailnet.Name
        dnsName = $status.Self.DNSName
        online = $status.Self.Online
        tags = $selfTags
        keyExpiry = $keyExpiry
        tailscaleIPs = @($status.TailscaleIPs)
        serve = $serveJsonText.Trim()
        serveAudience = $serveText.Trim()
        funnelAudience = $funnelText.Trim()
        listener = "127.0.0.1:8443:$ExpectedProcessId"
        process = "integration-host:${ExpectedProcessId}:$($process.StartTime.ToUniversalTime().ToString('o'))"
        firewallProfiles = $firewall
        publicDnsA = $publicDns
    }
    return ($snapshot | ConvertTo-Json -Depth 6 -Compress)
}

function Test-TcpPort {
    param([string]$Address, [int]$Port)
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync($Address, $Port)
        return $task.Wait(2000) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Invoke-WssProbe {
    param(
        [Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [string]$Origin,
        [string]$Subprotocol
    )
    $socket = [Net.WebSockets.ClientWebSocket]::new()
    $null = $socket.Options.ClientCertificates.Add($Certificate)
    $socket.Options.SetRequestHeader('Origin', $Origin)
    $socket.Options.AddSubProtocol($Subprotocol)
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(10))
    try {
        $null = $socket.ConnectAsync([Uri]"wss://$ExpectedHostName/terminal", $cancel.Token).GetAwaiter().GetResult()
        return [pscustomobject]@{ Connected = $socket.State -eq [Net.WebSockets.WebSocketState]::Open; Status = $null; Negotiated = $socket.SubProtocol }
    }
    catch {
        $base = $_.Exception.GetBaseException()
        $status = $null
        if ($base.PSObject.Properties['Response'] -and $base.Response) {
            $status = [int]$base.Response.StatusCode
        }
        return [pscustomobject]@{ Connected = $false; Status = $status; Negotiated = $null }
    }
    finally {
        if ($socket.State -eq [Net.WebSockets.WebSocketState]::Open) { $socket.Abort() }
        $cancel.Dispose()
        $socket.Dispose()
    }
}

$leaf = Get-Item "Cert:\CurrentUser\My\$ClientCertificateThumbprint"
if (-not $leaf.HasPrivateKey) { throw 'The selected client certificate has no private key.' }
$now = Get-Date
if ($leaf.NotBefore -gt $now -or $leaf.NotAfter -le $now) { throw 'The selected client certificate is not currently valid.' }
$eku = @($leaf.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' })
if ($eku.Count -ne 1 -or $eku[0].Format($false) -notmatch '1\.3\.6\.1\.5\.5\.7\.3\.2') {
    throw 'The selected certificate lacks explicit Client Authentication EKU.'
}

$before = Get-SafeSnapshot

$first = Invoke-WebRequest -Uri "https://$ExpectedHostName/healthz" -Certificate $leaf -UseBasicParsing -TimeoutSec 15
$second = Invoke-WebRequest -Uri "https://$ExpectedHostName/healthz" -Certificate $leaf -UseBasicParsing -TimeoutSec 15
if ($first.StatusCode -ne 200 -or $first.Content.Trim() -ne 'ok' -or $second.StatusCode -ne 200 -or $second.Content.Trim() -ne 'ok') {
    throw 'The existing ClientAuth identity did not pass two consecutive health requests.'
}

$invalidCandidates = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.Thumbprint -ne $leaf.Thumbprint -and $_.HasPrivateKey -and $_.NotAfter -gt $now -and $_.Issuer -ne $leaf.Issuer
})
if ($invalidCandidates.Count -eq 0) { throw 'No unrelated installed private-key certificate is available for the negative control.' }
$invalidDenied = $false
try {
    $unexpected = Invoke-WebRequest -Uri "https://$ExpectedHostName/healthz" -Certificate $invalidCandidates[0] -UseBasicParsing -TimeoutSec 15
    $unexpected.Dispose()
}
catch {
    $invalidDenied = $true
}
if (-not $invalidDenied) { throw 'An unrelated client certificate was unexpectedly accepted.' }

$oldPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = @(& curl.exe --tlsv1.3 --max-time 15 --silent --show-error --output NUL --write-out '%{http_code}' "https://$ExpectedHostName/healthz" 2>&1)
$noCertificateExit = $LASTEXITCODE
$ErrorActionPreference = $oldPreference
if ($noCertificateExit -eq 0) { throw 'A request without a client certificate unexpectedly succeeded.' }

$exact = Invoke-WssProbe -Certificate $leaf -Origin $ExpectedOrigin -Subprotocol $ExpectedSubprotocol
$wrongOrigin = Invoke-WssProbe -Certificate $leaf -Origin 'https://attacker.invalid' -Subprotocol $ExpectedSubprotocol
$wrongSubprotocol = Invoke-WssProbe -Certificate $leaf -Origin $ExpectedOrigin -Subprotocol 'other.v1'
if (-not $exact.Connected -or $exact.Negotiated -ne $ExpectedSubprotocol) { throw 'Exact Origin/subprotocol WSS upgrade failed.' }
if ($wrongOrigin.Connected -or $wrongOrigin.Status -ne 403) { throw "Wrong Origin result was not HTTP 403: $($wrongOrigin.Status)." }
if ($wrongSubprotocol.Connected -or $wrongSubprotocol.Status -ne 426) { throw "Wrong subprotocol result was not HTTP 426: $($wrongSubprotocol.Status)." }

if (-not (Test-TcpPort -Address '127.0.0.1' -Port 8443)) { throw 'Loopback origin was not reachable locally.' }
if (Test-TcpPort -Address $ExpectedTailnetIPv4 -Port 8443) { throw 'Direct Tailscale-interface access reached the loopback origin port.' }
if (-not (Test-TcpPort -Address $ExpectedTailnetIPv4 -Port 443)) { throw 'Private Serve port was not reachable over the tailnet address.' }
$lan = @([Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) | Where-Object {
    $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
    -not [Net.IPAddress]::IsLoopback($_) -and $_.IPAddressToString -ne $ExpectedTailnetIPv4
} | Select-Object -ExpandProperty IPAddressToString -Unique)
if ($lan.Count -eq 0) { throw 'No LAN IPv4 address was available for the denied-origin control.' }
foreach ($address in $lan) {
    if (Test-TcpPort -Address $address -Port 8443) { throw "LAN address $address reached the loopback origin port." }
}

$addressBytes = ([Net.IPAddress]::Parse($ExpectedTailnetIPv4)).GetAddressBytes()
if ($addressBytes[0] -ne 100 -or $addressBytes[1] -lt 64 -or $addressBytes[1] -gt 127) {
    throw 'Expected tailnet IPv4 address is not in the RFC 6598 shared-address range.'
}

$after = Get-SafeSnapshot
if ($before -cne $after) { throw 'Pre/post route, device, listener, firewall, process, or DNS snapshots changed.' }

$oldPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = @(& tailscale serve get-config --help 2>&1)
$getConfigHelpExit = $LASTEXITCODE
$null = @(& tailscale serve set-config --help 2>&1)
$setConfigHelpExit = $LASTEXITCODE
$null = @(& tailscale serve reset --help 2>&1)
$resetHelpExit = $LASTEXITCODE
$ErrorActionPreference = $oldPreference
if ($getConfigHelpExit -ne 0 -or $setConfigHelpExit -ne 0 -or $resetHelpExit -ne 0) {
    throw 'Installed CLI snapshot/restore/reset help did not exit successfully.'
}

Write-Output "PASS: exact raw TCP private route and pre/post snapshot hash $(Get-TextHash -Text $before)."
Write-Output 'PASS: existing ClientAuth identity succeeded twice; unrelated/no certificate failed closed.'
Write-Output 'PASS: exact WSS upgraded; wrong Origin=403 and wrong subprotocol=426.'
Write-Output 'PASS: loopback origin allowed locally; LAN/Tailscale direct origin denied; Serve 443 allowed.'
Write-Output 'LIMIT: no independent wrong-tailnet-peer, complete-policy, device-approval, external-public, or mobile-browser probe.'
