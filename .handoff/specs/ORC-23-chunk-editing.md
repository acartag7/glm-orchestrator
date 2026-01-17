# ORC-23: Chunk Editing Functionality

## Overview

Allow editing chunk title and description before execution.

## Context

Chunks can't be modified after creation. Typos or unclear descriptions require deleting and recreating the chunk, which is tedious and error-prone.

## Implementation

### 1. Add PATCH Handler

Update `packages/dashboard/src/app/api/chunks/[id]/route.ts`:

```typescript
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json();

  const chunk = getChunk(id);
  if (!chunk) {
    return Response.json({ error: 'Chunk not found' }, { status: 404 });
  }

  // Only allow editing pending chunks
  if (chunk.status !== 'pending') {
    return Response.json({ error: 'Can only edit pending chunks' }, { status: 400 });
  }

  const updated = updateChunk(id, {
    title: body.title,
    description: body.description,
  });

  return Response.json(updated);
}
```

### 2. Create Edit Chunk Modal

Create `packages/dashboard/src/components/EditChunkModal.tsx`:

```typescript
'use client';

import { useState } from 'react';
import type { Chunk } from '@specwright/shared';

interface EditChunkModalProps {
  chunk: Chunk;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { title: string; description: string }) => Promise<void>;
}

export default function EditChunkModal({ chunk, isOpen, onClose, onSave }: EditChunkModalProps) {
  const [title, setTitle] = useState(chunk.title);
  const [description, setDescription] = useState(chunk.description);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSave({ title, description });
      onClose();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 w-full max-w-lg">
        <h2 className="text-lg font-mono text-neutral-100 mb-4">Edit Chunk</h2>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm font-mono text-neutral-100 mb-3"
          placeholder="Chunk title"
          required
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm font-mono text-neutral-100 mb-4 h-40"
          placeholder="Chunk description"
          required
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-mono text-neutral-400">
            Cancel
          </button>
          <button type="submit" disabled={isLoading} className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded text-xs font-mono">
            {isLoading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

### 3. Add Edit Button to ChunkCard

Update `packages/dashboard/src/components/ChunkCard.tsx` or `ChunkItem.tsx`:

```typescript
// Add edit handler prop
interface ChunkCardProps {
  chunk: Chunk;
  onEdit?: (chunk: Chunk) => void;
  // ... other props
}

// Show edit button for pending chunks
{chunk.status === 'pending' && onEdit && (
  <button
    onClick={() => onEdit(chunk)}
    className="text-neutral-400 hover:text-neutral-200"
  >
    <Pencil className="w-4 h-4" />
  </button>
)}
```

## Files to Modify

- MODIFY: `packages/dashboard/src/app/api/chunks/[id]/route.ts`
- CREATE: `packages/dashboard/src/components/EditChunkModal.tsx`
- MODIFY: `packages/dashboard/src/components/ChunkCard.tsx`
- MODIFY: `packages/dashboard/src/app/project/[id]/spec/[specId]/page.tsx` (wire up modal)

## Acceptance Criteria

- [ ] Edit button visible on pending chunks
- [ ] Clicking edit opens modal with current data
- [ ] Can edit title and description
- [ ] Save persists changes via PATCH API
- [ ] Cannot edit running/completed/failed chunks
