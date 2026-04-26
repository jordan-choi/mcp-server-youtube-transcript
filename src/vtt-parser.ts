// VTT cleanup adapted from https://github.com/anaisbetts/mcp-youtube
// Original Copyright (c) Ani Betts, MIT License
//
// The original `stripVttNonContent` returned cleaned text only. This version
// is structured around individual cue blocks so we can also emit per-cue
// `start` / `dur` timestamps — required to keep our existing rendering
// (timestamp prefixing, ad-chapter filtering) working unchanged.

export interface TranscriptLine {
  text: string;
  start: number; // seconds since video start
  dur: number; // seconds
}

const TIMESTAMP_RE =
  /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

/**
 * Convert a VTT timestamp into seconds.
 */
function toSeconds(h: string, m: string, s: string, ms: string): number {
  return (
    parseInt(h, 10) * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms, 10) / 1000
  );
}

/**
 * Strip the inline annotations YouTube embeds inside auto-caption cues:
 *   - inline timestamp tags like `<00:00:07.759>`
 *   - karaoke-style colour tags like `<c>` and `</c.colorE5E5E5>`
 * Returns the visible text only, trimmed.
 */
function cleanCueText(line: string): string {
  return line
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
    .replace(/<\/?c[^>]*>/g, "")
    .trim();
}

/**
 * Parse a WebVTT subtitle file into a list of `{ text, start, dur }` cues.
 *
 * Returns an empty array for empty input or input that doesn't look like VTT
 * (no `WEBVTT` header). Adjacent cues with identical text are collapsed —
 * yt-dlp's auto-caption output is built from rolling captions and emits the
 * same line many times in a row.
 */
export function parseVtt(vtt: string): TranscriptLine[] {
  if (!vtt || vtt.trim() === "") return [];

  const lines = vtt.split(/\r?\n/);
  if (!lines.some((line) => line.includes("WEBVTT"))) return [];

  const cues: TranscriptLine[] = [];
  let cueStart: number | null = null;
  let cueEnd: number | null = null;
  let cueTextParts: string[] = [];

  const flush = () => {
    if (cueStart !== null && cueEnd !== null && cueTextParts.length > 0) {
      const text = cueTextParts.join(" ").replace(/\s+/g, " ").trim();
      if (text) {
        cues.push({
          text,
          start: cueStart,
          dur: Math.max(0, cueEnd - cueStart),
        });
      }
    }
    cueStart = null;
    cueEnd = null;
    cueTextParts = [];
  };

  for (const raw of lines) {
    const match = raw.match(TIMESTAMP_RE);

    if (match) {
      // New cue header. Flush any cue we were collecting.
      flush();
      cueStart = toSeconds(match[1], match[2], match[3], match[4]);
      cueEnd = toSeconds(match[5], match[6], match[7], match[8]);
      continue;
    }

    if (raw.trim() === "") {
      // Blank line ends the current cue.
      flush();
      continue;
    }

    if (cueStart === null) {
      // Header lines, NOTE blocks, cue identifiers — skip until we see a
      // timestamp line.
      continue;
    }

    // Skip positioning metadata that occasionally trails timestamp lines
    // on its own row (e.g. "align:start position:0%").
    if (/^\s*(align|position):/i.test(raw)) {
      continue;
    }

    const cleaned = cleanCueText(raw);
    if (cleaned) cueTextParts.push(cleaned);
  }

  // End-of-file flush in case the last cue isn't followed by a blank line.
  flush();

  // Collapse adjacent duplicates (rolling auto-captions emit the same text
  // across many overlapping cues).
  const deduped: TranscriptLine[] = [];
  for (const cue of cues) {
    const last = deduped[deduped.length - 1];
    if (!last || last.text !== cue.text) {
      deduped.push(cue);
    }
  }

  return deduped;
}
