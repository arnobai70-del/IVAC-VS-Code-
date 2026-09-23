const READY_REASON =
  'READY';


function requireBoolean(
  value,
  name,
) {
  if (
    typeof value
    !== 'boolean'
  ) {
    throw new TypeError(
      `${name} must be a boolean.`,
    );
  }

  return value;
}


function requireNonNegativeInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative integer.`,
    );
  }

  return value;
}


function requirePositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    )
    || value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}


function requireProxyPool(
  proxyPool,
) {
  if (
    proxyPool === null
    || typeof proxyPool
      !== 'object'
    || typeof proxyPool
      .listProxies
      !== 'function'
    || typeof proxyPool
      .countHealthyAvailable
      !== 'function'
  ) {
    throw new TypeError(
      'proxyPool must provide listProxies() and countHealthyAvailable().',
    );
  }

  return proxyPool;
}


function requireNetworkHealthService(
  networkHealthService,
) {
  if (
    networkHealthService === null
    || typeof networkHealthService
      !== 'object'
    || typeof networkHealthService
      .testProxy
      !== 'function'
  ) {
    throw new TypeError(
      'networkHealthService must provide testProxy().',
    );
  }

  return networkHealthService;
}


function isConfiguredHealthUrl(
  value,
) {
  return (
    typeof value
      === 'string'
    && value.trim()
      .length > 0
  );
}


function createBlockers({
  sourceExists,
  healthCheckConfigured,
  enabledProxyCount,
  healthyAvailableCount,
}) {
  const blockers = [];

  if (
    !sourceExists
  ) {
    blockers.push(
      'PROXY_CONFIG_NOT_FOUND',
    );
  }

  if (
    !healthCheckConfigured
  ) {
    blockers.push(
      'PROXY_HEALTH_CHECK_NOT_CONFIGURED',
    );
  }

  if (
    enabledProxyCount < 1
  ) {
    blockers.push(
      'NO_ENABLED_PROXIES',
    );
  }

  if (
    healthyAvailableCount < 1
  ) {
    blockers.push(
      'NO_HEALTHY_PROXY_CAPACITY',
    );
  }

  return Object.freeze(
    blockers,
  );
}


function applyProbeErrorBoundary(
  inspection,
  probeErrorCount,
) {
  if (
    probeErrorCount < 1
    || inspection.ready
      !== true
  ) {
    return inspection;
  }

  /*
   * A probe that throws before NetworkHealthService can persist a
   * health failure must never inherit stale AVAILABLE state from a
   * previous successful probe.
   *
   * Fail closed without exposing the raw exception.
   */
  return Object.freeze({
    ...inspection,

    ready:
      false,

    reason:
      'PROXY_PROBE_ERROR',

    blockers:
      Object.freeze([
        'PROXY_PROBE_ERROR',
        ...inspection.blockers,
      ]),
  });
}


export function inspectProxyReadiness({
  sourceExists,
  healthCheckConfigured,
  configuredProxyCount,
  enabledProxyCount,
  healthyAvailableCount,
}) {
  requireBoolean(
    sourceExists,
    'sourceExists',
  );

  requireBoolean(
    healthCheckConfigured,
    'healthCheckConfigured',
  );

  requireNonNegativeInteger(
    configuredProxyCount,
    'configuredProxyCount',
  );

  requireNonNegativeInteger(
    enabledProxyCount,
    'enabledProxyCount',
  );

  requireNonNegativeInteger(
    healthyAvailableCount,
    'healthyAvailableCount',
  );

  if (
    enabledProxyCount
    > configuredProxyCount
  ) {
    throw new TypeError(
      'enabledProxyCount cannot exceed configuredProxyCount.',
    );
  }

  if (
    healthyAvailableCount
    > enabledProxyCount
  ) {
    throw new TypeError(
      'healthyAvailableCount cannot exceed enabledProxyCount.',
    );
  }

  const gates =
    Object.freeze({
      sourceExists,

      healthCheckConfigured,

      hasEnabledProxy:
        enabledProxyCount > 0,

      hasHealthyAvailableProxy:
        healthyAvailableCount > 0,
    });

  const counts =
    Object.freeze({
      configured:
        configuredProxyCount,

      enabled:
        enabledProxyCount,

      healthyAvailable:
        healthyAvailableCount,

      requiredHealthy:
        1,
    });

  const blockers =
    createBlockers({
      sourceExists,
      healthCheckConfigured,
      enabledProxyCount,
      healthyAvailableCount,
    });

  const ready =
    blockers.length
    === 0;

  return Object.freeze({
    ready,

    reason:
      ready
        ? READY_REASON
        : blockers[0],

    blockers,

    gates,

    counts,
  });
}


export function inspectProxyPoolReadiness({
  sourceExists,
  healthCheckUrl,
  proxyPool,
}) {
  requireBoolean(
    sourceExists,
    'sourceExists',
  );

  requireProxyPool(
    proxyPool,
  );

  const proxies =
    proxyPool
      .listProxies();

  if (
    !Array.isArray(
      proxies,
    )
  ) {
    throw new TypeError(
      'proxyPool.listProxies() must return an array.',
    );
  }

  const configuredProxyCount =
    proxies.length;

  const enabledProxyCount =
    proxies.filter(
      (proxy) =>
        proxy?.enabled
        === true,
    ).length;

  const healthyAvailableCount =
    proxyPool
      .countHealthyAvailable();

  return inspectProxyReadiness({
    sourceExists,

    healthCheckConfigured:
      isConfiguredHealthUrl(
        healthCheckUrl,
      ),

    configuredProxyCount,

    enabledProxyCount,

    healthyAvailableCount,
  });
}


export async function probeProxyReadiness({
  sourceExists,
  healthCheckUrl,
  timeoutMs,
  cooldownMs,
  proxyPool,
  networkHealthService,
}) {
  requireBoolean(
    sourceExists,
    'sourceExists',
  );

  requirePositiveInteger(
    timeoutMs,
    'timeoutMs',
  );

  requirePositiveInteger(
    cooldownMs,
    'cooldownMs',
  );

  requireProxyPool(
    proxyPool,
  );

  requireNetworkHealthService(
    networkHealthService,
  );

  const healthCheckConfigured =
    isConfiguredHealthUrl(
      healthCheckUrl,
    );

  const proxies =
    proxyPool
      .listProxies();

  if (
    !Array.isArray(
      proxies,
    )
  ) {
    throw new TypeError(
      'proxyPool.listProxies() must return an array.',
    );
  }

  const enabledProxies =
    proxies.filter(
      (proxy) =>
        proxy?.enabled
        === true,
    );

  if (
    !sourceExists
    || !healthCheckConfigured
    || enabledProxies.length < 1
  ) {
    const inspection =
      inspectProxyReadiness({
        sourceExists,

        healthCheckConfigured,

        configuredProxyCount:
          proxies.length,

        enabledProxyCount:
          enabledProxies.length,

        healthyAvailableCount:
          proxyPool
            .countHealthyAvailable(),
      });

    return Object.freeze({
      ...inspection,

      probed:
        false,

      testedCount:
        0,

      probeSuccessCount:
        0,

      probeFailureCount:
        0,

      probeErrorCount:
        0,
    });
  }

  let probeSuccessCount =
    0;

  let probeFailureCount =
    0;

  let probeErrorCount =
    0;

  for (
    const proxy
    of enabledProxies
  ) {
    try {
      const result =
        await networkHealthService
          .testProxy(
            proxy.id,
            {
              url:
                healthCheckUrl,

              timeoutMs,

              cooldownMs,
            },
          );

      if (
        result?.ok
        === true
      ) {
        probeSuccessCount +=
          1;
      } else {
        probeFailureCount +=
          1;
      }
    } catch {
      probeFailureCount +=
        1;

      probeErrorCount +=
        1;
    }
  }

  const inspection =
    inspectProxyReadiness({
      sourceExists,

      healthCheckConfigured,

      configuredProxyCount:
        proxies.length,

      enabledProxyCount:
        enabledProxies.length,

      healthyAvailableCount:
        proxyPool
          .countHealthyAvailable(),
    });

  const boundedInspection =
    applyProbeErrorBoundary(
      inspection,
      probeErrorCount,
    );

  return Object.freeze({
    ...boundedInspection,

    probed:
      true,

    testedCount:
      enabledProxies.length,

    probeSuccessCount,

    probeFailureCount,

    probeErrorCount,
  });
}


export function assertProxyReadinessForIntake({
  intakeEnabled,
  readiness,
}) {
  requireBoolean(
    intakeEnabled,
    'intakeEnabled',
  );

  if (
    readiness === null
    || typeof readiness
      !== 'object'
    || Array.isArray(
      readiness,
    )
    || typeof readiness.ready
      !== 'boolean'
    || typeof readiness.reason
      !== 'string'
  ) {
    throw new TypeError(
      'readiness must be a valid proxy readiness result.',
    );
  }

  if (
    intakeEnabled
    !== true
  ) {
    return readiness;
  }

  if (
    readiness.ready
    !== true
  ) {
    throw new Error(
      `Proxy readiness blocked: ${readiness.reason}.`,
    );
  }

  return readiness;
}