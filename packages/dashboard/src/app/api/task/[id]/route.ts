import { NextRequest, NextResponse } from 'next/server';
import { getTaskDetails } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: 'taskId is required' },
        { status: 400 }
      );
    }

    const { task, toolCalls } = getTaskDetails(taskId);

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        task,
        toolCalls,
      },
    });
  } catch (error) {
    console.error('Error fetching task details:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch task details' },
      { status: 500 }
    );
  }
}
