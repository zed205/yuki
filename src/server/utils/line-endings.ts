/**
 * Centralized line ending handling for the Yuki agent.
 *
 * All text input from external sources (files, shell output, LLM responses,
 * browser content, etc.) should be normalized to LF (`\n`) through this module
 * before any further processing.  All internal string construction already uses
 * LF, so the output side needs no changes.
 *
 * Design decisions
 * ----------------
 * - Input:  CRLF, CR, and LF are all accepted and canonicalised to LF.
 * - Output: LF only (the rest of the codebase already does this).
 * - No platform-specific `os.EOL` — the model context must be consistent
 *   regardless of the host OS.
 *
 * Exported API
 * ------------
 * - `normalizeLineEndings(text)` — CRLF/CR → LF
 * - `splitLines(text)` — split on any line ending, returns clean lines
 * - `trimLineEndings(text)` — trim leading/trailing whitespace *and* newlines
 * - `stripLeadingNewlines(text, count)` — strip exactly N leading newlines
 *
 * Usage pattern
 * -------------
 *   const raw = fs.readFileSync(path, 'utf-8');
 *   const content = normalizeLineEndings(raw);   // ← do this FIRST
 *   const lines = content.split('\n');           // ← now safe to split on \n
 */

/**
 * Canonicalise all line-ending styles to LF (`\n`).
 *
 * Handles:
 *   CRLF (\r\n) → LF
 *   CR (\r)     → LF  (old-Mac style, uncommon but possible)
 *   LF (\n)     → LF  (no-op)
 *
 * Order matters: replace CRLF *before* bare CR to avoid double-conversion.
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Split text on any line-ending style.
 *
 * Equivalent to `normalizeLineEndings(text).split('\n')` but slightly more
 * efficient because it avoids creating an intermediate string.
 *
 * Returns clean lines — no trailing `\r` or other whitespace.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Trim leading and trailing whitespace **and** line-break characters.
 *
 * Unlike `String.prototype.trim()`, this also removes stray `\r` characters
 * that may be embedded in text content (e.g. from Windows file reads).
 *
 * Returns a new string with all leading/trailing spaces, tabs, `\r`, `\n`,
 * and Unicode line/paragraph separators removed.
 */
export function trimLineEndings(text: string): string {
  return text.replace(/^[\t \r\n\u2028\u2029]+/, '').replace(/[\t \r\n\u2028\u2029]+$/, '');
}

/**
 * Strip exactly `count` leading newline characters (LF) from `text`.
 *
 * This is a safe replacement for patterns like `text.replace(/^\n{N}/, '')`
 * because it operates on already-normalised LF-only text.
 */
export function stripLeadingNewlines(text: string, count: number): string {
  if (count <= 0) return text;
  const regex = new RegExp(`^\\n{${count}}`);
  return text.replace(regex, '');
}
