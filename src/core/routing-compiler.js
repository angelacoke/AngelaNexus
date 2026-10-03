import { Kernels } from "./model.js";
import { createRoutingPolicy, validateRoutingPolicy } from "./routing-policy.js";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function values(value) {
  return Array.isArray(value) ? value : [value];
}

function requireTarget(rule) {
  if (!rule.action || !rule.action.target) {
    throw new Error("routing action requires target: " + rule.id);
  }
  return rule.action.target;
}

function mihomoMatch(match) {
  const entries = [];
  const add = (type, prefix) => {
    if (match[type] !== undefined) {
      for (const value of values(match[type])) entries.push(prefix + "," + value);
    }
  };
  add("domain", "DOMAIN");
  add("domain_suffix", "DOMAIN-SUFFIX");
  add("domain_keyword", "DOMAIN-KEYWORD");
  add("ip_cidr", "IP-CIDR");
  add("source_ip_cidr", "SRC-IP-CIDR");
  add("port", "DST-PORT");
  add("source_port", "SRC-PORT");
  add("network", "NETWORK");
  add("geoip", "GEOIP");
  add("geosite", "GEOSITE");
  add("rule_set", "RULE-SET");
  add("process_name", "PROCESS-NAME");
  add("process_path", "PROCESS-PATH");
  add("inbound", "IN-NAME");
  if (match.logical) {
    return [String(match.logical)];
  }
  if (!entries.length) throw new Error("unsupported or empty Mihomo routing match");
  return entries;
}

function compileMihomoRule(rule) {
  const target = rule.action.type === "reject"
    ? "REJECT"
    : requireTarget(rule);
  return mihomoMatch(rule.match).map((match) => match + "," + target);
}

function singBoxMatch(match) {
  const output = {};
  const supported = [
    "domain", "domain_suffix", "domain_keyword", "ip_cidr", "source_ip_cidr",
    "port", "source_port", "network", "geoip", "geosite", "rule_set",
    "process_name", "process_path", "package_name", "inbound"
  ];
  for (const key of supported) {
    if (match[key] !== undefined) output[key] = clone(values(match[key]));
  }
  if (match.logical) {
    const logical = clone(match.logical);
    if (typeof logical !== "object" || !logical.type || !Array.isArray(logical.rules)) {
      throw new Error("invalid sing-box logical routing match");
    }
    output.type = "logical";
    output.mode = logical.mode;
    output.rules = logical.rules;
  }
  if (!Object.keys(output).length) throw new Error("unsupported or empty sing-box routing match");
  return output;
}

function compileSingBoxRule(rule) {
  const output = singBoxMatch(rule.match);
  switch (rule.action.type) {
    case "route":
    case "chain":
    case "bypass":
      output.action = "route";
      output.outbound = requireTarget(rule);
      break;
    case "reject":
      output.action = "reject";
      break;
    case "dns":
      output.action = "resolve";
      output.server = requireTarget(rule);
      break;
    default:
      throw new Error("unsupported sing-box routing action: " + rule.action.type);
  }
  return output;
}

function xrayMatch(match) {
  const output = {};
  const domain = [];
  if (match.domain) for (const value of values(match.domain)) domain.push("full:" + value);
  if (match.domain_suffix) for (const value of values(match.domain_suffix)) domain.push("domain:" + value);
  if (match.domain_keyword) for (const value of values(match.domain_keyword)) domain.push("keyword:" + value);
  if (match.geosite) for (const value of values(match.geosite)) domain.push("geosite:" + value);
  if (domain.length) output.domain = domain;
  if (match.ip_cidr) output.ip = values(match.ip_cidr);
  if (match.geoip) output.ip = values(match.geoip).map((value) => "geoip:" + value);
  if (match.source_ip_cidr) output.sourceIP = values(match.source_ip_cidr);
  if (match.port !== undefined) output.port = values(match.port).join(",");
  if (match.source_port !== undefined) output.sourcePort = values(match.source_port).join(",");
  if (match.network !== undefined) output.network = values(match.network).join(",");
  if (match.protocol !== undefined) output.protocol = values(match.protocol);
  if (match.process_name !== undefined) output.process = values(match.process_name);
  if (match.inbound !== undefined) output.inboundTag = values(match.inbound);
  if (!Object.keys(output).length) throw new Error("unsupported or empty Xray routing match");
  return output;
}

function compileXrayRule(rule) {
  const output = xrayMatch(rule.match);
  switch (rule.action.type) {
    case "route":
    case "chain":
    case "bypass":
      output.outboundTag = requireTarget(rule);
      break;
    case "reject":
      output.outboundTag = "Nexus-Blackhole";
      break;
    case "dns":
      output.outboundTag = "Nexus-DNS";
      break;
    default:
      throw new Error("unsupported Xray routing action: " + rule.action.type);
  }
  output.ruleTag = rule.name;
  return output;
}

export function compileRoutingPolicy(policy, kernel) {
  const normalized = createRoutingPolicy(policy || {});
  const validation = validateRoutingPolicy(normalized);
  if (!validation.ok) throw new Error("invalid routing policy: " + validation.errors.join("; "));

  const rules = normalized.rules.filter((rule) => rule.enabled);
  if (kernel === Kernels.MIHOMO) {
    return rules.flatMap(compileMihomoRule);
  }
  if (kernel === Kernels.SING_BOX) {
    return rules.map(compileSingBoxRule);
  }
  if (kernel === Kernels.XRAY) {
    return rules.map(compileXrayRule);
  }
  throw new Error("unsupported kernel for routing compilation: " + kernel);
}
