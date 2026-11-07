# STATUS.md

Build status, updated at each milestone. The final pass rewrites this file
with exactly what was verified, what was not, and the first commands to run.

## Milestone 1 — scaffold

- Electron Forge 8 + Vite 8 + React 19 + TypeScript 6 scaffold.
- Engine skeleton (`config.ts`, `types.ts`, `lexicon.ts`, `stats.ts`).
- Tests green (vitest), lint + typecheck green.
- `npm run dev -- --sim` boots under Xvfb (verified with
  `node scripts/smoke-sim.mjs`).
- `@smartspectra/node-sdk@3.4.0` installed; the linux-x64 native runtime loads
  in plain Node in the build container.
