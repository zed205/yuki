/**
 * Lenient, line-ending-aware unified-diff parser & applier for the `patch`
 * tool.
 *
 * Why this exists
 * ---------------
 * The LLM emits unified diffs with a number of conventions that the stock
 * `diff` package does not tolerate:
 *
 *   1. **Bare `@@` headers** — the model frequently omits the
 *      `-start,count +start,count` line numbers and writes just `@@`.
 *      `diff.parsePatch` silently produces *zero* hunks for that, so
 *      `applyPatch` returns the source unchanged and the tool reports a
 *      false success (a silent no-op).
 *   2. **Missing `---`/`+++` file headers** — often omitted entirely.
 *   3. **CRLF / LF / CR mismatches** — the file on disk may use CRLF while
 *      the diff uses LF (or vice versa), so byte-exact context comparison
 *      fails.
 *
 * This module fixes all three by:
 *   - normalising both the source and the patch to LF before comparison,
 *   - treating `@@` headers as optional (context-searching when no line
 *     numbers are given),
 *   - tolerating missing file headers,
 *   - re-applying the *original* file's line-ending style and BOM on output,
 *   - never silently no-op'ing: it reports whether anything changed and
 *     returns precise diagnostics when a hunk cannot be located.
 */

import { normalizeLineEndings, matchFileLineEndings, preserveBom } from './line-endings';

export interface ParsedHunk {
  /** Declared start line in the old file (1-based), or null if omitted. */
  oldStart: number | null;
  /** Declared count of old lines, or null if omitted. */
  oldCount: number | null;
  /** The old-side lines: context (` `) and removal (`-`) lines, in order. */
  oldLines: string[];
  /** The new-side lines: context (` `) and addition (`+`) lines, in order. */
  newLines: string[];
  /** The 1-based line in the *patch text* where this hunk started (for diagnostics). */
  patchLine: number;
}

export interface PatchParseResult {
  hunks: ParsedHunk[];
  /** True when the patch was a valid, parseable diff (>=1 hunk). */
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  reason?: string;
}

export interface PatchApplyResult {
  ok: boolean;
  /** The new file content (line endings already re-applied to the source's style). */
  content?: string;
  /** Whether at least one hunk changed the file. */
  changed: boolean;
  /** Number of hunks successfully applied. */
  appliedHunks: number;
  /** Total hunks parsed. */
  totalHunks: number;
  /** Error message when `ok` is false. */
  error?: string;
}

/**
 * Parse a unified diff into hunks.
 *
 * Tolerates: bare `@@` headers, missing `---`/`+++` headers, trailing text
 * after the closing `@@` (e.g. a function context comment), and any line
 * ending style.
 */
export function parseUnifiedDiff(patchText: string): PatchParseResult {
  const lines = normalizeLineEndings(patchText).split('\n');
  const hunks: ParsedHunk[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // A hunk header is any line starting with @@. We accept:
    //   @@                                    (bare — no line numbers)
    //   @@ -L,C +L,C @@
    //   @@ -L +L @@
    //   @@ -L,C +L,C @@ trailing function context
    if (!line.startsWith('@@')) {
      i++; // skip file headers (---/+++), Index:, diff metadata, etc.
      continue;
    }

    // Best-effort extraction of the declared old start/count. The regex is
    // deliberately permissive; when numbers are absent we get nulls and rely
    // on context searching.
    let oldStart: number | null = null;
    let oldCount: number | null = null;
    const numeric = /@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/.exec(line);
    if (numeric) {
      oldStart = parseInt(numeric[1], 10);
      oldCount = numeric[2] ? parseInt(numeric[2], 10) : null;
    }

    const oldLines: string[] = [];
    const newLines: string[] = [];
    const patchLine = i + 1; // 1-based line in the patch text (diagnostics)
    i++; // move past the header

    // Consume the hunk body: lines starting with ' ', '-', or '+' (or an
    // empty line, which in a diff means an empty context line).
    while (i < lines.length) {
      const body = lines[i];
      // A '---' line only starts a new file section when it is followed by a
      // '+++' line and then a '@@' header — otherwise it is hunk content
      // (e.g. a removed line that itself begins with --).
      if (
        /^---/.test(body) &&
        i + 2 < lines.length &&
        lines[i + 1].startsWith('+++') &&
        lines[i + 2].startsWith('@@')
      ) {
        break;
      }
      if (body.startsWith('@@')) break; // next hunk

      if (body.length === 0) {
        // An empty line is an empty context line, unless it is clearly a
        // separator: the final split artefact, directly followed by the
        // next @@ header, or the hunk already reached its declared
        // old-line count.
        if (
          i === lines.length - 1 ||
          (lines[i + 1] !== undefined && lines[i + 1].startsWith('@@')) ||
          (oldCount !== null && oldLines.length >= oldCount)
        ) {
          break;
        }
        oldLines.push('');
        newLines.push('');
        i++;
        continue;
      }

      const prefix = body[0];
      if (prefix === ' ' || prefix === '-' || prefix === '+') {
        const content = body.slice(1);
        if (prefix === ' ') {
          oldLines.push(content);
          newLines.push(content);
        } else if (prefix === '-') {
          oldLines.push(content);
        } else {
          newLines.push(content);
        }
        i++;
      } else {
        // Not a recognised hunk body line; stop consuming this hunk.
        break;
      }
    }

    // A hunk with no old-side lines at all (pure insertion with no context)
    // is still valid if it has new lines.
    if (oldLines.length > 0 || newLines.length > 0) {
      hunks.push({ oldStart, oldCount, oldLines, newLines, patchLine });
    }
  }

  if (hunks.length === 0) {
    return {
      hunks,
      ok: false,
      reason:
        'No diff hunks found. Expected at least one hunk beginning with a @@ line ' +
        '(e.g. "@@ -1,3 +1,4 @@" or a bare "@@").',
    };
  }

  return { hunks, ok: true };
}

