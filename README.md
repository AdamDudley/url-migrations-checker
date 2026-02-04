# URL Migration Checker

A CLI tool to crawl a source website and validate URL migrations to a new destination. Ensures no SEO "juice" is lost during framework migrations.

## Features

- **Two rendering modes**: Static HTML parsing or FlareSolverr for JavaScript-rendered SPAs
- **Soft 404 detection**: Detects pages returning 200 OK but showing error content
- **Title comparison**: Validates page titles match between source and destination
- **Parallel crawling**: Configurable concurrency for fast crawling
- **Detailed reports**: JSON output with statistics and issue breakdown

## Installation

```bash
cd tools/url-migration-checker
npm install
npm run build
```

## Quick Start

### Crawl a static site (traditional HTML)

```bash
npm run crawl -- --url https://example.com
```

### Crawl an SPA (React, Vue, etc.) using FlareSolverr

```bash
npm run crawl -- --url https://example.com --renderer flaresolverr
```

### Validate URLs on new destination

```bash
npm run validate -- --input crawl-example.com-*.json --destination https://new.example.com
```

## Commands

### `crawl` - Discover all URLs on source site

Crawls a website starting from the source URL and discovers all internal links.

```bash
npm run crawl -- --url <source-url> [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-u, --url` | Source URL to crawl (required) | - |
| `-o, --output` | Output file path | `crawl-{domain}-{timestamp}.json` |
| `-d, --max-depth` | Max crawl depth | 10 |
| `-c, --concurrency` | Parallel requests | 5 |
| `-t, --timeout` | Request timeout (ms) | 10000 (60000 for FlareSolverr) |
| `--delay` | Delay between requests (ms) | 100 |
| `-e, --exclude` | URL patterns to exclude (regex) | - |
| `-r, --renderer` | Renderer: `static` or `flaresolverr` | static |
| `--flaresolverr-url` | FlareSolverr API URL | http://localhost:8191/v1 |
| `-v, --verbose` | Verbose logging | false |

**Examples:**

```bash
# Basic static crawl
npm run crawl -- -u https://example.com

# Crawl SPA with FlareSolverr (JavaScript rendering)
npm run crawl -- -u https://example.com -r flaresolverr -v

# Crawl with limited depth
npm run crawl -- -u https://example.com -d 3

# Crawl excluding certain patterns
npm run crawl -- -u https://example.com -e "\.pdf$" "/admin" "/api"

# Use custom FlareSolverr instance
npm run crawl -- -u https://myapp.com -r flaresolverr --flaresolverr-url http://localhost:8191/v1
```

### `validate` - Check URLs on destination

Reads crawler output and validates each path on the destination domain.

```bash
npm run validate -- --input <crawler-output> --destination <dest-url> [options]
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `-i, --input` | Crawler output file (required) | - |
| `-d, --destination` | Destination URL (required) | - |
| `-o, --output` | Report file path | `validation-report-{timestamp}.json` |
| `-c, --concurrency` | Parallel requests | 5 |
| `-t, --timeout` | Request timeout (ms) | 10000 |
| `-v, --verbose` | Verbose logging | false |

**Examples:**

```bash
# Validate against new domain
npm run validate -- -i crawl-example.com-*.json -d https://new.example.com -v

# Validate against staging
npm run validate -- -i crawl-example.com-*.json -d https://staging.example.com

