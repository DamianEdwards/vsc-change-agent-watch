# Changelog

All notable changes to the "File Change Follower" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-30

### Added

- Initial release
- Real-time file change following with automatic editor opening
- Status bar integration with click-to-toggle functionality
- Command palette commands: Toggle, Enable, Disable follow mode
- Configurable include/exclude glob patterns
- Debounced event handling (default 150ms)
- Change highlighting with configurable duration
- Default exclusions for node_modules, .git, out, dist directories
