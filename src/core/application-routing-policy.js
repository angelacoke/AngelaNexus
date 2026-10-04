import { applicationIdentityKey, matchesApplicationIdentity, normalizeApplicationSelector } from "./application-identity.js";

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function list(value) { return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : []; }
function normalizedHost(value) { return text(value).toLowerCase().replace(/\.$/, ""); }
function hostMatches(host, pattern) { const h=normalizedHost(host), p=normalizedHost(pattern); if (!h||!p) return false; if (p.startsWith("*.")) return h===p.slice(2)||h.endsWith(p.slice(1)); return h===p; }
function matchesAnyHost(host, patterns) { return patterns.some((pattern) => hostMatches(host, pattern)); }
function matchesAny(value, patterns) { const v=text(value).toLowerCase(); return patterns.some((pattern) => text(pattern).toLowerCase()===v); }
function ruleMatches(rule, context) {
  const selector=rule.application||rule.selector;
  if (selector && !matchesApplicationIdentity(context.identity, normalizeApplicationSelector(selector))) return false;
  const hosts=list(rule.domains||rule.hosts); if (hosts.length && !matchesAnyHost(context.host, hosts)) return false;
  const ips=list(rule.ips); if (ips.length && !matchesAny(context.ip, ips)) return false;
  const ports=Array.isArray(rule.ports)?rule.ports.filter(Number.isInteger):[]; if (ports.length && !ports.includes(context.port)) return false;
  const protocols=list(rule.protocols); if (protocols.length && !matchesAny(context.protocol, protocols)) return false;
  const processes=list(rule.processes); if (processes.length && !matchesAny(context.identity?.processName, processes)) return false;
  return true;
}
function specificity(rule) { const selector=rule.application||rule.selector; return (selector?100:0)+(list(rule.processes).length?50:0)+(list(rule.domains||rule.hosts).length?20:0)+(list(rule.ips).length?20:0)+(Array.isArray(rule.ports)&&rule.ports.length?10:0)+(list(rule.protocols).length?5:0); }

export function evaluateApplicationRoutingPolicy(input={}) {
  if (!input||typeof input!=="object") throw new TypeError("routing policy input is required");
  const identity=input.identity; if (!identity||typeof identity!=="object") throw new TypeError("routing policy requires application identity");
  const rules=Array.isArray(input.rules)?input.rules.filter(Boolean):[];
  const context=Object.freeze({identity,host:normalizedHost(input.host),ip:text(input.ip),port:Number.isInteger(input.port)?input.port:null,protocol:text(input.protocol)});
  const matches=rules.map((rule,index)=>({rule,index})).filter(({rule})=>ruleMatches(rule,context)).sort((a,b)=>{
    const pa=Number.isFinite(a.rule.priority)?a.rule.priority:0, pb=Number.isFinite(b.rule.priority)?b.rule.priority:0;
    if(pa!==pb) return pb-pa; const sd=specificity(b.rule)-specificity(a.rule); return sd||a.index-b.index;
  });
  const winner=matches[0]||null; const action=winner?(text(winner.rule.action)||"direct"):(text(input.defaultAction)||"direct");
  const ruleId=winner?(text(winner.rule.id)||("rule-"+(winner.index+1))):null;
  return Object.freeze({matched:Boolean(winner),action,ruleId,matchedRuleIndex:winner?winner.index:null,
    explanation:winner?"Rule "+ruleId+" matched application/process and traffic selectors; priority and specificity determined the winner.":"No application/process routing rule matched; the configured default action was used.",
    identityKey:applicationIdentityKey(identity),context,consideredRules:Object.freeze(matches.map(({rule,index})=>Object.freeze({id:text(rule.id)||("rule-"+(index+1)),priority:Number.isFinite(rule.priority)?rule.priority:0,specificity:specificity(rule)})))
  });
}
export function explainApplicationRoutingPolicy(result={}) { if(!result||typeof result!=="object") throw new TypeError("policy result is required"); return Object.freeze({action:text(result.action)||"direct",ruleId:result.ruleId||null,matched:result.matched===true,identityKey:result.identityKey||null,explanation:text(result.explanation)||"No explanation available."}); }