import React from 'react';

interface LinkifyProps {
  text: string;
  className?: string;
}

const urlRegex = /(\b(https?:\/\/|www\.)[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gi;

const Linkify: React.FC<LinkifyProps> = ({ text, className }) => {
  if (!text) {
    return null;
  }

  const parts = text.split(urlRegex);

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (part && part.match(urlRegex)) {
          let href = part;
          if (!href.startsWith('http')) {
            href = `http://${href}`;
          }
          return (
            <a
              key={index}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline">
              {part}
            </a>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </span>
  );
};

export default Linkify;
