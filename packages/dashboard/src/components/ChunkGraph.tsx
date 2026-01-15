'use client';

import { useMemo, useState, useCallback } from 'react';
import type { Chunk, ChunkNode } from '@glm/shared';
import { calculateLayout, groupByLayers, calculateCriticalPath } from '@/lib/graph-layout';

interface ChunkGraphProps {
  chunks: Chunk[];
  onChunkClick: (chunk: Chunk) => void;
  onRunChunk: (chunk: Chunk) => void;
  runningChunkId?: string;
  selectedChunkId?: string;
}

const statusConfig = {
  pending: {
    icon: '○',
    borderColor: 'border-neutral-600',
    bgColor: 'bg-neutral-900/50',
    textColor: 'text-neutral-400',
    iconColor: 'text-neutral-500',
  },
  running: {
    icon: '◐',
    borderColor: 'border-amber-500',
    bgColor: 'bg-amber-950/30',
    textColor: 'text-amber-100',
    iconColor: 'text-amber-400',
  },
  completed: {
    icon: '✓',
    borderColor: 'border-emerald-500',
    bgColor: 'bg-emerald-950/30',
    textColor: 'text-emerald-100',
    iconColor: 'text-emerald-400',
  },
  failed: {
    icon: '✕',
    borderColor: 'border-red-500',
    bgColor: 'bg-red-950/30',
    textColor: 'text-red-100',
    iconColor: 'text-red-400',
  },
  cancelled: {
    icon: '⊘',
    borderColor: 'border-amber-500/50',
    bgColor: 'bg-amber-950/20',
    textColor: 'text-amber-100',
    iconColor: 'text-amber-400',
  },
};

interface GraphNodeProps {
  node: ChunkNode;
  chunk: Chunk;
  isSelected: boolean;
  isRunning: boolean;
  isHovered: boolean;
  isHighlighted: boolean;
  isCriticalPath: boolean;
  isBlocked: boolean;
  chunkMap: Map<string, Chunk>;
  onClick: () => void;
  onDoubleClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function GraphNode({
  node,
  chunk,
  isSelected,
  isRunning,
  isHovered,
  isHighlighted,
  isCriticalPath,
  isBlocked,
  chunkMap,
  onClick,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
}: GraphNodeProps) {
  const config = statusConfig[node.status];

  // Get dependency names
  const depNames = node.dependencies.map(depId => {
    const dep = chunkMap.get(depId);
    return dep?.title || depId;
  });

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`
        relative p-3 rounded-lg border-2 cursor-pointer transition-all
        ${config.bgColor} ${config.borderColor}
        ${isSelected ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-neutral-950' : ''}
        ${isHighlighted ? 'border-emerald-400/60' : ''}
        ${isCriticalPath ? 'border-l-4 border-l-amber-500' : ''}
        ${isBlocked ? 'opacity-50' : ''}
        ${node.canRun ? 'border-emerald-400' : ''}
        hover:border-neutral-500
        min-w-[180px] max-w-[220px]
      `}
    >
      {/* Status icon */}
      <div className="flex items-center gap-2 mb-1">
        {isRunning ? (
          <svg className="w-4 h-4 animate-spin text-amber-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <span className={`${config.iconColor} font-mono text-sm`}>{config.icon}</span>
        )}
        <span className={`text-sm font-mono ${config.textColor} truncate flex-1`}>
          {node.title.length > 22 ? node.title.slice(0, 20) + '...' : node.title}
        </span>
      </div>

      {/* Dependency info */}
      {node.dependencies.length > 0 && (
        <div className="text-[10px] font-mono text-neutral-500 mt-1">
          ↪ depends on: {depNames.slice(0, 2).map(n => n.slice(0, 15)).join(', ')}
          {depNames.length > 2 && ` +${depNames.length - 2}`}
        </div>
      )}

      {/* Can run indicator */}
      {node.canRun && (
        <div className="absolute top-2 right-2">
          <span className="flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        </div>
      )}

      {/* Blocked indicator */}
      {isBlocked && (
        <div className="absolute top-2 right-2 text-[10px] font-mono text-neutral-500">
          ⏳ blocked
        </div>
      )}
    </div>
  );
}

