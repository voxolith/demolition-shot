# AGENTS.md: demolition-shot

Demolition Shot, a mobile-first voxel demolition game and the engine's showcase. It lives at
https://voxolith.github.io/demolition-shot/ and is installable as a PWA. Pull back to aim, release
to fire; whatever the impact disconnects from the pedestal falls in chunks and shatters.

## Commands

```sh
bun run --cwd demolition-shot dev      # https://localhost:5173
bun run --cwd demolition-shot build    # tsc --noEmit + vite build (what CI runs)
bun run --cwd demolition-shot verify   # headless checks of the demolition simulation, no GPU
```

Siblings needed: renderer, engine.

## Map

- `src/game/`: levels, the cannon, the structure and connectivity, physics, vfx and scoring.
- `src/ui/`: input (the slingshot state machine, on the engine's input core), screens, audio,
  haptics and progress.
- `src/pwa.ts`: service worker and install.
- `src/main.ts`: wiring.

## How it uses the engine

- One dense `128 × 96 × 128` grid. The pedestal, the structure and settled rubble live in the
  stamper's base plate. Everything that moves is stamped each frame and uploaded as one dirty box
  (`GridStamper`, `OccupancyGrid.updateBox`). Permanent edits go through `GridStamper.writeBase`.
- Ball flight and the aim preview use the CPU `voxelRaycast`.
- Collapse is connectivity: a flood fill from the voxels resting on the pedestal finds what is
  unsupported.
- Keep it phone-first. Test touch (pull, tap to cancel, two-finger orbit, pinch) on a real phone
  when you change input or layout, and keep the frame on demand outside flights.

## App rules

- **Deployment.** Every push to `main` deploys to GitHub Pages under `/<repo>/`
  (`.github/workflows/pages.yml`). The workflow checks the sibling repos out alongside to satisfy
  `workspace:*` and builds with `BASE_PATH=/<repo>/`. Never hard-code absolute URLs: fetch with
  `import.meta.env.BASE_URL` and link pages relatively. CI's required job is `build`.
- **Vite.** `optimizeDeps: { exclude: ["@voxolith/renderer"] }` stays in `vite.config.ts`
  (the renderer ships raw TypeScript and imports shaders with `?raw`).
- **Input** comes from `@voxolith/engine/input` only, never raw listeners:
  - one `createInput(canvas, { loop })` per surface;
  - `prepareSurface(canvas)` instead of per-app `touch-action` CSS;
  - `makeOrbitController` / `makeLookController` for cameras;
  - `recogniseGestures` for taps, `makeActions` for game controls, `makeTouchControls` for
    on-screen sticks.
- **Render on demand.** Use `makeFrameLoop`: `invalidate()` on camera, scene or viewport changes,
  and `setContinuous(true)` only while something animates (water on screen counts). Quality is
  the engine's presets behind a select stored as `voxolith-quality`. Software adapters
  (`gpu.software`) warn and start on Low.
- **Branding.** `src/brand/tokens.css` and `src/brand/theme.ts` are generated copies from the
  private `branding` repo: never edit them here. Use the tokens (`--bg`, `--surface`,
  `--accent`, ...), never hex colours in CSS. Dark is the default theme.

## Working in the Voxolith repos

- **Layout.** Every Voxolith repo is checked out side by side under one bun workspace root, and
  depends on its siblings as `"workspace:*"`. Run `bun install` from that root, never inside a
  repo. [CONTRIBUTING](https://github.com/voxolith/.github/blob/main/CONTRIBUTING.md) lists
  which siblings each repo needs.
- **Toolchain: bun only.** There is no npm or node step anywhere. It is TypeScript 7 and Vite 8;
  scripts run `tsc`, `vite` and `bun tools/x.ts`. Use current dependency versions.
- **`tsconfig.base.json` is byte-identical in every repo**, because consumers compile the
  renderer's and engine's sources under their own flags. Change it everywhere or nowhere.
- **WebGPU, not WebGL.** Dev servers are HTTPS (`@vitejs/plugin-basic-ssl`), because WebGPU needs a
  secure context. Checks cannot see pixels: anything that changes what is drawn must be looked
  at in a WebGPU browser, with a before/after screenshot in the pull request.
- **Docs live on the site** ([voxolith.github.io](https://voxolith.github.io/docs/), repo
  `voxolith.github.io`). READMEs stay short and link there. The API reference is generated from
  the sources, so doc comments are published content: every exported symbol has a `/** */`, and
  entry files open with `@packageDocumentation`.
- **Credit research.** When an idea comes from a paper, cite it (authors, title, venue, DOI) in
  the code comment, in the docs (the page's References and `/docs/credits/`) and in the commit
  body. Check the citation against the paper or DataCite; don't cite from memory.
- **Prose.** British spelling in prose and comments (`colour`, `normalise`); identifiers follow the
  web platform (`lightColor`). "Voxolith" is capitalised in prose; lowercase is only for the
  wordmark.
- **Commits.** History is linear and read as prose:
  - The subject says what is now true, in plain words: no `feat:` prefixes, no trailing full
    stop, about 70 characters at most.
  - The body says why, what it costs and what it deliberately does not do, wrapped at about 72
    columns.
  - One change per commit. AI-assisted commits keep their `Co-Authored-By` trailer.
  - Pull requests are squash-merged or rebased; there are no merge commits.
  - Don't push, tag or publish unless asked.
- **Community files** (CONTRIBUTING with the AI policy, CODE_OF_CONDUCT, SECURITY, templates) live
  once in `voxolith/.github` and apply org-wide; don't copy them in here.
- **CI's job names are required checks** on `main` (rulesets). Renaming a job breaks merging.
