import type {
  AudienceMessage,
  Graphics,
  LowerThirds,
  Scene,
  Source,
} from '../types';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

type LayoutRect = { x: number; y: number; width: number; height: number };

type SourceDescriptor = {
  id: string;
  source_id: string;
  label: string;
  node_type: 'camera' | 'screen' | 'remote' | 'background' | 'overlay';
  status?: string;
  resolution?: string;
  fps?: number;
  audio_level?: number;
  visible: boolean;
  content_fit?: 'Fit' | 'Fill';
};

export type NativeSceneNode = {
  id: string;
  node_type: string;
  label: string;
  source_id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  visible: boolean;
  content_fit?: string | null;
  status?: string | null;
  resolution?: string | null;
  fps?: number | null;
  audio_level?: number | null;
  accent_color?: string | null;
  text?: string | null;
};

export type NativeSceneSnapshot = {
  revision: number;
  render_path: string;
  canvas_width: number;
  canvas_height: number;
  active_scene_id: string;
  active_scene_name: string;
  scene_type: string;
  layout: string;
  transition_type: string;
  background: string;
  frame_style: string;
  motion_style: string;
  brand_color: string;
  source_swap: boolean;
  nodes: NativeSceneNode[];
};

export type NativeSourceDescriptor = {
  source_id: string;
  label: string;
  source_kind: string;
  browser_owned: boolean;
  available: boolean;
  source_status?: string | null;
  resolution?: string | null;
  fps?: number | null;
  audio_level?: number | null;
};

type BuildSceneSnapshotArgs = {
  activeScene: Scene;
  layout: string;
  transitionType: string;
  sources: Source[];
  lowerThirds: LowerThirds;
  graphics: Graphics;
  background: string;
  frameStyle: string;
  motionStyle: string;
  brandColor: string;
  sourceSwap: boolean;
  audienceMessages: AudienceMessage[];
  activeMessageId: string | null;
  webcamAvailable: boolean;
  screenAvailable: boolean;
  remoteSourceCount: number;
  hasLocalCam2: boolean;
};

