import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractAdChapters,
  extractCaptionTracks,
  extractMetadata,
  parseSponsorBlockResponse,
  YtDlpInfo,
} from "../src/youtube-fetcher.ts";

describe("extractAdChapters", () => {
  it("returns [] when chapters is missing", () => {
    assert.deepEqual(extractAdChapters({}), []);
  });

  it("returns [] when chapters is empty", () => {
    assert.deepEqual(extractAdChapters({ chapters: [] }), []);
  });

  it("returns [] when no chapter titles match an ad marker", () => {
    const info: YtDlpInfo = {
      chapters: [
        { start_time: 0, end_time: 30, title: "Intro" },
        { start_time: 30, end_time: 600, title: "Main content" },
        { start_time: 600, end_time: 900, title: "Outro" },
      ],
    };
    assert.deepEqual(extractAdChapters(info), []);
  });

  it("uses the chapter's own end_time when present", () => {
    const info: YtDlpInfo = {
      chapters: [
        { start_time: 0, end_time: 30, title: "Intro" },
        { start_time: 30, end_time: 90, title: "Squarespace (sponsor)" },
        { start_time: 90, end_time: 600, title: "Main content" },
      ],
    };
    const ads = extractAdChapters(info);
    assert.equal(ads.length, 1);
    assert.equal(ads[0].title, "Squarespace (sponsor)");
    assert.equal(ads[0].startMs, 30_000);
    assert.equal(ads[0].endMs, 90_000);
  });

  it("falls back to the next chapter's start_time when end_time is missing", () => {
    const info: YtDlpInfo = {
      chapters: [
        { start_time: 0, title: "Intro" },
        { start_time: 30, title: "[Sponsor]" },
        { start_time: 90, title: "Content" },
      ],
    };
    const ads = extractAdChapters(info);
    assert.equal(ads.length, 1);
    assert.equal(ads[0].startMs, 30_000);
    assert.equal(ads[0].endMs, 90_000); // start of "Content"
  });

  it("falls back to +5min when an ad chapter is the last chapter and has no end_time", () => {
    const info: YtDlpInfo = {
      chapters: [
        { start_time: 0, title: "Content" },
        { start_time: 600, title: "(Ad)" },
      ],
    };
    const ads = extractAdChapters(info);
    assert.equal(ads.length, 1);
    assert.equal(ads[0].startMs, 600_000);
    assert.equal(ads[0].endMs, 900_000); // 600s + 300s = 900s
  });

  it("matches markers case-insensitively", () => {
    const info: YtDlpInfo = {
      chapters: [
        { start_time: 0, end_time: 30, title: "Intro (SPONSOR)" },
        { start_time: 30, end_time: 60, title: "(Werbung) — Squarespace" },
        { start_time: 60, end_time: 90, title: "[Promo]" },
        { start_time: 90, end_time: 120, title: "Real content" },
      ],
    };
    const ads = extractAdChapters(info);
    assert.equal(ads.length, 3);
    assert.deepEqual(
      ads.map((a) => a.title),
      ["Intro (SPONSOR)", "(Werbung) — Squarespace", "[Promo]"],
    );
  });

  it("matches all documented marker variants", () => {
    const titles = [
      "(werbung)", "(ad)", "(ads)", "(sponsor)", "(sponsored)",
      "(promo)", "(promotion)", "(anzeige)", "(reklame)",
      "[werbung]", "[ad]", "[ads]", "[sponsor]", "[sponsored]",
      "[promo]", "[promotion]", "[anzeige]", "[reklame]",
    ];
    const info: YtDlpInfo = {
      chapters: titles.map((title, i) => ({
        start_time: i * 10,
        end_time: i * 10 + 5,
        title,
      })),
    };
    const ads = extractAdChapters(info);
    assert.equal(ads.length, titles.length);
  });

  it("captures multiple ad chapters in order", () => {
    const info: YtDlpInfo = {
      chapters: [
        { start_time: 0, end_time: 30, title: "Intro" },
        { start_time: 30, end_time: 60, title: "(Sponsor)" },
        { start_time: 60, end_time: 600, title: "Main" },
        { start_time: 600, end_time: 660, title: "[Promo]" },
        { start_time: 660, end_time: 700, title: "Outro" },
      ],
    };
    const ads = extractAdChapters(info);
    assert.equal(ads.length, 2);
    assert.equal(ads[0].startMs, 30_000);
    assert.equal(ads[0].endMs, 60_000);
    assert.equal(ads[1].startMs, 600_000);
    assert.equal(ads[1].endMs, 660_000);
  });

  it("does not match ad-marker substrings without surrounding parens/brackets", () => {
    // The marker list requires parens/brackets — bare 'ad' inside a regular
    // word like "advice" must not trigger the filter.
    const info: YtDlpInfo = {
      chapters: [
        { start_time: 0, end_time: 30, title: "Some advice for beginners" },
        { start_time: 30, end_time: 60, title: "Adversarial examples" },
      ],
    };
    assert.deepEqual(extractAdChapters(info), []);
  });
});

