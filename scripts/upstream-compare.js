export const GITHUB_COMPARE_FILE_LIMIT = 300;

/**
 * GitHub's compare endpoint exposes a bounded file list in its response; page
 * parameters do not provide a reliable continuation for that list. At the
 * documented ceiling, completeness is unknown, so callers must fail closed.
 */
export function normalizeGitHubComparisonFiles(repository, result) {
  if (!Array.isArray(result?.files)) {
    throw new Error(repository + ": upstream comparison returned no file list");
  }

  const files = result.files.map(file => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes
  }));

  return {
    files,
    truncated: files.length >= GITHUB_COMPARE_FILE_LIMIT
  };
}
