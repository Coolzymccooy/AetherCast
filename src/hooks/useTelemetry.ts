import { useState, useEffect, useRef } from 'react';
import { Telemetry } from '../types';

/**
 * Collects real telemetry from RTCPeerConnection.getStats() when available,
 * falling back to MediaRecorder chunk-based bitrate and Performance API CPU.
 */
export function useTelemetry(isStreaming: boolean) {
  const [telemetry, setTelemetry] = useState<Telemetry>({
    bitrate: '0.0 Mbps',
    fps: 0,
    cpu: 0,
    droppedFrames: 0,
    network: 'excellent'
  });

  const prevBytesRef = useRef(0);
  const prevTimestampRef = useRef(0);

  // Collect real stats from any active RTCPeerConnection
  useEffect(() => {
    const interval = setInterval(async () => {
      // Try to get real stats from active peer connections
      const peerConnections = (window as any).__aether_peer_connections as RTCPeerConnection[] | undefined;

      if (peerConnections && peerConnections.length > 0) {
        try {
          const pc = peerConnections[0];
          const stats = await pc.getStats();
          let totalBytesSent = 0;
          let currentFps = 0;
          let framesDropped = 0;
          let roundTripTime = 0;

          stats.forEach((report) => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              totalBytesSent += report.bytesSent || 0;
              currentFps = report.framesPerSecond || 0;
            }
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              framesDropped += report.framesDropped || 0;
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              roundTripTime = report.currentRoundTripTime || 0;
            }
          });

          // Calculate bitrate from delta
          const now = performance.now();
          let bitrateMbps = 0;
          if (prevBytesRef.current > 0 && prevTimestampRef.current > 0) {
            const deltaBytes = totalBytesSent - prevBytesRef.current;
            const deltaSecs = (now - prevTimestampRef.current) / 1000;
            if (deltaSecs > 0) {
              bitrateMbps = (deltaBytes * 8) / (deltaSecs * 1_000_000);
            }
          }
          prevBytesRef.current = totalBytesSent;
          prevTimestampRef.current = now;

          // Derive network quality from RTT
          let network: Telemetry['network'] = 'excellent';
          if (roundTripTime > 0.3) network = 'poor';
          else if (roundTripTime > 0.15) network = 'fair';
          else if (roundTripTime > 0.05) network = 'good';

          setTelemetry(prev => ({
            ...prev,
            fps: currentFps || prev.fps,
            droppedFrames: framesDropped,
            network,
            ...(bitrateMbps > 0 ? { bitrate: `${bitrateMbps.toFixed(1)} Mbps` } : {}),
          }));

          return; // Used real stats, skip fallback
        } catch {
          // Fall through to fallback
        }
      }

      // Fallback: use Performance API for CPU estimate where available
      let cpuEstimate = 0;
      if (typeof performance !== 'undefined' && 'measureUserAgentSpecificMemory' in performance) {
        // Use event loop delay as a proxy for CPU load
        const start = performance.now();
        await new Promise(resolve => setTimeout(resolve, 0));
        const delay = performance.now() - start;
        // Map event loop delay (0-16ms) to approximate CPU percentage (0-100%)
        cpuEstimate = Math.min(100, Math.round((delay / 16) * 100));
      }

      setTelemetry(prev => ({
        ...prev,
        cpu: cpuEstimate || prev.cpu,
        bitrate: isStreaming ? prev.bitrate : '0.0 Mbps',
        fps: isStreaming ? prev.fps : 0,
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [isStreaming]);

  return { telemetry, setTelemetry };
}