export default function ChunkGraph({
  chunks,
  onChunkClick,
  onRunChunk,
  runningChunkId,
  selectedChunkId,
}: ChunkGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const [collapsedLayers, setCollapsedLayers] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(100);

  // Calculate layout
  const graph = useMemo(() => calculateLayout(chunks), [chunks]);
  const layers = useMemo(() => groupByLayers(graph), [graph]);
  const criticalPath = useMemo(
    () => (showCriticalPath ? new Set(calculateCriticalPath(graph)) : new Set<string>()),
    [graph, showCriticalPath]
  );

  // Create chunk map for quick lookup
  const chunkMap = useMemo(
    () => new Map(chunks.map(c => [c.id, c])),
    [chunks]
  );

  // Create node map for quick lookup
  const nodeMap = useMemo(
    () => new Map(graph.nodes.map(n => [n.id, n])),
    [graph.nodes]
  );

  // Get highlighted nodes (selected or hovered node + its connections)
  const highlightedNodes = useMemo(() => {
    const highlighted = new Set<string>();
    const focusId = hoveredNodeId || selectedChunkId;
    if (!focusId) return highlighted;

    const node = nodeMap.get(focusId);
    if (!node) return highlighted;

    highlighted.add(focusId);
    node.dependencies.forEach(id => highlighted.add(id));
    node.dependents.forEach(id => highlighted.add(id));

    return highlighted;
  }, [hoveredNodeId, selectedChunkId, nodeMap]);

  const handleNodeClick = useCallback((id: string) => {
    const chunk = chunkMap.get(id);
    if (chunk) {
      onChunkClick(chunk);
    }
  }, [chunkMap, onChunkClick]);

  const handleNodeDoubleClick = useCallback((id: string) => {
    const chunk = chunkMap.get(id);
    const node = nodeMap.get(id);
    if (chunk && node?.canRun) {
      onRunChunk(chunk);
    }
  }, [chunkMap, nodeMap, onRunChunk]);

  const toggleLayer = useCallback((layerNum: number) => {
    setCollapsedLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerNum)) {
        next.delete(layerNum);
      } else {
        next.add(layerNum);
      }
      return next;
    });
  }, []);

  if (chunks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-neutral-900/50 border border-dashed border-neutral-800 rounded-md p-6 text-center">
          <p className="text-neutral-600 text-xs font-mono">
            no chunks yet. break your spec into executable tasks.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex-shrink-0 flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCriticalPath(!showCriticalPath)}
            className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
              showCriticalPath
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                : 'bg-neutral-900 text-neutral-500 border-neutral-700 hover:text-neutral-300'
            }`}
          >
            {showCriticalPath ? '◆' : '◇'} critical path
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.max(50, z - 10))}
            className="text-neutral-500 hover:text-neutral-300 p-1"
            title="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <span className="text-[10px] font-mono text-neutral-500 w-10 text-center">
            {zoom}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(150, z + 10))}
            className="text-neutral-500 hover:text-neutral-300 p-1"
            title="Zoom in"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => setZoom(100)}
            className="text-[10px] font-mono text-neutral-500 hover:text-neutral-300 px-1"
            title="Reset zoom"
          >
            reset
          </button>
        </div>
      </div>

      {/* Graph container with zoom */}
      <div
        className="flex-1 overflow-auto"
        style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
      >
        <div className="space-y-4 pb-4">
          {layers.map(layer => {
            const isCollapsed = collapsedLayers.has(layer.layer);

            return (
              <div key={layer.layer} className="border border-neutral-800 rounded-lg overflow-hidden">
                {/* Layer header */}
                <button
                  onClick={() => toggleLayer(layer.layer)}
                  className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors ${
                    layer.isComplete
                      ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                      : 'bg-neutral-900/50 hover:bg-neutral-800/50'
                  }`}
                >
                  <span className="text-[11px] font-mono text-neutral-400">
                    {layer.label}
                    <span className="text-neutral-600 ml-2">
                      ({layer.nodes.length} {layer.nodes.length === 1 ? 'chunk' : 'chunks'})
                    </span>
                  </span>
                  <span className="text-neutral-500">
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                </button>

                {/* Layer content */}
                {!isCollapsed && (
                  <div className="p-3 bg-neutral-950/50">
                    <div className="flex flex-wrap gap-3">
                      {layer.nodes.map(node => {
                        const chunk = chunkMap.get(node.id);
                        if (!chunk) return null;

                        const isBlocked = !node.canRun && node.status !== 'completed' && node.status !== 'running' && node.dependencies.length > 0;

                        return (
                          <GraphNode
                            key={node.id}
                            node={node}
                            chunk={chunk}
                            isSelected={selectedChunkId === node.id}
                            isRunning={runningChunkId === node.id}
                            isHovered={hoveredNodeId === node.id}
                            isHighlighted={highlightedNodes.has(node.id)}
                            isCriticalPath={criticalPath.has(node.id)}
                            isBlocked={isBlocked}
                            chunkMap={chunkMap}
                            onClick={() => handleNodeClick(node.id)}
                            onDoubleClick={() => handleNodeDoubleClick(node.id)}
                            onMouseEnter={() => setHoveredNodeId(node.id)}
                            onMouseLeave={() => setHoveredNodeId(null)}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 mt-2 px-1 flex flex-wrap gap-4 text-[10px] font-mono text-neutral-500">
        <div className="flex items-center gap-1">
          <span className="text-neutral-500">○</span> pending
        </div>
        <div className="flex items-center gap-1">
          <span className="text-amber-400">◐</span> running
        </div>
        <div className="flex items-center gap-1">
          <span className="text-emerald-400">✓</span> completed
        </div>
        <div className="flex items-center gap-1">
          <span className="text-red-400">✕</span> failed
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> can run
        </div>
        <div className="text-neutral-600">
          double-click to run
        </div>
      </div>
    </div>
  );
}
