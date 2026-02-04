#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { crawl, generateOutputFilename } from './crawler.js';
import { validate, generateReportFilename } from './validator.js';
import type { CrawlerConfig, ValidatorConfig, RendererType } from './types/index.js';

const DEFAULT_FLARESOLVERR_URL = 'http://localhost:8191/v1';

const program = new Command();

program
  .name('url-migration-checker')
  .description('CLI tool to crawl a source website and validate URL migrations to a new destination')
  .version('1.0.0');

// Crawl command
program
  .command('crawl')
  .description('Crawl a website and discover all URLs')
  .requiredOption('-u, --url <url>', 'Source URL to crawl')
  .option('-o, --output <path>', 'Output file path')
  .option('-d, --max-depth <number>', 'Maximum crawl depth', '10')
  .option('-c, --concurrency <number>', 'Number of parallel requests', '5')
  .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--delay <ms>', 'Delay between requests in milliseconds', '100')
  .option('-e, --exclude <patterns...>', 'URL patterns to exclude (regex)')
  .option('-r, --renderer <type>', 'Renderer type: static or flaresolverr (for SPAs)', 'static')
  .option('--flaresolverr-url <url>', 'FlareSolverr API URL', DEFAULT_FLARESOLVERR_URL)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    try {
      // Validate URL
      let sourceUrl = options.url;
      try {
        const parsed = new URL(sourceUrl);
        if (!parsed.protocol.startsWith('http')) {
          throw new Error('URL must use http or https protocol');
        }
        sourceUrl = parsed.href;
      } catch (error) {
        console.error(chalk.red('Invalid URL:'), options.url);
        process.exit(1);
      }

      // Validate renderer option
      const renderer = options.renderer as RendererType;
      if (renderer !== 'static' && renderer !== 'flaresolverr') {
        console.error(chalk.red('Invalid renderer. Use "static" or "flaresolverr"'));
        process.exit(1);
      }

      const config: CrawlerConfig = {
        sourceUrl,
        maxDepth: parseInt(options.maxDepth, 10),
        concurrency: parseInt(options.concurrency, 10),
        timeout: renderer === 'flaresolverr' ? 60000 : parseInt(options.timeout, 10), // FlareSolverr needs more time
        delay: parseInt(options.delay, 10),
        excludePatterns: options.exclude || [],
        outputPath: options.output || generateOutputFilename(sourceUrl),
        verbose: options.verbose,
        renderer,
        flaresolverrUrl: options.flaresolverrUrl,
      };

      // Validate numeric options
      if (isNaN(config.maxDepth) || config.maxDepth < 0) {
        console.error(chalk.red('Invalid max-depth value'));
        process.exit(1);
      }
      if (isNaN(config.concurrency) || config.concurrency < 1) {
        console.error(chalk.red('Invalid concurrency value'));
        process.exit(1);
      }
      if (isNaN(config.timeout) || config.timeout < 0) {
        console.error(chalk.red('Invalid timeout value'));
        process.exit(1);
      }

      await crawl(config);
    } catch (error) {
      console.error(chalk.red('Crawl failed:'), error);
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate crawled URLs against a destination')
  .requiredOption('-i, --input <path>', 'Crawler output file path')
  .requiredOption('-d, --destination <url>', 'Destination URL to validate against')
  .option('-o, --output <path>', 'Output report file path')
  .option('-c, --concurrency <number>', 'Number of parallel requests', '5')
  .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('--redirects-ok', 'Treat redirects as OK instead of warning', false)
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    try {
      // Validate destination URL
      let destinationUrl = options.destination;
      try {
        const parsed = new URL(destinationUrl);
        if (!parsed.protocol.startsWith('http')) {
          throw new Error('URL must use http or https protocol');
        }
        // Remove trailing slash
        destinationUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
      } catch (error) {
        console.error(chalk.red('Invalid destination URL:'), options.destination);
        process.exit(1);
      }

      const config: ValidatorConfig = {
        inputPath: options.input,
        destinationUrl,
        concurrency: parseInt(options.concurrency, 10),
        timeout: parseInt(options.timeout, 10),
        outputPath: options.output || generateReportFilename(),
        verbose: options.verbose,
        redirectHandling: options.redirectsOk ? 'ok' : 'warning',
      };

      // Validate numeric options
      if (isNaN(config.concurrency) || config.concurrency < 1) {
        console.error(chalk.red('Invalid concurrency value'));
        process.exit(1);
      }
      if (isNaN(config.timeout) || config.timeout < 0) {
        console.error(chalk.red('Invalid timeout value'));
        process.exit(1);
      }

      // Check input file exists
      const fse = await import('fs-extra');
      if (!await fse.default.pathExists(config.inputPath)) {
        console.error(chalk.red('Input file not found:'), config.inputPath);
        process.exit(1);
      }

      await validate(config);
    } catch (error) {
      console.error(chalk.red('Validation failed:'), error);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();

// Show help if no command specified
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
