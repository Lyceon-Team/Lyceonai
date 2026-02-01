# Legacy Test Files

This directory contains legacy test files that were previously in the repository root.

## Files

These test files are deprecated and may not work with the current codebase:

- `test-*.js` - Various integration and unit tests
- `trigger-integration.js` - Integration test trigger script
- `debug-sat-format.js` - SAT format debugging script
- `test-integration.html` - HTML-based integration test

## Status

⚠️ **DEPRECATED** - These files are kept for reference only.

For current test suite, see:
- `/tests/ci/` - CI tests
- `/tests/integration/` - Integration tests
- `/tests/specs/` - E2E test specs

## Migration Plan

These files should be:
1. Reviewed for any unique test coverage
2. Migrated to the modern test framework if valuable
3. Removed once migration is complete
