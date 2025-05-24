import { useState, useEffect } from 'react';
import { AgentEvent, EventType, ExecutionState } from '../types/event';
import { ACTOR_PROFILES } from '../types/message';
import { Actors } from '@extension/storage';

interface LiveStatusCardProps {
  event: AgentEvent;
  isDarkMode?: boolean;
}

interface ProgressInfo {
  current: number;
  total: number;
  percentage: number;
}

export default function LiveStatusCard({ event, isDarkMode = false }: LiveStatusCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  const actor = ACTOR_PROFILES[event.actor as keyof typeof ACTOR_PROFILES];
  const progress: ProgressInfo = {
    current: event.data.step || 0,
    total: event.data.maxSteps || 0,
    percentage: event.data.maxSteps ? Math.round(((event.data.step || 0) / event.data.maxSteps) * 100) : 0,
  };

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Date.now() - event.timestamp);
    }, 1000);

    return () => clearInterval(interval);
  }, [event.timestamp]);

  const formatElapsedTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${remainingSeconds}s`;
  };

  const getStatusIcon = (): string => {
    switch (event.state) {
      case ExecutionState.STEP_START:
      case ExecutionState.ACT_START:
        return '🔄';
      case ExecutionState.STEP_OK:
      case ExecutionState.ACT_OK:
        return '✅';
      case ExecutionState.STEP_FAIL:
      case ExecutionState.ACT_FAIL:
        return '❌';
      default:
        return '⏳';
    }
  };

  const getActivitySummary = (): string => {
    const details = event.data.details || '';

    // Extract meaningful actions from details with more specificity
    if (details.includes('Planning')) return '🧠 Analyzing page structure and planning next steps';
    if (details.includes('Navigator')) return '🎯 Executing actions on the webpage';
    if (details.includes('Validating')) return '✅ Verifying task completion and results';
    if (details.includes('buildDomTree')) return '🔍 Processing and analyzing page elements';
    if (details.includes('getClickableElements')) return '📋 Finding interactive elements on page';
    if (details.includes('click')) return '👆 Clicking on page elements';
    if (details.includes('scroll')) return '📜 Scrolling to view more content';
    if (details.includes('type')) return '⌨️ Typing text into fields';
    if (details.includes('navigate')) return '🧭 Navigating to new page';
    if (details.includes('count')) return '🔢 Counting elements or items';
    if (details.includes('extract')) return '📊 Extracting data from page';
    if (details.includes('search')) return '🔍 Searching for specific content';

    // Enhanced actor-based descriptions with context
    switch (event.actor) {
      case Actors.PLANNER:
        if (event.state.includes('start')) return '🧠 Starting to analyze the task and plan approach';
        if (event.state.includes('ok')) return '✅ Successfully created execution plan';
        return '🤔 Thinking and planning the best approach';
      case Actors.NAVIGATOR:
        if (event.state.includes('start')) return '🎯 Beginning to interact with page elements';
        if (event.state.includes('ok')) return '✅ Successfully completed page interactions';
        if (details.includes('DOM')) return '🌐 Processing webpage structure';
        return '🎮 Interacting with webpage elements';
      case Actors.VALIDATOR:
        if (event.state.includes('start')) return '🔍 Starting to validate task completion';
        if (event.state.includes('ok')) return '✅ Task validation successful';
        return '🧐 Checking if task objectives are met';
      default:
        return details || 'Working on your request...';
    }
  };

  const getLiveResults = (): string[] => {
    // Extract any results from the event data
    const results: string[] = [];

    if (event.data.detailsObject) {
      const obj = event.data.detailsObject;

      // Look for common result patterns
      if (typeof obj === 'object' && obj !== null) {
        Object.entries(obj).forEach(([key, value]) => {
          if (key.includes('count') || key.includes('found') || key.includes('total')) {
            results.push(`${key}: ${value}`);
          }
        });
      }
    }

    return results;
  };

  return (
    <div
      className={`rounded-lg border transition-all duration-200 ${
        isDarkMode ? 'border-slate-600 bg-slate-800/50' : 'border-gray-200 bg-white/50'
      } backdrop-blur-sm`}>
      {/* Main Status Header */}
      <div
        className={`flex items-center justify-between p-3 cursor-pointer hover:${
          isDarkMode ? 'bg-slate-700/30' : 'bg-gray-50/50'
        } transition-colors`}
        onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-3 flex-1">
          {/* Actor Avatar */}
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: actor.iconBackground }}>
            <img src={actor.icon} alt={actor.name} className="size-5" />
          </div>

          {/* Status Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{getStatusIcon()}</span>
              <span className={`font-medium text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                {actor.name}
              </span>
              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Step {progress.current}/{progress.total} • {formatElapsedTime(elapsedTime)}
              </span>
            </div>

            <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getActivitySummary()}</div>
          </div>
        </div>

        {/* Progress & Expand Button */}
        <div className="flex items-center gap-3">
          {/* Progress Bar */}
          <div className="flex items-center gap-2">
            <div className={`w-20 h-2 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <span className={`text-xs font-mono ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
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

      {/* Live Results (if any) */}
      {getLiveResults().length > 0 && (
        <div
          className={`px-3 pb-2 border-t ${
            isDarkMode ? 'border-slate-600 bg-slate-700/20' : 'border-gray-100 bg-green-50/50'
          }`}>
          <div className={`text-sm font-medium mb-1 ${isDarkMode ? 'text-green-300' : 'text-green-700'}`}>
            📊 Live Results:
          </div>
          {getLiveResults().map((result, index) => (
            <div key={index} className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              • {result}
            </div>
          ))}
        </div>
      )}

      {/* Expandable Details */}
      {isExpanded && (
        <div
          className={`border-t p-3 ${
            isDarkMode ? 'border-slate-600 bg-slate-800/30' : 'border-gray-200 bg-gray-50/30'
          }`}>
          <div className={`text-sm mb-2 font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
            🔍 Technical Details:
          </div>

          <div className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            <div>
              <strong>Task ID:</strong> {event.data.taskId}
            </div>
            <div>
              <strong>State:</strong> {event.state}
            </div>
            <div>
              <strong>Details:</strong> {event.data.details || 'No details available'}
            </div>

            {event.data.detailsObject && (
              <div className="mt-2">
                <strong>Data:</strong>
                <pre
                  className={`mt-1 p-2 rounded text-xs overflow-x-auto ${
                    isDarkMode ? 'bg-slate-900 text-gray-300' : 'bg-gray-100 text-gray-700'
                  }`}>
                  {JSON.stringify(event.data.detailsObject, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
