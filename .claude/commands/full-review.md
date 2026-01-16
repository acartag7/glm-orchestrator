# Full Codebase Review: GLM Orchestrator

You are performing a comprehensive review of the GLM Orchestrator - a spec-driven development platform. Review EVERYTHING, not just code quality.

## Project Context
- Next.js 16 + React 19 + Tailwind CSS 4
- SQLite database (better-sqlite3)
- Integrates with Claude CLI (Opus/Sonnet) and OpenCode (GLM)
- SSE for real-time updates
- Terminal-inspired dark UI theme

## Review Categories

### 1. BUGS & ERRORS
- Logic errors, off-by-one, wrong conditions
- Null/undefined handling
- Type mismatches
- API request/response mismatches
- State synchronization issues
- Error handling gaps

### 2. SECURITY
- SQL injection, XSS, command injection
- Path traversal
- Secrets in code
- Input validation
- Unsafe operations

### 3. MEMORY & PERFORMANCE
- Memory leaks (intervals, listeners, streams)
- Race conditions
- N+1 queries
- Unnecessary re-renders
- Missing cleanup in useEffect
- Large bundle concerns

### 4. UX/UI ISSUES
- Confusing user flows
- Missing loading states
- Missing error feedback to user
- Inconsistent behavior
- Accessibility (a11y) issues
- Responsive design gaps
- Missing confirmations for destructive actions
- Keyboard navigation
- Dead-end states (user gets stuck)

### 5. INCOMPLETE IMPLEMENTATIONS
- TODOs and FIXMEs
- Placeholder code
- Commented-out code
- Features that are half-done
- Hardcoded values that should be configurable
- Missing edge case handling

### 6. ARCHITECTURE & DESIGN
- Separation of concerns violations
- Tight coupling
- Inconsistent patterns
- Code duplication
- Poor naming
- Missing abstractions
- Over-engineering
- Files that are too large (flag anything over 400 lines)

### 7. DATA & DATABASE
- Schema issues
- Missing indexes
- Data integrity risks
- Migration gaps
- Orphaned data possibilities

### 8. API DESIGN
- Inconsistent endpoints
- Missing validation
- Poor error responses
- Missing pagination
- Unclear contracts

### 9. TYPE SAFETY
- Any types
- Type assertions (as)
- Missing types
- Incorrect generics
- Runtime vs compile-time mismatches

### 10. TESTING & RELIABILITY
- Untested critical paths
- Missing error boundaries
- No retry logic where needed
- Silent failures
- Missing logging

### 11. DEVELOPER EXPERIENCE
- Missing documentation
- Unclear code
- Magic numbers/strings
- Complex functions that need splitting
- Missing JSDoc on exports

### 12. INTEGRATION ISSUES
- Claude CLI integration edge cases
- OpenCode API edge cases
- Git operations error handling
- SSE connection reliability
- Process spawning issues

### 13. STATE MANAGEMENT
- React state inconsistencies
- Stale closures in callbacks
- Missing dependency arrays
- Props drilling
- Global state issues

### 14. CONFIGURATION & ENVIRONMENT
- Hardcoded paths
- Missing env var handling
- Platform-specific issues (macOS vs Linux)
- Port conflicts
- Path handling (Windows compatibility?)

## Output Format

```json
{
  "issues": [
    {
      "id": 1,
      "file": "path/to/file.ts",
      "lines": [10, 25],
      "category": "ux" | "bug" | "security" | "performance" | "incomplete" | "architecture" | "database" | "api" | "types" | "testing" | "dx" | "integration" | "state" | "config",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "Brief title",
      "description": "What's wrong and why it matters",
      "suggestion": "How to fix it",
      "effort": "quick" | "medium" | "large",
      "blocks_dogfooding": true | false
    }
  ],
  "summary_by_category": {
    "ux": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
    "bug": { ... },
    ...
  },
  "summary_by_severity": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0
  },
  "quick_wins": [1, 5, 8],
  "blocks_dogfooding": [2, 3],
  "recommended_fix_order": [2, 3, 1, 5, ...]
}
```

## Files to Review

### Core Application
- packages/dashboard/src/app/**/*.tsx (pages)
- packages/dashboard/src/components/**/*.tsx (all components)
- packages/dashboard/src/hooks/*.ts (custom hooks)
- packages/dashboard/src/lib/*.ts (utilities, db, execution)

### API Layer
- packages/dashboard/src/app/api/**/*.ts (all API routes)

### Shared Types
- packages/shared/src/types.ts
- packages/shared/src/schema.ts

### AI Clients
- packages/mcp/src/client/claude.ts
- packages/mcp/src/client/opencode.ts

## What Matters Most

We want to dogfood this tool ASAP - use it to build itself. Focus on:
1. Issues that would break the core flow (create spec → chunks → execute → review)
2. Issues that would cause data loss or corruption
3. Issues that make the UX confusing or frustrating
4. Issues that would cause the tool to hang or crash
5. Files that are too large and should be split

Be practical. We don't need perfection - we need a working tool we can iterate on.

## Begin

Read through the codebase systematically. Start with the core flow files, then branch out. Report everything you find.
