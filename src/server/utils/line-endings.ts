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
 * - Output: LF only for text that flows into the model context. For files on
 *   disk, tools preserve the file's existing line-ending style (see
 *   `matchFileLineEndings`) so an edit never flips a CRLF file to LF.
 * - No platform-specific `os.EOL` — the model context must be consistent
 *   regardless of the host OS.
 *
 * Exported API
 * ------------
 * - `normalizeLineEndings(text)` — CRLF/CR → LF
 * - `splitLines(text)` — split on any line ending, returns clean lines
 * - `trimLineEndings(text)` — trim leading/trailing whitespace *and* newlines
 * - `stripLeadingNewlines(text, count)` — strip exactly N leading newlines
 * - `detectLineEnding(text)` — dominant style: CRLF / LF / CR / none
 * - `convertLineEndings(text, style)` — re-encode text to a given style
 * - `matchFileLineEndings(original, newContent)` — keep a file's existing style
 * - `stripBom(text)` / `preserveBom(original, newText)` — BOM helpers
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

/**
 * The line-ending style detected in a string of text.
 *
 * - `CRLF` — Windows style (`\r\n`)
 * - `LF`   — Unix/macOS style (`\n`)
 * - `CR`   — legacy Mac style (`\r`)
 * - `none` — the text contains no line endings at all
 */
export type LineEndingStyle = 'CRLF' | 'LF' | 'CR' | 'none';

/**
 * Detect the dominant line-ending style in `text`.
 *
 * Counts CRLF, bare LF, and bare CR occurrences and returns the dominant
 * style.  Ties are resolved deterministically (CRLF > CR > LF) so the same
 * input always yields the same answer.
 *
 * Returns `'none'` for empty text or text with no line endings.
 */
export function detectLineEnding(text: string): LineEndingStyle {
  if (!text) return 'none';
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (ch === '\n') {
      lf++;
    }
  }
  if (crlf === 0 && lf === 0 && cr === 0) return 'none';
  if (crlf >= lf && crlf >= cr) return 'CRLF';
  if (cr > lf) return 'CR';
  return 'LF';
}

/**
 * Convert `text` to the given line-ending style.
 *
 * The input is first canonicalised to LF, then re-encoded as the target
 * style, so mixed-endings input always produces uniform output.
 *
 * `'none'` is treated as LF (i.e. the text is simply normalised).
 */
export function convertLineEndings(text: string, style: LineEndingStyle): string {
  const lf = normalizeLineEndings(text);
  if (style === 'CRLF') return lf.replace(/\n/g, '\r\n');
  if (style === 'CR') return lf.replace(/\n/g, '\r');
  return lf;
}

/**
 * Reconcile newly produced (LF) content with the line-ending style of an
 * existing file.
 *
 * If `original` is predominantly CRLF or CR, `newContent` is converted to
 * that style so the file keeps a uniform, pre-existing convention.  For LF,
 * mixed, or empty `original` the content is written with LF endings (the
 * project standard).
 *
 * This is what makes `edit`/`patch`/`write` transparent to line endings:
 * callers always work in LF and the file on disk keeps its own style.
 */
export function matchFileLineEndings(original: string, newContent: string): string {
  const style = detectLineEnding(original);
  if (style === 'CRLF' || style === 'CR') {
    return convertLineEndings(newContent, style);
  }
  return normalizeLineEndings(newContent);
}

const BOM = '\uFEFF';

/**
 * Strip a leading UTF-8 BOM if present (no-op otherwise).
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Preserve a pre-existing BOM when replacing file content.
 *
 * If `original` started with a BOM and `newText` does not, the BOM is
 * re-prepended so the file's encoding marker survives in-place edits.
 */
export function preserveBom(original: string, newText: string): string {
  if (original.startsWith(BOM) && !newText.startsWith(BOM)) return BOM + newText;
  return newText;
}
