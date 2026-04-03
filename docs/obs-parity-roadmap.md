# OBS-Class Architecture Roadmap

## Goal

Bring AetherCast desktop mode to the point where it can credibly compete with OBS/vMix/Wirecast for long-form live production on Windows.

This does not mean "keep hardening the browser path forever." The browser/server path remains compatibility mode. The desktop/Tauri path becomes the primary production engine.

## Current State

The current stack has improved materially, but it still falls short of broadcast-grade architecture:

- Browser mode still depends on `MediaRecorder -> Socket.io -> server FFmpeg` in [useStreaming.ts](/c:/Users/segun/source/repos/aether2/src/hooks/useStreaming.ts) and [server.ts](/c:/Users/segun/source/repos/aether2/server.ts).
- Desktop mode still originates frames from the web compositor canvas in [useGPUStreaming.ts](/c:/Users/segun/source/repos/aether2/src/hooks/useGPUStreaming.ts).
- Desktop frames still enter FFmpeg as JPEG/image pipe in [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs).
- Desktop audio is not yet a real native broadcast mixer. Synthetic fallback is still present in [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs).
- The Tauri app is stronger than the browser path, but it is still a custom encoder path rather than a full native media runtime.

## Recommended Direction

Use Tauri as the control UI, but move live media ownership into a native media engine.

Recommended implementation path:

1. Build a dedicated native media service boundary first.
2. Keep browser streaming as compatibility mode only.
3. Integrate a native broadcast engine, preferably `libobs`, unless a prototype proves it is unworkable for this product.
4. If `libobs` integration is rejected, commit fully to a custom Rust engine using native video/audio APIs. Do not keep half-solving the problem in the browser.

## Target Architecture

```text
+-----------------------------+
| React / Tauri UI            |
| scenes, controls, telemetry |
+-------------+---------------+
              |
              | RPC / event bridge
              v
+-----------------------------+
| Native Media Service        |
| owns stream/record runtime  |
| survives UI restarts        |
+------+------+------+--------+
       |      |      |
       |      |      +-------------------+
       |      |                          |
       v      v                          v
+----------+ +----------------+ +------------------+
| Video    | | Audio Engine   | | Output Manager   |
| sources  | | WASAPI mixer   | | RTMP/SRT/RIST    |
| scenegraph| | sync/monitor  | | local archive    |
+----------+ +----------------+ +------------------+
       |               |                  |
       +---------------+------------------+
                       |
                       v
              +------------------+
              | Telemetry/Health |
              | recovery/watchdog|
              +------------------+
```

## Non-Negotiable Capabilities For Parity

- UI crash or reload must not kill the stream.
- One destination failure must not stop other outputs.
- Local archive recording must continue even if live output fails.
- Audio and video must stay in sync over long sessions.
- Devices must survive unplug/replug and sleep/wake events.
- Encoder death must be supervised and recoverable.
- Long sessions must be proven by soak testing, not assumed.

## Required Workstreams

### 1. Native Runtime Ownership

What is needed:

- A long-lived native service/worker outside the current webview render loop.
- Clear command surface for start, stop, scene update, output update, record start, record stop, telemetry subscribe.
- Persistent runtime state independent of React component lifecycle.

Repo impact:

- [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs) should stop being a monolith.
- Create `src-tauri/src/engine/` for the actual runtime.
- Create `src/hooks/useNativeEngine.ts` as the new frontend control hook.
- Reduce [useGPUStreaming.ts](/c:/Users/segun/source/repos/aether2/src/hooks/useGPUStreaming.ts) to a transitional compatibility wrapper.

### 2. Native Video Pipeline

What is needed:

- Replace `canvas -> JPEG -> FFmpeg` with a native frame path.
- Native source graph for camera, screen, browser, media, and phone inputs.
- Native compositor for scenes, transforms, crops, z-order, scaling, and transitions.

Repo impact:

- Current compositor logic in `src/lib/webglCompositor.ts` and `src/components/Compositor.tsx` becomes UI preview logic or scene-authoring logic, not the production renderer.
- Add native scene/source definitions under `src-tauri/src/engine/video/`.
- Add a shared scene schema in `src/lib/sceneSchema.ts`.

### 3. Native Audio Engine

What is needed:

- WASAPI capture for mics/system audio.
- Per-bus mixer with mute/solo, monitor, delay, gain staging.
- Clock discipline and drift correction.
- Loudness metering and limiter/compressor parity with current UI expectations.

