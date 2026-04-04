# Desktop 8-Hour Stability Test Plan

## Goal

Prove that the Tauri desktop path can sustain long-form live sessions with predictable recovery and no silent failure.

This plan is for the desktop/native engine path, not the browser compatibility path.

## Test Environment

- Windows 11 desktop or laptop on mains power
- Tauri desktop build `v1.0.10`
- Stable wired or high-quality Wi-Fi uplink
- At least 2 destinations when testing output isolation
- FFmpeg available in the packaged app or system path
- Local archive disk with at least 30 GB free

## Preflight

1. Disable system sleep, display sleep, and USB selective suspend for the test machine.
2. Close non-essential apps, especially anything that may grab camera/mic devices.
3. Verify the desktop app can see:
   - local camera(s)
   - microphone
   - screen share
   - at least one remote phone feed if remote-source testing is included
4. Configure at least one live destination and confirm local archive is enabled.
5. Start the desktop app and confirm native mode is active, not browser mode.
6. Open devtools only if needed for diagnostics export. Avoid heavy debug overhead during the main soak.

## Core 8-Hour Soak

### Test 1. Single-destination baseline

Purpose:
- Validate continuous 8-hour streaming with archive continuity.

Steps:
1. Start a desktop native stream to one destination.
2. Keep these sources active for the full session:
   - one local camera
   - one screen share or media loop
   - one microphone or system audio source
3. Switch scenes every 5 to 10 minutes.
4. Observe the stream every 30 minutes.
5. After 8 hours, stop the stream cleanly.
6. Export diagnostics with `window.__AETHER_EXPORT_NATIVE_DIAGNOSTICS__?.()`.
7. Run `npm run diagnostics:check -- <diagnostics-file.json>`.

Pass criteria:
- no unexpected stream stop
- no output in permanent `error` state
- diagnostics check passes
- local archive segments are present and playable

### Test 2. Multi-destination isolation

Purpose:
- Validate that one bad destination does not kill the session.

Steps:
1. Start with two enabled destinations plus local archive.
2. During the stream, intentionally break one destination:
   - disable the upstream key
   - point one destination to a bad RTMP/SRT target
   - or disconnect only that upstream route if possible
3. Leave the second destination valid.
4. Continue the session for 30 minutes.

Pass criteria:
- healthy destination remains live
- archive remains active
- failed destination enters `recovering` or `error` without collapsing the whole session

### Test 3. Source churn

Purpose:
- Validate source lifecycle stability under real operator usage.

Steps:
1. Start the native stream.
2. Repeatedly:
   - switch scenes
   - start/stop screen share
   - connect/disconnect phone screen share
   - connect/disconnect phone camera
   - start/stop media loop
3. Run this churn for at least 45 minutes.

Pass criteria:
- stream stays live
- native source statuses recover cleanly
- no silent frozen output

### Test 4. UI resilience

Purpose:
- Validate that short UI stalls do not kill the desktop session.

Steps:
1. Start the desktop native stream.
2. Stress the UI lightly:
   - open/close settings modals
   - switch tabs
   - change scenes rapidly for 2 to 3 minutes
3. Watch diagnostics after the run.

Pass criteria:
- stream stays live
- if the UI frame loop stalls, `watchdog_renders` is non-zero and the stream still survives

## Fault Injection

### Test 5. Network interruption

Purpose:
- Validate destination recovery and archive continuity.

Steps:
1. Start a native stream.
2. Disconnect network for 30 to 90 seconds.
3. Restore network.
4. Continue for another 20 minutes.

Pass criteria:
- archive remains usable
- outputs recover according to protocol backoff
- app does not require restart

### Test 6. Camera device recovery

Purpose:
- Validate camera hot-plug behavior.

Steps:
1. Start stream with a local camera.
2. Unplug the camera or disable it temporarily.
3. Reconnect it.
4. Continue streaming.

Pass criteria:
- stream stays up
- source health reflects failure and recovery
- no permanent black frame unless the device truly fails to return

### Test 7. Phone feed interruption

Purpose:
- Validate bridged remote source recovery.

Steps:
1. Start desktop stream with phone camera or phone screen share active.
2. Lock the phone briefly or force the phone feed to disconnect.
3. Reconnect the phone feed.

Pass criteria:
- desktop stream remains live
- native source status updates correctly
- reconnect does not require app restart

## Quality Checks

### Test 8. Archive integrity

Purpose:
- Validate that the local safety archive is useful after a live fault.

Steps:
1. Complete any of the long tests above.
2. Inspect the generated archive folder.
3. Open several segments across:
   - beginning
   - middle
   - end

Pass criteria:
- files are present
- files are playable
- segment boundaries are acceptable for recovery usage

### Test 9. Audio sanity

Purpose:
- Validate basic native audio bus behavior.

Steps:
1. Stream with microphone and system audio enabled.
2. Change per-bus volume.
3. Mute/unmute microphone and system.
4. Apply delay if needed.

Pass criteria:
- muting works
- gain changes are audible
- no obvious runaway echo or drift over a 30-minute window

## Required Diagnostics Review

For every soak/fault run:

1. Export diagnostics:
   - `window.__AETHER_EXPORT_NATIVE_DIAGNOSTICS__?.()`
2. Run:
   - `npm run diagnostics:check -- <diagnostics-file.json>`
3. Review manually:
   - `restartCount`
   - `watchdogRenders`
   - `maxFrameAgeMs`
   - `archiveState`
   - `archiveRestartCount`
   - per-output states and restart counts

## Release Gate

Do not claim 8-hour stability until all are true:

- 8-hour baseline passes
- multi-destination isolation passes
- network interruption recovery passes
- archive integrity passes
- diagnostics check passes on all primary runs
- no unexplained stream stop remains

## Known Limits

This plan validates the current native desktop architecture. It does not prove:

- true Rust-side native WebRTC receive
- real browser-page runtime capture
- out-of-process media service isolation

Those are still future architecture steps, not part of this soak plan.
