import pLimit from 'p-limit';

/**
 * Creates a concurrency limiter for parallel operations
 */
export function createLimiter(concurrency: number) {
  return pLimit(concurrency);
}

/**
 * Progress tracker for long-running operations
 */
export class ProgressTracker {
  private total: number;
  private completed: number;
  private failed: number;
  private startTime: number;
  private lastLogTime: number;
  private logInterval: number;
  private verbose: boolean;
  private logger: (message: string) => void;

  constructor(options: {
    total: number;
    verbose?: boolean;
    logInterval?: number;
    logger?: (message: string) => void;
  }) {
    this.total = options.total;
    this.completed = 0;
    this.failed = 0;
    this.startTime = Date.now();
    this.lastLogTime = 0;
    this.logInterval = options.logInterval || 1000; // Log at most every second
    this.verbose = options.verbose || false;
    this.logger = options.logger || console.log;
  }

  /**
   * Increments the completed count and optionally logs progress
   */
  complete(success: boolean = true): void {
    this.completed++;
    if (!success) {
      this.failed++;
    }
    this.maybeLog();
  }

  /**
   * Logs progress if enough time has passed since last log
   */
  private maybeLog(): void {
    const now = Date.now();
    if (this.verbose && now - this.lastLogTime >= this.logInterval) {
      this.log();
      this.lastLogTime = now;
    }
  }

  /**
   * Forces a progress log
   */
  log(): void {
    const elapsed = Date.now() - this.startTime;
    const rate = this.completed / (elapsed / 1000);
    const remaining = this.total - this.completed;
    const eta = remaining > 0 ? Math.round(remaining / rate) : 0;

    const percent = Math.round((this.completed / this.total) * 100);
    this.logger(
      `Progress: ${this.completed}/${this.total} (${percent}%) | ` +
      `Failed: ${this.failed} | ` +
      `Rate: ${rate.toFixed(1)}/s | ` +
      `ETA: ${formatDuration(eta * 1000)}`
    );
  }

  /**
   * Logs final summary
   */
  summary(): void {
    const elapsed = Date.now() - this.startTime;
    const rate = this.completed / (elapsed / 1000);

    this.logger(
      `\nCompleted: ${this.completed}/${this.total} | ` +
      `Failed: ${this.failed} | ` +
      `Duration: ${formatDuration(elapsed)} | ` +
      `Rate: ${rate.toFixed(1)}/s`
    );
  }

  /**
   * Gets current stats
   */
  getStats() {
    return {
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      elapsed: Date.now() - this.startTime,
    };
  }
}

/**
 * Formats milliseconds as a human-readable duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Batches an array into chunks of specified size
 */
export function batch<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Runs tasks with concurrency limit and progress tracking
 */
export async function runWithProgress<T, R>(
  items: T[],
  task: (item: T, index: number) => Promise<R>,
  options: {
    concurrency: number;
    verbose?: boolean;
    logger?: (message: string) => void;
    onComplete?: (result: R, item: T, success: boolean) => void;
  }
): Promise<R[]> {
  const limiter = createLimiter(options.concurrency);
  const tracker = new ProgressTracker({
    total: items.length,
    verbose: options.verbose,
    logger: options.logger,
  });

  const results = await Promise.all(
    items.map((item, index) =>
      limiter(async () => {
        try {
          const result = await task(item, index);
          tracker.complete(true);
          options.onComplete?.(result, item, true);
          return result;
        } catch (error) {
          tracker.complete(false);
          throw error;
        }
      })
    )
  );

  tracker.summary();
  return results;
}
