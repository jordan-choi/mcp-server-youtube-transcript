# YouTube Transcript MCP Server

An MCP server that returns transcripts for YouTube videos. Forked from [`kimtaeyoon83/mcp-server-youtube-transcript`](https://github.com/kimtaeyoon83/mcp-server-youtube-transcript) with these substantive changes:

- **Backend swapped** from a hand-rolled HTTPS scraper to [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). YouTube changes don't break this server unless they also break yt-dlp, which the community generally fixes within days.
- **Sponsor segment removal via [SponsorBlock](https://sponsor.ajay.app/)** when `strip_ads: true`, even on videos with no creator-added chapter markers.
- **Rolling auto-caption duplication is collapsed.** Transcripts no longer include "Have you noticed Claude's performance Have you noticed Claude's performance varying by day…" repetition.
- **Per-sentence timestamps** when `include_timestamps: true` instead of one anchor per ~1-second cue.
- **`lang` argument is validated** with an actionable hint — passing `kor` instead of `ko` returns *"Did you mean 'ko'?"* up front instead of an opaque yt-dlp error mid-call.

## Prerequisites

`yt-dlp` must be installed and on the user's `PATH`:

| OS | Command |
| --- | --- |
| macOS | `brew install yt-dlp` |
| Windows | `winget install yt-dlp.yt-dlp` |
| Linux | `pipx install yt-dlp` (or your distro package) |

The server checks for `yt-dlp` at startup. If missing, it writes the install instructions above to stderr and exits non-zero — the failure shows up in your MCP host's log instead of producing opaque per-call errors.

Node.js 18 or higher is also required for runtime.

## Tool

### `get_transcript`

Returns the transcript text for a YouTube video, with optional sponsor filtering and per-sentence timestamps.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | string | — | YouTube video URL, Shorts URL, or 11-character video ID. |
| `lang` | string | `"en"` | ISO 639-1 (2-letter) language code, optionally with a region suffix (`en-US`, `pt-BR`, `zh-Hant`, `es-419`). 3-letter ISO 639-2 codes (`kor`, `eng`, …) are not accepted — use the 2-letter form. Falls back to an available language if the requested one isn't published. |
| `include_timestamps` | boolean | `false` | Prefix each sentence with `[m:ss]` (or `[h:mm:ss]` for videos longer than an hour). |
| `strip_ads` | boolean | `true` | Filter out sponsor segments. Uses both creator-marked chapters and the SponsorBlock community database. See "Privacy" below. |

The response includes the cleaned transcript text plus `structuredContent` with the video's title, author, subscriber count, view count, and publish date.

## Configuration

Add this entry to your MCP host configuration (e.g. `~/Library/Application Support/Claude/claude_desktop_config.json` for Claude Desktop):

```json
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "npx",
      "args": ["-y", "@jordanchoi/mcp-server-youtube-transcript"]
    }
  }
}
```

To install from source instead of npm, see "Development" below.

## Privacy

When `strip_ads: true` (the default), the server queries [SponsorBlock](https://sponsor.ajay.app) at `https://sponsor.ajay.app/api/skipSegments` to look up sponsor segments. Each call sends the YouTube video ID to that server. Pass `strip_ads: false` to opt out — no third-party request is made in that case.

Subtitle and metadata fetching itself goes only to `youtube.com` via `yt-dlp`. No analytics, telemetry, or other third parties are involved.

## Usage examples

```typescript
// By URL
await server.callTool("get_transcript", {
  url: "https://www.youtube.com/watch?v=VIDEO_ID",
  lang: "en",
});

// By video ID
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  lang: "ko",
});

// Shorts
await server.callTool("get_transcript", {
  url: "https://www.youtube.com/shorts/VIDEO_ID",
});

// With per-sentence timestamps
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  include_timestamps: true,
});

// Without sponsor filtering — also opts out of the SponsorBlock query
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  strip_ads: false,
});
```

## Error handling

| Condition | Result |
| --- | --- |
| Invalid URL or video ID | `InvalidParams` |
| Invalid `lang` (e.g. `"kor"` instead of `"ko"`) | `InvalidParams` with a "Did you mean 'X'?" hint when applicable |
| `yt-dlp` not installed at startup | Process exits 1 with install instructions on stderr |
| `yt-dlp` non-zero exit during a call | `InternalError` with yt-dlp's actual `ERROR:` line (not the ffmpeg warning) |
| Video has no captions | `InternalError` — *"No transcript available for this video. The video may not have captions enabled."* |
| Requested language unavailable, fallback succeeds | No error; response is prefixed with `[Note: Requested language 'X' not available. Using 'Y'…]` |
| Sponsor segments stripped | Response is prefixed with `[Note: N sponsored segment lines filtered out…]` |

## Development

```bash
npm install
npm run build     # tsc → dist/
npm test          # node:test via tsx
```

For development with auto-rebuild:

```bash
npm run watch
```

The server uses stdio transport. To debug interactively without restarting your MCP host every time, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Build from source (alternative to npm)

If you'd rather not pull from npm:

```bash
git clone https://github.com/jordan-choi/mcp-server-youtube-transcript
cd mcp-server-youtube-transcript
npm install
npm run build
```

Then point your MCP host at the built file:

```json
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-youtube-transcript/dist/index.js"]
    }
  }
}
```

## License

MIT — see [LICENSE](./LICENSE). Original copyright preserved per MIT terms; modifications copyright (c) 2026 Jordan Choi.
