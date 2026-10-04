# Application-aware routing policy

Application/process identity is a first-class matcher dimension in platform routing policy.
Rules may constrain application identity, process name, domain/host, IP, port, protocol, priority and action.
The evaluator is deterministic: priority wins first, then selector specificity, then declaration order. It returns the winning rule, stable application identity key, considered matches, and an explanation suitable for detailed troubleshooting logs.
This layer does not choose Mihomo, sing-box, or Xray. It produces routing intent; Driver Scheduler and transport/protocol capability negotiation remain responsible for execution.
Security boundary: application/process selectors never widen into system-wide routing; an unmatched scoped rule does not silently become a different application scope; explanations contain no credentials, proxy secrets, or payload contents.