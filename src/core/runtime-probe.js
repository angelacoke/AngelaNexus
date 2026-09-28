const UNSUPPORTED_PATTERNS = [
  /unknown\s+(?:outbound\s+)?type/i,
  /unsupported\s+(?:outbound|protocol|type)/i,
  /(?:outbound|protocol|type).*not\s+supported/i,
  /(?:outbound|protocol|type).*not\s+found/i,
  /(?:wireguard|outbound).*removed/i
];

const INVALID_FIXTURE_PATTERNS = [
  /invalid\s+(?:configuration|config|field|value|key)/i,
  /missing\s+(?:required|field|property)/i,
  /malformed/i,
  /parse\s+(?:error|failed)/i,
  /syntax\s+error/i,
  /invalid\s+(?:private|public)\s*key/i
];

export function classifyRuntimeProbeResult(result) {
  if (!result || typeof result !== "object") {
    return { status: "execution-error", reason: "missing process result" };
  }
  if (result.code === 0) {
    return { status: "supported", reason: "runtime accepted configuration" };
  }
  if (result.code === null) {
    return { status: "execution-error", reason: "process did not exit normally" };
  }

  const text = String(result.stderr || "") + "\n" + String(result.stdout || "");
  if (UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(text))) {
    return { status: "rejected", reason: "runtime explicitly rejected the capability" };
  }
  if (INVALID_FIXTURE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { status: "invalid-fixture", reason: "runtime reported invalid probe configuration" };
  }
  return { status: "execution-error", reason: "runtime failed without an explicit capability or fixture diagnosis" };
}
