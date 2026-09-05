# AGENTS.md - Coding Agent Instructions

This document provides context for AI coding agents working on this VS Code extension.

## Project Overview

**File Change Follower** is a VS Code extension that enables real-time following of file changes in the workspace. It automatically opens editors and scrolls to edited locations, designed for users watching CLI-based coding agents work.

## Project Structure

```
vsc-change-agent-watch/
├── src/
│   ├── extension.ts       # Extension entry point, command registration
│   ├── changeFollower.ts  # Core file watching and change handling logic
│   ├── statusBar.ts       # Status bar UI management
│   ├── configuration.ts   # Configuration/settings management
│   ├── debounce.ts        # Debounce utility
│   └── test/
│       ├── runTest.ts     # Test runner entry point
│       └── suite/
│           ├── index.ts           # Test suite loader
│           ├── extension.test.ts  # Extension integration tests
│           └── debounce.test.ts   # Debounce unit tests
├── .vscode/               # VS Code workspace configuration
├── .github/workflows/     # CI/CD workflows
├── package.json           # Extension manifest and npm config
├── tsconfig.json          # TypeScript configuration
└── .eslintrc.json         # ESLint configuration
```

## Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Extension lifecycle (activate/deactivate), command registration |
| `src/changeFollower.ts` | Core logic: file watching, change detection, editor navigation |
| `src/statusBar.ts` | Status bar item creation and updates |
| `src/configuration.ts` | Wraps VS Code configuration API |
| `src/debounce.ts` | Simple debounce utility for rate limiting |

## Build & Development Commands

Use Node.js 22 or newer for development and testing; `@vscode/test-electron` requires it.

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (continuous compilation)
npm run watch

# Run linter
npm run lint

# Fix lint issues
npm run lint:fix

# Run tests (requires VS Code)
npm test

# Package extension as .vsix
npm run package
```

## Testing

- Tests use VS Code's extension testing framework with Mocha
- Run `npm test` to execute tests (launches VS Code instance)
- Unit tests are in `src/test/suite/*.test.ts`
- Add new test files with `.test.ts` suffix in the `suite` directory

## Coding Conventions

1. **TypeScript**: Strict mode enabled, use explicit types
2. **Naming**: 
   - Classes: PascalCase
   - Functions/methods: camelCase
   - Constants: UPPER_SNAKE_CASE for true constants
3. **Imports**: Use named imports, group by external then internal
4. **Error handling**: Use try/catch for async operations, log errors to console
5. **Disposables**: Implement `vscode.Disposable` for classes that manage resources

## VS Code Extension API Patterns

- Use `vscode.workspace.onDidChangeTextDocument` for edit detection
- Use `vscode.workspace.createFileSystemWatcher` for file system events
- Use `vscode.window.showTextDocument` with `preserveFocus: true` to not steal focus
- Use `vscode.window.createTextEditorDecorationType` for highlighting
- Always dispose watchers/listeners in `deactivate()` or when disabled

## Adding New Features

1. **New command**: Add to `contributes.commands` in `package.json`, register in `extension.ts`
2. **New setting**: Add to `contributes.configuration` in `package.json`, access via `ConfigurationManager`
3. **New behavior**: Modify `ChangeFollower` class, add tests

## CI/CD

- **ci.yml**: Runs on PRs and pushes, lints, builds, tests on multiple platforms
- **release.yml**: Triggered by version tags, publishes to VS Code Marketplace
- **dev-release.yml**: Updates standing "dev" release with latest build from main

## Common Issues

1. **Tests fail locally**: Ensure no other VS Code instances are running
2. **Extension not loading**: Check `activationEvents` in `package.json`
3. **File watcher not triggering**: Ensure file matches include patterns and doesn't match exclude patterns

## Dependencies

- **minimatch**: Glob pattern matching for include/exclude patterns
- **@vscode/vsce**: Extension packaging and publishing
- **@vscode/test-electron**: Extension testing framework
