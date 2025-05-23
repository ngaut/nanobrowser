#!/usr/bin/env node

/**
 * Development tools script for nanobrowser
 * Provides utilities for debugging and project management
 */

const fs = require('fs');
const path = require('path');

class DevToolsScript {
  constructor() {
    this.rootDir = path.dirname(__dirname);
  }

  /**
   * Analyze project structure
   */
  analyzeProject() {
    console.log('🔍 Analyzing project structure...\n');
    
    const srcDir = path.join(this.rootDir, 'src');
    const stats = this.analyzeDirectory(srcDir, 'src');
    
    console.log('📊 Project Analysis:');
    console.log(`  Total files: ${stats.files}`);
    console.log(`  Total lines: ${stats.lines}`);
    console.log(`  TypeScript files: ${stats.tsFiles}`);
    console.log(`  Average file size: ${Math.round(stats.lines / stats.files)} lines`);
    console.log(`  Largest file: ${stats.largestFile.name} (${stats.largestFile.lines} lines)`);
    
    // Identify large files that might need refactoring
    const largeFiles = stats.fileDetails
      .filter(file => file.lines > 200)
      .sort((a, b) => b.lines - a.lines);
    
    if (largeFiles.length > 0) {
      console.log('\n⚠️  Large files (>200 lines) that might need refactoring:');
      largeFiles.forEach(file => {
        console.log(`  ${file.path}: ${file.lines} lines`);
      });
    }
  }

