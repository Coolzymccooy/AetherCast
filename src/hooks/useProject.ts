import { useState, useRef, useCallback } from 'react';
import { ProjectManager } from '../lib/projectManager';
import type { ProjectFile } from '../types';

export function useProject() {
  const managerRef = useRef(new ProjectManager());
  const [projectName, setProjectName] = useState('Untitled Project');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasAutoSave, setHasAutoSave] = useState(() => !!managerRef.current.recoverAutoSave());

  const refreshUndoState = useCallback(() => {
    setCanUndo(managerRef.current.canUndo());
    setCanRedo(managerRef.current.canRedo());
  }, []);

  const saveProject = useCallback((state: Partial<ProjectFile>, name?: string) => {
    const n = name || projectName;
    managerRef.current.downloadProject({ ...state, name: n }, n);
  }, [projectName]);

  const loadProject = useCallback(async (file: File): Promise<ProjectFile> => {
    const project = await ProjectManager.loadFromFile(file);
    setProjectName(project.name);
    return project;
  }, []);

  const autoSave = useCallback((state: Partial<ProjectFile>) => {
    managerRef.current.autoSave({ ...state, name: projectName });
    setHasAutoSave(true);
  }, [projectName]);

  const recoverAutoSave = useCallback((): ProjectFile | null => {
    return managerRef.current.recoverAutoSave();
  }, []);

  const exportJSON = useCallback((state: Partial<ProjectFile>): string => {
    return managerRef.current.exportProject({ ...state, name: projectName });
  }, [projectName]);

  const pushUndo = useCallback((description: string, undo: () => void, redo: () => void) => {
    managerRef.current.pushAction({
      type: 'user-action', description, timestamp: Date.now(), undo, redo,
    });
    refreshUndoState();
  }, [refreshUndoState]);

  const undo = useCallback(() => {
    managerRef.current.undo();
    refreshUndoState();
  }, [refreshUndoState]);

  const redo = useCallback(() => {
    managerRef.current.redo();
    refreshUndoState();
  }, [refreshUndoState]);

  return {
    projectName, setProjectName,
    canUndo, canRedo, undo, redo, pushUndo,
    saveProject, loadProject, autoSave, recoverAutoSave, exportJSON,
    hasAutoSave,
  };
}
