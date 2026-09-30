export const PLATFORM_FAILURE_ACTIONS = Object.freeze({
  RETRY: "retry",
  RECHECK: "recheck",
  REGENERATE: "regenerate",
  SWITCH_LANDING: "switch-landing",
  DISABLE: "disable",
  REJECT: "reject",
});

const DEFAULT_ACTIONS = Object.freeze([
  PLATFORM_FAILURE_ACTIONS.RETRY,
  PLATFORM_FAILURE_ACTIONS.RECHECK,
  PLATFORM_FAILURE_ACTIONS.SWITCH_LANDING,
  PLATFORM_FAILURE_ACTIONS.REJECT,
]);

function normalizeAction(action) {
  return Object.values(PLATFORM_FAILURE_ACTIONS).includes(action) ? action : null;
}

function createAction(action, label, description, enabled = true) {
  return Object.freeze({
    action,
    label,
    description,
    enabled: Boolean(enabled),
  });
}

export function createPlatformFailureState({
  capability,
  reason,
  impact = "required-operation-unavailable",
  details = null,
  failClosed = true,
} = {}) {
  if (typeof capability !== "string" || capability.length === 0) {
    throw new TypeError("capability is required");
  }
  if (typeof reason !== "string" || reason.length === 0) {
    throw new TypeError("reason is required");
  }

  return Object.freeze({
    type: "platform-failure",
    capability,
    reason,
    impact,
    details,
    failClosed: Boolean(failClosed),
  });
}

export function createPlatformRecoveryOptions({
  failure,
  actions = DEFAULT_ACTIONS,
  alternatives = [],
} = {}) {
  if (!failure || failure.type !== "platform-failure") {
    throw new TypeError("failure must be a platform failure state");
  }

  const safeAlternatives = Array.isArray(alternatives)
    ? alternatives.filter((item) => item && item.id && item.enabled !== false)
    : [];

  const availableActions = [];
  for (const candidate of actions) {
    const action = typeof candidate === "string" ? normalizeAction(candidate) : normalizeAction(candidate?.action);
    if (!action) continue;
    if (action === PLATFORM_FAILURE_ACTIONS.SWITCH_LANDING && safeAlternatives.length === 0) continue;
    if (action === PLATFORM_FAILURE_ACTIONS.REGENERATE && failure.capability !== "warp") continue;
    availableActions.push(action);
  }

  if (!failure.failClosed && !availableActions.includes(PLATFORM_FAILURE_ACTIONS.REJECT)) {
    availableActions.push(PLATFORM_FAILURE_ACTIONS.REJECT);
  }

  return Object.freeze({
    failure,
    options: Object.freeze(availableActions.map((action) => {
      switch (action) {
        case PLATFORM_FAILURE_ACTIONS.RETRY:
          return createAction(action, "重试", "重新执行当前操作");
        case PLATFORM_FAILURE_ACTIONS.RECHECK:
          return createAction(action, "重新检测", "重新检测当前能力是否恢复");
        case PLATFORM_FAILURE_ACTIONS.REGENERATE:
          return createAction(action, "重新生成", "重新生成当前用户专属能力配置");
        case PLATFORM_FAILURE_ACTIONS.SWITCH_LANDING:
          return createAction(action, "切换落地", "从可用落地出口中选择其他方案");
        case PLATFORM_FAILURE_ACTIONS.DISABLE:
          return createAction(action, "停用", "停用当前不可用能力并保持其余配置不变");
        case PLATFORM_FAILURE_ACTIONS.REJECT:
          return createAction(action, "保持阻断", "无法安全建立所需路径时保持阻断，不自动直连");
        default:
          return null;
      }
    }).filter(Boolean)),
    alternatives: Object.freeze(safeAlternatives),
  });
}

export function createPlatformFailureNotice({ failure, recovery } = {}) {
  if (!failure || failure.type !== "platform-failure") {
    throw new TypeError("failure must be a platform failure state");
  }
  const options = recovery?.options || [];
  return Object.freeze({
    title: "网络能力不可用",
    message: failure.details || `当前需要的“${failure.capability}”不可用：${failure.reason}`,
    impact: failure.impact,
    failClosed: failure.failClosed,
    options: Object.freeze(options),
  });
}

export function advisePlatformFailure({
  capability,
  reason,
  impact,
  details,
  failClosed = true,
  actions,
  alternatives,
} = {}) {
  const failure = createPlatformFailureState({
    capability,
    reason,
    impact,
    details,
    failClosed,
  });
  const recovery = createPlatformRecoveryOptions({
    failure,
    actions,
    alternatives,
  });
  return Object.freeze({
    failure,
    recovery,
    notice: createPlatformFailureNotice({ failure, recovery }),
  });
}
