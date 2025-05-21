import { useState } from 'react';
import { AgentEvent, EventStatus } from '../types/event';
import { ACTOR_PROFILES } from '../types/message';

interface EventDetailsProps {
  event: AgentEvent;
  isDarkMode?: boolean;
}

const statusColors: Record<EventStatus, { bg: string; text: string }> = {
  success: { bg: 'bg-green-100', text: 'text-green-800' },
  error: { bg: 'bg-red-100', text: 'text-red-800' },
  warning: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  info: { bg: 'bg-blue-100', text: 'text-blue-800' },
};

const darkStatusColors: Record<EventStatus, { bg: string; text: string }> = {
  success: { bg: 'bg-green-900/30', text: 'text-green-300' },
  error: { bg: 'bg-red-900/30', text: 'text-red-300' },
  warning: { bg: 'bg-yellow-900/30', text: 'text-yellow-300' },
  info: { bg: 'bg-blue-900/30', text: 'text-blue-300' },
};

export default function EventDetails({ event, isDarkMode = false }: EventDetailsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const actor = ACTOR_PROFILES[event.actor as keyof typeof ACTOR_PROFILES];
  const status = event.getEventStatus();
  const colors = isDarkMode ? darkStatusColors[status] : statusColors[status];
  const duration = event.getFormattedDuration();

  return (
    <div className={`rounded-lg border ${isDarkMode ? 'border-slate-700' : 'border-gray-200'} p-2`}>
      {/* Event Header */}
      <div className="flex cursor-pointer items-center justify-between" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center gap-2">
          <div
            className="flex size-6 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: actor.iconBackground }}>
            <img src={actor.icon} alt={actor.name} className="size-4" />
          </div>
          <div className="flex flex-col">
            <div className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              {actor.name} - {event.state}
            </div>
            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {new Date(event.timestamp).toLocaleTimeString()}
              {duration && ` • ${duration}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${colors.bg} ${colors.text}`}>{status}</span>
          <button
            className={`rounded p-1 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}>
            <svg
              className={`size-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Event Details (Collapsible) */}
      {isExpanded && (
        <div className={`mt-2 space-y-2 border-t ${isDarkMode ? 'border-slate-700' : 'border-gray-200'} pt-2`}>
          {/* Basic Details */}
          <div>
            <div className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Details</div>
            <div className={`mt-1 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{event.data.details}</div>
          </div>

          {/* Metadata */}
          {event.data.metadata && (
            <div>
              <div className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Metadata</div>
              <div className={`mt-1 space-y-1 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {event.data.metadata.source && <div>Source: {event.data.metadata.source}</div>}
                {event.data.metadata.target && <div>Target: {event.data.metadata.target}</div>}
                {event.data.metadata.parameters && Object.keys(event.data.metadata.parameters).length > 0 && (
                  <div>
                    Parameters:
                    <pre className={`mt-1 rounded p-1 ${isDarkMode ? 'bg-slate-800' : 'bg-gray-100'}`}>
                      {JSON.stringify(event.data.metadata.parameters, null, 2)}
                    </pre>
                  </div>
                )}
                {event.data.metadata.errorDetails && (
                  <div>
                    Error:
                    <pre
                      className={`mt-1 rounded p-1 ${isDarkMode ? 'bg-red-900/30 text-red-300' : 'bg-red-100 text-red-800'}`}>
                      {event.data.metadata.errorDetails.message}
                      {event.data.metadata.errorDetails.stack && (
                        <div className="mt-1 text-xs opacity-75">{event.data.metadata.errorDetails.stack}</div>
                      )}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          {event.data.tags && event.data.tags.length > 0 && (
            <div>
              <div className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Tags</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {event.data.tags.map(tag => (
                  <span
                    key={tag}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      isDarkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-700'
                    }`}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Related Events */}
          {event.data.relatedEvents && event.data.relatedEvents.length > 0 && (
            <div>
              <div className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Related Events
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {event.data.relatedEvents.map(eventId => (
                  <span
                    key={eventId}
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      isDarkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-700'
                    }`}>
                    {eventId}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
