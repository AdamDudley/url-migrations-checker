import chalk from 'chalk';
import fse from 'fs-extra';
import type {
  CrawlerOutput,
  ValidatorConfig,
  ValidationReport,
  ValidationResult,
  ValidationSummary,
  ValidationIssue,
} from './types/index.js';
import { fetchUrl, isSuccessStatus, isServerErrorStatus } from './utils/http.js';
import { extractTitle, extractBodyText, joinUrl } from './utils/html-parser.js';
import { checkSoft404, titlesMatch } from './utils/soft404.js';
import { createLimiter, formatDuration } from './utils/concurrency.js';

/**
 * Validates crawled URLs against a destination
 */
export async function validate(config: ValidatorConfig): Promise<ValidationReport> {
  const startTime = Date.now();
  const log = config.verbose ? console.log : () => {};

  // Load crawler output
  log(chalk.blue('Loading crawler output:'), config.inputPath);
  const crawlerOutput: CrawlerOutput = await fse.readJson(config.inputPath);

  console.log(chalk.blue('Source:'), crawlerOutput.sourceUrl);
  console.log(chalk.blue('Destination:'), config.destinationUrl);
  console.log(chalk.blue('URLs to validate:'), crawlerOutput.urls.length);
  console.log('');

  const limiter = createLimiter(config.concurrency);
  const results: ValidationResult[] = [];

  // Progress tracking
  let processed = 0;
  const total = crawlerOutput.urls.length;

  // Validate each URL
  const validationPromises = crawlerOutput.urls.map(crawledUrl =>
    limiter(async () => {
      const result = await validateUrl(
        crawledUrl.path,
        crawledUrl.title,
        config.destinationUrl,
        config.timeout
      );

      results.push(result);
      processed++;

      // Log progress
      const statusIcon = result.status === 'ok'
        ? chalk.green('✓')
        : result.status === 'warning'
        ? chalk.yellow('⚠')
        : chalk.red('✗');

      const statusCode = result.destinationStatusCode
        ? chalk.gray(`[${result.destinationStatusCode}]`)
        : chalk.gray('[ERR]');

      log(
        statusIcon,
        statusCode,
        chalk.white(result.sourcePath),
        result.issues.length > 0
          ? chalk.gray(`- ${result.issues.map(i => i.type).join(', ')}`)
          : ''
      );

      // Show progress every 10 URLs or on verbose
      if (processed % 10 === 0 || config.verbose) {
        console.log(
          chalk.cyan(`Progress: ${processed}/${total} (${Math.round(processed / total * 100)}%)`)
        );
      }

      return result;
    })
  );

  await Promise.all(validationPromises);

  const durationMs = Date.now() - startTime;

  // Calculate summary
  const summary = calculateSummary(results, durationMs);

  const report: ValidationReport = {
    sourceUrl: crawlerOutput.sourceUrl,
    destinationUrl: config.destinationUrl,
    summary,
    results: results.sort((a, b) => {
      // Sort errors first, then warnings, then ok
      const order = { error: 0, warning: 1, ok: 2 };
      return order[a.status] - order[b.status];
    }),
    validatedAt: new Date().toISOString(),
    config,
  };

  // Write report
  await fse.writeJson(config.outputPath, report, { spaces: 2 });

  // Print summary
  printSummary(summary, config.outputPath);

  // Print errors and warnings
  printIssues(results, config.verbose);

  return report;
}

/**
 * Validates a single URL on the destination
 */
async function validateUrl(
  path: string,
  sourceTitle: string | null,
  destinationUrl: string,
  timeout: number
): Promise<ValidationResult> {
  const destUrl = joinUrl(destinationUrl, path);
  const issues: ValidationIssue[] = [];
  let status: 'ok' | 'warning' | 'error' = 'ok';

  const startTime = Date.now();
  const result = await fetchUrl(destUrl, {
    timeout,
    retries: 1,
    followRedirects: true,
  });
  const responseTimeMs = Date.now() - startTime;

  // Handle fetch errors
  if (result.error) {
    issues.push({
      type: 'error',
      message: result.error,
    });
    return {
      sourcePath: path,
      sourceTitle,
      destinationUrl: destUrl,
      destinationStatusCode: null,
      destinationTitle: null,
      status: 'error',
      issues,
      responseTimeMs,
    };
  }

  // Check for 404
  if (result.statusCode === 404) {
    issues.push({
      type: 'not_found',
      message: '404 Not Found',
    });
    status = 'error';
  }

  // Check for server errors
  if (isServerErrorStatus(result.statusCode)) {
    issues.push({
      type: 'server_error',
      message: `Server error: ${result.statusCode}`,
    });
    status = 'error';
  }

  // Check for redirects
  if (result.wasRedirected) {
    const originalUrl = new URL(destUrl);
    const finalUrl = new URL(result.finalUrl);

    // Only warn if redirected to a different path (not just protocol or www)
    if (originalUrl.pathname !== finalUrl.pathname) {
      issues.push({
        type: 'redirect',
        message: `Redirected to: ${finalUrl.pathname}`,
        details: { finalUrl: result.finalUrl },
      });
      status = status === 'ok' ? 'warning' : status;
    }
  }

  // Extract destination title
  const destTitle = extractTitle(result.body);
  const bodyText = extractBodyText(result.body);

  // Check for soft 404
  if (isSuccessStatus(result.statusCode)) {
    const soft404Check = checkSoft404(bodyText, destTitle, result.statusCode);
    if (soft404Check.isSoft404) {
      issues.push({
        type: 'soft_404',
        message: `Soft 404 detected (${Math.round(soft404Check.confidence * 100)}% confidence)`,
        details: { reasons: soft404Check.reasons },
      });
      status = 'error';
    }
  }

  // Check title mismatch (only if both have titles and not already an error)
  if (sourceTitle && destTitle && status !== 'error') {
    if (!titlesMatch(sourceTitle, destTitle)) {
      issues.push({
        type: 'title_mismatch',
        message: `Title mismatch: "${sourceTitle}" vs "${destTitle}"`,
        details: { sourceTitle, destinationTitle: destTitle },
      });
      status = status === 'ok' ? 'warning' : status;
    }
  }

  return {
    sourcePath: path,
    sourceTitle,
    destinationUrl: destUrl,
    destinationStatusCode: result.statusCode,
    destinationTitle: destTitle,
    status,
    issues,
    responseTimeMs,
  };
}

