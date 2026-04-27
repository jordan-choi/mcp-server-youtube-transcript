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

  // Reduce rolling auto-caption cues into a non-overlapping sequence.
  // YouTube's auto-captions are streamed as overlapping rolling cues — each
  // cue contains the tail of the previous one plus a few new words. Naive
  // concatenation produces 3-4x duplication; collapsing into one giant cue
  // (the previous approach) loses the per-segment timestamps the formatter
  // and the ad-strip filter both rely on.
  //
  // We keep one cue per *new* chunk of text. For each incoming cue we
  // compute how many trailing words of what we've already kept reappear at
  // the start of the cue; everything past that prefix is genuinely new and
  // becomes its own cue with the incoming cue's start time. Cues that
  // introduce no new words (fully contained as a suffix of our running
  // text) are absorbed by extending the previous cue's duration.
  const kept: TranscriptLine[] = [];
  const cumulativeWords: string[] = [];

  for (const cue of cues) {
    const cueWords = cue.text.split(/\s+/).filter(Boolean);
    if (cueWords.length === 0) continue;

    const last = kept[kept.length - 1];

    if (last && last.text === cue.text) {
      // Exact duplicate — keep the earlier cue, extend its duration.
      kept[kept.length - 1] = {
        text: last.text,
        start: last.start,
        dur: Math.max(last.dur, cue.start + cue.dur - last.start),
      };
      continue;
    }

    const overlap = wordSuffixPrefixOverlap(cumulativeWords, cueWords);

    if (overlap >= MIN_ROLLING_OVERLAP_WORDS) {
      const newWords = cueWords.slice(overlap);
      if (newWords.length === 0) {
        // Fully contained — extend the last kept cue's duration.
        if (last) {
          kept[kept.length - 1] = {
            text: last.text,
            start: last.start,
            dur: Math.max(last.dur, cue.start + cue.dur - last.start),
          };
        }
        continue;
      }
      kept.push({
        text: newWords.join(" "),
        start: cue.start,
        dur: cue.dur,
      });
      for (const w of newWords) cumulativeWords.push(w);
    } else {
      kept.push(cue);
      for (const w of cueWords) cumulativeWords.push(w);
    }
  }

  return kept;
}

/**
 * Minimum word overlap to treat as a rolling caption. A single shared word
 * is too weak a signal — could be a coincidence — and trimming it would risk
 * eating real content from the start of the new cue.
 */
const MIN_ROLLING_OVERLAP_WORDS = 2;

/**
 * How far back into the running cumulative text we'll look for an overlap.
 * Real rolling-caption windows are short (a sentence or so); bounding the
 * search keeps this O(N) overall instead of quadratic in transcript length.
 */
const ROLLING_LOOKBACK_WORDS = 50;

/**
 * Returns how many trailing words of `cumulative` appear verbatim at the
 * head of `current`. Returns 0 if there is no such match.
 */
function wordSuffixPrefixOverlap(
  cumulative: string[],
  current: string[],
): number {
  if (cumulative.length === 0 || current.length === 0) return 0;

  const lookback = Math.min(cumulative.length, ROLLING_LOOKBACK_WORDS);
  const max = Math.min(lookback, current.length);

  for (let n = max; n >= 1; n--) {
    let match = true;
    for (let i = 0; i < n; i++) {
      if (cumulative[cumulative.length - n + i] !== current[i]) {
        match = false;
        break;
      }
    }
    if (match) return n;
  }
  return 0;
}
