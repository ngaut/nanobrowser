# Nanobrowser Architecture

## Overview

This document describes the architecture of the Nanobrowser Chrome extension after the maintainability refactoring.

## Directory Structure

```
src/
├── core/                    # Core business logic
│   ├── planning/           # Planning system
│   ├── execution/          # Execution system  
│   └── workflow/           # Workflow orchestration
├── infrastructure/         # Technical infrastructure
│   ├── browser/           # Browser integration
│   ├── storage/           # Data persistence
│   ├── messaging/         # Event & message handling
│   └── monitoring/        # Logging & debugging
├── shared/                # Shared utilities
│   ├── types/            # Common type definitions
│   ├── config/           # Configuration management
│   ├── utils/            # Utility functions
│   └── constants/        # Application constants
└── adapters/             # External integrations
    ├── llm/              # LLM provider adapters
    └── chrome-api/       # Chrome extension APIs
```

## Key Principles

1. **Separation of Concerns**: Clear boundaries between business logic and infrastructure
2. **Centralized Configuration**: All settings managed through a single config system
3. **Structured Logging**: Consistent logging with contextual information
4. **Error Handling**: Standardized error types with recovery strategies
5. **Type Safety**: Strong typing throughout the system

## Core Components

### Planning System (`core/planning/`)
- Handles task analysis and step generation
- Browser context awareness
- Plan validation and optimization

### Execution System (`core/execution/`)
- Orchestrates action execution
- Manages browser navigation
- Handles execution state

### Workflow Orchestration (`core/workflow/`)
- Coordinates planning and execution
- Manages execution context
- Handles user interactions

## Development Guidelines

1. Keep files under 300 lines where possible
2. Use structured logging instead of console.log
3. Implement proper error handling with NanobrowserError
4. Write unit tests for core logic
5. Document public APIs with JSDoc

Generated on: 2025-05-23T03:57:03.965Z
