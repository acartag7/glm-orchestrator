'use client';

/**
 * Live Sessions Panel - Real-time GLM execution visualization
 */

import { useOpencodeEvents } from '@/hooks/useOpencodeEvents';
import type { LiveSession, LiveToolCall } from '@/lib/types';
import { useState } from 'react';

function ConnectionStatus({ isConnected, error }: { isConnected: boolean; error: string | null }) {
  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 rounded-full border border-red-500/30">
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <span className="text-red-400 text-xs font-medium">Disconnected</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
      isConnected
        ? 'bg-emerald-500/10 border-emerald-500/30'
        : 'bg-amber-500/10 border-amber-500/30'
    }`}>
      <div className={`w-2 h-2 rounded-full ${
        isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-bounce'
      }`} />
      <span className={`text-xs font-medium ${isConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
        {isConnected ? 'Live' : 'Connecting...'}
      </span>
    </div>
  );
}

function ToolCallBadge({ toolCall, index }: { toolCall: LiveToolCall; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const config: Record<string, { bg: string; border: string; text: string; icon: string; glow?: string }> = {
    pending: {
      bg: 'bg-slate-800',
      border: 'border-slate-600',
      text: 'text-slate-300',
      icon: '○'
    },
    running: {
      bg: 'bg-blue-950',
      border: 'border-blue-500',
      text: 'text-blue-300',
      icon: '◐',
      glow: 'shadow-blue-500/20 shadow-lg'
    },
    completed: {
      bg: 'bg-emerald-950',
      border: 'border-emerald-600',
      text: 'text-emerald-300',
      icon: '●'
    },
    error: {
      bg: 'bg-red-950',
      border: 'border-red-600',
      text: 'text-red-300',
      icon: '✗'
    },
  };

  const c = config[toolCall.state] || config.pending;
  const toolIcons: Record<string, string> = {
    read: '📄',
    write: '✍️',
    edit: '📝',
    glob: '🔍',
    grep: '🔎',
    bash: '💻',
    default: '🔧'
  };
  const icon = toolIcons[toolCall.tool.toLowerCase()] || toolIcons.default;

  return (
    <div
      className={`relative transition-all duration-300 ${c.glow || ''}`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full text-left px-3 py-2 rounded-lg border ${c.bg} ${c.border} ${c.text}
          hover:brightness-110 transition-all`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-lg ${toolCall.state === 'running' ? 'animate-spin' : ''}`}>
            {toolCall.state === 'running' ? '⚙️' : icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-sm">{toolCall.tool}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                toolCall.state === 'running' ? 'bg-blue-500 text-white animate-pulse' : 'bg-white/10'
              }`}>
                {toolCall.state}
              </span>
            </div>
            {toolCall.input && !expanded && (
              <div className="text-xs text-white/40 truncate font-mono mt-0.5">
                {getInputPreview(toolCall.input)}
              </div>
            )}
          </div>
          <span className="text-white/30 text-xs">{c.icon}</span>
        </div>
      </button>

      {expanded && toolCall.input && (
        <div className="mt-1 p-2 bg-black/40 rounded-lg border border-white/5">
          <pre className="text-[10px] text-white/60 font-mono overflow-x-auto">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
          {toolCall.output && (
            <div className="mt-2 pt-2 border-t border-white/10">
              <div className="text-[10px] text-emerald-400/60 mb-1">Output:</div>
              <pre className="text-[10px] text-white/50 font-mono max-h-32 overflow-y-auto">
                {toolCall.output.substring(0, 500)}
                {toolCall.output.length > 500 && '...'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getInputPreview(input: Record<string, unknown>): string {
  if (input.filePath) return String(input.filePath);
  if (input.path) return String(input.path);
  if (input.file_path) return String(input.file_path);
  if (input.command) return String(input.command).substring(0, 40);
  if (input.pattern) return `pattern: ${input.pattern}`;
  return Object.keys(input).slice(0, 2).join(', ');
}

function SessionCard({ session }: { session: LiveSession }) {
  const [collapsed, setCollapsed] = useState(false);
  const isBusy = session.status === 'busy';

  const completedCount = session.toolCalls.filter(t => t.state === 'completed').length;
  const runningCount = session.toolCalls.filter(t => t.state === 'running').length;
  const totalCount = session.toolCalls.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className={`rounded-xl border transition-all duration-300 ${
      isBusy
        ? 'border-blue-500/50 bg-gradient-to-br from-blue-950/50 to-slate-900 shadow-xl shadow-blue-500/10'
        : 'border-slate-700 bg-slate-900/50'
    }`}>
      {/* Header */}
      <div
        className="p-4 cursor-pointer hover:bg-white/5 transition-colors rounded-t-xl"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              isBusy ? 'bg-blue-500 animate-pulse' : 'bg-slate-600'
            }`} />
            <span className="font-mono text-sm text-white/70">
              {session.id.substring(0, 24)}...
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isBusy && (
              <span className="px-2 py-1 text-xs font-medium bg-blue-500 text-white rounded-full animate-pulse">
                LIVE
              </span>
            )}
            <span className="text-xs text-white/40">
              {collapsed ? '▶' : '▼'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        {totalCount > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-white/40 mb-1">
              <span>{completedCount} / {totalCount} tools</span>
              {runningCount > 0 && (
                <span className="text-blue-400">{runningCount} running</span>
              )}
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  isBusy
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-400'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tool calls */}
      {!collapsed && session.toolCalls.length > 0 && (
        <div className="px-4 pb-4">
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {session.toolCalls.map((tc, i) => (
              <ToolCallBadge key={tc.callId} toolCall={tc} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Text output */}
      {!collapsed && session.textOutput && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-black/30 rounded-lg border border-white/5">
            <div className="text-[10px] text-white/40 mb-1 uppercase tracking-wide">Output</div>
            <div className="text-sm text-white/70 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
              {session.textOutput.substring(0, 500)}
              {session.textOutput.length > 500 && '...'}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/5 flex justify-between text-[10px] text-white/30">
        <span>Started {new Date(session.startedAt).toLocaleTimeString()}</span>
        <span>{Math.round((Date.now() - session.startedAt) / 1000)}s elapsed</span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4">
        <span className="text-3xl">🔌</span>
      </div>
      <h3 className="text-lg font-medium text-white mb-2">No Active Sessions</h3>
      <p className="text-sm text-white/40 max-w-xs">
        Sessions will appear here when GLM tasks are running via the orchestrator.
      </p>
    </div>
  );
}

export default function LiveSessionsPanel() {
  const { sessions, isConnected, connectionError, events } = useOpencodeEvents();
  const sessionList = Array.from(sessions.values());
  const activeSessions = sessionList.filter(s => s.status === 'busy');
  const idleSessions = sessionList.filter(s => s.status === 'idle').slice(-5);

  return (
    <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50 bg-slate-800/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Live Sessions</h2>
              <p className="text-xs text-white/40">Real-time GLM execution</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-white/40 bg-slate-800 px-2 py-1 rounded">
              {events.length} events
            </div>
            <ConnectionStatus isConnected={isConnected} error={connectionError} />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {sessionList.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {/* Active sessions */}
            {activeSessions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-xs font-medium text-white/60 uppercase tracking-wider">
                    Active ({activeSessions.length})
                  </span>
                </div>
                <div className="space-y-3">
                  {activeSessions.map(session => (
                    <SessionCard key={session.id} session={session} />
                  ))}
                </div>
              </div>
            )}

            {/* Recent idle sessions */}
            {idleSessions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-slate-500" />
                  <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
                    Recent
                  </span>
                </div>
                <div className="space-y-3">
                  {idleSessions.map(session => (
                    <SessionCard key={session.id} session={session} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
