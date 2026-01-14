'use client';

import { useState, useEffect, useRef } from 'react';
import type { Server, Task, Workflow } from '@/lib/types';

interface DashboardData {
  servers: Server[];
  activeTasks: Task[];
  workflows: Workflow[];
}

interface UseDashboardReturn {
  data: DashboardData | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
}

export function useDashboard(): UseDashboardReturn {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const fetchState = async () => {
      try {
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        const response = await fetch('/api/state', {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const json = await response.json();
        setData(json);
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchState();

    const intervalId = setInterval(fetchState, 2000);

    return () => {
      clearInterval(intervalId);
      abortControllerRef.current?.abort();
    };
  }, []);

  return { data, isLoading, error, lastUpdated };
}
