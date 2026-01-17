# ORC-43: Manage opencode Server Lifecycle

## Overview

Specwright should automatically start, monitor, and stop the opencode server. Users shouldn't need to manually run `opencode` in a separate terminal.

## Goals

1. Auto-start opencode when dashboard starts
2. Monitor health and restart if it crashes
3. Clean shutdown when dashboard stops
4. Show status in UI (running/stopped/error)
5. Handle port conflicts gracefully

## Architecture

### Opencode Manager Service

```typescript
// packages/dashboard/src/lib/opencode-manager.ts

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface OpencodeStatus {
  running: boolean;
  pid?: number;
  port: number;
  uptime?: number;
  error?: string;
  lastRestart?: Date;
}

export class OpencodeManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private port = 4096;
  private restartCount = 0;
  private maxRestarts = 5;
  private startTime: Date | null = null;

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('opencode is already running');
    }

    // Check if port is available
    if (!await this.isPortAvailable(this.port)) {
      throw new Error(`Port ${this.port} is already in use`);
    }

    // Spawn opencode process
    this.process = spawn('opencode', ['--port', String(this.port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false, // Keep as child process
    });

    this.startTime = new Date();
    this.restartCount = 0;

    // Handle stdout/stderr
    this.process.stdout?.on('data', (data) => {
      console.log('[opencode]', data.toString());
    });

    this.process.stderr?.on('data', (data) => {
      console.error('[opencode]', data.toString());
    });

    // Handle exit
    this.process.on('exit', (code, signal) => {
      console.log(`opencode exited with code ${code} signal ${signal}`);
      this.process = null;
      this.startTime = null;

      // Auto-restart if crashed (not manual stop)
      if (code !== 0 && this.restartCount < this.maxRestarts) {
        this.restartCount++;
        console.log(`Restarting opencode (attempt ${this.restartCount}/${this.maxRestarts})`);
        setTimeout(() => this.start(), 2000);
        this.emit('restart', this.restartCount);
      } else {
        this.emit('stopped', code);
      }
    });

    // Wait for health check
    await this.waitForHealth();
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    this.process.kill('SIGTERM');

    // Force kill after 5s
    setTimeout(() => {
      if (this.process) {
        this.process.kill('SIGKILL');
      }
    }, 5000);

    this.process = null;
    this.startTime = null;
  }

  async getStatus(): Promise<OpencodeStatus> {
    if (!this.process || !this.startTime) {
      return { running: false, port: this.port };
    }

    const uptime = Date.now() - this.startTime.getTime();

    // Check health
    try {
      const response = await fetch(`http://localhost:${this.port}/health`, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return {
          running: true,
          pid: this.process.pid,
          port: this.port,
          uptime,
        };
      }
    } catch (error) {
      return {
        running: false,
        port: this.port,
        error: error instanceof Error ? error.message : 'Health check failed',
      };
    }

    return { running: false, port: this.port };
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return false; // Port in use
    } catch {
      return true; // Port available
    }
  }

  private async waitForHealth(timeout = 30000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const response = await fetch(`http://localhost:${this.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('opencode failed to start within 30s');
  }
}

// Singleton instance
let manager: OpencodeManager | null = null;

export function getOpencodeManager(): OpencodeManager {
  if (!manager) {
    manager = new OpencodeManager();
  }
  return manager;
}
```

### Integration with Dashboard

```typescript
// packages/dashboard/src/lib/server-lifecycle.ts

import { getOpencodeManager } from './opencode-manager';

let isShuttingDown = false;

export async function startServices() {
  const opencode = getOpencodeManager();

  try {
    console.log('Starting opencode server...');
    await opencode.start();
    console.log('opencode server started successfully');
  } catch (error) {
    console.error('Failed to start opencode:', error);
    throw error;
  }
}

export async function stopServices() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const opencode = getOpencodeManager();

  console.log('Stopping opencode server...');
  await opencode.stop();
  console.log('Services stopped');
}

// Handle process signals
process.on('SIGINT', async () => {
  await stopServices();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopServices();
  process.exit(0);
});
```

### API Route for Status

```typescript
// packages/dashboard/src/app/api/opencode/status/route.ts

import { NextResponse } from 'next/server';
import { getOpencodeManager } from '@/lib/opencode-manager';

export async function GET() {
  const manager = getOpencodeManager();
  const status = await manager.getStatus();
  return NextResponse.json(status);
}
```

### Start Services on Dev/Production

```typescript
// packages/dashboard/server.ts (new file for custom server)

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { startServices, stopServices } from './src/lib/server-lifecycle';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  // Start opencode
  await startServices();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  server.listen(4740, () => {
    console.log('> Ready on http://localhost:4740');
  });

  // Cleanup on exit
  process.on('SIGTERM', async () => {
    await stopServices();
    server.close();
  });
});
```

Update package.json scripts:

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build",
    "start": "NODE_ENV=production tsx server.ts"
  }
}
```

## Status Indicator Component

```tsx
// packages/dashboard/src/components/OpencodeStatus.tsx
'use client';

