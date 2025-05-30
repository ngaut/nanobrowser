export type { BaseStorage } from './base/types';
export * from './settings';
export * from './chat';
export * from './profile';
export * from './prompt/favorites';
export * from './settings/types';
export * from './settings/llmProviders';
export * from './settings/connectionTest';

// Re-export the favorites instance for direct use
export { default as favoritesStorage } from './prompt/favorites';