Repo impact:

- Current browser-side mix path in [audioEngine.ts](/c:/Users/segun/source/repos/aether2/src/lib/audioEngine.ts) is not enough for parity.
- Add `src-tauri/src/engine/audio/` with device capture, mix graph, and telemetry.
- Keep browser audio as preview/compatibility, not production authority.

### 4. Output And Recording Layer

What is needed:

- Per-destination output sessions.
- RTMP/RTMPS, SRT, and RIST support with isolation and retry policy.
- Always-on local recording while live.
- Safer container defaults for crash survival.

Repo impact:

- Current FFmpeg command construction in [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs) and [server.ts](/c:/Users/segun/source/repos/aether2/server.ts) becomes output manager logic, not app-level inline logic.
- Add `src-tauri/src/engine/output/`.
- Add `src-tauri/src/engine/archive/`.

### 5. Recovery, Telemetry, And Diagnostics

What is needed:

- Runtime heartbeat independent of UI.
- Structured restart reasons.
- Queue depth, dropped frames, output RTT, encoder load, device state, archive state.
- Session event log export.

Repo impact:

- Extend native stats beyond the current `get_stream_stats` shape in [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs).
- Add `src-tauri/src/engine/telemetry.rs`.
- Replace log-only recovery with a formal state machine.

### 6. Device Management

What is needed:

- Stable device identity and automatic remapping.
- Hot-plug recovery.
- Sleep/wake handling.
- Screen capture permission/session recovery.

Repo impact:

- Add `src-tauri/src/engine/devices/`.
- Keep phone/WebRTC sources integrated, but they feed the native scene graph instead of directly feeding browser-only renderer assumptions.

### 7. Browser Compatibility Mode

What is needed:

- Keep [useStreaming.ts](/c:/Users/segun/source/repos/aether2/src/hooks/useStreaming.ts) and [server.ts](/c:/Users/segun/source/repos/aether2/server.ts) for non-desktop fallback only.
- Make UI messaging explicit that browser mode is not the recommended long-session production path.

Repo impact:

- [App.tsx](/c:/Users/segun/source/repos/aether2/src/App.tsx) should clearly prefer native engine when Tauri is available.
- Browser streaming stays maintained, but no longer drives architecture decisions.

## Repository Ownership Map

### Current To Target Mapping

| Current Area | Current File(s) | Target Ownership |
|---|---|---|
| Desktop streaming control | [useGPUStreaming.ts](/c:/Users/segun/source/repos/aether2/src/hooks/useGPUStreaming.ts) | `src/hooks/useNativeEngine.ts` |
| Native runtime monolith | [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs) | `src-tauri/src/engine/*` + thin command layer |
| Browser stream pipeline | [useStreaming.ts](/c:/Users/segun/source/repos/aether2/src/hooks/useStreaming.ts), [server.ts](/c:/Users/segun/source/repos/aether2/server.ts) | Compatibility path only |
| Browser audio engine | [audioEngine.ts](/c:/Users/segun/source/repos/aether2/src/lib/audioEngine.ts) | Preview/compatibility only |
| Scene rendering | `src/components/Compositor.tsx`, [webglCompositor.ts](/c:/Users/segun/source/repos/aether2/src/lib/webglCompositor.ts) | UI preview + shared scene authoring, not production renderer |
| Telemetry | `useTelemetry.ts`, ad hoc logs | Native telemetry service + UI subscriber |

## Phase Plan

### Phase 0. Architecture Freeze

Duration:

- 3 to 5 days

Deliverables:

- Approve native-first direction.
- Decide whether Phase 2 will integrate `libobs` or continue custom native rendering.
- Create engine module layout under `src-tauri/src/engine/`.
- Add feature flag: `nativeEngineMode = legacy | service | obs`.

Acceptance criteria:

- No new production features are added on the browser path until desktop engine direction is fixed.
- All future streaming changes reference this roadmap.

### Phase 1. Native Service Boundary

Duration:

- 1 to 2 weeks

Deliverables:

- Extract stream runtime from [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs) into `engine/service.rs`.
- Introduce command/event bridge between UI and service.
- Service owns stream state, record state, destination state, and telemetry.
- UI can reconnect to the service without killing the stream.

Acceptance criteria:

- Restarting the Tauri window does not terminate a live stream.
- Encoder process lifecycle is owned by the service, not the React hook.

