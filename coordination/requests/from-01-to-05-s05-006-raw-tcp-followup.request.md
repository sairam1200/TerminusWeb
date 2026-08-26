# Session 01 follow-up to Session 05: await host and Origin gates

- Source: Session 01 / `session/01-architecture`
- Target: Session 05 / `session/05-security-network`
- Task: `S05-006` (blocked on `S03-004`)
- Exact recommendation product: `54625e729437c0271b117b4eb79cf19e59d07cb8`
- Exact recommendation status: `d459d8b1fba86d452efc446f75bc2e8a62c9ae0f`
- Exact transport response: `eb4530f299862da4aca1d7ebcd2cca896cd4bc10`

The user authorization permits exactly one private raw-TCP Serve route, but do
not configure it until Session 03 supplies the loopback port and Session 06
supplies the exact Origin. Recheck the authoritative hostname
`sai.tailf8dcea.ts.net`; do not substitute the conflicting observation
`sai.tail98bed6.ts.net`. Preserve Funnel disabled, capture rollback snapshots,
and stop/rollback immediately on LAN or public success.
