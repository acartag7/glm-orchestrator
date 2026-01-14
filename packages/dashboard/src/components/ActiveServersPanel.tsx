'use client';

import type { Server } from '@/lib/types';

interface ActiveServersPanelProps {
  servers: Server[];
}

export default function ActiveServersPanel({ servers }: ActiveServersPanelProps) {

  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
          Active Servers
        </h2>
        <span className="bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">
          {servers.length}
        </span>
      </div>
      {servers.length === 0 ? (
        <p className="text-gray-500 italic">No servers connected</p>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => {
            const isActive = Date.now() - server.last_heartbeat <= 30000;
            return (
              <div
                key={server.id}
                className="flex items-center justify-between bg-gray-800 rounded px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isActive ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-sm text-gray-200">
                    {server.folder_name}:{server.pid}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {formatTimeAgo(server.last_heartbeat)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
