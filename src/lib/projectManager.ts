// Project Save/Load System with Undo/Redo
// Pure TypeScript — no React imports

// Re-export ProjectFile from the shared types module
import type { ProjectFile, CamoSettings } from '../types';
export type { ProjectFile };

export interface UndoableAction {
  type: string;
  description: string;
  timestamp: number;
  undo: () => void;
  redo: () => void;
}

const DEFAULT_PROJECT: ProjectFile = {
  version: '1.0.0',
  name: 'Untitled Project',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  scenes: [],
  activeSceneId: '',
  layout: 'single',
  background: '#000000',
  frameStyle: 'none',
  motionStyle: 'none',
  brandColor: '#6C63FF',
  activeTheme: 'default',
  camoSettings: {
    layout: 'Fill', contentFit: 'Fit', scale: 1.0, x: 0, y: 0,
    shape: 'Rect', cornerRadius: 0, crop: { left: 0, right: 0, top: 0, bottom: 0 },
    filter: 'None', removeBackground: false,
  } as CamoSettings,
  lowerThirds: {
    name: '',
    title: '',
    accentColor: '#6C63FF',
    visible: false,
    duration: 5000,
  },
  presets: [],
  audioChannels: [],
  destinations: [],
  scripts: [],
};

const AUTOSAVE_KEY = 'aether_autosave';
const MAX_UNDO_STACK = 50;

export class ProjectManager {
  private undoStack: UndoableAction[] = [];
  private redoStack: UndoableAction[] = [];

  constructor() {}

  /**
   * Serialize the current state into a JSON string.
   * Stream keys are stripped from destinations for security.
   */
  exportProject(state: Partial<ProjectFile>): string {
    const project: ProjectFile = {
      ...DEFAULT_PROJECT,
      ...state,
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
    };

    // Ensure no stream keys leak — only keep safe destination fields
    if (project.destinations) {
      project.destinations = project.destinations.map((d) => ({
        id: d.id,
        name: d.name,
        rtmpUrl: d.rtmpUrl,
        enabled: d.enabled,
      }));
    }

    return JSON.stringify(project, null, 2);
  }

  /**
   * Parse and validate a JSON string into a ProjectFile.
   * Missing fields are filled with defaults.
   */
  importProject(json: string): ProjectFile {
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Invalid project file: not valid JSON');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid project file: root must be an object');
    }

    const project: ProjectFile = {
      ...DEFAULT_PROJECT,
      ...parsed,
    };

    // Ensure required array fields are arrays
    if (!Array.isArray(project.scenes)) project.scenes = [];
    if (!Array.isArray(project.presets)) project.presets = [];
    if (!Array.isArray(project.audioChannels)) project.audioChannels = [];
    if (!Array.isArray(project.destinations)) project.destinations = [];
    if (!Array.isArray(project.scripts)) project.scripts = [];

    // Ensure lowerThirds has the right shape
    if (typeof project.lowerThirds !== 'object' || project.lowerThirds === null) {
      project.lowerThirds = { ...DEFAULT_PROJECT.lowerThirds };
    }

    return project;
  }

  /**
   * Trigger a browser download of the project as a .aether file.
   */
  downloadProject(state: Partial<ProjectFile>, name?: string): void {
    const json = this.exportProject(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const fileName = (name || state.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');

    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.aether`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Load a ProjectFile from a File input (e.g. from <input type="file">).
   */
  static async loadFromFile(file: File): Promise<ProjectFile> {
    const text = await file.text();
    const manager = new ProjectManager();
    return manager.importProject(text);
  }

  /**
   * Auto-save the current state to localStorage with a timestamp.
   */
  autoSave(state: Partial<ProjectFile>): void {
    const payload = {
      timestamp: Date.now(),
      project: {
        ...DEFAULT_PROJECT,
        ...state,
        updatedAt: new Date().toISOString(),
      },
    };

    // Strip stream keys from auto-save as well
    if (payload.project.destinations) {
      payload.project.destinations = payload.project.destinations.map((d) => ({
        id: d.id,
        name: d.name,
        rtmpUrl: d.rtmpUrl,
        enabled: d.enabled,
      }));
    }

    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage may be full — silently fail
    }
  }

  /**
   * Recover the most recent auto-saved project, or null if none exists.
   */
  recoverAutoSave(): ProjectFile | null {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.project) return null;

      return this.importProject(JSON.stringify(parsed.project));
    } catch {
      return null;
    }
  }

  // --------------- Undo / Redo ---------------

  /**
   * Push an undoable action onto the stack.
   * Clears the redo stack and enforces the max stack size.
   */
  pushAction(action: UndoableAction): void {
    this.undoStack.push(action);
    this.redoStack = [];

    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
  }

  /**
   * Undo the most recent action. Returns the action that was undone, or null.
   */
  undo(): UndoableAction | null {
    const action = this.undoStack.pop();
    if (!action) return null;

    action.undo();
    this.redoStack.push(action);
    return action;
  }

  /**
   * Redo the most recently undone action. Returns the action that was redone, or null.
   */
  redo(): UndoableAction | null {
    const action = this.redoStack.pop();
    if (!action) return null;

    action.redo();
    this.undoStack.push(action);
    return action;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getHistory(): UndoableAction[] {
    return [...this.undoStack];
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
