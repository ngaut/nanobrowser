import { useState, useEffect } from 'react';
import { AgentEvent, ExecutionState } from '../types/event';
import { Actors } from '@extension/storage';

interface TaskSummaryCardProps {
  events: AgentEvent[];
  isDarkMode?: boolean;
}

interface TaskProgress {
  currentStep: number;
  totalSteps: number;
  percentage: number;
  isActive: boolean;
  isComplete: boolean;
  hasErrors: boolean;
}

export default function TaskSummaryCard({ events, isDarkMode = false }: TaskSummaryCardProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  const taskStartTime = events.find(e => e.state === ExecutionState.TASK_START)?.timestamp || Date.now();

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Date.now() - taskStartTime);
    }, 1000);

    return () => clearInterval(interval);
  }, [taskStartTime]);

  const getTaskProgress = (): TaskProgress => {
    const latestEvent = events[events.length - 1];
    const hasTaskEnd = events.some(
      e =>
        e.state === ExecutionState.TASK_OK ||
        e.state === ExecutionState.TASK_FAIL ||
        e.state === ExecutionState.TASK_CANCEL,
    );
    const hasErrors = events.some(
      e =>
        e.state === ExecutionState.STEP_FAIL ||
        e.state === ExecutionState.ACT_FAIL ||
        e.state === ExecutionState.TASK_FAIL,
    );

    return {
      currentStep: latestEvent?.data.step || 0,
      totalSteps: latestEvent?.data.maxSteps || 0,
      percentage: latestEvent?.data.maxSteps
        ? Math.round(((latestEvent.data.step || 0) / latestEvent.data.maxSteps) * 100)
        : 0,
      isActive: !hasTaskEnd,
      isComplete: events.some(e => e.state === ExecutionState.TASK_OK),
      hasErrors,
    };
  };

  const getTaskDescription = (): string => {
    const progress = getTaskProgress();

    if (progress.isComplete) return '✅ Task completed successfully';
    if (progress.hasErrors) return '⚠️ Task encountered some issues';
    if (progress.isActive) return '🔄 Task in progress';
    return '⏳ Task queued';
  };

  const formatElapsedTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  };

  const getActiveAgents = (): string[] => {
    const recentEvents = events.slice(-5); // Last 5 events
    const activeAgents = new Set<string>();

    recentEvents.forEach(event => {
      if (event.state.includes('start') || event.state.includes('ok')) {
        activeAgents.add(event.actor);
      }
    });

    return Array.from(activeAgents);
  };

  const progress = getTaskProgress();

  if (events.length === 0) {
    return null; // Don't show if no events
  }

  return (
    <div
      className={`rounded-lg border mb-4 transition-all duration-200 ${
        isDarkMode ? 'border-slate-600 bg-slate-800/50' : 'border-gray-200 bg-blue-50/50'
      } backdrop-blur-sm`}>
      {/* Task Header */}
      <div
        className={`flex items-center justify-between p-4 cursor-pointer hover:${
          isDarkMode ? 'bg-slate-700/30' : 'bg-blue-100/50'
        } transition-colors`}
        onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-3 flex-1">
          {/* Task Status Icon */}
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
              progress.isComplete
                ? 'bg-green-500'
                : progress.hasErrors
                  ? 'bg-yellow-500'
                  : progress.isActive
                    ? 'bg-blue-500'
                    : 'bg-gray-500'
            }`}>
            <span className="text-white text-lg">
              {progress.isComplete ? '✓' : progress.hasErrors ? '!' : progress.isActive ? '⚡' : '⏸'}
            </span>
          </div>

          {/* Task Info */}
          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-base mb-1 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              Task Execution Summary
            </div>

            <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getTaskDescription()}</div>

            <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Step {progress.currentStep}/{progress.totalSteps} • {formatElapsedTime(elapsedTime)} elapsed
            </div>
          </div>
        </div>

        {/* Progress Bar & Expand Button */}
        <div className="flex items-center gap-4">
          {/* Overall Progress */}
          <div className="flex items-center gap-2">
            <div className={`w-24 h-3 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  progress.isComplete ? 'bg-green-500' : progress.hasErrors ? 'bg-yellow-500' : 'bg-blue-500'
                }`}
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <span className={`text-sm font-mono ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {progress.percentage}%
            </span>
          </div>

          {/* Expand/Collapse Button */}
          <button
            className={`p-1 rounded-full transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            } ${isDarkMode ? 'hover:bg-slate-600' : 'hover:bg-gray-200'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expandable Details */}
      {isExpanded && (
        <div
          className={`border-t p-4 ${
            isDarkMode ? 'border-slate-600 bg-slate-800/30' : 'border-gray-200 bg-gray-50/30'
          }`}>
          {/* Active Agents */}
          <div className="mb-4">
            <div className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              🤖 Active Agents:
            </div>
            <div className="flex gap-2 flex-wrap">
              {getActiveAgents().map(agent => (
                <span
                  key={agent}
                  className={`px-2 py-1 rounded-full text-xs ${
                    isDarkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                  }`}>
                  {agent}
                </span>
              ))}
            </div>
          </div>

          {/* Recent Activity Timeline */}
          <div>
            <div className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              📊 Recent Activity:
            </div>
            <div className="space-y-1">
              {events.slice(-3).map((event, index) => (
                <div
                  key={`${event.timestamp}-${index}`}
                  className={`text-xs flex items-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  <span className="font-medium">{event.actor}:</span>
                  <span>{event.data.details || event.state}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
