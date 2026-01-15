/**
 * Chunk Dependencies API
 *
 * PUT /api/chunks/[id]/dependencies
 * Updates the dependencies of a chunk with validation
 */

import { getChunk, getChunksBySpec, updateChunk } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Check for circular dependencies using DFS
 */
function hasCircularDependency(
  chunkId: string,
  newDependencies: string[],
  allChunks: Map<string, string[]>
): boolean {
  const visited = new Set<string>();
  const stack = new Set<string>();

  // Create a temporary map with the new dependencies
  const tempDeps = new Map(allChunks);
  tempDeps.set(chunkId, newDependencies);

  function dfs(id: string): boolean {
    if (stack.has(id)) {
      return true; // Circular dependency found
    }
    if (visited.has(id)) {
      return false;
    }

    visited.add(id);
    stack.add(id);

    const deps = tempDeps.get(id) || [];
    for (const dep of deps) {
      if (dfs(dep)) {
        return true;
      }
    }

    stack.delete(id);
    return false;
  }

  return dfs(chunkId);
}

// PUT /api/chunks/[id]/dependencies
export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const { dependencies } = body as { dependencies: string[] };

    // Validate input
    if (!Array.isArray(dependencies)) {
      return new Response(
        JSON.stringify({ error: 'dependencies must be an array of chunk IDs' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get the chunk to update
    const chunk = getChunk(id);
    if (!chunk) {
      return new Response(
        JSON.stringify({ error: 'Chunk not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate: no self-reference
    if (dependencies.includes(id)) {
      return new Response(
        JSON.stringify({ error: 'A chunk cannot depend on itself' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all chunks in the same spec
    const specChunks = getChunksBySpec(chunk.specId);
    const chunkIds = new Set(specChunks.map(c => c.id));

    // Validate: all referenced chunks exist in same spec
    for (const depId of dependencies) {
      if (!chunkIds.has(depId)) {
        return new Response(
          JSON.stringify({ error: `Dependency "${depId}" not found in this spec` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Build dependency map for circular check
    const depsMap = new Map<string, string[]>();
    for (const c of specChunks) {
      depsMap.set(c.id, c.dependencies);
    }

    // Validate: no circular dependencies
    if (hasCircularDependency(id, dependencies, depsMap)) {
      return new Response(
        JSON.stringify({ error: 'This would create a circular dependency' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update the chunk
    const updated = updateChunk(id, { dependencies });
    if (!updated) {
      return new Response(
        JSON.stringify({ error: 'Failed to update chunk' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating chunk dependencies:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
