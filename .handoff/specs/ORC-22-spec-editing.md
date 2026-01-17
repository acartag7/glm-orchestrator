# ORC-22: Spec Editing Functionality

## Overview

Allow editing spec title, content, and status after creation.

## Context

Currently specs can't be edited once created. Typos require deleting and recreating the entire spec, losing all associated chunks and execution history.

## Implementation

### 1. Add PATCH Handler

Update `packages/dashboard/src/app/api/specs/[id]/route.ts`:

```typescript
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json();

  const spec = getSpec(id);
  if (!spec) {
    return Response.json({ error: 'Spec not found' }, { status: 404 });
  }

  // Only allow editing draft/review specs, not running ones
  if (spec.status === 'running') {
    return Response.json({ error: 'Cannot edit running spec' }, { status: 400 });
  }

  const updated = updateSpec(id, {
    title: body.title,
    content: body.content,
    status: body.status,
  });

  return Response.json(updated);
}
```

### 2. Create Spec Editor Component

Create `packages/dashboard/src/components/SpecEditor.tsx`:

```typescript
'use client';

import { useState } from 'react';
import type { Spec } from '@specwright/shared';

interface SpecEditorProps {
  spec: Spec;
  onSave: (data: { title: string; content: string }) => Promise<void>;
  onCancel: () => void;
}

export default function SpecEditor({ spec, onSave, onCancel }: SpecEditorProps) {
  const [title, setTitle] = useState(spec.title || '');
  const [content, setContent] = useState(spec.content || '');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onSave({ title, content });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm font-mono text-neutral-100"
        placeholder="Spec title"
        required
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm font-mono text-neutral-100 h-96"
        placeholder="Spec content (markdown)"
        required
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-mono text-neutral-400">
          Cancel
        </button>
        <button type="submit" disabled={isLoading} className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded text-xs font-mono">
          {isLoading ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}
```

### 3. Add Edit Button to Spec Page

Update `packages/dashboard/src/app/project/[id]/spec/[specId]/page.tsx`:

```typescript
// Add edit mode state
const [isEditing, setIsEditing] = useState(false);

// Add edit handler
const handleSaveEdit = async (data: { title: string; content: string }) => {
  await fetch(`/api/specs/${specId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  setIsEditing(false);
  // Refresh spec data
  fetchSpec();
};

// In render, add edit button next to title
{spec.status !== 'running' && (
  <button onClick={() => setIsEditing(true)} className="text-neutral-400 hover:text-neutral-200">
    <Pencil className="w-4 h-4" />
  </button>
)}
```

## Files to Modify

- MODIFY: `packages/dashboard/src/app/api/specs/[id]/route.ts`
- CREATE: `packages/dashboard/src/components/SpecEditor.tsx`
- MODIFY: `packages/dashboard/src/app/project/[id]/spec/[specId]/page.tsx`

## Acceptance Criteria

- [ ] Edit button visible on spec page (when not running)
- [ ] Clicking edit opens editor with current content
- [ ] Can edit title and content
- [ ] Save persists changes to database
- [ ] Cancel discards changes
- [ ] Cannot edit while spec is running