/**
 * Find the location of `pattern` (the old-side lines) within `lines`.
 *
 * The match must be **exact** (all inputs are already normalised to LF): every
 * pattern line must equal the corresponding file line. We deliberately do NOT
 * fall back to a "close enough" fuzzy match — applying a hunk at a
 * partially-matching location silently corrupts the file (especially for
 * removal hunks, which would delete the wrong lines) while still reporting a
 * success. Failing loudly and telling the model which lines did not match is
 * strictly better: it can re-read the file and retry with the exact content.
 *
 * Strategy:
 *   1. If `hint` (a 0-based preferred index) is given and the pattern matches
 *      exactly there, use it.
 *   2. Otherwise scan all valid start positions and collect every exact match.
 *      If exactly one exists, use it; if several, prefer the one closest to
 *      `hint` (or the first when there is no hint).
 *   3. Otherwise return -1 so the caller fails loudly with diagnostics.
 *
 * Returns the 0-based start index, or -1 when no exact match exists.
 */
function findPattern(
  lines: string[],
  pattern: string[],
  hint: number | null,
): number {
  if (pattern.length === 0) {
    // Pure insertion: insert at the hinted position (or the end).
    if (hint !== null && hint >= 0 && hint <= lines.length) return hint;
    return lines.length;
  }

  const maxStart = lines.length - pattern.length;
  if (maxStart < 0) return -1;

  // 1. Exact match at the hint.
  if (hint !== null && hint >= 0 && hint <= maxStart && exactMatch(lines, pattern, hint)) {
    return hint;
  }

  // 2. Scan for exact matches.
  const exact: number[] = [];
  for (let start = 0; start <= maxStart; start++) {
    if (exactMatch(lines, pattern, start)) exact.push(start);
  }

  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    if (hint === null) return exact[0];
    return exact.reduce((best, idx) => (Math.abs(idx - hint) < Math.abs(best - hint) ? idx : best));
  }

  // 3. No exact match: fail loudly (do NOT fuzzy-match to a wrong location).
  return -1;
}

function exactMatch(lines: string[], pattern: string[], start: number): boolean {
  for (let k = 0; k < pattern.length; k++) {
    if (lines[start + k] !== pattern[k]) return false;
  }
  return true;
}

/**
 * Apply a unified diff (as text) to a source string.
 *
 * Both inputs are normalised to LF for comparison. The returned content uses
 * the *source's* original line-ending style and BOM (if any).
 *
 * This never silently no-ops:
 *   - an unparseable patch returns `ok:false` with a reason;
 *   - a hunk that cannot be located returns `ok:false` with diagnostics;
 *   - a parseable patch that changes nothing returns `ok:true, changed:false`.
 */
