import { peerRoomKey } from './roomId';

/** Stable host peer ID — the Studio registers this on PeerJS cloud */
export const hostPeerId = (roomId: string) => `aether-${peerRoomKey(roomId)}-host`;

export type PhonePeerRole = 'camera' | 'screen';

/** Unique client peer ID for each phone connection */
export const clientPeerId = (roomId: string, role: PhonePeerRole = 'camera') =>
  `aether-${peerRoomKey(roomId)}-${role}-client-${Math.floor(Math.random() * 99999)}`;

/** Fallback role inference when PeerJS metadata is unavailable */
export const inferPeerRole = (peerId: string): PhonePeerRole | null => {
  if (peerId.includes('-screen-client-')) return 'screen';
  if (peerId.includes('-camera-client-') || peerId.includes('-client-')) return 'camera';
  return null;
};
