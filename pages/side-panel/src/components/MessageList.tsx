import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo } from 'react';
import EventDetails from './EventDetails';
import LiveStatusCard from './LiveStatusCard';
import { AgentEvent } from '../types/event';
import { EventType } from '../types/event';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
}

export default memo(function MessageList({ messages, isDarkMode = false }: MessageListProps) {
  return (
    <div className="max-w-full space-y-4">
      {messages.map((message, index) => {
        // Debug: log message structure and detailsObject presence
        // eslint-disable-next-line no-console
        console.log('Message:', message, 'Has detailsObject:', message.data?.detailsObject);

        // Check if this is a progress message
        const isProgressMessage = message.content === 'Showing progress...';

        // Determine if this message should be treated as an AgentEvent display
        const isAgentEventDisplay =
          message.data &&
          message.state &&
          message.actor &&
          (message.type === EventType.EXECUTION || message.type === EventType.PLAN_PROPOSED_TO_USER);

        let eventToDisplay: AgentEvent | null = null;
        if (isAgentEventDisplay && message.data && message.state && message.actor && message.type) {
          if (message instanceof AgentEvent) {
            eventToDisplay = message;
          } else {
            // Reconstruct AgentEvent if it's a plain object (e.g., from storage or port message)
            // Ensure data.output is populated from data.detailsObject if necessary (already done in SidePanel.tsx for port messages)
            eventToDisplay = new AgentEvent(
              message.actor, // Actor is confirmed by isAgentEventDisplay
              message.state, // State is confirmed
              message.data, // data is EnhancedEventData (or has .output mapped)
              message.timestamp,
              message.type as EventType, // Cast string to EventType
            );
          }
        }

        return (
          <div
            key={`${message.actor}-${message.timestamp}-${index}`}
            className={`${
              !eventToDisplay && !isProgressMessage && index > 0 && messages[index - 1].actor === message.actor
                ? `mt-4 border-t ${isDarkMode ? 'border-sky-800/50' : 'border-sky-200/50'} pt-4 first:mt-0 first:border-t-0 first:pt-0`
                : ''
            }`}>
            {isProgressMessage && eventToDisplay ? (
              // Show live status card for progress messages
              <LiveStatusCard event={eventToDisplay} isDarkMode={isDarkMode} />
            ) : eventToDisplay ? (
              // Show event details for completed events
              <EventDetails event={eventToDisplay} isDarkMode={isDarkMode} />
            ) : (
              // Show regular message block
              <MessageBlock
                message={message}
                isSameActor={index > 0 ? messages[index - 1].actor === message.actor : false}
                isDarkMode={isDarkMode}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});

interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
}

function MessageBlock({ message, isSameActor, isDarkMode = false }: MessageBlockProps) {
  if (!message.actor) {
    console.error('[MessageList] No actor found for message:', { message, isSameActor });
    return <div />;
  }

  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameActor
          ? `mt-4 border-t ${isDarkMode ? 'border-sky-800/50' : 'border-sky-200/50'} pt-4 first:mt-0 first:border-t-0 first:pt-0`
          : ''
      }`}>
      {!isSameActor && (
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: actor.iconBackground }}>
          <img src={actor.icon} alt={actor.name} className="size-6" />
        </div>
      )}
      {isSameActor && <div className="w-8" />}

      <div className="min-w-0 flex-1">
        {!isSameActor && (
          <div className={`mb-1 text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
            {actor.name}
          </div>
        )}

        <div className="space-y-0.5">
          <div className={`whitespace-pre-wrap break-words text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {message.content}
          </div>
          <div className={`text-right text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-300'}`}>
            {formatTimestamp(message.timestamp)}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats a timestamp (in milliseconds) to a readable time string
 * @param timestamp Unix timestamp in milliseconds
 * @returns Formatted time string
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  // Check if the message is from today
  const isToday = date.toDateString() === now.toDateString();

  // Check if the message is from yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  // Check if the message is from this year
  const isThisYear = date.getFullYear() === now.getFullYear();

  // Format the time (HH:MM)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr; // Just show the time for today's messages
  }

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  if (isThisYear) {
    // Show month and day for this year
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  // Show full date for older messages
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}
