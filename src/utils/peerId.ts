import { peerRoomKey } from './roomId';

/** Stable host peer ID — the Studio registers this on PeerJS cloud */
export const hostPeerId = (roomId: string) => `aether-${peerRoomKey(roomId)}-host`;

/** Unique client peer ID for each phone connection */
export const clientPeerId = (roomId: string) =>
  `aether-${peerRoomKey(roomId)}-client-${Math.floor(Math.random() * 99999)}`;
