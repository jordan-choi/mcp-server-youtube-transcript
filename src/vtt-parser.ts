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

  // Merge rolling auto-caption cues. YouTube's auto-captions are streamed as
  // overlapping rolling cues — each cue contains the tail of the previous
  // one plus a few new words, so naive concatenation produces massive
  // duplication. We collapse these by detecting word-level overlap between
  // adjacent cues.
  const merged: TranscriptLine[] = [];
  for (const cue of cues) {
    const last = merged[merged.length - 1];

    if (!last) {
      merged.push(cue);
      continue;
    }

    if (last.text === cue.text) {
      // Exact duplicate — keep the earlier cue and extend its duration to
      // cover the later one.
      merged[merged.length - 1] = {
        text: last.text,
        start: last.start,
        dur: Math.max(last.dur, cue.start + cue.dur - last.start),
      };
      continue;
    }

    const rolled = mergeRolling(last, cue);
    if (rolled) {
      merged[merged.length - 1] = rolled;
      continue;
    }

    merged.push(cue);
  }

  return merged;
}

/**
 * Minimum word overlap to call two adjacent cues a rolling pair. Below this
 * threshold the overlap is more likely a coincidence than a rolling caption,
 * and merging would risk eating real content.
 */
const MIN_ROLLING_OVERLAP_WORDS = 2;

/**
 * If `current.text` starts with a multi-word suffix of `prev.text` (≥
 * MIN_ROLLING_OVERLAP_WORDS), treat them as a rolling auto-caption pair and
 * return a single merged cue. The merged cue keeps prev's start time and
 * extends through current's end time; its text is prev's text followed by
 * only the new words from current.
 *
 * Returns null if no qualifying overlap is found, in which case the caller
 * should keep both cues separate.
 */
function mergeRolling(
  prev: TranscriptLine,
  current: TranscriptLine,
): TranscriptLine | null {
  const prevWords = prev.text.split(/\s+/).filter(Boolean);
  const currWords = current.text.split(/\s+/).filter(Boolean);
  const maxOverlap = Math.min(prevWords.length, currWords.length);

  for (let n = maxOverlap; n >= MIN_ROLLING_OVERLAP_WORDS; n--) {
    const prevSuffix = prevWords.slice(prevWords.length - n).join(" ");
    const currPrefix = currWords.slice(0, n).join(" ");
    if (prevSuffix === currPrefix) {
      const newWords = prevWords.concat(currWords.slice(n));
      return {
        text: newWords.join(" "),
        start: prev.start,
        dur: Math.max(prev.dur, current.start + current.dur - prev.start),
      };
    }
  }

  return null;
}
