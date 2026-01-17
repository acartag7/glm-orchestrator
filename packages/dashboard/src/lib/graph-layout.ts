/**
 * Graph layout algorithm for chunk visualization
 *
 * Uses topological sort to assign layers, then groups nodes by layer.
 */

import type { Chunk, ChunkNode, ChunkGraph } from '@specwright/shared';

/**
 * Compute dependents for each chunk (reverse of dependencies)
 */
function computeDependents(chunks: Chunk[]): Map<string, string[]> {
  const dependents = new Map<string, string[]>();

  // Initialize empty arrays
  for (const chunk of chunks) {
    dependents.set(chunk.id, []);
  }

  // Build reverse map
  for (const chunk of chunks) {
    for (const depId of chunk.dependencies) {
      const deps = dependents.get(depId);
      if (deps) {
        deps.push(chunk.id);
      }
    }
  }

  return dependents;
}

/**
 * Topological sort using Kahn's algorithm
 * Returns chunks grouped by layer (level in the dependency graph)
 */
function assignLayers(chunks: Chunk[]): Map<string, number> {
  const layers = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const chunkMap = new Map<string, Chunk>();

  // Initialize
  for (const chunk of chunks) {
    chunkMap.set(chunk.id, chunk);
    inDegree.set(chunk.id, chunk.dependencies.length);
  }

  // Find all nodes with no dependencies (layer 0)
  let currentLayer: string[] = [];
  for (const chunk of chunks) {
    if (chunk.dependencies.length === 0) {
      currentLayer.push(chunk.id);
      layers.set(chunk.id, 0);
    }
  }

  let layer = 0;
  const processed = new Set<string>();

  while (currentLayer.length > 0) {
    const nextLayer: string[] = [];

    for (const id of currentLayer) {
      processed.add(id);
      const chunk = chunkMap.get(id);
      if (!chunk) continue;

      // Process all chunks that depend on this one
      for (const other of chunks) {
        if (processed.has(other.id)) continue;
        if (!other.dependencies.includes(id)) continue;

        // Decrement in-degree
        const newDegree = (inDegree.get(other.id) || 1) - 1;
        inDegree.set(other.id, newDegree);

        // If all dependencies processed, add to next layer
        if (newDegree === 0) {
          nextLayer.push(other.id);
          layers.set(other.id, layer + 1);
        }
      }
    }

    currentLayer = nextLayer;
    layer++;
  }

  // Handle any remaining nodes (cycles or orphans) - place in last layer
  for (const chunk of chunks) {
    if (!layers.has(chunk.id)) {
      layers.set(chunk.id, layer);
    }
  }

  return layers;
}

/**
 * Check if a chunk can be run (all dependencies completed)
 */
function canChunkRun(chunk: Chunk, chunks: Chunk[]): boolean {
  if (chunk.status === 'running' || chunk.status === 'completed') {
    return false;
  }

  const chunkMap = new Map(chunks.map(c => [c.id, c]));

  for (const depId of chunk.dependencies) {
    const dep = chunkMap.get(depId);
    if (!dep || dep.status !== 'completed') {
      return false;
    }
  }

  return true;
}

/**
 * Check if a chunk is blocked (has pending dependencies)
 */
function isChunkBlocked(chunk: Chunk, chunks: Chunk[]): boolean {
  if (chunk.dependencies.length === 0) return false;
  if (chunk.status === 'completed' || chunk.status === 'running') return false;

  const chunkMap = new Map(chunks.map(c => [c.id, c]));

  for (const depId of chunk.dependencies) {
    const dep = chunkMap.get(depId);
    if (!dep || dep.status !== 'completed') {
      return true;
    }
  }

  return false;
}

export interface LayerInfo {
  layer: number;
  label: string;
  nodes: ChunkNode[];
  isComplete: boolean;
}

/**
 * Calculate the full graph layout grouped by layers
 */
export function calculateLayout(chunks: Chunk[]): ChunkGraph {
  if (chunks.length === 0) {
    return { nodes: [], edges: [] };
  }

  const dependents = computeDependents(chunks);
  const layers = assignLayers(chunks);

  const nodes: ChunkNode[] = chunks.map(chunk => {
    return {
      id: chunk.id,
      title: chunk.title,
      status: chunk.status,
      reviewStatus: chunk.reviewStatus,
      dependencies: chunk.dependencies,
      dependents: dependents.get(chunk.id) || [],
      canRun: canChunkRun(chunk, chunks),
      layer: layers.get(chunk.id) || 0,
      x: 0, // Not used in HTML layout
      y: 0,
    };
  });

  // Build edges
  const edges: Array<{ from: string; to: string }> = [];
  for (const chunk of chunks) {
    for (const depId of chunk.dependencies) {
      edges.push({ from: depId, to: chunk.id });
    }
  }

  return { nodes, edges };
}

