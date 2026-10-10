const MAX_COMPARE_FILES = 300;

/**
 * Read the changed files from GitHub's first compare page.
 * GitHub documents that this first page includes up to 300 changed files total;
 * later pages contain commits only, not additional files.
 */
export async function compareRelease(entry, configured, upstream, github) {
  if (!configured || !upstream || configured === upstream) {
    return { files: [], truncated: false };
  }

  const result = await github(
    `https://api.github.com/repos/${entry.repository}/compare/v${encodeURIComponent(configured)}...v${encodeURIComponent(upstream)}?per_page=100&page=1`
  );
  if (!Array.isArray(result?.files)) {
    throw new Error(entry.repository + ": upstream comparison returned no file list");
  }

  return {
    files: result.files.map(file => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes
    })),
    // A full 300-file response may be capped, so treat it as potentially incomplete.
    truncated: result.files.length >= MAX_COMPARE_FILES
  };
}
