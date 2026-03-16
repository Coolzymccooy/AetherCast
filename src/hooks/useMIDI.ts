import { useState, useEffect, useRef, useCallback } from 'react';
import { MIDIController } from '../lib/midiTally';
import type { MIDIMapping } from '../types';

export function useMIDI(onAction?: (action: string, value: number) => void) {
  const controllerRef = useRef<MIDIController | null>(null);
  const [isSupported] = useState(() => MIDIController.isSupported());
  const [devices, setDevices] = useState<Array<{ name: string; manufacturer: string; id: string }>>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [mappings, setMappings] = useState<MIDIMapping[]>([]);
  const [isLearning, setIsLearning] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize on mount
  useEffect(() => {
    if (!isSupported) return;

    const controller = new MIDIController();
    controllerRef.current = controller;

    if (onAction) {
      controller.onAction((action, value) => onAction(action, value));
    }

    controller.init().then(devs => {
      setDevices(devs);
      setIsInitialized(true);
      controller.loadMappings();
      setMappings(controller.getMappings());
    }).catch(err => {
      console.error('MIDI init failed:', err);
    });

    return () => { controller.destroy(); controllerRef.current = null; };
  }, [isSupported]);

  const selectDevice = useCallback((deviceId: string) => {
    controllerRef.current?.selectDevice(deviceId);
    setSelectedDevice(deviceId);
  }, []);

  const updateMappings = useCallback((newMappings: MIDIMapping[]) => {
    controllerRef.current?.setMappings(newMappings);
    controllerRef.current?.saveMappings();
    setMappings(newMappings);
  }, []);

  const startLearn = useCallback((action: string) => {
    controllerRef.current?.startLearn(action);
    setIsLearning(true);
  }, []);

  const stopLearn = useCallback(() => {
    controllerRef.current?.stopLearn();
    setIsLearning(false);
    setMappings(controllerRef.current?.getMappings() || []);
  }, []);

  return {
    isSupported, isInitialized,
    devices, selectedDevice, selectDevice,
    mappings, updateMappings,
    isLearning, startLearn, stopLearn,
  };
}
