import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertProxyReadinessForIntake,
  inspectProxyPoolReadiness,
  inspectProxyReadiness,
  probeProxyReadiness,
} from '../src/network/proxy-readiness.js';


function createProxy({
  id,
  enabled = true,
} = {}) {
  return {
    id:
      id ?? 'proxy-1',

    enabled,
  };
}


function createFakeProxyPool({
  proxies = [],
  healthyAvailableCount = 0,
} = {}) {
  let healthyCount =
    healthyAvailableCount;

  return {
    listProxies() {
      return proxies.map(
        (proxy) => ({
          ...proxy,
        }),
      );
    },

    countHealthyAvailable() {
      return healthyCount;
    },

    setHealthyAvailableCount(
      value,
    ) {
      healthyCount =
        value;
    },
  };
}


test(
  'static proxy readiness is ready only with source, health route, enabled proxy, and healthy capacity',
  () => {
    const result =
      inspectProxyReadiness({
        sourceExists:
          true,

        healthCheckConfigured:
          true,

        configuredProxyCount:
          2,

        enabledProxyCount:
          2,

        healthyAvailableCount:
          1,
      });

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.deepEqual(
      result.blockers,
      [],
    );

    assert.deepEqual(
      result.gates,
      {
        sourceExists:
          true,

        healthCheckConfigured:
          true,

        hasEnabledProxy:
          true,

        hasHealthyAvailableProxy:
          true,
      },
    );

    assert.deepEqual(
      result.counts,
      {
        configured:
          2,

        enabled:
          2,

        healthyAvailable:
          1,

        requiredHealthy:
          1,
      },
    );

    assert.equal(
      Object.isFrozen(
        result,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        result.blockers,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        result.gates,
      ),
      true,
    );

    assert.equal(
      Object.isFrozen(
        result.counts,
      ),
      true,
    );
  },
);


test(
  'missing proxy configuration source fails closed',
  () => {
    const result =
      inspectProxyReadiness({
        sourceExists:
          false,

        healthCheckConfigured:
          true,

        configuredProxyCount:
          1,

        enabledProxyCount:
          1,

        healthyAvailableCount:
          0,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PROXY_CONFIG_NOT_FOUND',
    );

    assert.deepEqual(
      result.blockers,
      [
        'PROXY_CONFIG_NOT_FOUND',
        'NO_HEALTHY_PROXY_CAPACITY',
      ],
    );
  },
);


test(
  'missing proxy health-check route fails closed',
  () => {
    const result =
      inspectProxyReadiness({
        sourceExists:
          true,

        healthCheckConfigured:
          false,

        configuredProxyCount:
          1,

        enabledProxyCount:
          1,

        healthyAvailableCount:
          0,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PROXY_HEALTH_CHECK_NOT_CONFIGURED',
    );

    assert.deepEqual(
      result.blockers,
      [
        'PROXY_HEALTH_CHECK_NOT_CONFIGURED',
        'NO_HEALTHY_PROXY_CAPACITY',
      ],
    );
  },
);


test(
  'zero enabled proxies fails closed before intake',
  () => {
    const result =
      inspectProxyReadiness({
        sourceExists:
          true,

        healthCheckConfigured:
          true,

        configuredProxyCount:
          2,

        enabledProxyCount:
          0,

        healthyAvailableCount:
          0,
      });

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'NO_ENABLED_PROXIES',
    );

    assert.deepEqual(
      result.blockers,
      [
        'NO_ENABLED_PROXIES',
        'NO_HEALTHY_PROXY_CAPACITY',
      ],
    );
  },
);


test(
  'proxy-pool inspection exposes bounded counts without proxy connection details',
  () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',
          }),

          createProxy({
            id:
              'proxy-b',

            enabled:
              false,
          }),
        ],

        healthyAvailableCount:
          1,
      });

    const result =
      inspectProxyPoolReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          'https://health.example/',

        proxyPool,
      });

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.deepEqual(
      result.counts,
      {
        configured:
          2,

        enabled:
          1,

        healthyAvailable:
          1,

        requiredHealthy:
          1,
      },
    );

    assert.equal(
      'proxies' in result,
      false,
    );

    assert.equal(
      'ip' in result,
      false,
    );

    assert.equal(
      'username' in result,
      false,
    );

    assert.equal(
      'password' in result,
      false,
    );
  },
);


test(
  'probe skips every network request when proxy config source is missing',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',
          }),
        ],

        healthyAvailableCount:
          0,
      });

    let probeCalls =
      0;

    const result =
      await probeProxyReadiness({
        sourceExists:
          false,

        healthCheckUrl:
          'https://health.example/',

        timeoutMs:
          1000,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService: {
          async testProxy() {
            probeCalls +=
              1;

            return {
              ok:
                true,
            };
          },
        },
      });

    assert.equal(
      probeCalls,
      0,
    );

    assert.equal(
      result.probed,
      false,
    );

    assert.equal(
      result.testedCount,
      0,
    );

    assert.equal(
      result.probeErrorCount,
      0,
    );

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PROXY_CONFIG_NOT_FOUND',
    );
  },
);