/**
 * Calculates summary statistics from results
 */
function calculateSummary(results: ValidationResult[], durationMs: number): ValidationSummary {
  const summary: ValidationSummary = {
    totalUrls: results.length,
    okUrls: 0,
    warningUrls: 0,
    errorUrls: 0,
    soft404Count: 0,
    notFoundCount: 0,
    serverErrorCount: 0,
    titleMismatchCount: 0,
    redirectCount: 0,
    durationMs,
  };

  for (const result of results) {
    switch (result.status) {
      case 'ok':
        summary.okUrls++;
        break;
      case 'warning':
        summary.warningUrls++;
        break;
      case 'error':
        summary.errorUrls++;
        break;
    }

    for (const issue of result.issues) {
      switch (issue.type) {
        case 'soft_404':
          summary.soft404Count++;
          break;
        case 'not_found':
          summary.notFoundCount++;
          break;
        case 'server_error':
          summary.serverErrorCount++;
          break;
        case 'title_mismatch':
          summary.titleMismatchCount++;
          break;
        case 'redirect':
          summary.redirectCount++;
          break;
      }
    }
  }

  return summary;
}

/**
 * Prints summary to console
 */
function printSummary(summary: ValidationSummary, outputPath: string): void {
  console.log('');
  console.log(chalk.blue('═'.repeat(60)));
  console.log(chalk.blue.bold('Validation Complete'));
  console.log(chalk.blue('═'.repeat(60)));
  console.log(chalk.white('Total URLs:'), summary.totalUrls);
  console.log(chalk.green('OK:'), summary.okUrls);
  console.log(chalk.yellow('Warnings:'), summary.warningUrls);
  console.log(chalk.red('Errors:'), summary.errorUrls);
  console.log('');
  console.log(chalk.white('Issue breakdown:'));
  console.log(chalk.red('  404 Not Found:'), summary.notFoundCount);
  console.log(chalk.red('  Soft 404s:'), summary.soft404Count);
  console.log(chalk.red('  Server Errors:'), summary.serverErrorCount);
  console.log(chalk.yellow('  Title Mismatches:'), summary.titleMismatchCount);
  console.log(chalk.yellow('  Redirects:'), summary.redirectCount);
  console.log('');
  console.log(chalk.blue('Duration:'), formatDuration(summary.durationMs));
  console.log(chalk.blue('Report:'), outputPath);
  console.log(chalk.blue('═'.repeat(60)));
}

/**
 * Prints issues to console
 */
function printIssues(results: ValidationResult[], verbose: boolean): void {
  const errors = results.filter(r => r.status === 'error');
  const warnings = results.filter(r => r.status === 'warning');

  if (errors.length > 0) {
    console.log('');
    console.log(chalk.red.bold(`Errors (${errors.length}):`));
    const maxToShow = verbose ? errors.length : Math.min(errors.length, 10);
    for (let i = 0; i < maxToShow; i++) {
      const error = errors[i];
      console.log(chalk.red(`  ${error.sourcePath}`));
      for (const issue of error.issues) {
        console.log(chalk.gray(`    - ${issue.message}`));
      }
    }
    if (errors.length > maxToShow) {
      console.log(chalk.gray(`  ... and ${errors.length - maxToShow} more (use -v to see all)`));
    }
  }

  if (warnings.length > 0 && verbose) {
    console.log('');
    console.log(chalk.yellow.bold(`Warnings (${warnings.length}):`));
    for (const warning of warnings) {
      console.log(chalk.yellow(`  ${warning.sourcePath}`));
      for (const issue of warning.issues) {
        console.log(chalk.gray(`    - ${issue.message}`));
      }
    }
  }
}

/**
 * Generates a default output filename based on timestamp
 */
export function generateReportFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `validation-report-${timestamp}.json`;
}
