import * as cheerio from 'cheerio';
import type { ParsedPage } from '../types/index.js';

/**
 * Parses HTML and extracts title, links, and body content
 */
export function parseHtml(html: string, baseUrl: string): ParsedPage {
  const $ = cheerio.load(html);

  // Extract title
  const title = $('title').first().text().trim() || null;

  // Extract all links
  const links: string[] = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      const normalizedLink = normalizeLink(href, baseUrl);
      if (normalizedLink && isInternalLink(normalizedLink, baseUrl)) {
        links.push(normalizedLink);
      }
    }
  });

  // Extract body text for soft 404 detection
  // Remove script and style elements first
  $('script, style, noscript').remove();
  const bodyText = $('body').text()
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    links: [...new Set(links)], // Remove duplicates
    bodyText,
    contentLength: bodyText.length,
  };
}

/**
 * Extracts just the title from HTML (faster for validation)
 */
export function extractTitle(html: string): string | null {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  return title || null;
}

/**
 * Extracts body text for soft 404 detection
 */
export function extractBodyText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a link to an absolute URL
 */
export function normalizeLink(href: string, baseUrl: string): string | null {
  // Skip non-http links
  if (
    href.startsWith('javascript:') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('data:') ||
    href.startsWith('#')
  ) {
    return null;
  }

  try {
    // Handle relative and absolute URLs
    const url = new URL(href, baseUrl);

    // Remove hash fragments
    url.hash = '';

    // Normalize trailing slashes (remove from non-root paths)
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.href;
  } catch {
    return null;
  }
}

/**
 * Checks if a URL is internal (same domain as base)
 */
export function isInternalLink(url: string, baseUrl: string): boolean {
  try {
    const linkHost = new URL(url).hostname;
    const baseHost = new URL(baseUrl).hostname;

    // Handle www vs non-www
    const normalizeHost = (host: string) => host.replace(/^www\./, '');

    return normalizeHost(linkHost) === normalizeHost(baseHost);
  } catch {
    return false;
  }
}

/**
 * Extracts the path from a URL
 */
export function getUrlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/**
 * Gets the domain from a URL
 */
export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Joins a path with a base URL
 */
export function joinUrl(baseUrl: string, path: string): string {
  try {
    return new URL(path, baseUrl).href;
  } catch {
    return `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  }
}
