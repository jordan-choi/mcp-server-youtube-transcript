#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { getSubtitles, AdChapter, CaptionTrack } from "./youtube-fetcher.js";
import { formatTranscript } from "./format-transcript.js";
import { validateLanguageCode } from "./lang-code.js";

const execFile = promisify(execFileCallback);

class YouTubeTranscriptExtractor {
  /**
   * Extracts YouTube video ID from various URL formats or direct ID input.
   */
  extractYoutubeId(input: string): string {
    if (!input) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "YouTube URL or ID is required",
      );
    }

    try {
      const url = new URL(input);
      if (url.hostname === "youtu.be") {
        return url.pathname.slice(1);
      } else if (url.hostname.includes("youtube.com")) {
        if (url.pathname.startsWith("/shorts/")) {
          const id = url.pathname.slice(8);
          if (!id) {
            throw new McpError(
              ErrorCode.InvalidParams,
              "Invalid YouTube Shorts URL: missing video ID",
            );
          }
          return id;
        }
        const videoId = url.searchParams.get("v");
        if (!videoId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid YouTube URL: ${input}`,
          );
        }
        return videoId;
      }
    } catch (error) {
      // Not a URL, check if it's a direct video ID (10-11 URL-safe Base64
      // chars, may start with -).
      if (!/^-?[a-zA-Z0-9_-]{10,11}$/.test(input)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid YouTube video ID: ${input}`,
        );
      }
      return input;
    }

    throw new McpError(
      ErrorCode.InvalidParams,
      `Could not extract video ID from: ${input}`,
    );
  }

  /**
   * Retrieves transcript for a given video ID and language.
   */
  async getTranscript(
    videoId: string,
    lang: string,
    includeTimestamps: boolean,
    stripAds: boolean,
  ): Promise<{
    text: string;
    actualLang: string;
    availableLanguages: string[];
    adsStripped: number;
    adChaptersFound: number;
    metadata: {
      title: string;
      author: string;
      subscriberCount: string;
      viewCount: string;
      publishDate: string;
    };
  }> {
    try {
      const result = await getSubtitles({
        videoID: videoId,
        lang: lang,
        enableFallback: true,
        // Only opt in to SponsorBlock when the user wants ad-stripping —
        // otherwise we'd hit a third-party server for nothing.
        useSponsorBlock: stripAds,
      });

      let lines = result.lines;
      let adsStripped = 0;

      if (stripAds && result.adChapters.length > 0) {
        const originalCount = lines.length;
        lines = lines.filter((line) => {
          const lineStartMs = line.start * 1000;
          return !result.adChapters.some(
            (ad: AdChapter) =>
              lineStartMs >= ad.startMs && lineStartMs < ad.endMs,
          );
        });
        adsStripped = originalCount - lines.length;
        if (adsStripped > 0) {
          console.error(
            `[youtube-transcript] Filtered ${adsStripped} lines from ${result.adChapters.length} ad chapter(s): ${result.adChapters
              .map((a: AdChapter) => a.title)
              .join(", ")}`,
          );
        }
      }

      return {
        text: formatTranscript(lines, includeTimestamps),
        actualLang: result.actualLang,
        availableLanguages: result.availableLanguages.map(
          (t: CaptionTrack) => t.languageCode,
        ),
        adsStripped,
        adChaptersFound: result.adChapters.length,
        metadata: result.metadata,
      };
    } catch (error) {
      console.error("Failed to fetch transcript:", error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve transcript: ${(error as Error).message}`,
      );
    }
  }
}

const extractor = new YouTubeTranscriptExtractor();

// Tool input as a Zod raw shape. McpServer takes this directly via
// `inputSchema` and auto-generates the JSON Schema that `tools/list`
// returns to clients. `.describe(...)` calls become field descriptions in
// the generated schema; `.default(...)` makes the field optional with the
// listed default. We don't constrain `lang` to a regex here because the
// custom `validateLanguageCode` check in the handler returns a friendlier
// "Did you mean 'X'?" error than a generic Zod rejection.
const getTranscriptInput = {
  url: z.string().describe("YouTube video URL or ID"),
  lang: z
    .string()
    .default("en")
    .describe(
      "ISO 639-1 (2-letter) language code, e.g. 'en' for English or 'ko' for Korean. Optionally with a region suffix like 'en-US' or 'pt-BR'. 3-letter ISO 639-2 codes ('eng', 'kor', etc.) are NOT accepted — use the 2-letter form. Falls back to an available language if the requested one isn't published.",
    ),
  include_timestamps: z
    .boolean()
    .default(false)
    .describe(
      "Include timestamps in output (e.g., '[0:05] text'). Useful for referencing specific moments. Default: false",
    ),
  strip_ads: z
    .boolean()
    .default(true)
    .describe(
      "Filter out sponsored segments from the transcript using both creator-marked chapters and the SponsorBlock community database. Default: true",
    ),
};

// Output schema describes `structuredContent` shape. Claude Code 2.0.21+
// uses this for nicer rendering than the raw text content alone.
const getTranscriptOutput = {
  meta: z.string().describe("Title | Author | Subs | Views | Date"),
  content: z
    .string()
    .describe("Transcript text with newlines collapsed to spaces"),
};

const server = new McpServer({
  name: "mcp-server-youtube-transcript",
  version: "0.3.0",
});

server.registerTool(
  "get_transcript",
  {
    title: "Get Transcript",
    description:
      "Extract transcript from a YouTube video URL or ID. Automatically falls back to available languages if requested language is not available.",
    inputSchema: getTranscriptInput,
    outputSchema: getTranscriptOutput,
    annotations: {
      title: "Get Transcript",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ url: input, lang, include_timestamps, strip_ads }) => {
    const langError = validateLanguageCode(lang);
    if (langError) {
      throw new McpError(ErrorCode.InvalidParams, langError);
    }

    try {
      const videoId = extractor.extractYoutubeId(input);
      console.error(
        `Processing transcript for video: ${videoId}, lang: ${lang}, timestamps: ${include_timestamps}, strip_ads: ${strip_ads}`,
      );

      const result = await extractor.getTranscript(
        videoId,
        lang,
        include_timestamps,
        strip_ads,
      );
      console.error(
        `Successfully extracted transcript (${result.text.length} chars, lang: ${result.actualLang}, ads stripped: ${result.adsStripped})`,
      );

      let transcript = result.text;

      if (result.actualLang !== lang) {
        transcript = `[Note: Requested language '${lang}' not available. Using '${result.actualLang}'. Available: ${result.availableLanguages.join(
          ", ",
        )}]\n\n${transcript}`;
      }

      if (result.adsStripped > 0) {
        transcript = `[Note: ${result.adsStripped} sponsored segment lines filtered out based on chapter markers]\n\n${transcript}`;
      } else if (strip_ads && result.adChaptersFound === 0) {
        transcript +=
          "\n\n[Note: No chapter markers found. If summarizing, please exclude any sponsored segments or ads from the summary.]";
      }

      return {
        content: [
          {
            type: "text" as const,
            text: transcript,
          },
        ],
        structuredContent: {
          meta: `${result.metadata.title} | ${result.metadata.author} | ${result.metadata.subscriberCount} subs | ${result.metadata.viewCount} views | ${result.metadata.publishDate}`,
          content: transcript.replace(/[\r\n]+/g, " ").replace(/\s+/g, " "),
        },
      };
    } catch (error) {
      console.error("Transcript extraction failed:", error);
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to process transcript: ${(error as Error).message}`,
      );
    }
  },
);

