/**
 * Lumina Presenter Bridge — server-side router.
 * Lumina sends POST /api/lumina/bridge with x-lumina-event headers
 * and a JSON body. Studio clients receive events via Socket.io.
 */
import { Router } from 'express';
import type { Server as IOServer } from 'socket.io';

const LUMINA_BRIDGE_TOKEN = process.env.LUMINA_BRIDGE_TOKEN || '';

const LUMINA_ALLOWED_EVENTS = new Set([
  'lumina.bridge.ping',
  'lumina.state.sync',
  'lumina.scene.switch',
  'lumina.slide.changed',
  'lumina.item.started',
  'lumina.countdown.started',
  'lumina.countdown.ended',
  'lumina.service.mode.changed',
  'lumina.stream.request',
  'lumina.recording.request',
]);

export function createLuminaRouter(
  io: IOServer,
  luminaRoomLastPing: Map<string, number>
): Router {
  const router = Router();

  router.post('/bridge', (req, res) => {
    const eventType = String(req.headers['x-lumina-event'] || '').trim();
    const workspaceId = String(req.headers['x-lumina-workspace'] || '').trim();
    const sessionId = String(req.headers['x-lumina-session'] || '').trim();
    const token = String(req.headers['x-lumina-token'] || '').trim();
    const roomId = String(
      req.headers['x-lumina-room'] ||
        (req.query as Record<string, string>).room ||
        ''
    ).trim();

    if (!eventType || !workspaceId || !sessionId) {
      res.status(400).json({ ok: false, message: 'missing_required_headers' });
      return;
    }

    if (!LUMINA_ALLOWED_EVENTS.has(eventType)) {
      res.status(400).json({ ok: false, message: 'unknown_event_type' });
      return;
    }

    if (LUMINA_BRIDGE_TOKEN && token !== LUMINA_BRIDGE_TOKEN) {
      res.status(401).json({ ok: false, message: 'unauthorized' });
      return;
    }

    if (eventType === 'lumina.bridge.ping') {
      if (roomId) {
        luminaRoomLastPing.set(roomId, Date.now());
        io.to(roomId).emit('lumina-connected', { workspaceId, ts: Date.now() });
      }
      console.log(`[lumina-bridge] ping from workspace=${workspaceId} room=${roomId || '(broadcast)'}`);
      res.status(200).json({ ok: true, message: 'accepted' });
      return;
    }

    const bridgeEvent = {
      type: 'lumina_event',
      event: eventType,
      workspaceId,
      sessionId,
      payload: (req.body as Record<string, unknown>)?.payload ?? req.body ?? {},
      ts: Date.now(),
    };

    if (roomId) {
      luminaRoomLastPing.set(roomId, Date.now());
      io.to(roomId).emit('lumina-event', bridgeEvent);
      console.log(`[lumina-bridge] ${eventType} → room=${roomId}`);
    } else {
      io.emit('lumina-event', bridgeEvent);
      console.log(`[lumina-bridge] ${eventType} → ${io.engine.clientsCount} client(s) (broadcast)`);
    }
    res.status(200).json({ ok: true, message: 'accepted' });
  });

  router.get('/rooms/:roomId/status', (req, res) => {
    const roomId = String(req.params.roomId || '').trim();
    const lastSeen = luminaRoomLastPing.get(roomId) ?? null;
    const connected = lastSeen !== null && Date.now() - lastSeen < 300_000;
    res.json({ connected, lastSeenMs: lastSeen });
  });

  return router;
}
