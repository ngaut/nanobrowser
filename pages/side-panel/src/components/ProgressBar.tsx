import { memo, useState } from 'react';
import { IoChevronDown, IoChevronUp } from 'react-icons/io5';

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  currentPage?: {
    title: string;
    url: string;
    screenshot?: string | null; // Base64 encoded screenshot
  };
  nextStep?: string;
  isDarkMode?: boolean;
  className?: string;
  // Enhanced props for more detailed information
  planInfo?: {
    hasPlan: boolean;
    nextStep: string;
    upcomingSteps: string[];
    totalStepsInPlan: number;
  };
  temporalContext?: {
    stepNumber: number;
    maxSteps: number;
    progressPercentage: number;
    executionStartTime: string;
    planningInterval: number;
    isPlannningStep: boolean;
  };
  actionAnalysis?: string;
  browserState?: {
    interactiveElementsCount: number;
    scrollPosition: {
      pixelsAbove: number;
      pixelsBelow: number;
    };
    openTabs: Array<{
      id: number;
      title: string;
      url: string;
      isActive: boolean;
    }>;
  };
}

export default memo(function ProgressBar({
  currentStep,
  totalSteps,
  currentPage,
  nextStep,
  isDarkMode = false,
  className = '',
  planInfo,
  temporalContext,
  actionAnalysis,
  browserState,
}: ProgressBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const progressPercentage = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;

  // Truncate long titles and URLs for display
  const truncateText = (text: string, maxLength: number) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const pageTitle = currentPage?.title ? truncateText(currentPage.title, 25) : 'Unknown Page';
  const pageUrl = currentPage?.url ? truncateText(currentPage.url, 30) : '';
  const nextStepText = nextStep ? truncateText(nextStep, 40) : 'Planning next action...';

  // Calculate execution time
  const getExecutionTime = () => {
    if (temporalContext?.executionStartTime) {
      const startTime = new Date(temporalContext.executionStartTime).getTime();
      const currentTime = Date.now();
      const diffMs = currentTime - startTime;
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);
      return `${diffMins}:${diffSecs.toString().padStart(2, '0')}`;
    }
    return '0:00';
  };

  // Format action analysis for better display
  const formatActionAnalysis = (analysis: string): string[] => {
    if (!analysis) return [];
    // Split by lines and format each line
    return analysis
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  };

  const analysisLines = actionAnalysis ? formatActionAnalysis(actionAnalysis) : [];

  return (
    <div
      className={`rounded-lg border transition-all duration-200 ${
        isExpanded ? 'p-4' : 'p-3'
      } ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-white/50'} ${className}`}>
      {/* Clickable Header */}
      <div className="cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        {/* Progress Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              Step {currentStep} of {totalSteps}
            </div>
            <div
              className={`text-xs px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-100 text-blue-800'}`}>
              {progressPercentage}%
            </div>
            {temporalContext?.isPlannningStep && (
              <div
                className={`text-xs px-2 py-0.5 rounded-full ${isDarkMode ? 'bg-purple-900/30 text-purple-300' : 'bg-purple-100 text-purple-800'}`}>
                Planning
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{getExecutionTime()}</div>
            {isExpanded ? (
              <IoChevronUp className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            ) : (
              <IoChevronDown className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className={`h-2 rounded-full overflow-hidden mb-3 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* Current Working Snapshot - Always Visible */}
        <div className="space-y-2">
          {/* Current Page with Screenshot */}
          <div className="flex items-center gap-3">
            {/* Screenshot Thumbnail */}
            {currentPage?.screenshot && (
              <div className="flex-shrink-0">
                <img
                  src={`data:image/jpeg;base64,${currentPage.screenshot}`}
                  alt="Page screenshot"
                  className={`w-12 h-8 object-cover rounded border ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`}
                  onError={e => {
                    // Hide image if it fails to load
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}

            {/* Status Indicator */}
            <div className="flex-shrink-0">
              <div className={`w-2 h-2 rounded-full ${isDarkMode ? 'bg-green-400' : 'bg-green-500'}`} />
            </div>

            {/* Page Info */}
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{pageTitle}</div>
              {pageUrl && <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{pageUrl}</div>}
            </div>
          </div>

          {/* Next Action */}
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0">
              <div className={`w-2 h-2 rounded-full ${isDarkMode ? 'bg-orange-400' : 'bg-orange-500'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Next: {isExpanded ? nextStep || nextStepText : nextStepText}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="mt-4 space-y-4 border-t pt-4" style={{ borderColor: isDarkMode ? '#374151' : '#e5e7eb' }}>
          {/* Action Analysis */}
          {analysisLines.length > 0 && (
            <div>
              <h4 className={`text-xs font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                🔍 Current Analysis
              </h4>
              <div className="space-y-1">
                {analysisLines.map((line: string, index: number) => (
                  <div key={index} className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plan Information */}
          {planInfo && planInfo.hasPlan && (
            <div>
              <h4 className={`text-xs font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                📋 Execution Plan ({planInfo.totalStepsInPlan} steps)
              </h4>
              <div className="space-y-1">
                <div className={`text-xs ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                  ▶ {planInfo.nextStep}
                </div>
                {planInfo.upcomingSteps.map((step: string, index: number) => (
                  <div key={index} className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                    {index + 2}. {step}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Browser State */}
          {browserState && (
            <div>
              <h4 className={`text-xs font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                🌐 Page State
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Interactive elements: {browserState.interactiveElementsCount}
                </div>
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Scroll: {browserState.scrollPosition.pixelsAbove}px ↑ / {browserState.scrollPosition.pixelsBelow}px ↓
                </div>
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Open tabs: {browserState.openTabs.length}
                </div>
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Active tab: {browserState.openTabs.find(tab => tab.isActive)?.title || 'Unknown'}
                </div>
              </div>
            </div>
          )}

          {/* Execution Stats */}
          {temporalContext && (
            <div>
              <h4 className={`text-xs font-semibold mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                ⏱️ Execution Stats
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Progress: {temporalContext.stepNumber}/{temporalContext.maxSteps}
                </div>
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Runtime: {getExecutionTime()}</div>
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Planning interval: {temporalContext.planningInterval} steps
                </div>
                <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Completion: {temporalContext.progressPercentage}%
                </div>
              </div>
            </div>
          )}

          {/* Click hint */}
          <div className={`text-xs text-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Click to collapse
          </div>
        </div>
      )}
    </div>
  );
});
