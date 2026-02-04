/**
 * Represents a crawled URL with metadata
 */
export interface CrawledUrl {
  /** Full URL that was crawled */
  url: string;
  /** URL path (without domain) */
  path: string;
  /** Page title extracted from <title> tag */
  title: string | null;
  /** HTTP status code from the request */
  statusCode: number;
  /** Depth level from the source URL (0 = root) */
  depth: number;
  /** URL from which this page was discovered */
  discoveredFrom: string | null;
}

/**
 * Statistics from the crawl operation
 */
export interface CrawlStats {
  /** Total unique URLs discovered */
  totalUrls: number;
  /** Successfully crawled URLs (2xx status) */
  successfulCrawls: number;
  /** Failed crawls (non-2xx or errors) */
  failedCrawls: number;
  /** URLs skipped due to depth limit */
  skippedDueToDepth: number;
  /** URLs skipped due to exclude patterns */
  skippedDueToExclude: number;
  /** Duration of crawl in milliseconds */
  durationMs: number;
}

/**
 * Output from the crawler command
 */
export interface CrawlerOutput {
  /** The source URL that was crawled */
  sourceUrl: string;
  /** All discovered URLs with metadata */
  urls: CrawledUrl[];
  /** Crawl statistics */
  stats: CrawlStats;
  /** Timestamp when crawl started */
  crawledAt: string;
  /** Crawler configuration used */
  config: CrawlerConfig;
}

/**
 * Renderer type for fetching pages
 */
export type RendererType = 'static' | 'flaresolverr';

/**
 * Configuration options for the crawler
 */
export interface CrawlerConfig {
  /** Source URL to crawl */
  sourceUrl: string;
  /** Maximum depth to crawl */
  maxDepth: number;
  /** Number of parallel requests */
  concurrency: number;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Delay between requests in milliseconds */
  delay: number;
  /** URL patterns to exclude (regex strings) */
  excludePatterns: string[];
  /** Output file path */
  outputPath: string;
  /** Enable verbose logging */
  verbose: boolean;
  /** Renderer to use for fetching pages */
  renderer: RendererType;
  /** FlareSolverr API URL (when renderer is 'flaresolverr') */
  flaresolverrUrl?: string;
}

/**
 * Issue found during validation
 */
export interface ValidationIssue {
  /** Type of issue detected */
  type: 'not_found' | 'soft_404' | 'server_error' | 'title_mismatch' | 'redirect' | 'timeout' | 'error';
  /** Human-readable message describing the issue */
  message: string;
  /** Additional details (e.g., redirect location) */
  details?: Record<string, unknown>;
}

/**
 * Result of validating a single URL
 */
export interface ValidationResult {
  /** Original path from source */
  sourcePath: string;
  /** Original title from source */
  sourceTitle: string | null;
  /** Full destination URL tested */
  destinationUrl: string;
  /** HTTP status code from destination */
  destinationStatusCode: number | null;
  /** Title on destination page */
  destinationTitle: string | null;
  /** Overall status: ok, warning, or error */
  status: 'ok' | 'warning' | 'error';
  /** List of issues found */
  issues: ValidationIssue[];
  /** Response time in milliseconds */
  responseTimeMs: number | null;
}

/**
 * Summary statistics for the validation report
 */
export interface ValidationSummary {
  /** Total URLs validated */
  totalUrls: number;
  /** URLs with status 'ok' */
  okUrls: number;
  /** URLs with status 'warning' */
  warningUrls: number;
  /** URLs with status 'error' */
  errorUrls: number;
  /** Count of soft 404s detected */
  soft404Count: number;
  /** Count of actual 404s */
  notFoundCount: number;
  /** Count of server errors (5xx) */
  serverErrorCount: number;
  /** Count of title mismatches */
  titleMismatchCount: number;
  /** Count of redirects */
  redirectCount: number;
  /** Duration of validation in milliseconds */
  durationMs: number;
}

/**
 * Complete validation report output
 */
export interface ValidationReport {
  /** Source URL that was crawled */
  sourceUrl: string;
  /** Destination URL that was validated */
  destinationUrl: string;
  /** Summary statistics */
  summary: ValidationSummary;
  /** Detailed results for each URL */
  results: ValidationResult[];
  /** Timestamp when validation started */
  validatedAt: string;
  /** Validator configuration used */
  config: ValidatorConfig;
}

/**
 * Configuration options for the validator
 */
export interface ValidatorConfig {
  /** Path to crawler output file */
  inputPath: string;
  /** Destination URL to validate against */
  destinationUrl: string;
  /** Number of parallel requests */
  concurrency: number;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Output file path for report */
  outputPath: string;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Result of a soft 404 check
 */
export interface Soft404CheckResult {
  /** Whether this appears to be a soft 404 */
  isSoft404: boolean;
  /** Confidence score from 0 to 1 */
  confidence: number;
  /** Reasons why this was flagged */
  reasons: string[];
}

/**
 * Parsed HTML data from a page
 */
export interface ParsedPage {
  /** Page title from <title> tag */
  title: string | null;
  /** All internal links found on the page */
  links: string[];
  /** Body text content (for soft 404 detection) */
  bodyText: string;
  /** Content length in characters */
  contentLength: number;
}

/**
 * Result of an HTTP fetch operation
 */
export interface FetchResult {
  /** HTTP status code */
  statusCode: number;
  /** Response body as text */
  body: string;
  /** Final URL after redirects */
  finalUrl: string;
  /** Whether the request was redirected */
  wasRedirected: boolean;
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** Error message if request failed */
  error?: string;
}

/**
 * FlareSolverr request payload
 */
export interface FlareSolverrRequest {
  cmd: 'request.get';
  url: string;
  maxTimeout: number;
  cookies?: FlareSolverrCookie[];
}

/**
 * FlareSolverr cookie
 */
export interface FlareSolverrCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

/**
 * FlareSolverr solution data
 */
export interface FlareSolverrSolution {
  url: string;
  status: number;
  response: string;
  cookies: FlareSolverrCookie[];
  userAgent: string;
}

/**
 * FlareSolverr API response
 */
export interface FlareSolverrResponse {
  status: 'ok' | 'error';
  message: string;
  startTimestamp: number;
  endTimestamp: number;
  version: string;
  solution: FlareSolverrSolution;
}
