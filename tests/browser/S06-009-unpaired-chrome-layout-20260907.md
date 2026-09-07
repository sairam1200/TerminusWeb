# S06-009 unpaired Chrome layout verification

Independent Session 06 verifier: `/root/intelligence_verification`.
Exact web product: `cd6a1ef32e40f41ebada2b5a36cdcbefb90346ea`.
The coordinator served this product at `http://127.0.0.1:3000` with the existing
explicit local connection profile for local UI inspection.

Installed Playwright 1.62.1 launched installed Google Chrome 152.0.7977.76
with `channel: 'chrome'` in fresh isolated headless contexts. API source was
verified against installed `playwright/package.json` and
`playwright-core/types/types.d.ts`. The Playwright skill was read; `npx` was
available but its CLI package was not installed, so the already installed library
was used without a dependency installation or a new Playwright test suite.

Commands `node tmp/s06-chrome-inspect.cjs` and
`node tmp/s06-chrome-layout.cjs` both exited 0. The first captured an accessibility
snapshot and observed navigation labels before interaction. The second used
separate desktop 1440x1000 and iPhone-sized 390x844 mobile/touch contexts,
expanded the recommendations/composer group, then clicked each observed workspace
navigation link and awaited its route.

| Route | Expected and observed heading | Desktop overflow | Mobile overflow |
| --- | --- | --- | --- |
| `/` | Terminal workspace | 0 px | 0 px |
| `/history` | Command history | 0 px | 0 px |
| `/usage` | Usage | 0 px | 0 px |
| `/account` | Private account | 0 px | 0 px |
| `/account/privacy` | Privacy and data | 0 px | 0 px |
| `/billing` | Personal prototype plan | 0 px | 0 px |
| `/admin` | Administration | 0 px | 0 px |

All seven navigation links remained within the viewport at every route; each
context reported zero page errors. Expanded composer showed history off and
the pair-first state. Full-page screenshots of desktop/mobile terminal and
privacy pages were saved only under local `output/playwright/`, alongside
`s06-unpaired-layout.json`. The verifier visually inspected both mobile captures:
privacy navigation wraps, its card fits the viewport, and the terminal composer
uses vertical scrolling below the fold. No terminal output or credential was
captured. Both contexts and their separate browser process were closed in cleanup.

This is real Chrome local unpaired UI evidence. It uses no authentication seed,
TLS bypass, customer profile, terminal command, model request or database mutation.
It does not verify iOS/Safari, physical iPhone, live WSS, paired history/account
flows, Vercel deployment or model generation. The authenticated Chrome staging
gate recorded in the component report remains blocked; these layout results do
not change S06-009 into completed end-to-end verification.
