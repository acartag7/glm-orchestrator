'use client';

import { useOpencode, OpencodeStatusType } from '@/contexts/OpencodeContext';

const statusConfig: Record<OpencodeStatusType, { icon: string; color: string; label: string }> = {
  unknown: { icon: '○', color: 'text-neutral-500', label: 'checking...' },
  starting: { icon: '◐', color: 'text-amber-400', label: 'starting...' },
  running: { icon: '●', color: 'text-emerald-400', label: 'running' },
  stopped: { icon: '○', color: 'text-red-400', label: 'stopped' },
  error: { icon: '✕', color: 'text-red-400', label: 'error' },
};

export function OpencodeStatus() {
  const { status, error, start, restart } = useOpencode();

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className={config.color}>{config.icon}</span>
      <span className="text-neutral-500">opencode:</span>
      <span className={config.color}>{config.label}</span>

      {status === 'stopped' && (
        <button
          type="button"
          onClick={start}
          className="ml-1 px-1.5 py-0.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded text-[10px] transition-colors"
        >
          start
        </button>
      )}

      {status === 'error' && (
        <>
          <span className="text-red-400/70 truncate max-w-[150px]" title={error}>
            {error}
          </span>
          <button
            type="button"
            onClick={restart}
            className="ml-1 px-1.5 py-0.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/30 rounded text-[10px] transition-colors"
          >
            retry
          </button>
        </>
      )}

      {status === 'starting' && (
        <svg className="animate-spin w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" role="img" aria-labelledby="opencode-spinner-title">
          <title id="opencode-spinner-title">Starting opencode server</title>
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
    </div>
  );
}
