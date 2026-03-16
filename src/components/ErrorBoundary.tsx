import React from 'react';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  name: string; // e.g., "Compositor", "AudioMixer", "DirectorRack"
  onError?: (error: Error, name: string) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, errorInfo);
    this.props.onError?.(error, this.props.name);
  }

  private handleReloadPanel = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReloadApp = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-6 bg-panel border border-border rounded-lg h-full min-h-[200px]">
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
            <AlertTriangle size={24} className="text-accent-red" />
          </div>

          <h3 className="text-base font-bold text-white">{this.props.name} crashed</h3>

          <div className="w-full max-w-md max-h-32 overflow-auto rounded border border-border bg-black/40 p-3">
            <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap break-words">
              {this.state.error?.message || 'An unknown error occurred'}
            </pre>
          </div>

          <div className="flex gap-3">
            <button
              onClick={this.handleReloadPanel}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold bg-transparent border border-border hover:bg-white/5 text-gray-300 transition-colors"
            >
              <RotateCcw size={14} />
              Reload Panel
            </button>
            <button
              onClick={this.handleReloadApp}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold bg-accent-red/20 border border-accent-red/40 hover:bg-accent-red/30 text-red-300 transition-colors"
            >
              <RefreshCw size={14} />
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
