import { Kernels } from "./model.js";

export const EXECUTION_CONTRACT_VERSION = 1;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertDecision(decision) {
  if (!decision || typeof decision !== "object") throw new TypeError("execution decision is required");
  if (!text(decision.id)) throw new Error("execution decision id is required");
  if (!Number.isInteger(decision.version) || decision.version < 1) {
    throw new Error("execution decision version is required");
  }
}

function assertExecutionGates(input) {
  if (!Object.values(Kernels).includes(input.kernel)) {
    throw new Error("execution contract has unsupported kernel");
  }
  if (!input.config || typeof input.config !== "object") {
    throw new TypeError("execution contract config is required");
  }
  if (input.config.kernel !== input.kernel) {
    throw new Error("execution contract kernel does not match config kernel");
  }
  if (input.userAuthorized !== true) {
    throw new Error("execution contract requires explicit user authorization");
  }
  if (!input.security || input.security.preflightPassed !== true) {
    throw new Error("execution contract requires a passed security preflight");
  }
  if (input.security.failClosed !== true) {
    throw new Error("execution contract requires fail-closed security mode");
  }
  if (input.security.directFallback === true) {
    throw new Error("execution contract forbids direct fallback");
  }
  if (!input.path || input.path.validated !== true) {
    throw new Error("execution contract requires a validated network path");
  }
  if (input.gfw && typeof input.gfw === "object" && input.gfw.state === "confirmed") {
    if (input.path.gfwValidated !== true) {
      throw new Error("execution contract requires GFW path revalidation");
    }
  }
  if (
    input.path.networkGeneration !== undefined &&
    input.path.validatedGeneration !== undefined &&
    input.path.networkGeneration !== input.path.validatedGeneration
  ) {
    throw new Error("execution contract rejects stale network path validation");
  }
}

export function createExecutionContract(input = {}) {
  assertDecision(input.decision);
  assertExecutionGates(input);

  const contract = {
    version: EXECUTION_CONTRACT_VERSION,
    decision: {
      id: text(input.decision.id),
      version: input.decision.version
    },
    kernel: input.kernel,
    config: clone(input.config),
    userAuthorized: true,
    security: clone(input.security),
    path: clone(input.path),
    gfw: clone(input.gfw),
    issuedAt: input.issuedAt === undefined ? null : input.issuedAt,
    metadata: clone(input.metadata || {})
  };

  return Object.freeze({
    ...contract,
    decision: Object.freeze(contract.decision),
    security: Object.freeze(contract.security),
    path: Object.freeze(contract.path),
    gfw: contract.gfw && typeof contract.gfw === "object" ? Object.freeze(contract.gfw) : contract.gfw,
    metadata: Object.freeze(contract.metadata)
  });
}

export function validateExecutionContract(contract) {
  const errors = [];
  try {
    createExecutionContract(contract);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return Object.freeze({
    version: EXECUTION_CONTRACT_VERSION,
    ok: errors.length === 0,
    errors: Object.freeze(errors)
  });
}