describe("extractCaptionTracks", () => {
  it("returns [] when both subtitle maps are missing", () => {
    assert.deepEqual(extractCaptionTracks({}), []);
  });

  it("flattens manual subtitles and marks them not-auto-generated", () => {
    const info: YtDlpInfo = {
      subtitles: { en: [{}], ko: [{}] },
    };
    const tracks = extractCaptionTracks(info);
    assert.equal(tracks.length, 2);
    assert.ok(tracks.every((t) => t.isAutoGenerated === false));
  });

  it("flattens automatic_captions and marks them auto-generated", () => {
    const info: YtDlpInfo = {
      automatic_captions: { en: [{}], es: [{}] },
    };
    const tracks = extractCaptionTracks(info);
    assert.equal(tracks.length, 2);
    assert.ok(tracks.every((t) => t.isAutoGenerated === true));
  });

  it("manual subtitles take precedence over auto for the same language", () => {
    const info: YtDlpInfo = {
      subtitles: { en: [{}] },
      automatic_captions: { en: [{}], ko: [{}] },
    };
    const tracks = extractCaptionTracks(info);
    const en = tracks.find((t) => t.languageCode === "en");
    const ko = tracks.find((t) => t.languageCode === "ko");
    assert.equal(en?.isAutoGenerated, false);
    assert.equal(ko?.isAutoGenerated, true);
  });
});

describe("extractMetadata", () => {
  it("formats subscriber and view counts with k / M suffixes", () => {
    const info: YtDlpInfo = {
      title: "Test video",
      uploader: "Test channel",
      channel_follower_count: 1_234_567,
      view_count: 42_500,
      upload_date: "20251215",
    };
    const meta = extractMetadata(info);
    assert.equal(meta.subscriberCount, "1.2M");
    assert.equal(meta.viewCount, "42.5k");
  });

  it("formats upload_date YYYYMMDD as YYYY-MM-DD", () => {
    const meta = extractMetadata({ upload_date: "20251215" });
    assert.equal(meta.publishDate, "2025-12-15");
  });

  it("falls back to channel when uploader is missing", () => {
    const meta = extractMetadata({ channel: "Channel name" });
    assert.equal(meta.author, "Channel name");
  });

  it("returns empty strings for missing fields rather than undefined", () => {
    const meta = extractMetadata({});
    assert.equal(meta.title, "");
    assert.equal(meta.author, "");
    assert.equal(meta.subscriberCount, "");
    assert.equal(meta.viewCount, "");
    assert.equal(meta.publishDate, "");
  });

  it("does not pretend to format a malformed upload_date", () => {
    const meta = extractMetadata({ upload_date: "not-a-date" });
    assert.equal(meta.publishDate, "");
  });
});

describe("parseSponsorBlockResponse", () => {
  it("returns [] for non-array input", () => {
    assert.deepEqual(parseSponsorBlockResponse(null), []);
    assert.deepEqual(parseSponsorBlockResponse(undefined), []);
    assert.deepEqual(parseSponsorBlockResponse({}), []);
    assert.deepEqual(parseSponsorBlockResponse("not json"), []);
  });

  it("returns [] for an empty array (404-equivalent payload)", () => {
    assert.deepEqual(parseSponsorBlockResponse([]), []);
  });

  it("parses the real SponsorBlock payload reported for KFisvc-AMII", () => {
    // Verbatim shape returned by sponsor.ajay.app for the field-bug video.
    const payload = [
      {
        category: "sponsor",
        actionType: "skip",
        segment: [86.757, 159.293],
        UUID: "a336…",
        videoDuration: 2654.061,
        locked: 0,
        votes: 1,
        description: "",
      },
      {
        category: "sponsor",
        actionType: "skip",
        segment: [1572.689, 1645.442],
        UUID: "6a8f…",
        videoDuration: 2654.061,
        locked: 0,
        votes: 1,
        description: "",
      },
    ];
    const ads = parseSponsorBlockResponse(payload);
    assert.equal(ads.length, 2);
    assert.equal(ads[0].title, "[SponsorBlock]: sponsor");
    assert.equal(ads[0].startMs, 86_757);
    assert.equal(ads[0].endMs, 159_293);
    assert.equal(ads[1].startMs, 1_572_689);
    assert.equal(ads[1].endMs, 1_645_442);
  });

  it("filters out non-ad action types (poi, chapter, full)", () => {
    const payload = [
      { category: "poi_highlight", actionType: "poi", segment: [10, 20] },
      { category: "exclusive_access", actionType: "chapter", segment: [30, 40] },
      { category: "filler", actionType: "full", segment: [0, 100] },
      { category: "sponsor", actionType: "skip", segment: [50, 60] },
    ];
    const ads = parseSponsorBlockResponse(payload);
    assert.equal(ads.length, 1);
    assert.equal(ads[0].startMs, 50_000);
  });

  it("keeps mute action type alongside skip", () => {
    const payload = [
      { category: "sponsor", actionType: "mute", segment: [10, 15] },
    ];
    const ads = parseSponsorBlockResponse(payload);
    assert.equal(ads.length, 1);
    assert.equal(ads[0].title, "[SponsorBlock]: sponsor");
  });

  it("rejects malformed segments defensively", () => {
    const payload = [
      { category: "sponsor", actionType: "skip", segment: [10] }, // wrong length
      { category: "sponsor", actionType: "skip", segment: ["a", "b"] }, // wrong types
      { category: "sponsor", actionType: "skip", segment: [50, 30] }, // end <= start
      { category: "sponsor", actionType: "skip" }, // segment missing
      { category: "sponsor", actionType: "skip", segment: [10, 20] }, // good
      null,
      "string entry",
    ];
    const ads = parseSponsorBlockResponse(payload);
    assert.equal(ads.length, 1);
    assert.equal(ads[0].startMs, 10_000);
    assert.equal(ads[0].endMs, 20_000);
  });

  it("falls back to a generic title when category is missing", () => {
    const payload = [{ actionType: "skip", segment: [10, 20] }];
    const ads = parseSponsorBlockResponse(payload);
    assert.equal(ads.length, 1);
    assert.equal(ads[0].title, "[SponsorBlock]: segment");
  });
});
