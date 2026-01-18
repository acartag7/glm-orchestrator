import { NextResponse } from 'next/server';
import { opencodeManager } from '@/lib/services/opencode-manager';

// GET /api/health/opencode - Check opencode server status
export async function GET() {
  const status = opencodeManager.getStatus();
  const healthy = await opencodeManager.checkHealth();

  return NextResponse.json({
    ...status,
    healthy,
  });
}

// POST /api/health/opencode - Start or restart opencode server
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const action = body.action || 'start';

  if (action === 'restart') {
    const result = await opencodeManager.restart();
    // Start health monitor after successful restart
    if (result.success) {
      opencodeManager.startHealthMonitor();
    }
    return NextResponse.json(result);
  }

  if (action === 'stop') {
    await opencodeManager.stop();
    return NextResponse.json({ success: true });
  }

  // Default: start
  const result = await opencodeManager.start();

  // Start health monitor after successful start
  if (result.success) {
    opencodeManager.startHealthMonitor();
  }

  return NextResponse.json(result);
}
