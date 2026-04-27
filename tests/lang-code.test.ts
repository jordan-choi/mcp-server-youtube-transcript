import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateLanguageCode } from "../src/lang-code.ts";

describe("validateLanguageCode — accepted forms", () => {
  it("accepts plain 2-letter codes", () => {
    assert.equal(validateLanguageCode("en"), null);
    assert.equal(validateLanguageCode("ko"), null);
    assert.equal(validateLanguageCode("es"), null);
  });

  it("accepts 2-letter codes with a 2-letter region suffix", () => {
    assert.equal(validateLanguageCode("en-US"), null);
    assert.equal(validateLanguageCode("pt-BR"), null);
    assert.equal(validateLanguageCode("zh-CN"), null);
  });

  it("accepts a 3-character region/script subtag (e.g. zh-Hant, es-419)", () => {
    assert.equal(validateLanguageCode("zh-Hant"), null);
    assert.equal(validateLanguageCode("es-419"), null);
  });

  it("is case-insensitive on the root and subtag (yt-dlp matches the same way)", () => {
    assert.equal(validateLanguageCode("EN"), null);
    assert.equal(validateLanguageCode("en-us"), null);
    assert.equal(validateLanguageCode("PT-br"), null);
  });
});

describe("validateLanguageCode — rejection with helpful suggestion", () => {
  it("suggests the 2-letter equivalent for a known 3-letter code", () => {
    const msg = validateLanguageCode("kor");
    assert.match(msg ?? "", /Invalid language code 'kor'/);
    assert.match(msg ?? "", /did you mean 'ko'/);
  });

  it("suggests for English, Japanese, Spanish equivalents too", () => {
    assert.match(validateLanguageCode("eng") ?? "", /'en'/);
    assert.match(validateLanguageCode("jpn") ?? "", /'ja'/);
    assert.match(validateLanguageCode("spa") ?? "", /'es'/);
  });

  it("matches 3-letter codes case-insensitively when suggesting", () => {
    assert.match(validateLanguageCode("KOR") ?? "", /'ko'/);
    assert.match(validateLanguageCode("Kor") ?? "", /'ko'/);
  });

  it("handles both ISO 639-2/B and 639-2/T variants for languages that have them", () => {
    // 639-2/B (bibliographic) → 639-2/T (terminologic) often differ but
    // both should map to the same 639-1.
    assert.match(validateLanguageCode("ger") ?? "", /'de'/); // 639-2/B
    assert.match(validateLanguageCode("deu") ?? "", /'de'/); // 639-2/T
    assert.match(validateLanguageCode("fre") ?? "", /'fr'/);
    assert.match(validateLanguageCode("fra") ?? "", /'fr'/);
    assert.match(validateLanguageCode("chi") ?? "", /'zh'/);
    assert.match(validateLanguageCode("zho") ?? "", /'zh'/);
  });
});

describe("validateLanguageCode — rejection without specific suggestion", () => {
  it("rejects an unknown 3-letter code with the generic message", () => {
    const msg = validateLanguageCode("xyz");
    assert.match(msg ?? "", /Invalid language code 'xyz'/);
    assert.match(msg ?? "", /ISO 639-1 \(2-letter\) codes/);
  });

  it("rejects free-form strings", () => {
    const msg = validateLanguageCode("english");
    assert.match(msg ?? "", /Invalid language code 'english'/);
  });

  it("rejects underscore separators (only hyphen is BCP 47)", () => {
    assert.notEqual(validateLanguageCode("en_US"), null);
  });

  it("rejects single-letter codes", () => {
    assert.notEqual(validateLanguageCode("e"), null);
  });

  it("rejects a region tag with no root", () => {
    assert.notEqual(validateLanguageCode("-US"), null);
  });
});

describe("validateLanguageCode — non-string inputs", () => {
  it("rejects empty string with a usage hint", () => {
    const msg = validateLanguageCode("");
    assert.match(msg ?? "", /must be a non-empty string/);
    assert.match(msg ?? "", /'en'/);
  });

  it("rejects null without throwing", () => {
    const msg = validateLanguageCode(null);
    assert.match(msg ?? "", /must be a non-empty string/);
  });

  it("rejects undefined without throwing", () => {
    const msg = validateLanguageCode(undefined);
    assert.match(msg ?? "", /must be a non-empty string/);
  });

  it("rejects numbers without throwing", () => {
    const msg = validateLanguageCode(42);
    assert.match(msg ?? "", /must be a non-empty string/);
  });
});
