/** Strip non-alphanumeric chars and lowercase — "SLTN-1234" → "sltn1234" */
const cleanRoom = (roomId: string) => roomId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

/** Stable host peer ID — the Studio registers this on PeerJS cloud */
export const hostPeerId = (roomId: string) => `aether-${cleanRoom(roomId)}-host`;

/** Unique client peer ID for each phone connection */
export const clientPeerId = (roomId: string) =>
  `aether-${cleanRoom(roomId)}-client-${Math.floor(Math.random() * 99999)}`;
