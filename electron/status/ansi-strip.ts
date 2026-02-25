/**
 * ANSI escape code stripping utility.
 *
 * Removes ANSI escape sequences from terminal output before pattern matching.
 * Uses inline regex (MIT-licensed pattern from ansi-regex project).
 */

/**
 * Strip ANSI escape codes from a string.
 * Regex covers: CSI sequences, OSC sequences, and single-character escapes.
 * Source: https://github.com/chalk/ansi-regex (MIT licensed regex pattern)
 */
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}