export function buildNativeSceneSnapshot(args: BuildSceneSnapshotArgs): NativeSceneSnapshot {
  const nodes: NativeSceneNode[] = [];
  const remoteSources = Array.from({ length: args.remoteSourceCount }, (_, index) =>
    makeDescriptor(
      `remote-${index + 1}`,
      `remote:${index + 1}`,
      `Remote ${index + 1}`,
      'remote',
      args.sources,
      index > 0 || args.remoteSourceCount > 0,
      'Fit',
      'Cam 2',
    ),
  );
  const localCam1 = makeDescriptor(
    'cam-1',
    'camera:local-1',
    'Cam 1',
    'camera',
    args.sources,
    args.webcamAvailable || args.remoteSourceCount > 0,
    'Fit',
    'Cam 1',
  );
  const localCam2 = makeDescriptor(
    'cam-2',
    'camera:local-2',
    'Cam 2',
    'camera',
    args.sources,
    args.hasLocalCam2,
    'Fit',
    'Cam 2',
  );
  const screen = makeDescriptor(
    'screen',
    'screen:main',
    'Screen Share',
    'screen',
    args.sources,
    args.screenAvailable,
    'Fit',
    'Screen Share',
  );

  pushNode(
    nodes,
    {
      id: 'background',
      source_id: 'background:program',
      label: args.background,
      node_type: 'background',
      visible: true,
      content_fit: 'Fill',
    },
    fullFrame(),
    0,
    undefined,
    args.background,
  );

  const dualSecondary = screen.visible ? screen : remoteSources[0] || localCam2;
  const [primaryCamera, secondarySource] = args.sourceSwap
    ? [dualSecondary || localCam1, localCam1]
    : [localCam1, dualSecondary || localCam2];

  switch (args.activeScene.type) {
    case 'CAM':
      if (args.activeScene.name === 'Cam 2') {
        const cam2Source = remoteSources[0] || localCam2;
        pushMainCameraScene(nodes, cam2Source || localCam2, args.layout, 10);
      } else {
        pushMainCameraScene(nodes, primaryCamera, args.layout, 10);
      }
      break;
    case 'DUAL':
      pushDualScene(nodes, primaryCamera, secondarySource || localCam2, args.layout, 10);
      break;
    case 'SCREEN':
      pushScreenScene(nodes, primaryCamera, screen, args.layout, 10);
      break;
    case 'GRID':
      pushGridScene(nodes, primaryCamera, remoteSources, 10);
      break;
    case 'PODCAST':
      pushPodcastScene(nodes, primaryCamera, secondarySource || remoteSources[0] || localCam2, 10);
      break;
    default:
      pushMainCameraScene(nodes, primaryCamera, args.layout, 10);
      break;
  }

  if (args.graphics.showBug) {
    pushNode(
      nodes,
      {
        id: 'overlay-bug',
        source_id: 'overlay:bug',
        label: 'Bug Logo',
        node_type: 'overlay',
        visible: true,
      },
      { x: 1820, y: 24, width: 72, height: 72 },
      100,
      args.brandColor,
    );
  }

  if (args.graphics.showSocials) {
    pushNode(
      nodes,
      {
        id: 'overlay-socials',
        source_id: 'overlay:socials',
        label: 'Social Handles',
        node_type: 'overlay',
        visible: true,
      },
      { x: 60, y: 60, width: 320, height: 64 },
      101,
      args.brandColor,
    );
  }

  if (args.lowerThirds.visible) {
    pushNode(
      nodes,
      {
        id: 'overlay-lower-third',
        source_id: 'overlay:lower-third',
        label: `${args.lowerThirds.name} - ${args.lowerThirds.title}`,
        node_type: 'overlay',
        visible: true,
      },
      { x: 60, y: 860, width: 560, height: 120 },
      102,
      args.lowerThirds.accentColor,
      `${args.lowerThirds.name} | ${args.lowerThirds.title}`,
    );
  }

  const activeMessage = resolveActiveMessage(args.audienceMessages, args.activeMessageId);
  if (activeMessage) {
    pushNode(
      nodes,
      {
        id: `overlay-audience-${activeMessage.id}`,
        source_id: `audience:${activeMessage.id}`,
        label: activeMessage.type,
        node_type: 'overlay',
        visible: activeMessage.visible,
      },
      { x: 80, y: 760, width: 680, height: 180 },
      103,
      args.brandColor,
      `${activeMessage.author}: ${activeMessage.text}`,
    );
  }

  const snapshotBase: Omit<NativeSceneSnapshot, 'revision'> = {
    render_path: 'browser-scene-schema',
    canvas_width: CANVAS_WIDTH,
    canvas_height: CANVAS_HEIGHT,
    active_scene_id: args.activeScene.id,
    active_scene_name: args.activeScene.name,
    scene_type: args.activeScene.type,
    layout: args.layout,
    transition_type: args.transitionType,
    background: args.background,
    frame_style: args.frameStyle,
    motion_style: args.motionStyle,
    brand_color: args.brandColor,
    source_swap: args.sourceSwap,
    nodes,
  };

  return {
    ...snapshotBase,
    revision: hashSceneSnapshot(JSON.stringify(snapshotBase)),
  };
}

type BuildSourceInventoryArgs = Pick<
  BuildSceneSnapshotArgs,
  'sources' | 'webcamAvailable' | 'screenAvailable' | 'remoteSourceCount' | 'hasLocalCam2'
> & {
  nativeOwnedSourceIds?: string[];
  mediaAvailable?: boolean;
  browserAvailable?: boolean;
};

