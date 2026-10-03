import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeReleaseTag,
  selectReleaseChannels,
  summarizeRelease,
} from "./upstream-release.js";

test("release tag normalization removes only the leading v", () => {
  assert.equal(normalizeReleaseTag("v1.14.2"), "1.14.2");
  assert.equal(normalizeReleaseTag("1.19.32"), "1.19.32");
  assert.equal(normalizeReleaseTag(""), "");
});

test("release channel selection ignores drafts and separates stable from preview", () => {
  const channels = selectReleaseChannels([
    { tag_name: "v2.0.0", draft: true, prerelease: false, published_at: "2026-10-02T00:00:00Z" },
    { tag_name: "v1.9.0", draft: false, prerelease: true, published_at: "2026-10-01T00:00:00Z" },
    { tag_name: "v1.8.0", draft: false, prerelease: false, published_at: "2026-09-30T00:00:00Z" },
    { tag_name: "v1.7.0", draft: false, prerelease: false, published_at: "2026-09-29T00:00:00Z" },
  ]);

  assert.equal(channels.stable.tag_name, "v1.8.0");
  assert.equal(channels.preview.tag_name, "v1.9.0");
});

test("release channel selection is timestamp based rather than array-order based", () => {
  const channels = selectReleaseChannels([
    { tag_name: "v1.7.0", draft: false, prerelease: false, published_at: "2026-09-29T00:00:00Z" },
    { tag_name: "v1.8.0", draft: false, prerelease: false, published_at: "2026-09-30T00:00:00Z" },
    { tag_name: "v1.6.0", draft: false, prerelease: false, published_at: "2026-09-28T00:00:00Z" },
  ]);

  assert.equal(channels.stable.tag_name, "v1.8.0");
});

test("release summary preserves verification-relevant metadata", () => {
  const summary = summarizeRelease({
    tag_name: "v1.14.2",
    published_at: "2026-09-24T00:00:00Z",
    prerelease: false,
    html_url: "https://example.invalid/release",
    body: "Release notes",
  }, { repository: "SagerNet/sing-box" });

  assert.deepEqual(summary, {
    tag: "1.14.2",
    publishedAt: "2026-09-24T00:00:00Z",
    prerelease: false,
    repository: "SagerNet/sing-box",
    releaseUrl: "https://example.invalid/release",
    htmlUrl: "https://example.invalid/release",
    body: "Release notes",
  });
});
