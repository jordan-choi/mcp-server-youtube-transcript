// Validate the `lang` argument users pass to get_transcript.
//
// We deliberately don't auto-normalize ISO 639-2 → ISO 639-1: silent
// translation hides the user's mistake from them and commits us to a
// translation table we'd have to keep complete. Instead we reject the
// malformed input with a "Did you mean 'X'?" hint where we can guess the
// intended code, so the user learns the convention and gets the right
// answer the next time.

// ISO 639-2/B and 639-2/T 3-letter codes mapped to their ISO 639-1
// 2-letter equivalents. Only the languages we expect to actually come up;
// the long tail of 639-2 has no useful 639-1 mapping anyway.
const ISO_639_2_TO_1: Readonly<Record<string, string>> = {
  ara: "ar", ben: "bn", ces: "cs", chi: "zh", cze: "cs", dan: "da",
  deu: "de", dut: "nl", ell: "el", eng: "en", fin: "fi", fra: "fr",
  fre: "fr", ger: "de", gre: "el", heb: "he", hin: "hi", ind: "id",
  ita: "it", jpn: "ja", kor: "ko", nld: "nl", nor: "no", pol: "pl",
  por: "pt", rus: "ru", spa: "es", swe: "sv", tha: "th", tur: "tr",
  ukr: "uk", urd: "ur", vie: "vi", zho: "zh",
};

// Accepted form: ISO 639-1 root (2 letters), optionally followed by a
// hyphen and a 2-4 char alphanumeric region/script subtag — covers
// 'en', 'ko', 'pt-BR', 'es-419', 'zh-Hant', etc. Case-insensitive on the
// outside; yt-dlp matches caption tracks case-insensitively.
const VALID_LANG_RE = /^[a-zA-Z]{2}(-[a-zA-Z0-9]{2,4})?$/;

/**
 * Validate a YouTube language code.
 *
 * Returns `null` when the input is well-formed and ready to pass through
 * to yt-dlp. Returns a human-readable error message otherwise. The error
 * message includes a "Did you mean 'X'?" hint when the input looks like a
 * known ISO 639-2 (3-letter) code that has a 639-1 equivalent.
 *
 * Accepts `unknown` so a non-string `lang` value (null, number, etc.)
 * gets a clean error rather than a TypeError.
 */
export function validateLanguageCode(code: unknown): string | null {
  if (typeof code !== "string" || code.length === 0) {
    return "Language code must be a non-empty string. Use an ISO 639-1 (2-letter) code, e.g. 'en' or 'ko'.";
  }

  if (VALID_LANG_RE.test(code)) return null;

  const suggestion = ISO_639_2_TO_1[code.toLowerCase()];
  if (suggestion) {
    return `Invalid language code '${code}'. YouTube uses ISO 639-1 (2-letter) codes — did you mean '${suggestion}'?`;
  }

  return `Invalid language code '${code}'. YouTube uses ISO 639-1 (2-letter) codes (e.g. 'en', 'ko', 'es'), optionally with a region suffix like 'en-US' or 'pt-BR'.`;
}
