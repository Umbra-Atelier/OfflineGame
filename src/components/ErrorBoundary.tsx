import React from 'react';
export class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string | null}> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error: error.message + "\n" + error.stack }; }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:\n", error, "\n", errorInfo);
  }
  render() {
    if (this.state.error) return <div className="p-8 text-white bg-red-600 break-words absolute inset-0 z-[9999] overflow-auto"><h1 className="text-white text-3xl font-bold mb-4">REACT CRASHED D:</h1><pre className="text-sm whitespace-pre-wrap font-mono bg-black/30 p-4 rounded">{this.state.error}</pre></div>;
    return this.props.children;
  }
}
