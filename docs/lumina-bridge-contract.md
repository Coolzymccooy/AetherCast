# Lumina Bridge Contract

This document defines the exact HTTP bridge contract Lumina Presenter should use when controlling Aether Studio.

## Endpoint

- Production bridge URL: `https://aethercast.tiwaton.co.uk/api/lumina/bridge`

## Required Headers

Every Lumina bridge request must send:

- `x-lumina-event`
- `x-lumina-workspace`
- `x-lumina-session`

Optional:

- `x-lumina-token`
  Must match `LUMINA_BRIDGE_TOKEN` in Aether when token auth is enabled.

## Content Type

- `Content-Type: application/json`

## Request Body

The request body can be either:

```json
{
  "payload": {
    "action": "start"
  }
}
```

or a flat payload body:

```json
{
  "action": "start"
}
```

The bridge normalizes both into `payload` before broadcasting to connected Aether Studio clients.

## Supported Events

- `lumina.bridge.ping`
- `lumina.scene.switch`
- `lumina.state.sync`
- `lumina.stream.request`

## Stream Control Event

Use `x-lumina-event: lumina.stream.request`.

### Supported Payload Fields

- `action`: `"start" | "stop" | "toggle"`
- `sceneName`: optional scene name to switch before starting
- `scene`: alternate scene field
- `target`: alternate scene field
- `name`: alternate scene field
- `themeName`: optional theme to apply before starting
- `theme`: alternate theme field
- `profile`: optional output profile
- `encodingProfile`: alternate profile field
- `outputProfile`: alternate profile field
- `quality`: alternate profile field
- `destination`: single saved destination name or id
- `destinationIds`: array of saved destination ids
- `destinationNames`: array of saved destination names

### Supported Profiles

- `1080p60`
- `1080p30`
- `720p30`
- `480p30`

Aliases also accepted:

- `1080p` -> `1080p30`
- `720p` -> `720p30`
- `480p` -> `480p30`

## Important Guardrails

- Lumina does not inject raw RTMP URLs or raw stream keys.
- Lumina can only trigger destinations already saved inside Aether Studio.
- Stream control is desktop-only in Aether. Browser clients ignore `lumina.stream.request`.

## Example: Start Live

Headers:

```http
x-lumina-event: lumina.stream.request
x-lumina-workspace: sunday-service
x-lumina-session: service-2026-04-04
x-lumina-token: <match LUMINA_BRIDGE_TOKEN if enabled>
content-type: application/json
```

Body:

```json
{
  "payload": {
    "action": "start",
    "sceneName": "Screen",
    "profile": "1080p30",
    "destinationNames": ["YouTube"]
  }
}
```

## Example: Stop Live

```json
{
  "payload": {
    "action": "stop"
  }
}
```

## Example: Toggle Live

```json
{
  "payload": {
    "action": "toggle",
    "sceneName": "Cam 1"
  }
}
```

## Ping Example

Headers:

- `x-lumina-event: lumina.bridge.ping`
- `x-lumina-workspace: sunday-service`
- `x-lumina-session: service-2026-04-04`

Body:

```json
{}
```

Response:

```json
{
  "ok": true,
  "message": "accepted"
}
```

## cURL Example

```bash
curl -X POST "https://aethercast.tiwaton.co.uk/api/lumina/bridge" \
  -H "Content-Type: application/json" \
  -H "x-lumina-event: lumina.stream.request" \
  -H "x-lumina-workspace: sunday-service" \
  -H "x-lumina-session: service-2026-04-04" \
  -H "x-lumina-token: your-bridge-token" \
  -d '{
    "payload": {
      "action": "start",
      "sceneName": "Screen",
      "profile": "1080p30",
      "destinationNames": ["YouTube"]
    }
  }'
```

## Response Codes

- `200`: accepted
- `400`: missing required headers or unknown event type
- `401`: token mismatch when `LUMINA_BRIDGE_TOKEN` is enabled
