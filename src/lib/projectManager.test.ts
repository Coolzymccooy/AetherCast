import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectManager } from './projectManager';

describe('ProjectManager', () => {
  let manager: ProjectManager;

  beforeEach(() => {
    manager = new ProjectManager();
    localStorage.clear();
  });

  const sampleState = {
    name: 'Test Project',
    version: '1.0.0',
    scenes: [{ id: '1', name: 'Cam 1', type: 'CAM' }],
    activeSceneId: '1',
    layout: 'Solo',
    background: 'Gradient Motion',
    frameStyle: 'Glass',
    motionStyle: 'Snappy',
    brandColor: '#5d28d9',
    activeTheme: 'Broadcast Studio',
  };

  describe('exportProject', () => {
    it('should export valid JSON', () => {
      const json = manager.exportProject(sampleState);
      const parsed = JSON.parse(json);
      expect(parsed.name).toBe('Test Project');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.layout).toBe('Solo');
    });

    it('should include timestamps', () => {
      const json = manager.exportProject(sampleState);
      const parsed = JSON.parse(json);
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.updatedAt).toBeDefined();
    });
  });

  describe('importProject', () => {
    it('should parse valid JSON', () => {
      const json = manager.exportProject(sampleState);
      const project = manager.importProject(json);
      expect(project.name).toBe('Test Project');
      expect(project.layout).toBe('Solo');
    });

    it('should throw on invalid JSON', () => {
      expect(() => manager.importProject('not json')).toThrow();
    });
  });

  describe('autoSave / recoverAutoSave', () => {
    it('should save and recover', () => {
      manager.autoSave(sampleState);
      const recovered = manager.recoverAutoSave();
      expect(recovered).not.toBeNull();
      expect(recovered!.name).toBe('Test Project');
    });

    it('should return null when no autosave exists', () => {
      const recovered = manager.recoverAutoSave();
      expect(recovered).toBeNull();
    });
  });

  describe('undo/redo', () => {
    it('should start with nothing to undo', () => {
      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(false);
    });

    it('should track actions', () => {
      let value = 0;
      manager.pushAction({
        type: 'test', description: 'set value', timestamp: Date.now(),
        undo: () => { value = 0; },
        redo: () => { value = 1; },
      });
      expect(manager.canUndo()).toBe(true);
      expect(manager.canRedo()).toBe(false);
    });

    it('should undo an action', () => {
      let value = 1;
      manager.pushAction({
        type: 'test', description: 'set value', timestamp: Date.now(),
        undo: () => { value = 0; },
        redo: () => { value = 1; },
      });
      manager.undo();
      expect(value).toBe(0);
      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(true);
    });

    it('should redo an undone action', () => {
      let value = 1;
      manager.pushAction({
        type: 'test', description: 'set value', timestamp: Date.now(),
        undo: () => { value = 0; },
        redo: () => { value = 1; },
      });
      manager.undo();
      expect(value).toBe(0);
      manager.redo();
      expect(value).toBe(1);
    });

    it('should clear redo stack on new push', () => {
      manager.pushAction({
        type: 'test', description: 'a', timestamp: Date.now(),
        undo: () => {}, redo: () => {},
      });
      manager.undo();
      expect(manager.canRedo()).toBe(true);
      manager.pushAction({
        type: 'test', description: 'b', timestamp: Date.now(),
        undo: () => {}, redo: () => {},
      });
      expect(manager.canRedo()).toBe(false);
    });

    it('should clear history', () => {
      manager.pushAction({
        type: 'test', description: 'a', timestamp: Date.now(),
        undo: () => {}, redo: () => {},
      });
      manager.clearHistory();
      expect(manager.canUndo()).toBe(false);
      expect(manager.getHistory()).toHaveLength(0);
    });
  });
});
