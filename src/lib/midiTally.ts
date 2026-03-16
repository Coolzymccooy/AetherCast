// MIDI Input Support and Tally Light Protocol
// Pure TypeScript — no React imports

export interface MIDIMapping {
  id: string;
  channel: number;        // MIDI channel 0-15
  note?: number;          // Note number (for note on/off)
  cc?: number;            // CC number (for control change)
  action: string;         // e.g. 'scene:1', 'audio:mute:mic1', 'transition:cut'
  type: 'button' | 'fader';
}

export interface TallyState {
  program: string[];     // Source IDs currently on program (live / red)
  preview: string[];     // Source IDs on preview (green)
}

export type TallyProtocol = 'tsl31' | 'websocket';

export interface MIDIControllerInfo {
  name: string;
  manufacturer: string;
  id: string;
}

const MIDI_MAPPINGS_KEY = 'aether_midi_mappings';

// MIDI status byte masks
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

export class MIDIController {
  private midiAccess: MIDIAccess | null = null;
  private selectedInput: MIDIInput | null = null;
  private mappings: MIDIMapping[] = [];
  private actionCallback: ((action: string, value: number) => void) | null = null;
  private learning: boolean = false;
  private learnAction: string = '';
  private devices: MIDIControllerInfo[] = [];

  constructor() {}

  /** Check if the Web MIDI API is available in this browser. */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  /**
   * Request MIDI access and enumerate available input devices.
   * Returns the list of discovered devices.
   */
  async init(): Promise<MIDIControllerInfo[]> {
    if (!MIDIController.isSupported()) {
      throw new Error('Web MIDI API is not supported in this browser');
    }

    this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    this.devices = this.enumerateDevices();

    // Listen for device hot-plug
    this.midiAccess.onstatechange = () => {
      this.devices = this.enumerateDevices();
    };

    return this.devices;
  }

  /** Select a specific MIDI input device by its ID. */
  selectDevice(deviceId: string): void {
    if (!this.midiAccess) {
      throw new Error('MIDI not initialised — call init() first');
    }

    // Detach previous listener
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null;
    }

    const input = this.midiAccess.inputs.get(deviceId);
    if (!input) {
      throw new Error(`MIDI device not found: ${deviceId}`);
    }

