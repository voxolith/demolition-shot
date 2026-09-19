<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/voxolith/.github/main/profile/lockup-dark.svg">
    <img alt="Voxolith — WebGPU voxel engine" src="https://raw.githubusercontent.com/voxolith/.github/main/profile/lockup.svg" width="420">
  </picture>
</p>

# Demolition Shot

Aim, release, watch it crumble. A mobile-first voxel demolition game and the showcase for
[`@voxolith/renderer`](https://github.com/voxolith/renderer), the WebGPU voxel raymarcher.

**Play:** <https://voxolith.github.io/demolition-shot/> (installable: Add to Home Screen)

Each level is a small voxel structure on a pedestal. You get one to three cannonballs. Pull back
anywhere on the screen to aim (the arc previews where the ball goes), release to fire. Anything the
impact disconnects from the pedestal falls as chunks, tumbles, and shatters when it lands hard. Win by
knocking the target percentage of the structure off the platform. Three stars for a first-ball win.

## Controls

| gesture | action |
|---|---|
| one finger, pull back and release | aim and fire (pull length = power, pull direction = angle) |
| short tap | cancel |
| two fingers drag | orbit the camera |
| pinch | zoom |
| mouse | same: drag to aim, right-drag or wheel not needed |

## What the engine does here

- One dense `128 × 96 × 128` grid. The pedestal, the structure and settled rubble live in the
  stamper's base plate; the cannon, the ball, flying chunks, debris and dust are stamped each frame
  and uploaded as one dirty box (`GridStamper`, `OccupancyGrid.updateBox`).
- Permanent edits (carving, rubble) go through `GridStamper.writeBase`, no full re-upload.
- Ball flight and the aim preview use the CPU `voxelRaycast`.
- Collapse is connectivity: after each impact a flood fill from the voxels resting on the pedestal
  finds everything unsupported, groups it into chunks and hands them to the physics.
- The frame loop renders on demand (`makeFrameLoop`): a settled scene costs nothing until you touch it.
- Render quality presets, adaptive resolution and the software-adapter check come from the engine
  (`setQuality`, `makePerf`, `gpu.software`).

Sound is synthesised with WebAudio (no assets), vibration uses `navigator.vibrate` where available,
and a small service worker makes the game installable and playable offline after the first visit.

## Levels

Twelve built-in generators live in `src/game/levels/generators.ts` (tower, hut, totem, arch, twin
towers, pyramid, dominoes, chimney, castle wall, bridge, temple, treehouse). Each is a few dozen lines
that place voxels in local space with small seeded variation per attempt.

Any MagicaVoxel `.vox` is also a level: Settings → *Load a .vox as a level*. Author one in the
[Voxolith Editor](https://voxolith.github.io/editor/), keep it under about 50 voxels wide and tall,
and its palette is remapped automatically.

## Development

```sh
bun install
bun run dev        # https://localhost:5173 (open the LAN https URL on your phone, accept the cert)
bun run verify     # headless simulation checks, no GPU
bun run build
```

Debug URL params: `?level=3` opens a level directly, `&auto=aim` shows the aim preview,
`&auto=fire` fires a shot immediately, `?perf` shows the frame-time overlay and the adapter.

This repo depends on `@voxolith/renderer` as `workspace:*`; clone it next to this folder and
`bun install` from a workspace root that lists both. The UI colours come from the Voxolith brand tokens
(`src/brand/`, generated from the private branding repo).

## Deploy

Every push to `main` builds and publishes to GitHub Pages via `.github/workflows/pages.yml`
(`BASE_PATH=/demolition-shot/`).

## License

MIT
