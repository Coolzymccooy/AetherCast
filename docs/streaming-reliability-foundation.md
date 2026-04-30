# Streaming Reliability Foundation

Branch: `feature/streaming-reliability-foundation`

## User Goals

The branch exists to make Aether reliable for real live production:

1. Stream cleanly to any supported destination.
2. Keep multi-destination streaming stable when several outputs are enabled.
3. Avoid buffering, bursty transport, and visible stalls while live.
4. Sustain long sessions, including 2+ hour streams, until the user stops the stream.

## Product Direction

- Desktop native streaming is the production path.
- Browser streaming remains compatibility mode only.
- Per-destination isolation is required. One failing destination must not take down the others.
- Long-session reliability must be proven with soak testing and diagnostics, not assumed.

## First Slice Completed On This Branch

`src-tauri/src/engine/output.rs`

- Output workers now receive unique `worker_id` values even when destinations resolve to the same masked display target.
- The native output planner now rejects exact duplicate enabled targets before the session starts.
- Rust unit tests now cover worker id uniqueness, duplicate-target rejection, and Twitch ingest normalization.

This is a foundation change for multi-destination stability. Without unique worker identities, per-output monitoring and recovery can collapse when two outputs look the same to the runtime.

## Second Slice Completed On This Branch

`src-tauri/src/engine/service.rs`

- Native `start_stream` now launches isolated per-output workers instead of the legacy shared FFmpeg runtime.
- Worker startup now fails with per-worker attribution, so the runtime can identify which destination or archive worker failed to boot.
- Partial worker startup now cleans up already-started workers instead of leaving the session in a half-live state.
- The native start status now reports `native output workers`, matching the actual runtime path.

This is the first change on the branch that materially improves the architecture for multi-destination streaming under live load. It aligns the runtime with the branch goal: each output is now a supervised unit instead of one shared process.

## Next Slices

1. Finish hardening the native output runtime:
   - per-worker startup failure attribution
   - clearer fatal vs recoverable output errors
   - stronger restart accounting and health summaries
2. Make the desktop path the only recommended production path in the UI:
   - browser mode labeled compatibility
   - warnings for long-session browser streaming
3. Add soak and fault tooling:
   - scripted long-session diagnostics capture
   - destination fail/recover test checklist
4. Decision gate:
   - continue the custom Rust engine, or
   - run a `libobs` integration spike in `src-tauri`

## Release Bar For This Branch Family

Do not claim parity with OBS/vMix/Wirecast until all of these are true:

- one output can fail without stopping the others
- archive recording survives live-output faults
- the stream survives long desktop sessions
- output health can explain failures after the fact
- the desktop runtime is the default production recommendation