export function applyUnifiedDiff(source: string, patchText: string): PatchApplyResult {
  const parse = parseUnifiedDiff(patchText);
  if (!parse.ok) {
    return {
      ok: false,
      changed: false,
      appliedHunks: 0,
      totalHunks: 0,
      error: parse.reason,
    };
  }

  // Work in normalised (LF) space. Remember the raw source for BOM + style.
  const rawSource = source;
  let lines = normalizeLineEndings(source).split('\n');
  const totalHunks = parse.hunks.length;
  let appliedHunks = 0;
  let changed = false;

  // Cumulative offset (in lines) applied to subsequent hunks' hints.
  let offset = 0;

  for (let h = 0; h < parse.hunks.length; h++) {
    const hunk = parse.hunks[h];

    // A hunk with no old-side lines is a pure insertion.
    if (hunk.oldLines.length === 0) {
      let insertAt: number;
      if (hunk.oldStart !== null) {
        // Git convention: with an empty old side, the "start line" l
        // means "after line l" (l = 0 � top of the file), matching
        // headers like "@@ -1,0 +2,1 @@".
        const base = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
        insertAt = Math.max(0, base + offset);
      } else {
        // Bare @@ pure insertion: append at the end.
        insertAt = lines.length;
      }
      const clamped = Math.min(insertAt, lines.length);
      lines = lines.slice(0, clamped).concat(hunk.newLines).concat(lines.slice(clamped));
      offset += hunk.newLines.length;
      appliedHunks++;
      changed = true;
      continue;
    }

    // The hint is the declared old start (1-based) adjusted for earlier hunks.
    const hint = hunk.oldStart !== null ? hunk.oldStart - 1 + offset : null;
    const start = findPattern(lines, hunk.oldLines, hint);

    if (start === -1) {
      return {
        ok: false,
        changed,
        appliedHunks,
        totalHunks,
        error: describeMismatch(h, hunk, lines, hint),
      };
    }

    // Splice: replace the matched old lines with the new lines.
    lines = lines
      .slice(0, start)
      .concat(hunk.newLines)
      .concat(lines.slice(start + hunk.oldLines.length));
    offset += hunk.newLines.length - hunk.oldLines.length;
    appliedHunks++;
    if (hunk.newLines.length !== hunk.oldLines.length || hunk.newLines.join('\n') !== hunk.oldLines.join('\n')) {
      changed = true;
    }
  }

  let out = lines.join('\n');
  out = matchFileLineEndings(rawSource, out);
  out = preserveBom(rawSource, out);

  return { ok: true, content: out, changed, appliedHunks, totalHunks };
}

/**
 * Build a helpful error message explaining why a hunk could not be applied.
 * Shows the expected old-side lines and the actual lines near the best guess.
 */
function describeMismatch(
  index: number,
  hunk: ParsedHunk,
  lines: string[],
  hint: number | null,
): string {
  const around = 3;
  // Pick a centre to show actual lines from.
  let centre = hint !== null && hint >= 0 ? hint : 0;
  if (centre >= lines.length) centre = Math.max(0, lines.length - 1);
  const from = Math.max(0, centre - around);
  const to = Math.min(lines.length, centre + around + 1);
  const actual = lines
    .slice(from, to)
    .map((l, i) => `  ${from + i + 1}: ${JSON.stringify(l)}`)
    .join('\n');

  const expected = hunk.oldLines
    .slice(0, 8)
    .map((l) => `  - ${JSON.stringify(l)}`)
    .join('\n');

  const hintText =
    hunk.oldStart !== null
      ? ` (declared old start line ${hunk.oldStart})`
      : ' (no line numbers declared — searched by context)';

  return (
    `Patch hunk ${index + 1} could not be located in the file${hintText}.\n` +
    `Line endings are already normalised automatically, so this mismatch is NOT ` +
    `a CRLF/LF problem — the old-side lines (context + removals) must match the ` +
    `file byte-for-byte, including indentation/whitespace.\n` +
    `Expected old-side lines (context + removals):\n${expected}\n` +
    `Actual file lines around line ${centre + 1}:\n${actual}\n` +
    `Re-read the file (read tool) to get the exact current content and retry ` +
    `with the verbatim lines — do not add or strip indentation.`
  );
}

/**
 * Convenience wrapper that mirrors the old `applyPatch(source, patch)`
 * contract: returns the new content string on success, or `false` when the
 * patch cannot be applied. Kept so call sites can stay simple, but prefer
 * {@link applyUnifiedDiff} for its richer result.
 */
export function applyUnifiedDiffLoose(source: string, patchText: string): string | false {
  const result = applyUnifiedDiff(source, patchText);
  return result.ok && result.content !== undefined ? result.content : false;
}
