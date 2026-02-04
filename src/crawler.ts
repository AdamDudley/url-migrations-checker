import chalk from 'chalk';
import fse from 'fs-extra';
import type {
  CrawledUrl,
  CrawlerConfig,
  CrawlerOutput,
  CrawlStats,
} from './types/index.js';
import { fetchUrl, fetchUrlWithFlareSolverr, sleep, isSuccessStatus } from './utils/http.js';
import { parseHtml, getUrlPath, getDomain } from './utils/html-parser.js';
import { createLimiter, ProgressTracker, formatDuration } from './utils/concurrency.js';

/**
 * Crawls a website starting from the source URL
 */
export async function crawl(config: CrawlerConfig): Promise<CrawlerOutput> {
  const startTime = Date.now();
  const log = config.verbose ? console.log : () => {};

  log(chalk.blue('Starting crawl of:'), chalk.green(config.sourceUrl));
  log(chalk.blue('Max depth:'), config.maxDepth);
  log(chalk.blue('Concurrency:'), config.concurrency);
  log(chalk.blue('Renderer:'), config.renderer === 'flaresolverr'
    ? chalk.magenta('FlareSolverr (JavaScript rendering)')
    : chalk.gray('Static (HTML only)'));
  if (config.renderer === 'flaresolverr' && config.flaresolverrUrl) {
    log(chalk.blue('FlareSolverr URL:'), config.flaresolverrUrl);
  }
  log('');

  // Parse exclude patterns
  const excludePatterns = config.excludePatterns.map(p => new RegExp(p, 'i'));

  // Track visited URLs to avoid re-crawling
  const visited = new Set<string>();
  const crawledUrls: CrawledUrl[] = [];

  // BFS queue: [url, depth, discoveredFrom]
  const queue: Array<{ url: string; depth: number; discoveredFrom: string | null }> = [
    { url: normalizeUrl(config.sourceUrl), depth: 0, discoveredFrom: null },
  ];

  // Stats tracking
  let skippedDueToDepth = 0;
  let skippedDueToExclude = 0;
  let successfulCrawls = 0;
  let failedCrawls = 0;

  // Concurrency limiter
  const limiter = createLimiter(config.concurrency);

  // Process queue in batches
  while (queue.length > 0) {
    // Take a batch from the queue
    const batchSize = Math.min(queue.length, config.concurrency * 2);
    const batch = queue.splice(0, batchSize);

    // Filter out already visited URLs and apply depth limit
    const toProcess = batch.filter(item => {
      const normalizedUrl = normalizeUrl(item.url);

      if (visited.has(normalizedUrl)) {
        return false;
      }

      if (item.depth > config.maxDepth) {
        skippedDueToDepth++;
        return false;
      }

      if (shouldExclude(normalizedUrl, excludePatterns)) {
        skippedDueToExclude++;
        log(chalk.yellow('Excluding:'), normalizedUrl);
        return false;
      }

      visited.add(normalizedUrl);
      return true;
    });

    if (toProcess.length === 0) {
      continue;
    }

    log(chalk.cyan(`Processing batch of ${toProcess.length} URLs...`));

    // Process batch in parallel
    const results = await Promise.all(
      toProcess.map(item =>
        limiter(async () => {
          const result = await crawlUrl(item.url, item.depth, item.discoveredFrom, config);

          // Apply delay between requests
          if (config.delay > 0) {
            await sleep(config.delay);
          }

          return result;
        })
      )
    );

    // Process results
    for (const result of results) {
      if (!result) continue;

      crawledUrls.push(result.crawledUrl);

      if (isSuccessStatus(result.crawledUrl.statusCode)) {
        successfulCrawls++;
      } else {
        failedCrawls++;
      }

      // Add discovered links to queue
      for (const link of result.links) {
        const normalizedLink = normalizeUrl(link);
        if (!visited.has(normalizedLink)) {
          queue.push({
            url: normalizedLink,
            depth: result.crawledUrl.depth + 1,
            discoveredFrom: result.crawledUrl.url,
          });
        }
      }

      log(
        result.crawledUrl.statusCode === 200
          ? chalk.green('✓')
          : chalk.red('✗'),
        chalk.gray(`[${result.crawledUrl.statusCode}]`),
        chalk.white(result.crawledUrl.path),
        chalk.gray(`(${result.links.length} links, depth: ${result.crawledUrl.depth})`)
      );
    }

    // Show progress
    console.log(
      chalk.blue(`Crawled: ${crawledUrls.length} | Queue: ${queue.length} | Visited: ${visited.size}`)
    );
  }

  const durationMs = Date.now() - startTime;

  const stats: CrawlStats = {
    totalUrls: crawledUrls.length,
    successfulCrawls,
    failedCrawls,
    skippedDueToDepth,
    skippedDueToExclude,
    durationMs,
  };

  const output: CrawlerOutput = {
    sourceUrl: config.sourceUrl,
    urls: crawledUrls,
    stats,
    crawledAt: new Date().toISOString(),
    config,
  };

  // Write output file
  await fse.writeJson(config.outputPath, output, { spaces: 2 });

  // Print summary
  console.log('');
  console.log(chalk.blue('═'.repeat(60)));
  console.log(chalk.blue.bold('Crawl Complete'));
  console.log(chalk.blue('═'.repeat(60)));
  console.log(chalk.green('Total URLs crawled:'), stats.totalUrls);
  console.log(chalk.green('Successful:'), stats.successfulCrawls);
  console.log(chalk.red('Failed:'), stats.failedCrawls);
  console.log(chalk.yellow('Skipped (depth):'), stats.skippedDueToDepth);
  console.log(chalk.yellow('Skipped (excluded):'), stats.skippedDueToExclude);
  console.log(chalk.blue('Duration:'), formatDuration(stats.durationMs));
  console.log(chalk.blue('Output:'), config.outputPath);
  console.log(chalk.blue('═'.repeat(60)));

  return output;
}

