import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseVtt } from "../src/vtt-parser.ts";

describe("parseVtt", () => {
  it("returns [] for empty input", () => {
    assert.deepEqual(parseVtt(""), []);
    assert.deepEqual(parseVtt("   \n\t\n"), []);
  });

  it("returns [] when the WEBVTT header is missing", () => {
    const noHeader = `00:00:00.000 --> 00:00:02.000
hello world`;
    assert.deepEqual(parseVtt(noHeader), []);
  });

  it("parses a single basic cue", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.500
hello world
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "hello world");
    assert.equal(result[0].start, 0);
    assert.equal(result[0].dur, 2.5);
  });

  it("parses multiple cues with start and dur", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
first

00:00:02.500 --> 00:00:05.000
second

00:00:05.000 --> 00:00:07.250
third
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 3);
    assert.equal(result[0].text, "first");
    assert.equal(result[1].start, 2.5);
    assert.equal(result[1].dur, 2.5);
    assert.equal(result[2].text, "third");
    assert.equal(result[2].start, 5);
  });

  it("parses h:mm:ss.mmm timestamps for videos longer than an hour", () => {
    const vtt = `WEBVTT

01:23:45.000 --> 01:23:47.000
late in the video
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    // 1h 23m 45s = 5025s
    assert.equal(result[0].start, 5025);
    assert.equal(result[0].dur, 2);
  });

  it("strips inline timestamp tags inside cue text", () => {
    const vtt = `WEBVTT

00:00:00.040 --> 00:00:02.519
hello<00:00:00.500> world<00:00:01.500>
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "hello world");
  });

  it("strips <c> karaoke tags", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
<c>colored</c> text<c.color1234> styled</c>
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "colored text styled");
  });

  it("ignores positioning metadata lines", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000 align:start position:0%
visible text
align:start
position:0%

00:00:02.500 --> 00:00:04.000
second cue
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "visible text");
    assert.equal(result[1].text, "second cue");
  });

  it("collapses adjacent cues with identical text (rolling auto-captions)", () => {
    // yt-dlp's auto-caption output has overlapping rolling cues that
    // resolve to the same cleaned text after stripping inline tags.
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
hello world

00:00:01.000 --> 00:00:02.000
hello world

00:00:02.000 --> 00:00:03.000
hello there

00:00:03.000 --> 00:00:04.000
hello there
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "hello world");
    assert.equal(result[1].text, "hello there");
    // First-occurrence start time should win
    assert.equal(result[0].start, 0);
    assert.equal(result[1].start, 2);
  });

  it("does NOT collapse non-adjacent identical cues", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
A

00:00:01.000 --> 00:00:02.000
B

00:00:02.000 --> 00:00:03.000
A
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 3);
    assert.deepEqual(result.map((l) => l.text), ["A", "B", "A"]);
  });

  it("handles cues with no trailing newline at end of file", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
last cue without newline`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "last cue without newline");
  });

  it("handles mixed CRLF and LF line endings", () => {
    const vtt = "WEBVTT\r\n\r\n00:00:00.000 --> 00:00:02.000\r\nhello\r\n";
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "hello");
  });

  it("preserves non-Latin characters", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
안녕하세요

00:00:02.000 --> 00:00:04.000
こんにちは
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "안녕하세요");
    assert.equal(result[1].text, "こんにちは");
  });

  it("joins multi-line cue text with a single space", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:04.000
first line
second line
third line
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "first line second line third line");
  });

  it("skips a NOTE block before the first cue", () => {
    const vtt = `WEBVTT

NOTE
This is a comment block
that should be ignored.

00:00:00.000 --> 00:00:02.000
real content
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "real content");
  });

  it("never returns negative durations", () => {
    // Defensive: malformed VTT could in theory emit end < start.
    const vtt = `WEBVTT

00:00:05.000 --> 00:00:03.000
broken
`;
    const result = parseVtt(vtt);
    assert.equal(result.length, 1);
    assert.equal(result[0].dur, 0);
  });
});
