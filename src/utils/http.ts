import { fetch, type Response } from 'undici';
import type { FetchResult, FlareSolverrRequest, FlareSolverrResponse } from '../types/index.js';

/**
 * Default request headers to mimic a real browser
 */
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; URLMigrationChecker/1.0; +https://github.com/url-migration-checker)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

/**
 * Options for fetchUrl
 */
export interface FetchOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retries?: number;
  /** Follow redirects (default: true) */
  followRedirects?: boolean;
  /** Additional headers */
  headers?: Record<string, string>;
}

/**
 * Fetches a URL with retries, timeout, and redirect handling
 */
export async function fetchUrl(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const {
    timeout = 10000,
    retries = 2,
    followRedirects = true,
    headers = {},
  } = options;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= retries) {
    attempt++;
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response: Response = await fetch(url, {
        method: 'GET',
        headers: { ...DEFAULT_HEADERS, ...headers },
        signal: controller.signal,
        redirect: followRedirects ? 'follow' : 'manual',
      });

      clearTimeout(timeoutId);

      const body = await response.text();
      const responseTimeMs = Date.now() - startTime;

      // Check if we were redirected
      const finalUrl = response.url || url;
      const wasRedirected = finalUrl !== url;

      return {
        statusCode: response.status,
        body,
        finalUrl,
        wasRedirected,
        responseTimeMs,
      };
    } catch (error) {
      lastError = error as Error;
      const responseTimeMs = Date.now() - startTime;

      // Check if it's an abort error (timeout)
      if (lastError.name === 'AbortError') {
        return {
          statusCode: 0,
          body: '',
          finalUrl: url,
          wasRedirected: false,
          responseTimeMs,
          error: `Request timeout after ${timeout}ms`,
        };
      }

      // If not the last attempt, wait a bit before retrying
      if (attempt <= retries) {
        await sleep(Math.min(1000 * attempt, 3000)); // Exponential backoff, max 3s
      }
    }
  }

  return {
    statusCode: 0,
    body: '',
    finalUrl: url,
    wasRedirected: false,
    responseTimeMs: 0,
    error: lastError?.message || 'Unknown error',
  };
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks if a status code indicates success
 */
export function isSuccessStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/**
 * Checks if a status code indicates a redirect
 */
export function isRedirectStatus(statusCode: number): boolean {
  return statusCode >= 300 && statusCode < 400;
}

/**
 * Checks if a status code indicates a client error
 */
export function isClientErrorStatus(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500;
}

/**
 * Checks if a status code indicates a server error
 */
export function isServerErrorStatus(statusCode: number): boolean {
  return statusCode >= 500 && statusCode < 600;
}

/**
 * Options for FlareSolverr fetch
 */
export interface FlareSolverrFetchOptions {
  /** FlareSolverr API URL */
  flaresolverrUrl: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Fetches a URL using FlareSolverr (renders JavaScript)
 */
export async function fetchUrlWithFlareSolverr(
  url: string,
  options: FlareSolverrFetchOptions
): Promise<FetchResult> {
  const { flaresolverrUrl, timeout = 60000 } = options;
  const startTime = Date.now();

  try {
    const request: FlareSolverrRequest = {
      cmd: 'request.get',
      url,
      maxTimeout: timeout,
    };

    const response = await fetch(flaresolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`FlareSolverr HTTP error: ${response.status}`);
    }

    const data = await response.json() as FlareSolverrResponse;
    const responseTimeMs = Date.now() - startTime;

    if (data.status !== 'ok') {
      return {
        statusCode: 0,
        body: '',
        finalUrl: url,
        wasRedirected: false,
        responseTimeMs,
        error: `FlareSolverr error: ${data.message}`,
      };
    }

    const solution = data.solution;
    const wasRedirected = solution.url !== url;

    return {
      statusCode: solution.status,
      body: solution.response,
      finalUrl: solution.url,
      wasRedirected,
      responseTimeMs,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    return {
      statusCode: 0,
      body: '',
      finalUrl: url,
      wasRedirected: false,
      responseTimeMs,
      error: (error as Error).message || 'FlareSolverr request failed',
    };
  }
}
