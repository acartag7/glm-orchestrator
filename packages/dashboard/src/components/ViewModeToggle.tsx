'use client';

export type ViewMode = 'list' | 'graph' | 'plan';

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export default function ViewModeToggle({
  viewMode,
  onViewModeChange,
}: ViewModeToggleProps) {
  return (
    <div className="flex items-center gap-0.5 bg-neutral-900 border border-neutral-800 rounded-md p-0.5">
      <button
        onClick={() => onViewModeChange('list')}
        className={`px-2 py-1 rounded text-[10px] font-mono transition-colors flex items-center gap-1 ${
          viewMode === 'list'
            ? 'bg-neutral-800 text-neutral-200'
            : 'text-neutral-500 hover:text-neutral-300'
        }`}
        title="List View"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        list
      </button>
      <button
        onClick={() => onViewModeChange('graph')}
        className={`px-2 py-1 rounded text-[10px] font-mono transition-colors flex items-center gap-1 ${
          viewMode === 'graph'
            ? 'bg-neutral-800 text-neutral-200'
            : 'text-neutral-500 hover:text-neutral-300'
        }`}
        title="Graph View"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
        graph
      </button>
      <button
        onClick={() => onViewModeChange('plan')}
        className={`px-2 py-1 rounded text-[10px] font-mono transition-colors flex items-center gap-1 ${
          viewMode === 'plan'
            ? 'bg-neutral-800 text-neutral-200'
            : 'text-neutral-500 hover:text-neutral-300'
        }`}
        title="Execution Plan"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        plan
      </button>
    </div>
  );
}
