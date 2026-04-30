# Native 8-Hour Hardening

## Statement Of Intent

This hardening pass exists to make AetherCast stable enough to become the streaming backbone for Lumina.

Success is defined as:

- sustained 8-hour native desktop streaming
- continuous local archive capture during the live session
- destination isolation, so one failed upstream does not collapse the whole stream

## Scope

- In scope: `aether2` native desktop streaming on the custom Rust engine
- Out of scope: browser compatibility streaming as the primary long-session path
- Out of scope: Lumina bridge contract changes
- Out of scope: `libobs` migration or Tauri sidecar migration in this branch

Browser streaming remains compatibility mode only. It is not the production guarantee for this hardening milestone.

## Branch Commitments

- Archive is started as its own worker even when Twitch is one of the live destinations.
- Output, archive, and source health must expose state, restart count, recovery delay, last event, and last error in runtime diagnostics.
- Native camera capture may fail independently from the browser-owned fallback path. Browser-fed source frames are allowed to keep the stream alive, but they must not hide native capture errors.
- Native-scene rendering must scale scene coordinates into the actual output size so reduced-resolution live outputs render the full scene instead of a cropped quadrant.

## Soak Artifact Workflow

At the end of a desktop soak or fault-injection run:

1. Open devtools in the desktop app.
2. Run `window.__AETHER_EXPORT_AND_CHECK_NATIVE_DIAGNOSTICS__?.()`.
3. Confirm the helper writes a JSON artifact under `artifacts/native-soaks/`.
4. Review the returned `check_passed`, `stdout`, and `stderr` fields.

Manual fallback remains available with `window.__AETHER_EXPORT_NATIVE_DIAGNOSTICS__?.()`, but the export-and-check helper is the preferred workflow for release gating.

## Release Gate

Do not claim native 8-hour readiness until all of the following are true:

- 8-hour native soak passes with no unexpected stop
- `npm run diagnostics:check -- <artifact>` passes
- stream `restartCount <= 3`
- `maxFrameAgeMs <= 5000`
- `degradedRatio <= 0.1`
- no final live output ends in `error`
- archive never ends in `error`
- desktop fault matrix in [desktop-soak-test-plan.md](./desktop-soak-test-plan.md) passes
- one manual Lumina-to-Aether smoke passes without changing the current `/api/lumina/bridge` contract