test(
  'probe skips every network request when health route is not configured',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',
          }),
        ],
      });

    let probeCalls =
      0;

    const result =
      await probeProxyReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          null,

        timeoutMs:
          1000,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService: {
          async testProxy() {
            probeCalls +=
              1;

            return {
              ok:
                true,
            };
          },
        },
      });

    assert.equal(
      probeCalls,
      0,
    );

    assert.equal(
      result.probed,
      false,
    );

    assert.equal(
      result.probeErrorCount,
      0,
    );

    assert.equal(
      result.reason,
      'PROXY_HEALTH_CHECK_NOT_CONFIGURED',
    );
  },
);


test(
  'probe skips every network request when no proxy is enabled',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',

            enabled:
              false,
          }),
        ],
      });

    let probeCalls =
      0;

    const result =
      await probeProxyReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          'https://health.example/',

        timeoutMs:
          1000,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService: {
          async testProxy() {
            probeCalls +=
              1;

            return {
              ok:
                true,
            };
          },
        },
      });

    assert.equal(
      probeCalls,
      0,
    );

    assert.equal(
      result.probed,
      false,
    );

    assert.equal(
      result.probeErrorCount,
      0,
    );

    assert.equal(
      result.reason,
      'NO_ENABLED_PROXIES',
    );
  },
);


test(
  'successful proxy probes produce healthy readiness using only enabled proxies',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',
          }),

          createProxy({
            id:
              'proxy-b',
          }),

          createProxy({
            id:
              'proxy-disabled',

            enabled:
              false,
          }),
        ],
      });

    const testedIds = [];

    const networkHealthService = {
      async testProxy(
        proxyId,
        options,
      ) {
        testedIds.push(
          proxyId,
        );

        assert.equal(
          options.url,
          'https://health.example/',
        );

        assert.equal(
          options.timeoutMs,
          1500,
        );

        assert.equal(
          options.cooldownMs,
          30000,
        );

        proxyPool
          .setHealthyAvailableCount(
            testedIds.length,
          );

        return {
          ok:
            true,
        };
      },
    };

    const result =
      await probeProxyReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          'https://health.example/',

        timeoutMs:
          1500,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService,
      });

    assert.deepEqual(
      testedIds,
      [
        'proxy-a',
        'proxy-b',
      ],
    );

    assert.equal(
      result.probed,
      true,
    );

    assert.equal(
      result.testedCount,
      2,
    );

    assert.equal(
      result.probeSuccessCount,
      2,
    );

    assert.equal(
      result.probeFailureCount,
      0,
    );

    assert.equal(
      result.probeErrorCount,
      0,
    );

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.equal(
      result.counts
        .healthyAvailable,
      2,
    );
  },
);


test(
  'partial proxy probe failure remains ready when healthy capacity still exists',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',
          }),

          createProxy({
            id:
              'proxy-b',
          }),
        ],
      });

    const networkHealthService = {
      async testProxy(
        proxyId,
      ) {
        if (
          proxyId
          === 'proxy-a'
        ) {
          proxyPool
            .setHealthyAvailableCount(
              1,
            );

          return {
            ok:
              true,
          };
        }

        return {
          ok:
            false,
        };
      },
    };

    const result =
      await probeProxyReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          'https://health.example/',

        timeoutMs:
          1000,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService,
      });

    assert.equal(
      result.probed,
      true,
    );

    assert.equal(
      result.testedCount,
      2,
    );

    assert.equal(
      result.probeSuccessCount,
      1,
    );

    assert.equal(
      result.probeFailureCount,
      1,
    );

    assert.equal(
      result.probeErrorCount,
      0,
    );

    assert.equal(
      result.ready,
      true,
    );

    assert.equal(
      result.reason,
      'READY',
    );

    assert.equal(
      result.counts
        .healthyAvailable,
      1,
    );
  },
);


test(
  'all failed proxy probes leave readiness blocked with zero healthy capacity',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',
          }),

          createProxy({
            id:
              'proxy-b',
          }),
        ],

        healthyAvailableCount:
          0,
      });

    const result =
      await probeProxyReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          'https://health.example/',

        timeoutMs:
          1000,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService: {
          async testProxy() {
            return {
              ok:
                false,
            };
          },
        },
      });

    assert.equal(
      result.probed,
      true,
    );

    assert.equal(
      result.testedCount,
      2,
    );

    assert.equal(
      result.probeSuccessCount,
      0,
    );

    assert.equal(
      result.probeFailureCount,
      2,
    );

    assert.equal(
      result.probeErrorCount,
      0,
    );

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'NO_HEALTHY_PROXY_CAPACITY',
    );
  },
);


