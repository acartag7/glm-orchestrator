'use client';

import type { Workflow } from '@/lib/types';

interface Stage {
  name: string;
  status: string;
}

interface WorkflowPanelProps {
  workflows: Workflow[];
}

export default function WorkflowPanel({ workflows }: WorkflowPanelProps) {

  function getWorkflowStatusBadge(status: string): { text: string; classes: string } {
    switch (status) {
      case 'running':
        return { text: 'Running', classes: 'bg-blue-600 text-white' };
      case 'pending':
        return { text: 'Pending', classes: 'bg-yellow-600 text-white' };
      case 'completed':
        return { text: 'Completed', classes: 'bg-green-600 text-white' };
      case 'failed':
        return { text: 'Failed', classes: 'bg-red-600 text-white' };
      case 'cancelled':
        return { text: 'Cancelled', classes: 'bg-gray-600 text-white' };
      default:
        return { text: status, classes: 'bg-gray-600 text-white' };
    }
  }

  function getStageStatusColor(status: string): string {
    switch (status) {
      case 'completed':
        return 'bg-green-600 border-green-500';
      case 'running':
        return 'bg-blue-600 border-blue-500';
      case 'failed':
        return 'bg-red-600 border-red-500';
      case 'pending':
        return 'bg-gray-700 border-gray-600';
      default:
        return 'bg-gray-700 border-gray-600';
    }
  }

  function parseStages(stagesStr: string | null): Stage[] {
    if (!stagesStr) return [];
    try {
      return JSON.parse(stagesStr);
    } catch {
      return [];
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
          Workflows
        </h2>
        <span className="bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">
          {workflows.length}
        </span>
      </div>
      {workflows.length === 0 ? (
        <p className="text-gray-500 italic">No active workflows</p>
      ) : (
        <div className="space-y-4">
          {workflows.map((workflow) => {
            const badge = getWorkflowStatusBadge(workflow.status);
            const stages = parseStages(workflow.stages);

            return (
              <div key={workflow.id} className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-medium text-gray-200">
                      {workflow.name}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                      ID: {workflow.id}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.classes}`}
                  >
                    {badge.text}
                  </span>
                </div>

                {stages.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center gap-2 overflow-x-auto pb-2">
                      {stages.map((stage, index) => {
                        const isCurrentStage = stage.name === workflow.current_stage;
                        const stageColor = getStageStatusColor(stage.status);

                        return (
                          <div key={index} className="flex items-center">
                            <div
                              className={`flex-shrink-0 px-3 py-2 rounded border-2 ${stageColor} ${isCurrentStage ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-800' : ''}`}
                            >
                              <p className="text-xs font-medium text-white truncate max-w-32">
                                {stage.name}
                              </p>
                            </div>
                            {index < stages.length - 1 && (
                              <div className="flex-shrink-0 w-6 h-0.5 bg-gray-600 mx-1" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