### Phase 2. Output And Archive Hardening

Duration:

- 1 to 2 weeks

Deliverables:

- Per-destination session management.
- Reliable local archive enabled by default while live.
- Clear reconnect/backoff policy by protocol.
- Structured output health model.

Acceptance criteria:

- Killing one output does not terminate the others.
- Archive continues when an output fails.

### Phase 3. Native Audio Engine

Duration:

- 2 to 4 weeks

Deliverables:

- WASAPI input capture.
- Native bus mixing and metering.
- Monitor and delay controls.
- Audio/video sync handling.

Acceptance criteria:

- No dependence on `anullsrc` for steady operation.
- Stable sync over 2-hour sessions.

### Phase 4. Native Video Path

Duration:

- 3 to 6 weeks

Deliverables:

- Replace JPEG/image pipe as primary production transport.
- Native source graph and scene graph.
- Native rendering/composition.
- Shared scene schema between UI and engine.

Acceptance criteria:

- Desktop production render does not depend on browser canvas frames.
- Quality loss from JPEG transport is eliminated.

### Phase 5. Device And Source Robustness

Duration:

- 2 to 3 weeks

Deliverables:

- Camera hot-plug recovery.
- Mic hot-plug recovery.
- Screen capture recovery.
- Phone/WebRTC source lifecycle integrated into native scene graph.

Acceptance criteria:

- Device disconnect/reconnect is recoverable without app restart.
- Sleep/wake does not silently leave dead inputs.

### Phase 6. Telemetry, QA, And Release Gates

Duration:

- 2 weeks minimum, then ongoing

Deliverables:

- Structured telemetry dashboard.
- Session diagnostics export.
- Automated soak and chaos tests.
- Release checklist.

Acceptance criteria:

- 8-hour soak passes on desktop.
- Destination fail/recover tests pass.
- Encoder crash/restart path passes.
- Archive integrity check passes.

## Recommended File Layout

```text
src-tauri/src/
  engine/
    mod.rs
    service.rs
    commands.rs
    state.rs
    telemetry.rs
    recovery.rs
    video/
      mod.rs
      scene.rs
      sources.rs
      compositor.rs
    audio/
      mod.rs
      capture.rs
      mixer.rs
      monitor.rs
    output/
      mod.rs
      manager.rs
      rtmp.rs
      srt.rs
      rist.rs
    archive/
      mod.rs
      recorder.rs
    devices/
      mod.rs
      registry.rs
      recovery.rs
```

```text
src/
  hooks/
    useNativeEngine.ts
    useStreaming.ts         # browser compatibility only
    useGPUStreaming.ts      # transitional adapter until removed
  lib/
    sceneSchema.ts
    outputSchema.ts
    telemetrySchema.ts
```

## First Tickets To Execute

1. Extract the native runtime from [main.rs](/c:/Users/segun/source/repos/aether2/src-tauri/src/main.rs) into `src-tauri/src/engine/service.rs`.
2. Add `useNativeEngine.ts` and make [App.tsx](/c:/Users/segun/source/repos/aether2/src/App.tsx) call it instead of directly owning stream lifecycle in [useGPUStreaming.ts](/c:/Users/segun/source/repos/aether2/src/hooks/useGPUStreaming.ts).
3. Add a formal native telemetry model and replace stringly logs for restart/output/archive state.
4. Add default local archive policy for every native live session.
5. Decide `libobs` integration vs custom native compositor before touching more browser-rendered streaming logic.

## Decision Gate: libobs Or Custom Rust

Default recommendation:

- Choose `libobs` if time-to-parity matters most.

Choose custom Rust engine only if:

- You accept a longer roadmap.
- You want tighter ownership of the stack.
- You are prepared to build video, audio, rendering, and device recovery subsystems yourself.

## Release Criteria For Claiming "OBS-Class"

Do not make the parity claim until all of these are true:

- 8-hour live test passes on Windows.
- UI restart does not kill the stream.
- Output failover behaves predictably.
- Local archive is continuous and playable.
- Audio remains in sync across long sessions.
- Camera, mic, screen, and phone sources recover from transient faults.
- Operational telemetry is good enough to explain any failure after the fact.

## Immediate Recommendation

The next implementation pass should be:

1. Extract native service boundary.
2. Add structured telemetry/state model.
3. Make browser streaming explicitly secondary.
4. Then make the `libobs` vs custom-native decision before building more renderer code.
