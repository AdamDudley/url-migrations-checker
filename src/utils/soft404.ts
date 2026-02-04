import type { Soft404CheckResult } from '../types/index.js';

/**
 * Patterns that indicate a 404 error page in body content
 */
const BODY_ERROR_PATTERNS = [
  /page\s*not\s*found/i,
  /404\s*(error)?/i,
  /not\s*found/i,
  /doesn'?t\s*exist/i,
  /does\s*not\s*exist/i,
  /no\s*longer\s*(available|exists?)/i,
  /cannot\s*be\s*found/i,
  /could\s*not\s*(be\s*)?found/i,
  /we\s*couldn'?t\s*find/i,
  /page\s*(you('?re)?\s*(looking\s*for\s*)?)?is\s*missing/i,
  /this\s*page\s*(has\s*been\s*)?(moved|removed|deleted)/i,
  /oops/i,
  /sorry.*page/i,
  /nothing\s*(here|found)/i,
];

/**
 * Patterns that indicate a 404 error in the page title
 */
const TITLE_ERROR_PATTERNS = [
  /404/i,
  /not\s*found/i,
  /page\s*not\s*found/i,
  /error/i,
  /missing/i,
  /oops/i,
];

/**
 * Minimum content length threshold - pages shorter than this are suspicious
 */
const MIN_CONTENT_LENGTH = 500;

/**
 * Confidence threshold for flagging as soft 404
 */
const SOFT_404_THRESHOLD = 0.5;

/**
 * Detects if a page is a soft 404 (returns 200 but shows error content)
 */
export function checkSoft404(
  body: string,
  title: string | null,
  statusCode: number
): Soft404CheckResult {
  // If it's already a real 404, not a soft 404
  if (statusCode === 404) {
    return { isSoft404: false, confidence: 0, reasons: [] };
  }

  // Only check pages that returned 200
  if (statusCode !== 200) {
    return { isSoft404: false, confidence: 0, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;

  // Check title for error patterns
  if (title) {
    for (const pattern of TITLE_ERROR_PATTERNS) {
      if (pattern.test(title)) {
        score += 0.4;
        reasons.push(`Title matches error pattern: "${title}"`);
        break;
      }
    }
  }

  // Check body for error patterns
  const bodyLower = body.toLowerCase();
  let bodyMatchCount = 0;
  for (const pattern of BODY_ERROR_PATTERNS) {
    if (pattern.test(bodyLower)) {
      bodyMatchCount++;
      if (bodyMatchCount === 1) {
        reasons.push(`Body contains error indicator`);
      }
    }
  }

  // Multiple body matches increase confidence
  if (bodyMatchCount > 0) {
    score += Math.min(0.3 + (bodyMatchCount * 0.1), 0.5);
  }

  // Check content length - very short pages are suspicious
  const contentLength = body.length;
  if (contentLength < MIN_CONTENT_LENGTH) {
    score += 0.2;
    reasons.push(`Short content length: ${contentLength} chars`);
  }

  // Check for empty or near-empty body
  const textContent = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (textContent.length < 100) {
    score += 0.3;
    reasons.push(`Very little text content: ${textContent.length} chars`);
  }

  const confidence = Math.min(score, 1);
  const isSoft404 = confidence >= SOFT_404_THRESHOLD;

  return {
    isSoft404,
    confidence,
    reasons,
  };
}

/**
 * Compares two titles to check if they're similar enough
 * Returns true if titles match (accounting for minor differences)
 */
export function titlesMatch(
  sourceTitle: string | null,
  destTitle: string | null
): boolean {
  // Both null or empty - consider as match
  if (!sourceTitle && !destTitle) {
    return true;
  }

  // One is null/empty, other isn't - mismatch
  if (!sourceTitle || !destTitle) {
    return false;
  }

  // Normalize titles for comparison
  const normalize = (title: string) =>
    title
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();

  const normalizedSource = normalize(sourceTitle);
  const normalizedDest = normalize(destTitle);

  // Exact match after normalization
  if (normalizedSource === normalizedDest) {
    return true;
  }

  // Check if one contains the other (for added site names, etc.)
  if (
    normalizedDest.includes(normalizedSource) ||
    normalizedSource.includes(normalizedDest)
  ) {
    return true;
  }

  // Calculate similarity (basic Levenshtein distance check)
  const similarity = calculateSimilarity(normalizedSource, normalizedDest);
  return similarity > 0.8; // 80% similar
}

/**
 * Calculates string similarity using Sørensen–Dice coefficient
 */
function calculateSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substring(i, i + 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) || 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substring(i, i + 2);
    const count = bigrams1.get(bigram) || 0;
    if (count > 0) {
      bigrams1.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (s1.length + s2.length - 2);
}
