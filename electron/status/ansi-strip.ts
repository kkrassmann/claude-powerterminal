/**
 * ANSI escape code stripping utility.
 *
 * Removes ANSI escape sequences from terminal output before pattern matching.
 * Handles CSI sequences, OSC sequences, and single-character escapes.
 */

// CSI sequences: ESC [ ... final_byte
const CSI_REGEX = /[\u001b\u009b]\[[\d;]*[A-Za-z]/g;

// OSC sequences: ESC ] ... BEL  or  ESC ] ... ESC backslash
const OSC_REGEX = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

// DEC private mode sequences: ESC [ ? digits h/l (e.g., synchronized output mode)
const DEC_REGEX = /\u001b\[\?\d+[hl]/g;

// Single-char escapes and remaining escape sequences
const ESC_REGEX = /\u001b[^[\]].?/g;

/**
 * Extract window title from OSC sequence (ESC ] 0 ; title BEL).
 * Returns null if no title sequence found.
 */
export function extractWindowTitle(text: string): string | null {
  const match = text.match(/\u001b\]0;([^\u0007\u001b]*?)(?:\u0007|\u001b\\)/);
  return match ? match[1] : null;
}

/**
 * Strip all ANSI/OSC escape codes from a string.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(OSC_REGEX, '')
    .replace(DEC_REGEX, '')
    .replace(CSI_REGEX, '')
    .replace(ESC_REGEX, '');
}
