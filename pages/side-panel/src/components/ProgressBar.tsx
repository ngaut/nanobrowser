import { memo } from 'react';

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
}

export default memo(function ProgressBar({
  currentStep,
  totalSteps,
  currentPage,
  nextStep,
  isDarkMode = false,
  className = '',
}: ProgressBarProps) {
  const progressPercentage = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;

  // Truncate long titles and URLs for display
  const truncateText = (text: string, maxLength: number) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const pageTitle = currentPage?.title ? truncateText(currentPage.title, 25) : 'Unknown Page';
  const pageUrl = currentPage?.url ? truncateText(currentPage.url, 30) : '';
  const nextStepText = nextStep ? truncateText(nextStep, 40) : 'Planning next action...';

  return (
    <div
      className={`rounded-lg border p-3 ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-white/50'} ${className}`}>
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
        </div>
        <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Progress Bar */}
      <div className={`h-2 rounded-full overflow-hidden mb-3 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Current Working Snapshot */}
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
            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Next: {nextStepText}</div>
          </div>
        </div>
      </div>
    </div>
  );
});
