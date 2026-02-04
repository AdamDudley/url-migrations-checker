# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode for development

# CLI commands (after build)
npm run crawl -- --url https://example.com [options]
npm run validate -- --input crawl-*.json --destination https://new.example.com [options]
```

## Architecture

This is a CLI tool for validating URL migrations between websites. It has two main commands:

### Crawl Command
Discovers all URLs on a source website using BFS traversal.

**Flow:** `src/index.ts` (CLI) → `src/crawler.ts` → `src/utils/http.ts` (fetch) → `src/utils/html-parser.ts` (link extraction)

Two rendering modes:
- **static**: Direct HTTP fetch with `undici`, parses raw HTML
- **flaresolverr**: Uses FlareSolverr proxy for JavaScript-rendered SPAs (React, Vue, etc.)

### Validate Command
Checks each crawled path on a destination domain and detects issues.

**Flow:** `src/index.ts` (CLI) → `src/validator.ts` → `src/utils/soft404.ts` (detection)

Issue types detected:
- 404 Not Found
- Soft 404 (200 OK but error content)
- Server errors (5xx)
- Title mismatches
- Redirects

### Key Utilities

- `src/utils/http.ts`: Fetch with retries, timeout, redirect handling. Supports both direct fetch and FlareSolverr.
- `src/utils/soft404.ts`: Detects soft 404s via title/body pattern matching, content length checks, and Sørensen–Dice similarity for title comparison.
- `src/utils/concurrency.ts`: Parallel request management via `p-limit`.
- `src/utils/html-parser.ts`: Cheerio-based link/title extraction.

### Output Files

Both commands output JSON files:
- Crawler: `crawl-{domain}-{timestamp}.json` with discovered URLs and metadata
- Validator: `validation-report-{timestamp}.json` with issues sorted by severity

## TypeScript Configuration

- ES modules (`"type": "module"` in package.json)
- NodeNext module resolution
- Strict mode enabled
- All imports require `.js` extension (even for .ts files)
