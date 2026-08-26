$ErrorActionPreference = 'Stop'
$hostSource = (& git show b52e3bb4493745909ab0fc3f65aa95ebb62dc33c:apps/windows-agent/cmd/integration-host/main_windows.go)
$endpointSource = ((& git show b52e3bb4493745909ab0fc3f65aa95ebb62dc33c:apps/windows-agent/internal/endpoint/endpoint.go) + (& git show b52e3bb4493745909ab0fc3f65aa95ebb62dc33c:apps/windows-agent/internal/endpoint/server.go))
$policy = Get-Content -Raw infrastructure/tailscale/policy.fragment.template.hujson
$checks = @(
  [pscustomobject]@{ Ok = $hostSource -match '127\.0\.0\.1:0'; Name = 'host default loopback' },
  [pscustomobject]@{ Ok = $hostSource -match 'IsLoopback\(\)'; Name = 'host loopback post-bind check' },
  [pscustomobject]@{ Ok = $hostSource -match 'RequireAndVerifyClientCert'; Name = 'verified device certificate' },
  [pscustomobject]@{ Ok = $hostSource -match 'VersionTLS13'; Name = 'TLS 1.3 minimum' },
  [pscustomobject]@{ Ok = $endpointSource -match 'AllowedOrigin'; Name = 'exact Origin input' },
  [pscustomobject]@{ Ok = $endpointSource -match '/terminal'; Name = 'terminal path' },
  [pscustomobject]@{ Ok = $endpointSource -match 'loopback'; Name = 'endpoint loopback guard' },
  [pscustomobject]@{ Ok = $policy -match 'tag:terminus-windows-agent'; Name = 'private tagged destination' },
  [pscustomobject]@{ Ok = $policy -notmatch 'autogroup:member|0\.0\.0\.0|Funnel|ssh'; Name = 'no broad/public policy selector' }
)
$failed = @($checks | Where-Object { -not $_.Ok })
if ($failed.Count) { $failed | ForEach-Object { Write-Error "FAIL: $($_.Name)" }; exit 1 }
Write-Output 'PASS: static private-publication boundary checks'
Write-Output 'UNTESTED: live hostname, certificate chain, Serve/Funnel state, listener, and network paths'