# Sanity check (same domain - should all pass)
npm run validate -- -i crawl-example.com-*.json -d https://example.com
```

## Rendering Modes

### Static (default)

Uses direct HTTP requests and parses the raw HTML response. Fast and efficient but **cannot discover links in JavaScript-rendered content**.

Best for:
- Traditional server-rendered websites
- Static sites (Jekyll, Hugo, etc.)
- Server-side rendered apps (Next.js SSR, Nuxt SSR)

### FlareSolverr

Uses FlareSolverr, a proxy service that runs a real browser (Chrome) to render JavaScript before returning the HTML. **Required for SPAs** like React, Vue, Angular.

Best for:
- Single Page Applications (SPAs)
- Client-side rendered React/Vue/Angular apps
- Sites with JavaScript-generated navigation

**Requirements:**
- FlareSolverr must be running (default: http://localhost:8191/v1)
- Slower than static mode (browser rendering takes time)
- Lower concurrency recommended (1-3) to avoid overwhelming the service

```bash
# Crawl SPA with lower concurrency
npm run crawl -- -u https://myapp.com -r flaresolverr -c 2 -v
```

## Output Files

### Crawler Output (JSON)

```json
{
  "sourceUrl": "https://example.com",
  "urls": [
    {
      "url": "https://example.com/articles/some-article",
      "path": "/articles/some-article",
      "title": "Some Article Title",
      "statusCode": 200,
      "depth": 1,
      "discoveredFrom": "https://example.com/"
    }
  ],
  "stats": {
    "totalUrls": 150,
    "successfulCrawls": 148,
    "failedCrawls": 2,
    "skippedDueToDepth": 10,
    "skippedDueToExclude": 5,
    "durationMs": 30000
  },
  "crawledAt": "2024-01-15T10:30:00.000Z",
  "config": { ... }
}
```

### Validation Report (JSON)

```json
{
  "sourceUrl": "https://example.com",
  "destinationUrl": "https://new.example.com",
  "summary": {
    "totalUrls": 150,
    "okUrls": 145,
    "warningUrls": 2,
    "errorUrls": 3,
    "soft404Count": 2,
    "notFoundCount": 1,
    "serverErrorCount": 0,
    "titleMismatchCount": 2,
    "redirectCount": 0,
    "durationMs": 25000
  },
  "results": [
    {
      "sourcePath": "/old-page",
      "sourceTitle": "Old Page",
      "destinationUrl": "https://new.example.com/old-page",
      "destinationStatusCode": 200,
      "destinationTitle": "Page Not Found",
      "status": "error",
      "issues": [
        {
          "type": "soft_404",
          "message": "Soft 404 detected (85% confidence)",
          "details": { "reasons": ["Title matches error pattern"] }
        }
      ],
      "responseTimeMs": 150
    }
  ],
  "validatedAt": "2024-01-15T11:00:00.000Z",
  "config": { ... }
}
```

## Soft 404 Detection

The tool detects pages that return HTTP 200 but display error content:

- **Title patterns**: Checks for "404", "not found", "error" in page title
- **Body patterns**: Searches for phrases like "page not found", "doesn't exist", "no longer available"
- **Content length**: Flags suspiciously short pages (<500 characters)

Returns a confidence score (0-1). Pages with score >= 0.5 are flagged as soft 404s.

## Typical Migration Workflow

1. **Crawl the source site** (before migration)
   ```bash
   npm run crawl -- -u https://old-site.com -r flaresolverr -v
   ```

2. **Deploy new site** to staging

3. **Validate against staging**
   ```bash
   npm run validate -- -i crawl-old-site.com-*.json -d https://staging.new-site.com -v
   ```

4. **Fix any issues** (missing pages, broken routes, etc.)

5. **Re-validate until clean**

6. **Deploy to production** with confidence

## Project Structure

```
tools/url-migration-checker/
├── src/
│   ├── index.ts              # CLI entry (Commander.js)
│   ├── crawler.ts            # Crawl command implementation
│   ├── validator.ts          # Validate command implementation
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── utils/
│       ├── http.ts           # Fetch with retries + FlareSolverr
│       ├── html-parser.ts    # Cheerio-based link/title extraction
│       ├── concurrency.ts    # Parallel request manager
│       └── soft404.ts        # Soft 404 detection logic
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing |
| `cheerio` | HTML parsing (fast, no browser) |
| `undici` | HTTP client (native, fast) |
| `p-limit` | Concurrency control |
| `chalk` | Colored console output |
| `fs-extra` | Enhanced file operations |

## Troubleshooting

### FlareSolverr errors

If you see FlareSolverr connection errors:

1. Check FlareSolverr is running: `curl http://localhost:8191/v1`
2. Try a custom instance: `--flaresolverr-url http://localhost:8191/v1`
3. Lower concurrency: `-c 1` or `-c 2`

### Crawl finds 0 links

This usually means the site is an SPA. Use FlareSolverr:
```bash
npm run crawl -- -u https://spa-site.com -r flaresolverr
```

### Timeout errors

Increase timeout for slow sites:
```bash
npm run crawl -- -u https://slow-site.com -t 30000
```
