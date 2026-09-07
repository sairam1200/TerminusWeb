# S06-009 combined authenticated WSS and PostgreSQL evidence

Independent verifier: `/root/intelligence_verification`, Session 06.
Continuation authority: coordinator task against Session 01 queue/status
`7f42e84`, preserving the previously blocked Chrome gate.

Exact immutable agent product: `a6adf52afeeb87ad9e6907c79baa9c9023c562a4`.
Exact immutable migration/grants: `33cc6383ff6af9a049113206a6a57d8690936de2`.
Shared contract and web products remain those in the prior component report.

## Result

`TestIntelligenceRealWSSServicePostgres` passes with the actual intelligence
WebSocket endpoint, HMAC authentication, actual intelligence service and actual
PostgreSQL capability role combined in one flow. This closes the previous
separation between endpoint tests with an RPC double and direct service tests.
It does not exercise the TypeScript client, live Windows credential store,
client-certificate device resolution or authenticated Chrome.

The independent Go test resides under Session 06-owned `tests/integration`.
`run-intelligence-wss-postgres.ps1` archives the exact agent product into a fresh
ignored `tmp/` snapshot and copies only the independent test into a new internal
test package. Producer source, branches and live credentials are not modified.
The test refuses a missing database variable rather than skipping. It accepts
only the explicitly disposable PostgreSQL fixture at loopback port 55439 with
database postgres, capability role terminus_intelligence_app and the sole
`sslmode=disable` query parameter; database URL query overrides cannot redirect it.

## Reproduced command and coverage

On Windows NT 10.0.26200.0 with installed Go 1.26.7, set only the synthetic
fixture configuration in `TERMINUS_INTELLIGENCE_TEST_DATABASE_URL`, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/integration/run-intelligence-wss-postgres.ps1
```

Final run exited 0. `go test -count=1 -v ./internal/s06integration` passed the
combined test in 1.03 seconds (package 1.710 seconds), with no skips.
`go vet ./internal/s06integration` exited 0. A prior development run and a fresh
snapshot run also passed; the final repeat followed tightening the database URL
guard. `gofmt` and `git diff --check` passed.

The test independently computes the specified domain-separated HMAC and uses
actual TLS WebSockets. It verifies:

- Wrong HTTPS Origin returns 403; wrong HMAC closes; correct HMAC returns ready.
- Default consent is off; rejected command recording creates no database event.
- Opt-in records only the reviewed template, verified both in the serialized
  response and by direct database readback; execution result fields stay unknown.
- Replayed event IDs do not count twice; usage reports one submission and no
  unmeasured model tokens.
- Another credential cannot read the first owner's history or use its export
  cursor; owner-field injection and non-admin administration are rejected.
- Catalog retrieval returns actual catalog results and accurately labels mode.
- Registration rotates identity and links eligible guest data; logout hides
  account data; wrong-password login rejects; correct login restores ownership.
- Export includes the stored event with a terminal null cursor; history deletion
  removes it from both subsequent RPC reads and database readback.
- Credential revocation closes its authenticated real-service socket while the
  other credential's real-service path remains usable.

No terminal process is opened by this test. No command is executed and no model
HTTP request is made. Synthetic submitted text contains only an explicit test
argument and is never printed by the test. Passwords and HMAC material are
ephemeral synthetic values and never appear in logs or committed evidence.

## Synthetic database and TLS boundaries

The old shared fixture was absent. After inspecting the exact container name,
the verifier created `terminus-intelligence-s06-tests` using the existing pinned
PostgreSQL 17 image digest from Session 04. The actual `docker run` used
`--publish 127.0.0.1:55439:5432 --env POSTGRES_HOST_AUTH_METHOD=trust` and no volume.
It applied the two exact migrations and capability-role grants, then enabled
LOGIN for that role only within this disposable database. Docker inspect readback
confirmed `HostIp=127.0.0.1`, `HostPort=55439`. It remains running for coordinating
Session 01; the coordinator owns stopping this exact container after staging.
No production database was accessed or migrated.

`start-intelligence-test-database.ps1` preserves those setup commands for future
fresh fixtures and refuses an existing same-name container. The initial successful
setup was executed directly before this wrapper was written; a fresh wrapper
creation is not claimed against the now in-use shared fixture.

Only the credential store, device resolver and TLS certificate are synthetic
boundaries. The client trusts the test server's specific certificate through an
explicit root pool and requires TLS 1.3. There is no InsecureSkipVerify, operating
system trust change, client-certificate selection bypass, user browser profile,
Tailscale mutation, hosted terminal relay or public listener. The real endpoint
and service enforce application authentication and authorization normally.

## Remaining gate

This combined test is stronger deterministic integration evidence, not a live
private-device or browser release result. The previously recorded authenticated
Chrome gate remains unresolved and production deployment is not claimed. Any
coordinator live Schannel/client-certificate probes must be recorded separately;
they were not executed by this verifier.