test(
  'unexpected probe exception is counted without leaking raw error text',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-a',
          }),
        ],
      });

    const result =
      await probeProxyReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          'https://health.example/',

        timeoutMs:
          1000,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService: {
          async testProxy() {
            throw new Error(
              'username:password@secret-proxy.example',
            );
          },
        },
      });

    assert.equal(
      result.probeFailureCount,
      1,
    );

    assert.equal(
      result.probeErrorCount,
      1,
    );

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'NO_HEALTHY_PROXY_CAPACITY',
    );

    const serialized =
      JSON.stringify(
        result,
      );

    assert.equal(
      serialized.includes(
        'secret-proxy',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'password',
      ),
      false,
    );
  },
);


test(
  'unexpected probe exception cannot reuse stale healthy capacity',
  async () => {
    const proxyPool =
      createFakeProxyPool({
        proxies: [
          createProxy({
            id:
              'proxy-stale',
          }),
        ],

        healthyAvailableCount:
          1,
      });

    const result =
      await probeProxyReadiness({
        sourceExists:
          true,

        healthCheckUrl:
          'https://health.example/',

        timeoutMs:
          1000,

        cooldownMs:
          30000,

        proxyPool,

        networkHealthService: {
          async testProxy() {
            throw new Error(
              'dispatcher setup failed with secret material',
            );
          },
        },
      });

    assert.equal(
      result.probed,
      true,
    );

    assert.equal(
      result.testedCount,
      1,
    );

    assert.equal(
      result.probeSuccessCount,
      0,
    );

    assert.equal(
      result.probeFailureCount,
      1,
    );

    assert.equal(
      result.probeErrorCount,
      1,
    );

    assert.equal(
      result.counts
        .healthyAvailable,
      1,
    );

    assert.equal(
      result.ready,
      false,
    );

    assert.equal(
      result.reason,
      'PROXY_PROBE_ERROR',
    );

    assert.deepEqual(
      result.blockers,
      [
        'PROXY_PROBE_ERROR',
      ],
    );

    const serialized =
      JSON.stringify(
        result,
      );

    assert.equal(
      serialized.includes(
        'dispatcher setup failed',
      ),
      false,
    );

    assert.equal(
      serialized.includes(
        'secret material',
      ),
      false,
    );
  },
);


test(
  'disabled intake can inspect blocked proxy readiness without failing startup',
  () => {
    const readiness =
      inspectProxyReadiness({
        sourceExists:
          false,

        healthCheckConfigured:
          false,

        configuredProxyCount:
          0,

        enabledProxyCount:
          0,

        healthyAvailableCount:
          0,
      });

    const result =
      assertProxyReadinessForIntake({
        intakeEnabled:
          false,

        readiness,
      });

    assert.equal(
      result,
      readiness,
    );

    assert.equal(
      result.ready,
      false,
    );
  },
);


test(
  'enabled intake fails closed when proxy readiness is blocked',
  () => {
    const readiness =
      inspectProxyReadiness({
        sourceExists:
          true,

        healthCheckConfigured:
          true,

        configuredProxyCount:
          1,

        enabledProxyCount:
          1,

        healthyAvailableCount:
          0,
      });

    assert.throws(
      () => {
        assertProxyReadinessForIntake({
          intakeEnabled:
            true,

          readiness,
        });
      },

      /Proxy readiness blocked: NO_HEALTHY_PROXY_CAPACITY/,
    );
  },
);


test(
  'enabled intake accepts only ready proxy capacity',
  () => {
    const readiness =
      inspectProxyReadiness({
        sourceExists:
          true,

        healthCheckConfigured:
          true,

        configuredProxyCount:
          1,

        enabledProxyCount:
          1,

        healthyAvailableCount:
          1,
      });

    const result =
      assertProxyReadinessForIntake({
        intakeEnabled:
          true,

        readiness,
      });

    assert.equal(
      result,
      readiness,
    );

    assert.equal(
      result.ready,
      true,
    );
  },
);


test(
  'proxy readiness rejects impossible and malformed count inputs',
  () => {
    assert.throws(
      () => {
        inspectProxyReadiness({
          sourceExists:
            true,

          healthCheckConfigured:
            true,

          configuredProxyCount:
            1,

          enabledProxyCount:
            2,

          healthyAvailableCount:
            0,
        });
      },

      /enabledProxyCount cannot exceed configuredProxyCount/,
    );

    assert.throws(
      () => {
        inspectProxyReadiness({
          sourceExists:
            true,

          healthCheckConfigured:
            true,

          configuredProxyCount:
            2,

          enabledProxyCount:
            1,

          healthyAvailableCount:
            2,
        });
      },

      /healthyAvailableCount cannot exceed enabledProxyCount/,
    );

    assert.throws(
      () => {
        inspectProxyReadiness({
          sourceExists:
            'true',

          healthCheckConfigured:
            true,

          configuredProxyCount:
            1,

          enabledProxyCount:
            1,

          healthyAvailableCount:
            1,
        });
      },

      {
        name:
          'TypeError',

        message:
          'sourceExists must be a boolean.',
      },
    );
  },
);