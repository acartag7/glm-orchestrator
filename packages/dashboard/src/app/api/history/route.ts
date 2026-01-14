import { NextRequest, NextResponse } from 'next/server';
import { getTaskHistory } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;
    const server = searchParams.get('server') || undefined;

    const tasks = getTaskHistory({
      limit,
      offset,
      search,
      status,
      server_id: server,
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('Error fetching task history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch task history' },
      { status: 500 }
    );
  }
}
