import test from "node:test";
import assert from "node:assert/strict";
import { selectReleaseChannels, summarizeRelease } from "../src/core/upstream-release.js";

test("selects the newest published stable release separately from previews", () => {
  const { stable, preview } = selectReleaseChannels([
    { tag_name: "v2.0.0-alpha.2", prerelease: true, published_at: "2026-09-20T00:00:00Z" },
    { tag_name: "v1.9.0", prerelease: false, published_at: "2026-09-19T00:00:00Z" },
    { tag_name: "v2.0.0-alpha.1", prerelease: true, published_at: "2026-09-18T00:00:00Z" },
    { tag_name: "v1.8.0", prerelease: false, published_at: "2026-09-10T00:00:00Z" },
    { tag_name: "v2.0.0-rc.1", prerelease: true, draft: true, published_at: "2026-09-21T00:00:00Z" }
  ]);

  assert.equal(stable.tag_name, "v1.9.0");
  assert.equal(preview.tag_name, "v2.0.0-alpha.2");
});

test("ignores draft releases and handles a missing preview channel", () => {
  const { stable, preview } = selectReleaseChannels([
    { tag_name: "v1.0.1", prerelease: false, draft: true, published_at: "2026-09-22T00:00:00Z" },
    { tag_name: "v1.0.0", prerelease: false, published_at: "2026-09-01T00:00:00Z" }
  ]);

  assert.equal(stable.tag_name, "v1.0.0");
  assert.equal(preview, null);
});

test("normalizes release metadata without treating previews as stable", () => {
  const result = summarizeRelease({
    tag_name: "v1.2.3",
    prerelease: false,
    published_at: "2026-09-23T00:00:00Z",
    html_url: "https://example.test/release",
    body: "release notes"
  });

  assert.deepEqual(result, {
    tag: "1.2.3",
    publishedAt: "2026-09-23T00:00:00Z",
    prerelease: false,
    htmlUrl: "https://example.test/release",
    body: "release notes"
  });
});