import { useEffect, useState } from 'react';
import type { OpencodeStatus } from '@/lib/opencode-manager';

export function OpencodeStatus() {
  const [status, setStatus] = useState<OpencodeStatus | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      const res = await fetch('/api/opencode/status');
      const data = await res.json();
      setStatus(data);
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  return (
    <div className="text-sm">
      {status.running ? (
        <span className="text-green-600">● opencode running</span>
      ) : (
        <span className="text-red-600">● opencode stopped</span>
      )}
      {status.error && <span className="text-xs text-red-500 ml-2">{status.error}</span>}
    </div>
  );
}
```

## Error Handling

### Port Conflict

If port 4096 is already in use:
1. Check if it's an existing opencode instance (connect and verify)
2. If yes, use it (don't start new one)
3. If no, show error: "Port 4096 in use. Stop the process or change OPENCODE_PORT env var"

### opencode Not Installed

If `opencode` command not found:
1. Show error in health check
2. Provide install instructions: `pnpm dlx opencode` or `npm install -g opencode`
3. Don't crash the dashboard

### Repeated Crashes

If opencode crashes 5 times:
1. Stop auto-restart
2. Show error in UI with logs
3. User can manually retry

## Environment Variables

```bash
# .env
OPENCODE_PORT=4096          # Default port
OPENCODE_AUTO_START=true    # Auto-start on dashboard launch
```

## Files to Create/Modify

**CREATE:**
- `packages/dashboard/src/lib/opencode-manager.ts`
- `packages/dashboard/src/lib/server-lifecycle.ts`
- `packages/dashboard/server.ts`
- `packages/dashboard/src/app/api/opencode/status/route.ts`
- `packages/dashboard/src/components/OpencodeStatus.tsx`

**MODIFY:**
- `packages/dashboard/package.json` (update scripts)
- `packages/dashboard/src/lib/health-check.ts` (integrate with manager)
- `packages/dashboard/src/app/layout.tsx` (add status indicator)

## Acceptance Criteria

- [ ] opencode starts automatically when dashboard starts
- [ ] Auto-restarts if crashes (max 5 attempts)
- [ ] Clean shutdown when dashboard stops
- [ ] Status visible in UI (running/stopped/error)
- [ ] Handles port conflicts gracefully
- [ ] Works with existing opencode instance
- [ ] Error messages guide user to fix issues
- [ ] No manual `opencode` command needed

## Dependencies

- Blocked by: None
- Blocks: ORC-42 (health check uses this)

## Testing

```bash
# Test auto-start
pnpm dev
# Should see "Starting opencode server..." in logs

# Test crash recovery
# Kill opencode process manually
pkill -9 opencode
# Should auto-restart

# Test graceful shutdown
# Ctrl+C dashboard
# Should see "Stopping opencode server..."

# Test port conflict
opencode --port 4096 &  # Start manually
pnpm dev  # Should detect and use existing instance
```
