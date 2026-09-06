# S01-006 recovered branch assembly manifest

Date: 2026-09-06. User explicitly requested merging all branches, resolving conflicts, and retaining the best UI.

This is a local repository-recovery assembly, not the verified release manifest required by S01-002. S01-003 remains blocked on its original verification gates. Early recovery merge subjects used S01-003; S01-006 records their actual recovery scope.

## Preserved inputs

| Saved branch | Exact commit |
| --- | --- |
| origin | 4bc74e88df8a3c5f30e894b373caca444ed37655 |
| origin/integration/unverified-bootstrap | 160da449ae1621210c6065f3c57bf3133540c6b9 |
| origin/main | 4bc74e88df8a3c5f30e894b373caca444ed37655 |
| origin/session/01-architecture | aa09734f5549ea69954a8c9817a610297c261f62 |
| origin/session/02-web | d479f5b3f058d01dccc3258e6c50bb7d1865e52e |
| origin/session/02-web-renderer | 1e52575afeacba4cff2b79567b229b9d84c00686 |
| origin/session/03-windows-agent | 00faa091c89b904dc3128a823cbe282e3b48d238 |
| recovery/merge-main | 4bc74e88df8a3c5f30e894b373caca444ed37655 |
| source/integration/unverified-bootstrap | 160da449ae1621210c6065f3c57bf3133540c6b9 |
| source/main | 6717badf70a011344b2d3c6bb54d84e1c962f763 |
| source/main-sync | c2229dca74aee1ae859403cbfbe355e45f315096 |
| source/session/01-architecture | 17f028d196372992c1871433a1c73db406b5cd0a |
| source/session/02-web | 74d81a129191e902ece1ed2eb2d5916816e208ca |
| source/session/02-web-pc-close | acac9fcc5b8dc2f54945f26aac7bdf52675defbe |
| source/session/02-web-renderer | 70666fac1fc9f696f630e91f947028b6c499a2ab |
| source/session/03-windows-agent | a1a5c62874e2551ade3d994c056167007e8cdb64 |
| source/session/04-control-plane | c81f96daf444f809f615e5bc2f6b0457fdbe0b21 |
| source/session/05-security-network | a966f88c8c45744f3257b85d2f30bb1b59d3f311 |
| source/session/06-verification-release | 807042ebb6f4be3ef555897fc1f82f8ed8a2721f |
| source/session01_pre_author_rewrite_backup | 0f78c1ff65420ef2f238c097fb2a5e585e0b51b8 |

## Conflict decisions

- Use latest Session 01 protocol/security contracts, including frozen 0.1 and remembered-session 0.2. Earlier rewritten architecture history adds no newer product semantics.
- Use Session 02 renderer product d8a9b52: xterm, bilingual settings, mobile controls, session fragments, bounded history replay, New Session and browser-valid close codes. S02-006 combines main local/private profile selection with this implementation.
- Use Session 03 product 92a29e1: protocol 0.2, remembered sessions, unlocked terminal creation, replay/cleanup fencing. S03-008 restores the main-only five-minute credential expiry headroom and test.
- Control-plane product is unchanged from reviewed owner remediation; merge missing evidence and handoff history.
- Preserve all security review artifacts and independent verification harness/CI workflow. Do not adopt the pre-existing uncommitted workflow deletion.
- Temporary merge-main used older remote tips and regressed the renderer, protocol, endpoint validation and agent lifecycle. Preserve its entire history, but retain current owner implementations. Its historical deployment note remains available at recovery/merge-main; this session makes no deployment claim.
- Preserve the pre-rewrite architecture backup lineage without replacing current contracts or task queue.

## Recovery preservation

- Source repositories remain at merge-work/full-copy and merge-work/temp-work, including full-copy unresolved index, modified files, deleted workflow, and untracked scripts.
- Git bundles, original index, staged and unstaged patches: merge-work/recovery-20260906.
- Nine existing .worktrees pointers repaired using git worktree repair; they remain associated with full-copy. No worktree was reset, deleted, pruned or moved.
- Existing root files are backed up under merge-work/recovery-20260906/root-files-before-recovery before replacing tracked paths. Untracked files remain in place.
- Assembly repository: merge-work/integrated, branch integration/all-branches-20260906. After final local checks it will seed the authoritative root repository.

## Verification request

Session 06: review exact S02-006 and S03-008 product commits, branch ancestry, CI preservation, and the combined UI on desktop and iPhone-sized Chromium using local simulation only. Record real-code versus test-double evidence separately.

Known release limits: S05-008-RESOURCE-001 replay-copy aggregate memory accounting remains unresolved; physical mobile, private endpoint authentication/reconnect, wrong-peer/external-public vantage, and integrated release gates are unclaimed. No push, deployment, certificate, live host or Tailscale mutation is authorized by this recovery task.
