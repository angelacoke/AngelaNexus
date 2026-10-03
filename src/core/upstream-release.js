export function normalizeReleaseTag(value) {
  return String(value || "").trim().replace(/^v/, "");
}

function releaseTimestamp(release) {
  const value = release?.published_at || release?.created_at || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function selectReleaseChannels(releases = []) {
  const candidates = releases
    .filter(release => release && release.draft !== true && release.tag_name)
    .slice()
    .sort((a, b) => releaseTimestamp(b) - releaseTimestamp(a));

  const stable = candidates.find(release => release.prerelease !== true) || null;
  const preview = candidates.find(release => release.prerelease === true) || null;

  return Object.freeze({ stable, preview });
}

export function summarizeRelease(release, { repository = null } = {}) {
  if (!release) return null;
  const summary = {
    tag: normalizeReleaseTag(release.tag_name),
    publishedAt: release.published_at || release.created_at || null,
    prerelease: release.prerelease === true,
    htmlUrl: release.html_url || null,
    body: String(release.body || "")
  };
  if (repository) {
    summary.repository = repository;
    summary.releaseUrl = release.html_url || null;
  }
  return Object.freeze(summary);
}
