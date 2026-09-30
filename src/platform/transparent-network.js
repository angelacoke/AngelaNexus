export const TRANSPARENT_INGRESS_VERSION = 2;

export const TRANSPARENT_CAPTURE_TYPES = Object.freeze({
  TCP: "tcp",
  UDP: "udp",
  DNS: "dns",
  ICMP: "icmp",
});

export const TRANSPARENT_FLOW_STATES = Object.freeze({
  CAPTURED: "captured",
  ROUTABLE: "routable",
  EXCLUDED: "excluded",
  REJECTED: "rejected",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}

function list(value) {
  return Object.freeze(Array.isArray(value) ? value.map(text).filter(Boolean) : []);
}

function familyFromIp(ip) {
  const value = text(ip);
  return value.includes(":") ? "ipv6" : value ? "ipv4" : null;
}

export function createTransparentNetworkContract(options = {}) {
  const contract = {
    version: TRANSPARENT_INGRESS_VERSION,
    enabled: Boolean(options.enabled),
    mode: text(options.mode) || "platform-native",
    capture: Object.freeze({
      tcp: bool(options.tcp, true),
      udp: bool(options.udp, true),
      dns: bool(options.dns, true),
      icmp: bool(options.icmp, false),
      ipv4: bool(options.ipv4, true),
      ipv6: bool(options.ipv6, true),
    }),
    identity: Object.freeze({
      app: bool(options.appIdentity, true),
      process: bool(options.processIdentity, true),
      uid: bool(options.uidIdentity, true),
      domain: bool(options.domainIdentity, true),
    }),
    routing: Object.freeze({
      handoff: "platform-routing",
      preserveIdentity: true,
      noProxyConfigurationRequired: true,
    }),
    security: Object.freeze({
      failClosed: true,
      allowSilentDirectFallback: false,
      protectResolverPath: true,
      protectProxyControlPath: true,
      protectLoopback: true,
    }),
    appPolicy: Object.freeze({
      includePackages: list(options.includePackages),
      excludePackages: list(options.excludePackages),
      includeProcesses: list(options.includeProcesses),
      excludeProcesses: list(options.excludeProcesses),
    }),
  };

  if (!contract.capture.ipv4 && !contract.capture.ipv6) {
    throw new Error("transparent ingress requires IPv4 or IPv6 capture");
  }
  return Object.freeze(contract);
}

export function evaluateTransparentNetwork(contract, runtime = {}) {
  if (!contract || contract.enabled !== true) {
    return Object.freeze({
      state: TRANSPARENT_FLOW_STATES.REJECTED,
      active: false,
      failClosed: true,
      reason: "transparent-ingress-disabled",
    });
  }

  const required = [];
  if (contract.capture.tcp) required.push("tcp");
  if (contract.capture.udp) required.push("udp");
  if (contract.capture.dns) required.push("dns");
  if (contract.capture.icmp) required.push("icmp");
  if (contract.capture.ipv4) required.push("ipv4");
  if (contract.capture.ipv6) required.push("ipv6");
  const unsupported = required.filter((key) => runtime[key] === false);
  if (unsupported.length) {
    return Object.freeze({
      state: TRANSPARENT_FLOW_STATES.REJECTED,
      active: false,
      failClosed: true,
      reason: "required-transparent-capability-unavailable",
      unsupported: Object.freeze(unsupported),
    });
  }

  if (runtime.permission === false) {
    return Object.freeze({
      state: TRANSPARENT_FLOW_STATES.REJECTED,
      active: false,
      failClosed: true,
      reason: "transparent-ingress-permission-denied",
    });
  }

  return Object.freeze({
    state: runtime.active === true ? TRANSPARENT_FLOW_STATES.ROUTABLE : TRANSPARENT_FLOW_STATES.CAPTURED,
    active: runtime.active === true,
    failClosed: true,
    identity: Object.freeze({
      app: runtime.appIdentity !== false,
      process: runtime.processIdentity !== false,
      uid: runtime.uidIdentity !== false,
      domain: runtime.domainIdentity !== false,
    }),
  });
}

export function createCapturedFlow(flow = {}) {
  if (
    flow &&
    flow.version === 1 &&
    typeof flow.protocol === "string" &&
    flow.source &&
    flow.destination &&
    flow.identity &&
    flow.metadata
  ) {
    return Object.freeze(flow);
  }

  const protocol = text(flow.protocol).toLowerCase();
  if (!Object.values(TRANSPARENT_CAPTURE_TYPES).includes(protocol)) {
    throw new Error("unsupported captured flow protocol: " + protocol);
  }
  if (
    protocol !== TRANSPARENT_CAPTURE_TYPES.DNS &&
    !text(flow.destinationIp) &&
    !text(flow.destinationDomain)
  ) {
    throw new Error("captured flow requires a destination");
  }
  const sourceFamily = familyFromIp(flow.sourceIp);
  const destinationFamily = familyFromIp(flow.destinationIp);
  return Object.freeze({
    version: 1,
    id: text(flow.id) || null,
    protocol,
    source: Object.freeze({
      ip: text(flow.sourceIp) || null,
      port: Number.isInteger(flow.sourcePort) ? flow.sourcePort : null,
      family: sourceFamily,
    }),
    destination: Object.freeze({
      ip: text(flow.destinationIp) || null,
      port: Number.isInteger(flow.destinationPort) ? flow.destinationPort : null,
      domain: text(flow.destinationDomain) || null,
      family: destinationFamily,
    }),
    identity: Object.freeze({
      appId: text(flow.appId) || null,
      packageName: text(flow.packageName) || null,
      processName: text(flow.processName) || null,
      uid: text(flow.uid) || null,
    }),
    metadata: Object.freeze({
      interface: text(flow.interface) || null,
      networkId: text(flow.networkId) || null,
      originatedByAngelaNexus: flow.originatedByAngelaNexus === true,
      resolverTraffic: flow.resolverTraffic === true,
    }),
  });
}

function matches(value, values) {
  return Boolean(value) && values.includes(value);
}

export function resolveTransparentFlowPolicy(contract, flow) {
  if (!contract || contract.enabled !== true) {
    return Object.freeze({
      state: TRANSPARENT_FLOW_STATES.REJECTED,
      action: "reject",
      reason: "transparent-ingress-disabled",
      failClosed: true,
    });
  }

  const captured = createCapturedFlow(flow);
  if (captured.metadata.originatedByAngelaNexus || captured.metadata.resolverTraffic) {
    return Object.freeze({
      state: TRANSPARENT_FLOW_STATES.EXCLUDED,
      action: "internal-protected-path",
      reason: "internal-control-path",
      failClosed: true,
    });
  }

  const policy = contract.appPolicy;
  const packageIncluded = matches(captured.identity.packageName, policy.includePackages);
  const processIncluded = matches(captured.identity.processName, policy.includeProcesses);
  const packageExcluded = matches(captured.identity.packageName, policy.excludePackages);
  const processExcluded = matches(captured.identity.processName, policy.excludeProcesses);

  if (packageExcluded || processExcluded) {
    return Object.freeze({
      state: TRANSPARENT_FLOW_STATES.EXCLUDED,
      action: "user-excluded",
      reason: "explicit-user-exclusion",
      failClosed: true,
      flow: captured,
    });
  }

  if ((policy.includePackages.length || policy.includeProcesses.length) && !packageIncluded && !processIncluded) {
    return Object.freeze({
      state: TRANSPARENT_FLOW_STATES.EXCLUDED,
      action: "user-excluded",
      reason: "not-in-explicit-inclusion",
      failClosed: true,
      flow: captured,
    });
  }

  return Object.freeze({
    state: TRANSPARENT_FLOW_STATES.ROUTABLE,
    action: "platform-routing",
    target: "platform-routing",
    reason: "captured-flow-ready-for-routing",
    failClosed: true,
    flow: captured,
  });
}

export function createTransparentIngressDecision(contract, runtime, flow) {
  const evaluation = evaluateTransparentNetwork(contract, runtime);
  if (evaluation.state === TRANSPARENT_FLOW_STATES.REJECTED) {
    return Object.freeze({
      action: "reject",
      target: "reject",
      failClosed: true,
      evaluation,
    });
  }
  const policy = resolveTransparentFlowPolicy(contract, flow);
  return Object.freeze({
    action: policy.action,
    target: policy.target || policy.action,
    failClosed: true,
    evaluation,
    policy,
  });
}
