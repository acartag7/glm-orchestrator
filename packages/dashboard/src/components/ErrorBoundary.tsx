'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  toggleDetails = (): void => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-6 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
          <div className="max-w-md w-full bg-neutral-900/80 border border-neutral-800 rounded-lg shadow-xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-neutral-800 bg-red-500/5">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20">
                  <svg
                    className="w-5 h-5 text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-medium text-neutral-100 font-mono">
                    Something went wrong
                  </h2>
                  <p className="text-xs text-neutral-500 font-mono">
                    An unexpected error occurred
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-5">
              <p className="text-sm text-neutral-400 font-mono mb-4">
                The application encountered an error and couldn&apos;t continue.
                You can try again or go back to the home page.
              </p>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={this.handleReset}
                  className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-mono rounded-md transition-colors flex items-center gap-2"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Try again
                </button>
                <a
                  href="/"
                  className="px-4 py-2 bg-neutral-800/50 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 text-xs font-mono rounded-md transition-colors"
                >
                  Go home
                </a>
              </div>
            </div>

            {/* Error Details (collapsible) */}
            {this.state.error && (
              <div className="border-t border-neutral-800">
                <button
                  onClick={this.toggleDetails}
                  className="w-full px-6 py-3 flex items-center justify-between text-xs text-neutral-500 hover:text-neutral-400 font-mono transition-colors"
                >
                  <span>Error details</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${
                      this.state.showDetails ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {this.state.showDetails && (
                  <div className="px-6 pb-4">
                    <div className="bg-neutral-950 border border-neutral-800 rounded-md p-3 overflow-auto max-h-48">
                      <p className="text-xs text-red-400 font-mono mb-2">
                        {this.state.error.name}: {this.state.error.message}
                      </p>
                      {this.state.errorInfo?.componentStack && (
                        <pre className="text-[10px] text-neutral-600 font-mono whitespace-pre-wrap">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