// Forward low-level transport / protocol errors to stderr so they surface
// in the host's MCP log. McpServer wraps a Server instance; we still need
// to attach onerror to the inner Server.
server.server.onerror = (error) => {
  console.error("[MCP Error]", error);
};

process.on("SIGINT", async () => {
  try {
    await server.close();
  } catch (error) {
    console.error("Error while stopping server:", error);
  }
  process.exit(0);
});

/**
 * Verify that yt-dlp is on the user's PATH before we try to use it.
 * Writes a clear, actionable error to stderr and exits non-zero if missing,
 * so the failure surfaces in the host's MCP log instead of as an opaque
 * tool-call error per request.
 */
async function checkYtDlp(): Promise<void> {
  try {
    await execFile("yt-dlp", ["--version"], { timeout: 5000 });
  } catch {
    const lines = [
      "",
      "─────────────────────────────────────────────────────────────",
      "  ERROR: yt-dlp not found on PATH",
      "─────────────────────────────────────────────────────────────",
      "",
      "  This MCP server requires yt-dlp to be installed locally.",
      "  Install it with one of:",
      "",
      "    macOS:    brew install yt-dlp",
      "    Windows:  winget install yt-dlp.yt-dlp",
      "    Linux:    pipx install yt-dlp",
      "",
      "  After installing, verify with: yt-dlp --version",
      "─────────────────────────────────────────────────────────────",
      "",
    ];
    for (const line of lines) console.error(line);
    process.exit(1);
  }
}

async function main() {
  await checkYtDlp();
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
