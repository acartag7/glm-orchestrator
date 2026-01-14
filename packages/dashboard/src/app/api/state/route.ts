import { NextResponse } from 'next/server';
import { getActiveServers, getActiveTasks, getWorkflows } from '@/lib/db';

export async function GET() {
  try {
    const servers = getActiveServers();
    const activeTasks = getActiveTasks();
    const workflows = getWorkflows();

    return NextResponse.json({
      servers,
      activeTasks,
      workflows,
    });
  } catch (error) {
    console.error('Error fetching dashboard state:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard state' },
      { status: 500 }
    );
  }
}
