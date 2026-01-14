import { NextRequest, NextResponse } from 'next/server';
import { cancelTask } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: 'taskId is required' },
        { status: 400 }
      );
    }

    const success = cancelTask(taskId);

    if (success) {
      return NextResponse.json({ success: true, message: 'Task cancelled successfully' });
    } else {
      return NextResponse.json(
        { success: false, error: 'Task not found or cannot be cancelled' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error cancelling task:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel task' },
      { status: 500 }
    );
  }
}
