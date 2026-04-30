# Virtual Camera Backend

## Current Scope

The desktop app now includes a native virtual-camera backend runtime.

What it does today:

- renders the current native-scene program feed in Rust
- publishes raw RGBA frames over a local WebSocket bridge
- tracks backend health, consumers, frame counts, and last-frame age
- exposes lifecycle commands through the Tauri desktop app

What it does **not** do yet:

- register a Windows webcam device that appears directly in Zoom, Meet, or Teams
- ship a custom Windows media-source / device-registration layer

That OS-facing device layer is the remaining step for a true webcam-style virtual camera.

## Desktop Commands

From the desktop app context:

- start:
  - `window.__AETHER_START_VIRTUAL_CAMERA__?.({ width: 1280, height: 720, fps: 30 })`
- stop:
  - `window.__AETHER_STOP_VIRTUAL_CAMERA__?.()`
- diagnostics:
  - `window.__AETHER_EXPORT_NATIVE_DIAGNOSTICS__?.()`

## Expected Status

The native engine reports the virtual-camera backend in native stats:

- backend: `native-scene-ws`
- transport: `raw-rgba-ws`
- `os_device_exposed: false`

That `false` value is intentional until the Windows webcam-device layer is added.

## Next Step

To make this a real OS webcam, add a Windows media-source / virtual-camera device component that consumes the local bridge and registers a camera visible to conferencing apps.
