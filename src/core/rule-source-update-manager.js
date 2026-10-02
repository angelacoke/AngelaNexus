import { evaluateRuleSource } from "./rule-source-security.js";
import { validateRuleSourceSemantics } from "./rule-source-semantic-validator.js";

export const RULE_SOURCE_UPDATE_VERSION = 1;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizeCandidate(candidate = {}) {
  const content = Buffer.isBuffer(candidate.content)
    ? Buffer.from(candidate.content)
    : Buffer.from(String(candidate.content ?? ""), "utf8");
  return Object.freeze({
    content,
    metadata: Object.freeze({ ...(candidate.metadata || {}) })
  });
}

function defaultSemanticValidator(content, metadata) {
  return validateRuleSourceSemantics(content, metadata);
}

export function createRuleSourceStore({
  trustPolicy = {},
  semanticValidator = defaultSemanticValidator,
  initial = null,
  now = Date.now
} = {}) {
  let active = initial ? normalizeCandidate(initial) : null;
  let staged = null;

  function evaluateCandidate(candidate) {
    const normalized = normalizeCandidate(candidate);
    const currentVersion = active ? Number(active.metadata.version) : null;
    const trust = evaluateRuleSource(normalized.content, normalized.metadata, {
      policy: trustPolicy,
      currentVersion,
      now: typeof now === "function" ? now() : Date.now()
    });
    if (!trust.ok) {
      return Object.freeze({
        ok: false,
        action: "reject",
        stage: "trust",
        trust,
        semantic: null,
        activeVersion: currentVersion
      });
    }

    let semantic;
    try {
      semantic = semanticValidator(normalized.content, normalized.metadata);
    } catch (error) {
      semantic = { ok: false, errors: [{ code: "RULE_SOURCE_SEMANTIC_VALIDATION_FAILED", message: String(error?.message || error) }] };
    }
    const semanticResult = semantic && typeof semantic === "object"
      ? semantic
      : { ok: false, errors: [{ code: "RULE_SOURCE_SEMANTIC_VALIDATION_INVALID" }] };

    if (semanticResult.ok !== true) {
      return Object.freeze({
        ok: false,
        action: "reject",
        stage: "semantic",
        trust,
        semantic: semanticResult,
        activeVersion: currentVersion
      });
    }

    return Object.freeze({
      ok: true,
      action: "stage",
      stage: "validated",
      trust,
      semantic: semanticResult,
      candidate: normalized,
      activeVersion: currentVersion
    });
  }

  return Object.freeze({
    version: RULE_SOURCE_UPDATE_VERSION,

    getActive() {
      return active ? Object.freeze({
        content: Buffer.from(active.content),
        metadata: { ...active.metadata }
      }) : null;
    },

    getStaged() {
      return staged ? Object.freeze({
        content: Buffer.from(staged.content),
        metadata: { ...staged.metadata }
      }) : null;
    },

    stage(candidate) {
      const result = evaluateCandidate(candidate);
      if (!result.ok) {
        staged = null;
        return result;
      }
      staged = result.candidate;
      return Object.freeze({
        ok: true,
        action: "staged",
        stage: "staged",
        version: Number(staged.metadata.version),
        digest: result.trust.digest,
        activeVersion: result.activeVersion
      });
    },

    activate() {
      if (!staged) {
        return Object.freeze({
          ok: false,
          action: "reject",
          code: "RULE_SOURCE_NO_STAGED_CANDIDATE"
        });
      }
      const candidate = staged;
      active = normalizeCandidate(candidate);
      staged = null;
      return Object.freeze({
        ok: true,
        action: "activated",
        version: Number(active.metadata.version),
        digest: evaluateRuleSource(active.content, active.metadata, {
          policy: trustPolicy,
          currentVersion: null,
          now: typeof now === "function" ? now() : Date.now()
        }).digest
      });
    },

    async update(fetchCandidate) {
      if (typeof fetchCandidate !== "function") {
        return Object.freeze({
          ok: false,
          action: "reject",
          code: "RULE_SOURCE_FETCHER_REQUIRED"
        });
      }
      let candidate;
      try {
        candidate = await fetchCandidate();
      } catch (error) {
        return Object.freeze({
          ok: false,
          action: "reject",
          code: "RULE_SOURCE_FETCH_FAILED",
          error: String(error?.message || error)
        });
      }
      const stagedResult = this.stage(candidate);
      if (!stagedResult.ok) return stagedResult;
      return this.activate();
    }
  });
}

export function createRuleSourceUpdateManager(options = {}) {
  return createRuleSourceStore(options);
}