  /**
   * Analyze a directory recursively
   */
  analyzeDirectory(dirPath, relativePath = '') {
    const stats = {
      files: 0,
      lines: 0,
      tsFiles: 0,
      largestFile: { name: '', lines: 0 },
      fileDetails: []
    };

    if (!fs.existsSync(dirPath)) {
      return stats;
    }

    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const relativeItemPath = path.join(relativePath, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
        const subStats = this.analyzeDirectory(itemPath, relativeItemPath);
        stats.files += subStats.files;
        stats.lines += subStats.lines;
        stats.tsFiles += subStats.tsFiles;
        stats.fileDetails.push(...subStats.fileDetails);
        
        if (subStats.largestFile.lines > stats.largestFile.lines) {
          stats.largestFile = subStats.largestFile;
        }
      } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.tsx') || item.endsWith('.js') || item.endsWith('.jsx'))) {
        const content = fs.readFileSync(itemPath, 'utf-8');
        const lines = content.split('\n').length;
        
        stats.files++;
        stats.lines += lines;
        
        if (item.endsWith('.ts') || item.endsWith('.tsx')) {
          stats.tsFiles++;
        }
        
        if (lines > stats.largestFile.lines) {
          stats.largestFile = { name: relativeItemPath, lines };
        }
        
        stats.fileDetails.push({
          path: relativeItemPath,
          lines,
          size: stat.size
        });
      }
    }

    return stats;
  }

  /**
   * Check for common maintainability issues
   */
  checkMaintainability() {
    console.log('🔧 Checking maintainability issues...\n');
    
    const issues = [];
    
    // Check for large files
    const srcDir = path.join(this.rootDir, 'src');
    const stats = this.analyzeDirectory(srcDir, 'src');
    
    const largeFiles = stats.fileDetails.filter(file => file.lines > 300);
    if (largeFiles.length > 0) {
      issues.push(`${largeFiles.length} files are larger than 300 lines`);
    }
    
    // Check for TODO comments
    const todoCount = this.countTodos(srcDir);
    if (todoCount > 10) {
      issues.push(`${todoCount} TODO comments found`);
    }
    
    // Check for console.log statements
    const consoleLogCount = this.countConsoleLogs(srcDir);
    if (consoleLogCount > 5) {
      issues.push(`${consoleLogCount} console.log statements found (consider using structured logging)`);
    }
    
    if (issues.length === 0) {
      console.log('✅ No major maintainability issues found!');
    } else {
      console.log('⚠️  Maintainability issues found:');
      issues.forEach(issue => console.log(`  - ${issue}`));
    }
  }

  /**
   * Count TODO comments
   */
  countTodos(dirPath) {
    let count = 0;
    
    const processFile = (filePath) => {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const todoMatches = content.match(/\/\/\s*TODO|\/\*\s*TODO|\*\s*TODO/gi);
        if (todoMatches) {
          count += todoMatches.length;
        }
      }
    };

    const processDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          processDir(itemPath);
        } else if (stat.isFile()) {
          processFile(itemPath);
        }
      }
    };

    processDir(dirPath);
    return count;
  }

  /**
   * Count console.log statements
   */
  countConsoleLogs(dirPath) {
    let count = 0;
    
    const processFile = (filePath) => {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const consoleMatches = content.match(/console\.log\s*\(/g);
        if (consoleMatches) {
          count += consoleMatches.length;
        }
      }
    };

    const processDir = (dir) => {
      if (!fs.existsSync(dir)) return;
      
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
          processDir(itemPath);
        } else if (stat.isFile()) {
          processFile(itemPath);
        }
      }
    };

    processDir(dirPath);
    return count;
  }

  /**
   * Generate architecture documentation
   */
  generateDocs() {
    console.log('📚 Generating architecture documentation...\n');
    
    const docsDir = path.join(this.rootDir, 'docs');
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir);
    }
    
    const archDoc = this.generateArchitectureDoc();
    fs.writeFileSync(path.join(docsDir, 'architecture.md'), archDoc);
    
    console.log('✅ Architecture documentation generated at docs/architecture.md');
  }

  /**
   * Generate architecture documentation content
   */
  generateArchitectureDoc() {
    return `# Nanobrowser Architecture

## Overview

This document describes the architecture of the Nanobrowser Chrome extension after the maintainability refactoring.

## Directory Structure

\`\`\`
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
\`\`\`

## Key Principles

1. **Separation of Concerns**: Clear boundaries between business logic and infrastructure
2. **Centralized Configuration**: All settings managed through a single config system
3. **Structured Logging**: Consistent logging with contextual information
4. **Error Handling**: Standardized error types with recovery strategies
5. **Type Safety**: Strong typing throughout the system

## Core Components

### Planning System (\`core/planning/\`)
- Handles task analysis and step generation
- Browser context awareness
- Plan validation and optimization

### Execution System (\`core/execution/\`)
- Orchestrates action execution
- Manages browser navigation
- Handles execution state

### Workflow Orchestration (\`core/workflow/\`)
- Coordinates planning and execution
- Manages execution context
- Handles user interactions

## Development Guidelines

1. Keep files under 300 lines where possible
2. Use structured logging instead of console.log
3. Implement proper error handling with NanobrowserError
4. Write unit tests for core logic
5. Document public APIs with JSDoc

Generated on: ${new Date().toISOString()}
`;
  }

  /**
   * Main command dispatcher
   */
  run() {
    const command = process.argv[2] || 'help';
    
    switch (command) {
      case 'analyze':
        this.analyzeProject();
        break;
      case 'check':
        this.checkMaintainability();
        break;
      case 'docs':
        this.generateDocs();
        break;
      case 'all':
        this.analyzeProject();
        console.log('\n' + '='.repeat(50) + '\n');
        this.checkMaintainability();
        console.log('\n' + '='.repeat(50) + '\n');
        this.generateDocs();
        break;
      default:
        console.log(`
🛠️  Nanobrowser Development Tools

Usage: node scripts/dev-tools.cjs <command>

Commands:
  analyze    Analyze project structure and identify large files
  check      Check for maintainability issues
  docs       Generate architecture documentation
  all        Run all tools
  help       Show this help message

Examples:
  pnpm dev:tools analyze
  pnpm dev:tools check
  pnpm dev:tools all
        `);
    }
  }
}

// Run the script
const devTools = new DevToolsScript();
devTools.run(); 