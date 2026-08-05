import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultLocale,
  detectLocale,
  getDictionary,
  interpolate,
  isLocale,
  locales,
} from "../../src/web/i18n/index.ts";

test("shared i18n exposes stable locales and complete dictionaries", () => {
  assert.deepEqual(locales, ["zh-CN", "en-US"]);
  assert.equal(defaultLocale, "zh-CN");
  assert.equal(isLocale("en-US"), true);
  assert.equal(isLocale("fr-FR"), false);
  assert.equal(getDictionary("zh-CN").controls.dark, "深色");
  assert.equal(getDictionary("en-US").controls.dark, "Dark");
});

test("locale detection prefers a valid cookie and accepts language ranges", () => {
  assert.equal(detectLocale("en-US", "zh-CN,zh;q=0.9"), "en-US");
  assert.equal(detectLocale(undefined, "en-GB,en;q=0.9"), "en-US");
  assert.equal(detectLocale(undefined, "zh-TW,zh;q=0.9"), "zh-CN");
  assert.equal(detectLocale(undefined, "fr-FR"), defaultLocale);
});

test("message interpolation preserves unknown placeholders", () => {
  assert.equal(interpolate("Selected {identifier}", { identifier: "#15" }), "Selected #15");
  assert.equal(interpolate("Missing {value}", {}), "Missing {value}");
});