export function buildNativeSourceInventory(args: BuildSourceInventoryArgs): NativeSourceDescriptor[] {
  const nativeOwnedSources = new Set(args.nativeOwnedSourceIds || []);
  const inventory: NativeSourceDescriptor[] = [];
  const cam1Source = args.sources.find((candidate) => candidate.name === 'Cam 1');
  const cam2Source = args.sources.find((candidate) => candidate.name === 'Cam 2');
  const screenSource = args.sources.find((candidate) => candidate.name === 'Screen Share');
  const mediaSource = args.sources.find((candidate) => candidate.name === 'Media Loop');
  const browserSource = args.sources.find((candidate) => candidate.name === 'Browser Source');

  inventory.push({
    source_id: 'camera:local-1',
    label: 'Cam 1',
    source_kind: 'camera',
    browser_owned: !nativeOwnedSources.has('camera:local-1'),
    available: args.webcamAvailable || nativeOwnedSources.has('camera:local-1'),
    source_status: cam1Source?.status || null,
    resolution: cam1Source?.resolution || null,
    fps: cam1Source?.fps ?? null,
    audio_level: cam1Source?.audioLevel ?? null,
  });

  inventory.push({
    source_id: 'camera:local-2',
    label: 'Cam 2',
    source_kind: 'camera',
    browser_owned: !nativeOwnedSources.has('camera:local-2'),
    available: args.hasLocalCam2 || nativeOwnedSources.has('camera:local-2'),
    source_status: cam2Source?.status || null,
    resolution: cam2Source?.resolution || null,
    fps: cam2Source?.fps ?? null,
    audio_level: cam2Source?.audioLevel ?? null,
  });

  inventory.push({
    source_id: 'screen:main',
    label: 'Screen Share',
    source_kind: 'screen',
    browser_owned: true,
    available: args.screenAvailable,
    source_status: screenSource?.status || null,
    resolution: screenSource?.resolution || null,
    fps: screenSource?.fps ?? null,
    audio_level: screenSource?.audioLevel ?? null,
  });

  for (let index = 0; index < args.remoteSourceCount; index += 1) {
    inventory.push({
      source_id: `remote:${index + 1}`,
      label: `Remote ${index + 1}`,
      source_kind: 'remote',
      browser_owned: !nativeOwnedSources.has(`remote:${index + 1}`),
      available: true,
      source_status: 'active',
      resolution: null,
      fps: null,
      audio_level: null,
    });
  }

  inventory.push({
    source_id: 'media:loop',
    label: 'Media Loop',
    source_kind: 'media',
    browser_owned: !nativeOwnedSources.has('media:loop'),
    available: !!args.mediaAvailable,
    source_status: mediaSource?.status || null,
    resolution: mediaSource?.resolution || null,
    fps: mediaSource?.fps ?? null,
    audio_level: mediaSource?.audioLevel ?? null,
  });

  inventory.push({
    source_id: 'browser:main',
    label: 'Browser Source',
    source_kind: 'browser',
    browser_owned: !nativeOwnedSources.has('browser:main'),
    available: !!args.browserAvailable,
    source_status: browserSource?.status || null,
    resolution: browserSource?.resolution || null,
    fps: browserSource?.fps ?? null,
    audio_level: browserSource?.audioLevel ?? null,
  });

  return inventory;
}

function pushMainCameraScene(
  nodes: NativeSceneNode[],
  source: SourceDescriptor | undefined,
  layout: string,
  zBase: number,
) {
  if (layout === 'Framed Solo') {
    pushNode(nodes, source, { x: 80, y: 95, width: 1760, height: 990 }, zBase);
  } else if (layout === 'Freeform') {
    pushNode(nodes, source, centeredRect(960, 540), zBase);
  } else {
    pushNode(nodes, source, fullFrame(), zBase);
  }
}

function pushDualScene(
  nodes: NativeSceneNode[],
  primary: SourceDescriptor | undefined,
  secondary: SourceDescriptor | undefined,
  layout: string,
  zBase: number,
) {
  if (layout === 'Picture-in-Pic' || layout === 'PiP') {
    pushNode(nodes, secondary, fullFrame(), zBase);
    pushNode(nodes, primary, { x: 1400, y: 770, width: 480, height: 270 }, zBase + 1);
    return;
  }

  const left = halfFrameLeft();
  const right = halfFrameRight();
  pushNode(nodes, primary, left, zBase);
  pushNode(nodes, secondary, right, zBase + 1);
}

