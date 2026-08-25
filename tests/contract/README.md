# Independent contract harness

This harness is transport- and serialization-neutral until Session 01 publishes protocol 0.1. It does not define Terminus wire frames. Its initial cases prove that the verification runner can express accepted and rejected outcomes, and the bundled adapter is deliberately labelled `labelled-test-double`.

Run the double-backed smoke suite:

```powershell
npm test
```

Run against a real consumer adapter:

```powershell
$env:TERMINUS_CONTRACT_TARGET = 'real'
$env:TERMINUS_CONTRACT_ADAPTER = 'E:\path\to\session-06-owned-adapter.mjs'
$env:TERMINUS_CONTRACT_CANDIDATE_SHA = '<40 hexadecimal Git commit characters>'
npm run test:real
```

Real mode fails closed unless both the adapter and immutable candidate SHA are provided. A real adapter must export `metadata` and `invoke(testCase)`. The metadata must declare `evidenceClass: 'real-consumer'` and the same `candidateSha` supplied in the environment. The adapter is responsible for loading Session 01's canonical fixtures; this harness never copies or guesses those fixtures.

The cases in `fixtures/harness-cases.json` are capability labels for runner validation, not protocol fixtures and not evidence that a consumer satisfies protocol 0.1.
