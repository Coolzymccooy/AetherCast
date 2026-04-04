# Lumina E2E Test Pack

This pack is for validating the live Lumina -> Aether integration end to end against the production bridge.

Use it when you want to confirm:

- Lumina can reach the Aether bridge
- Aether receives Lumina events
- scene switching works
- `Go Live` / `Stop Live` style control works on the desktop app

## Aether Prerequisites

Before testing, make sure:

1. You are using the desktop app, not only the browser app.
2. The desktop app is connected to the Aether engine.
3. At least one Aether destination is already configured with a valid URL and stream key.
4. If you use bridge auth, Lumina and Aether share the same `LUMINA_BRIDGE_TOKEN`.

Bridge endpoint:

- `https://aethercast.tiwaton.co.uk/api/lumina/bridge`

## Lumina-Side Configuration

Set these in Lumina Presenter:

| Field | Value |
|------|------|
| Bridge Endpoint URL | `https://aethercast.tiwaton.co.uk/api/lumina/bridge` |
| Bridge Token | Match `LUMINA_BRIDGE_TOKEN` in Aether if auth is enabled |
| Workspace ID | Any stable value, e.g. `sunday-service` |
| Session ID | Per-run value, e.g. `service-2026-04-04-evening` |

## Recommended Test Order

1. Ping the bridge
2. Trigger scene switch
3. Trigger start live
4. Trigger stop live
5. Repeat start live with a different scene/preset

## Helper Script

This repo now includes:

- [scripts/send-lumina-bridge-event.mjs](C:/Users/segun/source/repos/aether2/scripts/send-lumina-bridge-event.mjs)

Run it with:

```powershell
npm run lumina:bridge -- --event lumina.bridge.ping --workspace sunday-service --session rehearsal-1 --pretty
```

The script automatically reads `LUMINA_BRIDGE_TOKEN` from `.env` or `.env.local` if present.

## Test 1: Ping

```powershell
npm run lumina:bridge -- `
  --event lumina.bridge.ping `
  --workspace sunday-service `
  --session rehearsal-1 `
  --pretty
```

Expected result:

- HTTP `200`
- response body contains `{ "ok": true, "message": "accepted" }`

## Test 2: Scene Switch

```powershell
npm run lumina:bridge -- `
  --event lumina.scene.switch `
  --workspace sunday-service `
  --session rehearsal-1 `
  --payload "{""payload"":{""sceneName"":""Screen""}}" `
  --pretty
```

Expected result:

- desktop Aether server logs show a Lumina scene switch
- Aether switches to the requested scene if it exists

## Test 3: Start Live

```powershell
npm run lumina:bridge -- `
  --event lumina.stream.request `
  --workspace sunday-service `
  --session rehearsal-1 `
  --payload "{""payload"":{""action"":""start"",""sceneName"":""Screen"",""profile"":""1080p30"",""destinationNames"":[""YouTube""]}}" `
  --pretty
```

Expected result:

- desktop Aether logs `Lumina stream request: start`
- Aether optionally switches to `Screen`
- Aether starts streaming using the saved `YouTube` destination

## Test 4: Stop Live

```powershell
npm run lumina:bridge -- `
  --event lumina.stream.request `
  --workspace sunday-service `
  --session rehearsal-1 `
  --payload "{""payload"":{""action"":""stop""}}" `
  --pretty
```

Expected result:

- desktop Aether logs `Lumina stream request: stop`
- Aether stops the live stream

## Test 5: Toggle Live

```powershell
npm run lumina:bridge -- `
  --event lumina.stream.request `
  --workspace sunday-service `
  --session rehearsal-1 `
  --payload "{""payload"":{""action"":""toggle"",""sceneName"":""Cam 1""}}" `
  --pretty
```

## Test 6: Start With Preset Name

If your preset is saved in Aether as `Split Left`:

```powershell
npm run lumina:bridge -- `
  --event lumina.stream.request `
  --workspace sunday-service `
  --session rehearsal-1 `
  --payload "{""payload"":{""action"":""start"",""sceneName"":""Split Left"",""destinationNames"":[""YouTube""]}}" `
  --pretty
```

## Direct cURL Example

```bash
curl -X POST "https://aethercast.tiwaton.co.uk/api/lumina/bridge" \
  -H "Content-Type: application/json" \
  -H "x-lumina-event: lumina.stream.request" \
  -H "x-lumina-workspace: sunday-service" \
  -H "x-lumina-session: rehearsal-1" \
  -H "x-lumina-token: YOUR_TOKEN_IF_ENABLED" \
  -d '{
    "payload": {
      "action": "start",
      "sceneName": "Screen",
      "profile": "1080p30",
      "destinationNames": ["YouTube"]
    }
  }'
```

## Failure Cases To Watch

- `400 missing_required_headers`
  Missing one of the required Lumina headers.

- `400 unknown_event_type`
  The `x-lumina-event` value is not one Aether accepts.

- `401 unauthorized`
  The bridge token is enabled server-side and Lumina sent the wrong token.

- Aether logs `no matching Aether destinations were found`
  Lumina requested destination names or ids that do not match Aether’s saved destinations.

- Aether logs `is not fully configured in Aether`
  The destination exists but is missing a URL or stream key.

## Expected Aether Log Messages

Healthy stream-control flow should produce some of these:

- `Lumina stream control request received`
- `Lumina stream request: start`
- `Lumina prepared scene 'Screen' before going live.`
- `Lumina started the live stream.`
- `Lumina stream request: stop`
- `Lumina stopped the live stream.`

## Production Validation Checklist

- Bridge ping returns `200`
- Aether desktop shows `Engine Connected`
- Scene switch works from Lumina payload
- Start request goes live without operator clicking Aether's button
- Stop request ends stream cleanly
- Aether keeps using its own saved destination configuration
