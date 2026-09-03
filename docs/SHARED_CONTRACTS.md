# Shared Contract Governance

Session 01 owns shared contracts. Other sessions consume them and submit changes through `coordination/requests/`.

## Contract artifacts

- `packages/protocol/`: versioned frame schemas, compatibility rules, fixtures, and generated artifacts if later approved.
- `packages/security/`: pairing, authentication, key lifecycle, replay protection, origin validation, and threat assumptions.
- `docs/ARCHITECTURE.md`: deployable boundaries and data paths.
- `coordination/facts.md`: verified project facts and approved decisions.

## Initial protocol surface

The architecture session must define and freeze version `0.1` before integration. The expected capabilities are:

- negotiation/hello;
- pairing request and confirmation;
- authentication challenge and response;
- open session;
- terminal input and output;
- resize;
- heartbeat;
- detach/reconnect;
- close;
- structured error.

This list is a capability requirement, not permission for other sessions to invent incompatible frame shapes.

## Change process

1. Requesting session creates immutable `coordination/requests/from-SS-to-01-id.request.md`.
2. Include the observed incompatibility, evidence, proposed semantic change, compatibility impact, and required tests.
3. Session 01 responds in its own immutable `coordination/requests/from-01-to-SS-id.response.md`, then records an accepted decision in `coordination/facts.md`.
4. Session 06 adds or updates independent contract tests.
5. Consumers update only after the revised contract is versioned.

## Compatibility rule

During the prototype, breaking changes are allowed only through an explicit version bump and coordinated consumer update. Unknown message types, unsupported versions, oversized payloads, invalid state transitions, and replayed sequence values must fail closed.
