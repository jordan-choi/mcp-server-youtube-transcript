// Render TranscriptLine[] into the text the MCP tool returns.
//
// Two modes:
//   - Without timestamps: every line's text joined with single spaces.
//   - With timestamps: lines are grouped into *sentences* and each sentence
//     is prefixed with the start time of the cue where the sentence began.
//     This avoids the per-cue confetti the previous formatter produced
//     (every ~1-2 seconds a fresh `[m:ss]` interrupting mid-thought).
//
// Sentence detection splits on the first `.`, `?`, or `!` followed by
// whitespace or end-of-text. To stay readable when auto-captions have no
// punctuation at all, we also force a break if a sentence accumulates more
// than SENTENCE_SOFT_CAP_SECONDS of cue time without a terminator.

import type { TranscriptLine } from "./vtt-parser.js";

const SENTENCE_TERMINATOR = /[.?!]+(?=\s|$)/;
const SENTENCE_SOFT_CAP_SECONDS = 30;

interface SentenceGroup {
  start: number;
  text: string;
}

/**
 * Format a transcript for the MCP tool response.
 */
export function formatTranscript(
  transcript: TranscriptLine[],
  includeTimestamps: boolean,
): string {
  const cleaned = transcript
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter((line) => line.text.length > 0);

  if (!includeTimestamps) {
    return cleaned.map((l) => l.text).join(" ");
  }

  return groupBySentence(cleaned)
    .map((g) => `${formatTimestamp(g.start)} ${g.text}`)
    .join("\n");
}

/**
 * Walk lines accumulating text until a sentence terminator is reached, then
 * emit a group anchored at the start time of the cue where the sentence
 * began. Lines without terminators get folded into the current group; if
 * that group ever exceeds the soft cap in cue-time span, we flush early.
 */
function groupBySentence(lines: TranscriptLine[]): SentenceGroup[] {
  const groups: SentenceGroup[] = [];
  let buffer = "";
  let groupStart: number | null = null;

  const flush = () => {
    const text = buffer.replace(/\s+/g, " ").trim();
    if (text.length > 0 && groupStart !== null) {
      groups.push({ start: groupStart, text });
    }
    buffer = "";
    groupStart = null;
  };

  for (const line of lines) {
    let remaining = line.text;

    // Drain every complete sentence inside this line.
    while (remaining.length > 0) {
      const match = SENTENCE_TERMINATOR.exec(remaining);
      if (!match) break;

      const splitAt = match.index + match[0].length;
      const sentenceTail = remaining.slice(0, splitAt).trim();
      remaining = remaining.slice(splitAt).trim();

      if (groupStart === null) groupStart = line.start;
      buffer = buffer ? `${buffer} ${sentenceTail}` : sentenceTail;
      flush();
    }

    // Whatever's left of the line is a partial sentence — fold it into the
    // current group and possibly soft-cap-flush.
    if (remaining.length > 0) {
      if (groupStart === null) groupStart = line.start;
      buffer = buffer ? `${buffer} ${remaining}` : remaining;

      if (line.start - groupStart > SENTENCE_SOFT_CAP_SECONDS) {
        flush();
      }
    }
  }

  flush();
  return groups;
}

function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  // Use h:mm:ss for videos > 1 hour, mm:ss otherwise
  if (h > 0) {
    return `[${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}]`;
  }
  return `[${m}:${s.toString().padStart(2, "0")}]`;
}