/**
 * Group nodes by layer with metadata
 */
export function groupByLayers(graph: ChunkGraph): LayerInfo[] {
  const layerMap = new Map<number, ChunkNode[]>();

  for (const node of graph.nodes) {
    const layer = node.layer || 0;
    if (!layerMap.has(layer)) {
      layerMap.set(layer, []);
    }
    layerMap.get(layer)!.push(node);
  }

  const layers: LayerInfo[] = [];
  const sortedLayerNums = Array.from(layerMap.keys()).sort((a, b) => a - b);
  const maxLayer = sortedLayerNums.length - 1;

  for (const layerNum of sortedLayerNums) {
    const nodes = layerMap.get(layerNum) || [];
    const isComplete = nodes.every(n => n.status === 'completed');
    const hasRunning = nodes.some(n => n.status === 'running');
    const allBlocked = nodes.every(n => !n.canRun && n.status !== 'completed' && n.status !== 'running');

    let label: string;
    if (layerNum === 0) {
      label = 'Layer 0 — Run first (no dependencies)';
    } else if (allBlocked) {
      label = `Layer ${layerNum} — Blocked`;
    } else if (hasRunning) {
      label = `Layer ${layerNum} — Running`;
    } else if (isComplete) {
      label = `Layer ${layerNum} — Complete`;
    } else {
      label = `Layer ${layerNum}`;
    }

    layers.push({
      layer: layerNum,
      label,
      nodes,
      isComplete,
    });
  }

  return layers;
}

/**
 * Calculate critical path (longest chain of dependencies)
 */
export function calculateCriticalPath(graph: ChunkGraph): string[] {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const memo = new Map<string, string[]>();

  function getLongestPath(nodeId: string): string[] {
    if (memo.has(nodeId)) return memo.get(nodeId)!;

    const node = nodeMap.get(nodeId);
    if (!node) return [];

    if (node.dependencies.length === 0) {
      const path = [nodeId];
      memo.set(nodeId, path);
      return path;
    }

    let longestDepPath: string[] = [];
    for (const depId of node.dependencies) {
      const depPath = getLongestPath(depId);
      if (depPath.length > longestDepPath.length) {
        longestDepPath = depPath;
      }
    }

    const path = [...longestDepPath, nodeId];
    memo.set(nodeId, path);
    return path;
  }

  // Find the node with the longest path
  let criticalPath: string[] = [];
  for (const node of graph.nodes) {
    const path = getLongestPath(node.id);
    if (path.length > criticalPath.length) {
      criticalPath = path;
    }
  }

  return criticalPath;
}

/**
 * Build execution plan (steps with parallel groups)
 */
export interface ExecutionStep {
  step: number;
  parallel: boolean;
  chunks: Array<{
    id: string;
    title: string;
    dependencies: string[];
    dependencyTitles: string[];
  }>;
}

export function buildExecutionPlan(chunks: Chunk[]): ExecutionStep[] {
  if (chunks.length === 0) return [];

  const graph = calculateLayout(chunks);
  const layers = groupByLayers(graph);
  const chunkMap = new Map(chunks.map(c => [c.id, c]));

  // Filter to only pending/failed chunks
  const pendingChunks = chunks.filter(c =>
    c.status === 'pending' || c.status === 'failed' || c.status === 'cancelled'
  );

  if (pendingChunks.length === 0) return [];

  const pendingIds = new Set(pendingChunks.map(c => c.id));
  const steps: ExecutionStep[] = [];

  for (const layer of layers) {
    const pendingInLayer = layer.nodes.filter(n => pendingIds.has(n.id));
    if (pendingInLayer.length === 0) continue;

    steps.push({
      step: steps.length + 1,
      parallel: pendingInLayer.length > 1,
      chunks: pendingInLayer.map(node => {
        const chunk = chunkMap.get(node.id)!;
        return {
          id: node.id,
          title: node.title,
          dependencies: chunk.dependencies,
          dependencyTitles: chunk.dependencies.map(depId => {
            const dep = chunkMap.get(depId);
            return dep?.title || depId;
          }),
        };
      }),
    });
  }

  return steps;
}
