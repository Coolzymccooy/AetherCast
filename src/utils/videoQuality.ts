export type OutgoingVideoRole = 'camera' | 'screen';

const VIDEO_PROFILES: Record<OutgoingVideoRole, {
  contentHint: string;
  maxBitrate: number;
  maxFramerate: number;
}> = {
  camera: {
    contentHint: 'motion',
    maxBitrate: 4_500_000,
    maxFramerate: 30,
  },
  screen: {
    contentHint: 'detail',
    maxBitrate: 6_000_000,
    maxFramerate: 12,
  },
};

export function applyVideoTrackProfile(
  track: MediaStreamTrack | null | undefined,
  role: OutgoingVideoRole,
): void {
  if (!track) return;

  try {
    track.contentHint = VIDEO_PROFILES[role].contentHint;
  } catch {
    // Older browsers and WebViews can reject contentHint writes.
  }
}

export async function tuneOutgoingVideoPeerConnection(
  peerConnection: RTCPeerConnection | undefined,
  role: OutgoingVideoRole,
): Promise<void> {
  if (!peerConnection) return;

  const sender = peerConnection.getSenders().find((candidate) => candidate.track?.kind === 'video');
  if (!sender) return;

  applyVideoTrackProfile(sender.track, role);

  const profile = VIDEO_PROFILES[role];
  const parameters = sender.getParameters();
  const encodings = parameters.encodings?.length ? parameters.encodings : [{}];

  parameters.encodings = encodings.map((encoding) => ({
    ...encoding,
    maxBitrate: profile.maxBitrate,
    maxFramerate: profile.maxFramerate,
    scaleResolutionDownBy: 1,
  }));

  try {
    await sender.setParameters(parameters);
  } catch {
    // Some engines expose the sender but reject runtime parameter tuning.
  }
}
