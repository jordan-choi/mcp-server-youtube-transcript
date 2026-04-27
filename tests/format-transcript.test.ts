import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatTranscript } from "../src/format-transcript.ts";
import type { TranscriptLine } from "../src/vtt-parser.ts";

const line = (start: number, dur: number, text: string): TranscriptLine => ({
  start,
  dur,
  text,
});

describe("formatTranscript — without timestamps", () => {
  it("returns empty string for empty input", () => {
    assert.equal(formatTranscript([], false), "");
  });

  it("joins all line text with single spaces", () => {
    const out = formatTranscript(
      [
        line(0, 1, "hello"),
        line(1, 1, "world"),
        line(2, 1, "how are you"),
      ],
      false,
    );
    assert.equal(out, "hello world how are you");
  });

  it("trims each line and skips empty ones", () => {
    const out = formatTranscript(
      [
        line(0, 1, "  hello  "),
        line(1, 1, ""),
        line(2, 1, "  world"),
      ],
      false,
    );
    assert.equal(out, "hello world");
  });
});

describe("formatTranscript — with timestamps", () => {
  it("returns empty string for empty input", () => {
    assert.equal(formatTranscript([], true), "");
  });

  it("emits one anchor per sentence, not per cue", () => {
    // Three cues that together form two sentences.
    const out = formatTranscript(
      [
        line(0, 1, "hello world"),
        line(1, 1, "how are you?"),
        line(2, 1, "I am fine."),
      ],
      true,
    );
    assert.equal(out, "[0:00] hello world how are you?\n[0:02] I am fine.");
  });

  it("anchors each sentence at the start of the cue where it began", () => {
    // Cue 1 contains the end of a sentence + start of the next. Sentence 2's
    // anchor should be cue 1's start (where its first words appeared), not
    // some later cue.
    const out = formatTranscript(
      [
        line(1, 1, "first thought."),
        line(1, 1, "second thought goes"),
        line(3, 1, "across multiple cues."),
      ],
      true,
    );
    assert.equal(
      out,
      "[0:01] first thought.\n[0:01] second thought goes across multiple cues.",
    );
  });

  it("splits when one cue contains a sentence boundary mid-text", () => {
    // The terminator is mid-cue. Everything before it closes the running
    // sentence; everything after starts a new one anchored at this cue.
    const out = formatTranscript(
      [
        line(1, 2, "Have you noticed Claude's performance"),
        line(1, 2, "varying by day? Claude Opus 4.7 is a"),
        line(3, 2, "serious regression, not an upgrade."),
      ],
      true,
    );
    assert.equal(
      out,
      "[0:01] Have you noticed Claude's performance varying by day?\n[0:01] Claude Opus 4.7 is a serious regression, not an upgrade.",
    );
  });

  it("handles ! and ? terminators alongside .", () => {
    const out = formatTranscript(
      [
        line(0, 1, "Wow!"),
        line(1, 1, "Really?"),
        line(2, 1, "Yes."),
      ],
      true,
    );
    assert.equal(out, "[0:00] Wow!\n[0:01] Really?\n[0:02] Yes.");
  });

  it("does not split on a period that is not a sentence terminator", () => {
    // "4.7" has a `.` but it is followed by a digit, not whitespace or EOS.
    // Our SENTENCE_TERMINATOR regex requires the trailing context, so the
    // sentence stays intact.
    const out = formatTranscript(
      [
        line(0, 2, "Claude Opus 4.7 is here."),
      ],
      true,
    );
    assert.equal(out, "[0:00] Claude Opus 4.7 is here.");
  });

  it("force-flushes a long un-punctuated run via the soft cap", () => {
    // Auto-captions occasionally arrive without any punctuation. We don't
    // want a single timestamp prefix for an entire 5-minute segment, so the
    // formatter flushes when a group exceeds SENTENCE_SOFT_CAP_SECONDS (30s)
    // of cue-time span.
    const lines: TranscriptLine[] = [];
    for (let t = 0; t <= 60; t += 5) {
      lines.push(line(t, 5, `chunk at ${t}`));
    }
    const out = formatTranscript(lines, true);
    const anchors = out
      .split("\n")
      .map((l) => l.match(/^\[(\d+):(\d{2})\]/))
      .filter((m): m is RegExpMatchArray => m !== null);
    // We expect more than one anchor, evenly-ish spaced — never a single
    // monolithic block for the whole minute.
    assert.ok(
      anchors.length >= 2,
      `expected at least 2 anchors, got ${anchors.length}: ${out}`,
    );
  });

  it("uses h:mm:ss timestamp format for videos longer than an hour", () => {
    const out = formatTranscript(
      [line(3725, 2, "Late in the video.")], // 1h 02m 05s
      true,
    );
    assert.equal(out, "[1:02:05] Late in the video.");
  });

  it("preserves non-Latin characters across sentence groups", () => {
    const out = formatTranscript(
      [
        line(0, 1, "안녕하세요. 반갑습니다."),
        line(2, 1, "오늘은 좋은 날입니다."),
      ],
      true,
    );
    assert.equal(
      out,
      "[0:00] 안녕하세요.\n[0:00] 반갑습니다.\n[0:02] 오늘은 좋은 날입니다.",
    );
  });

  it("groups the realistic field-bug fixture into readable sentences", () => {
    // Mirrors what parseVtt produces for KFisvc-AMII rolling captions —
    // many short cues, each ~5-10 words, with sentence boundaries scattered
    // mid-cue. The formatter should fuse them into sentence-level lines.
    const lines: TranscriptLine[] = [
      line(1, 1, "Have you noticed Claude's performance"),
      line(1, 2, "varying by day? Claude Opus 4.7 is a"),
      line(3, 2, "serious regression, not an upgrade."),
      line(5, 2, "AMD's AI director slams Claude for"),
      line(8, 1, "becoming dumber and lazier since last"),
      line(9, 3, "update. Opus 4.6 is getting dumber."),
      line(12, 1, "Cloud code performance regression with"),
      line(13, 2, "Opus 47 models. Quantified evidence."),
    ];
    const out = formatTranscript(lines, true);
    const expected = [
      "[0:01] Have you noticed Claude's performance varying by day?",
      "[0:01] Claude Opus 4.7 is a serious regression, not an upgrade.",
      "[0:05] AMD's AI director slams Claude for becoming dumber and lazier since last update.",
      "[0:09] Opus 4.6 is getting dumber.",
      "[0:12] Cloud code performance regression with Opus 47 models.",
      "[0:13] Quantified evidence.",
    ].join("\n");
    assert.equal(out, expected);
  });

  it("flushes any unterminated tail at end of input", () => {
    // Last sentence has no terminator; we still want it included.
    const out = formatTranscript(
      [
        line(0, 1, "First sentence."),
        line(1, 1, "Trailing fragment without period"),
      ],
      true,
    );
    assert.equal(
      out,
      "[0:00] First sentence.\n[0:01] Trailing fragment without period",
    );
  });
});