/**
 * Crawls a single URL and extracts links
 */
async function crawlUrl(
  url: string,
  depth: number,
  discoveredFrom: string | null,
  config: CrawlerConfig
): Promise<{ crawledUrl: CrawledUrl; links: string[] } | null> {
  // Choose fetcher based on renderer config
  const result = config.renderer === 'flaresolverr' && config.flaresolverrUrl
    ? await fetchUrlWithFlareSolverr(url, {
        flaresolverrUrl: config.flaresolverrUrl,
        timeout: config.timeout,
      })
    : await fetchUrl(url, {
        timeout: config.timeout,
        retries: 2,
      });

  if (result.error) {
    return {
      crawledUrl: {
        url,
        path: getUrlPath(url),
        title: null,
        statusCode: result.statusCode,
        depth,
        discoveredFrom,
      },
      links: [],
    };
  }

  // Parse HTML to extract title and links
  const parsed = parseHtml(result.body, url);

  // Filter links to only internal ones that match the source domain
  const sourceDomain = getDomain(config.sourceUrl);
  const internalLinks = parsed.links.filter(link => {
    const linkDomain = getDomain(link);
    // Handle www vs non-www
    const normalizedLinkDomain = linkDomain.replace(/^www\./, '');
    const normalizedSourceDomain = sourceDomain.replace(/^www\./, '');
    return normalizedLinkDomain === normalizedSourceDomain;
  });

  return {
    crawledUrl: {
      url: result.finalUrl,
      path: getUrlPath(result.finalUrl),
      title: parsed.title,
      statusCode: result.statusCode,
      depth,
      discoveredFrom,
    },
    links: internalLinks,
  };
}

/**
 * Normalizes a URL for comparison
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove hash
    parsed.hash = '';

    // Remove trailing slash (except for root)
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Sort query parameters
    parsed.searchParams.sort();

    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Checks if a URL should be excluded based on patterns
 */
function shouldExclude(url: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(url));
}

/**
 * Generates a default output filename based on domain and timestamp
 */
export function generateOutputFilename(sourceUrl: string): string {
  const domain = getDomain(sourceUrl);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `crawl-${domain}-${timestamp}.json`;
}