function pushScreenScene(
  nodes: NativeSceneNode[],
  camera: SourceDescriptor | undefined,
  screen: SourceDescriptor | undefined,
  layout: string,
  zBase: number,
) {
  if (layout === 'Projector + Spk') {
    pushNode(nodes, screen, { x: 60, y: 135, width: 1440, height: 810 }, zBase);
    pushNode(nodes, camera, { x: 1380, y: 720, width: 480, height: 270 }, zBase + 1);
    return;
  }

  if (layout === 'PiP' || layout === 'Picture-in-Pic') {
    pushNode(nodes, screen, fullFrame(), zBase);
    pushNode(nodes, camera, { x: 1400, y: 770, width: 480, height: 270 }, zBase + 1);
    return;
  }

  if (layout === 'Split Left') {
    pushNode(nodes, screen, halfFrameLeft(), zBase);
    pushNode(nodes, camera, halfFrameRight(), zBase + 1);
    return;
  }

  if (layout === 'Freeform') {
    pushNode(nodes, screen, { x: 192, y: 135, width: 1536, height: 864 }, zBase);
    pushNode(nodes, camera, { x: 1496, y: 784, width: 384, height: 216 }, zBase + 1);
    return;
  }

  pushNode(nodes, camera, halfFrameLeft(), zBase);
  pushNode(nodes, screen, halfFrameRight(), zBase + 1);
}

function pushGridScene(
  nodes: NativeSceneNode[],
  primary: SourceDescriptor | undefined,
  remotes: SourceDescriptor[],
  zBase: number,
) {
  const rects: LayoutRect[] = [
    { x: 20, y: 7, width: 930, height: 523 },
    { x: 970, y: 7, width: 930, height: 523 },
    { x: 20, y: 550, width: 930, height: 523 },
    { x: 970, y: 550, width: 930, height: 523 },
  ];

  pushNode(nodes, primary, rects[0], zBase);
  for (let i = 0; i < 3; i += 1) {
    pushNode(nodes, remotes[i], rects[i + 1], zBase + i + 1);
  }
}

function pushPodcastScene(
  nodes: NativeSceneNode[],
  host: SourceDescriptor | undefined,
  guest: SourceDescriptor | undefined,
  zBase: number,
) {
  pushNode(nodes, guest, fullFrame(), zBase);
  pushNode(nodes, host, { x: 1400, y: 770, width: 480, height: 270 }, zBase + 1);
}

function pushNode(
  nodes: NativeSceneNode[],
  source: SourceDescriptor | undefined,
  rect: LayoutRect,
  zIndex: number,
  accentColor?: string,
  text?: string,
) {
  if (!source) return;
  nodes.push({
    id: source.id,
    node_type: source.node_type,
    label: source.label,
    source_id: source.source_id,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    z_index: zIndex,
    visible: source.visible,
    content_fit: source.content_fit || null,
    status: source.status || null,
    resolution: source.resolution || null,
    fps: source.fps ?? null,
    audio_level: source.audio_level ?? null,
    accent_color: accentColor || null,
    text: text || null,
  });
}

function makeDescriptor(
  id: string,
  sourceId: string,
  label: string,
  nodeType: SourceDescriptor['node_type'],
  sources: Source[],
  visible: boolean,
  contentFit: 'Fit' | 'Fill',
  sourceName?: string,
): SourceDescriptor {
  const source = sources.find((candidate) => candidate.name === (sourceName || label));
  return {
    id,
    source_id: sourceId,
    label,
    node_type: nodeType,
    status: source?.status,
    resolution: source?.resolution,
    fps: source?.fps,
    audio_level: source?.audioLevel,
    visible,
    content_fit: contentFit,
  };
}

function resolveActiveMessage(
  audienceMessages: AudienceMessage[],
  activeMessageId: string | null,
): AudienceMessage | null {
  if (activeMessageId) {
    return audienceMessages.find((message) => message.id === activeMessageId) || null;
  }
  return audienceMessages.find((message) => message.visible) || null;
}

function fullFrame(): LayoutRect {
  return { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
}

function centeredRect(width: number, height: number): LayoutRect {
  return {
    x: (CANVAS_WIDTH - width) / 2,
    y: (CANVAS_HEIGHT - height) / 2,
    width,
    height,
  };
}

function halfFrameLeft(): LayoutRect {
  return { x: 40, y: 270, width: 900, height: 506 };
}

function halfFrameRight(): LayoutRect {
  return { x: 980, y: 270, width: 900, height: 506 };
}

function hashSceneSnapshot(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