    this.selectedInput = input;
    this.selectedInput.onmidimessage = (e) => this.handleMessage(e);
  }

  /** Return the list of currently available MIDI input devices. */
  getDevices(): MIDIControllerInfo[] {
    return [...this.devices];
  }

  /** Replace all mappings. */
  setMappings(mappings: MIDIMapping[]): void {
    this.mappings = [...mappings];
  }

  /** Get a copy of the current mappings. */
  getMappings(): MIDIMapping[] {
    return [...this.mappings];
  }

  /** Persist mappings to localStorage. */
  saveMappings(): void {
    try {
      localStorage.setItem(MIDI_MAPPINGS_KEY, JSON.stringify(this.mappings));
    } catch {
      // Storage may be unavailable
    }
  }

  /** Load mappings from localStorage. */
  loadMappings(): void {
    try {
      const raw = localStorage.getItem(MIDI_MAPPINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.mappings = parsed;
        }
      }
    } catch {
      // Corrupted data — keep existing mappings
    }
  }

  /**
   * Register a callback that fires whenever a mapped MIDI message arrives.
   * @param callback Receives the action string and a numeric value (0-127).
   */
  onAction(callback: (action: string, value: number) => void): void {
    this.actionCallback = callback;
  }

  /**
   * Enter MIDI Learn mode.
   * The next incoming MIDI message will be mapped to the given action.
   */
  startLearn(action: string): void {
    this.learning = true;
    this.learnAction = action;
  }

  /** Cancel MIDI Learn mode. */
  stopLearn(): void {
    this.learning = false;
    this.learnAction = '';
  }

  /** Whether the controller is currently in learn mode. */
  isLearning(): boolean {
    return this.learning;
  }

  /** Detach all listeners and release MIDI access. */
  destroy(): void {
    if (this.selectedInput) {
      this.selectedInput.onmidimessage = null;
      this.selectedInput = null;
    }
    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
      this.midiAccess = null;
    }
    this.actionCallback = null;
    this.learning = false;
    this.devices = [];
  }

  // ──────────── Private helpers ────────────

  private enumerateDevices(): MIDIControllerInfo[] {
    if (!this.midiAccess) return [];

    const list: MIDIControllerInfo[] = [];
    this.midiAccess.inputs.forEach((input) => {
      list.push({
        name: input.name || 'Unknown Device',
        manufacturer: input.manufacturer || 'Unknown',
        id: input.id,
      });
    });
    return list;
  }

  private handleMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 2) return;

    const statusByte = data[0];
    const channel = statusByte & 0x0f;
    const messageType = statusByte & 0xf0;
    const param1 = data[1]; // note number or CC number
    const param2 = data.length > 2 ? data[2] : 0; // velocity or CC value

    // ---- MIDI Learn ----
    if (this.learning && this.learnAction) {
      const mapping: MIDIMapping = {
        id: crypto.randomUUID(),
        channel,
        action: this.learnAction,
        type: messageType === CONTROL_CHANGE ? 'fader' : 'button',
      };

      if (messageType === CONTROL_CHANGE) {
        mapping.cc = param1;
      } else {
        mapping.note = param1;
      }

      // Remove any existing mapping for the same action
      this.mappings = this.mappings.filter((m) => m.action !== this.learnAction);
      this.mappings.push(mapping);

      this.learning = false;
      this.learnAction = '';

      // Fire the action immediately so the user gets feedback
      if (this.actionCallback) {
        this.actionCallback(mapping.action, param2);
      }
      return;
    }

    // ---- Normal dispatch ----
    for (const mapping of this.mappings) {
      if (mapping.channel !== channel) continue;

      if (
        mapping.type === 'button' &&
        (messageType === NOTE_ON || messageType === NOTE_OFF) &&
        mapping.note === param1
      ) {
        // Only fire on Note On with velocity > 0 (Note Off or velocity 0 = release)
        const velocity = messageType === NOTE_ON ? param2 : 0;
        if (this.actionCallback) {
          this.actionCallback(mapping.action, velocity);
        }
        break;
      }

      if (
        mapping.type === 'fader' &&
        messageType === CONTROL_CHANGE &&
        mapping.cc === param1
      ) {
        if (this.actionCallback) {
          this.actionCallback(mapping.action, param2);
        }
        break;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// Tally Light Server
// Broadcasts tally state via Socket.io (browser-side)
// ─────────────────────────────────────────────────────────

export class TallyServer {
  private state: TallyState = { program: [], preview: [] };
  private socket: any = null; // Socket.io client instance
  private broadcasting: boolean = false;
  private clientCount: number = 0;

  constructor() {}

  /** Update the tally state. Broadcasts automatically if broadcasting is enabled. */
  updateState(state: TallyState): void {
    this.state = { ...state };
    if (this.broadcasting && this.socket) {
      this.emitState();
    }
  }

  /** Get the current tally state. */
  getState(): TallyState {
    return { ...this.state };
  }

  /**
   * Start broadcasting tally state via the existing Socket.io connection.
   * Tally clients (hardware lights, phone apps) connect to the same Socket.io server.
   *
   * @param port Ignored in the browser implementation — included for API compatibility.
   *             The Socket.io server port is determined by the existing server configuration.
   */
  startBroadcast(port?: number): void {
    if (this.broadcasting) return;

    // Dynamically import socket.io-client to avoid hard dependency
    this.initSocket(port);
    this.broadcasting = true;
  }

  /** Stop broadcasting tally state. */
  stopBroadcast(): void {
    this.broadcasting = false;
    if (this.socket) {
      this.socket.off('tally-client-count');
      this.socket.disconnect();
      this.socket = null;
    }
    this.clientCount = 0;
  }

  /** Get the number of connected tally clients. */
  getClientCount(): number {
    return this.clientCount;
  }

  /** Clean up resources. */
  destroy(): void {
    this.stopBroadcast();
  }

  // ──────────── Private helpers ────────────

  private initSocket(port?: number): void {
    try {
      // Attempt to use the globally available io() from socket.io-client
      // or use the current page's origin
      const ioFn = (globalThis as any).io;
      if (typeof ioFn === 'function') {
        const url = port
          ? `${window.location.protocol}//${window.location.hostname}:${port}`
          : undefined;

        this.socket = ioFn(url, { transports: ['websocket'] });
      } else {
        // Fallback: try dynamic import (works in bundled environments)
        import('socket.io-client').then(({ io }) => {
          const url = port
            ? `${window.location.protocol}//${window.location.hostname}:${port}`
            : undefined;

          this.socket = io(url, { transports: ['websocket'] });
          this.attachSocketListeners();
          this.emitState();
        }).catch(() => {
          console.warn(
            'TallyServer: socket.io-client not available. Tally broadcast disabled.',
          );
        });
        return;
      }

      this.attachSocketListeners();
      this.emitState();
    } catch {
      console.warn('TallyServer: failed to initialise socket connection.');
    }
  }

  private attachSocketListeners(): void {
    if (!this.socket) return;

    // The server is expected to echo back the connected tally client count
    this.socket.on('tally-client-count', (count: number) => {
      this.clientCount = count;
    });
  }

  private emitState(): void {
    if (!this.socket) return;
    this.socket.emit('tally-update', this.state);
  }
}
