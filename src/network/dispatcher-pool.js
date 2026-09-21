import {
  createHash,
} from 'node:crypto';

import {
  isIP,
} from 'node:net';

import {
  ProxyAgent,
} from 'undici';

import {
  ProxyUnavailableError,
} from '../core/errors.js';

import {
  isOwnedProxyState,
  PROXY_STATES,
} from './proxy-state.js';

function buildProxyUrl(settings) {
  const hostname =
    isIP(settings.ip) === 6
      ? `[${settings.ip}]`
      : settings.ip;

  const url = new URL(
    `${settings.protocol}://${hostname}:${settings.port}`,
  );

  if (settings.username) {
    url.username = settings.username;
    url.password = settings.password;
  }

  return url;
}

function getSettingsSignature(settings) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ip: settings.ip,
        port: settings.port,
        protocol: settings.protocol,
        username:
          settings.username ?? null,
        password:
          settings.password ?? null,
      }),
    )
    .digest('hex');
}

function createProxyAgent(settings) {
  const proxyUrl =
    buildProxyUrl(settings);

  return new ProxyAgent(
    proxyUrl.toString(),
  );
}

export class DispatcherPool {
  constructor({
    proxyPool,
  }) {
    this.proxyPool =
      proxyPool;

    /*
     * Probe dispatchers are used only for proxy/network health checks.
     *
     * They are deliberately separate from execution dispatchers so a
     * health probe can never share an execution transport with a job.
     */
    this.proxyDispatchers =
      new Map();

    /*
     * Execution dispatchers are keyed by allocation ID.
     *
     * This guarantees:
     *
     * allocation A -> dispatcher A
     * allocation B -> dispatcher B
     *
     * even when the same proxy is reused by another job later.
     */
    this.allocationDispatchers =
      new Map();
  }

  assertProxyUsable(
    proxy,
    {
      allowDisabled = false,
    } = {},
  ) {
    if (
      proxy.status
        === PROXY_STATES.DISABLED
      && !allowDisabled
    ) {
      throw new ProxyUnavailableError(
        `Proxy ${proxy.id} is disabled.`,
      );
    }

    if (
      !proxy.enabled
      && !isOwnedProxyState(
        proxy.status,
      )
      && !allowDisabled
    ) {
      throw new ProxyUnavailableError(
        `Proxy ${proxy.id} is not enabled.`,
      );
    }
  }

  async getForProxy(
    proxyId,
    {
      allowDisabled = false,
    } = {},
  ) {
    const proxy =
      this.proxyPool
        .getRequiredProxy(proxyId);

    this.assertProxyUsable(
      proxy,
      {
        allowDisabled,
      },
    );

    const settings =
      this.proxyPool
        .getConnectionSettings(proxyId);

    const signature =
      getSettingsSignature(
        settings,
      );

    const existing =
      this.proxyDispatchers
        .get(proxyId);

    if (
      existing
      && existing.signature
        === signature
    ) {
      return existing.dispatcher;
    }

    if (existing) {
      await existing
        .dispatcher
        .close();

      this.proxyDispatchers
        .delete(proxyId);
    }

    const dispatcher =
      createProxyAgent(
        settings,
      );

    this.proxyDispatchers.set(
      proxyId,
      {
        dispatcher,
        signature,
      },
    );

    return dispatcher;
  }

  async getForAllocation(
    allocation,
  ) {
    if (
      !allocation
      || typeof allocation
        !== 'object'
      || !allocation.allocationId
      || !allocation.proxyId
    ) {
      throw new ProxyUnavailableError(
        'A valid IP allocation is required before creating a job dispatcher.',
        {
          retryable: false,
        },
      );
    }

    const proxy =
      this.proxyPool
        .getRequiredProxy(
          allocation.proxyId,
        );

    this.assertProxyUsable(
      proxy,
    );

    if (
      proxy.ip !== allocation.ip
      || proxy.port
        !== allocation.port
    ) {
      throw new ProxyUnavailableError(
        `Allocation ${allocation.allocationId} no longer matches proxy ${allocation.proxyId}.`,
        {
          retryable: false,
        },
      );
    }

    const settings =
      this.proxyPool
        .getConnectionSettings(
          allocation.proxyId,
        );

    const signature =
      getSettingsSignature(
        settings,
      );

    const existing =
      this.allocationDispatchers
        .get(
          allocation.allocationId,
        );

    if (existing) {
      if (
        existing.proxyId
        !== allocation.proxyId
      ) {
        throw new ProxyUnavailableError(
          `Allocation ${allocation.allocationId} changed proxy ownership unexpectedly.`,
          {
            retryable: false,
          },
        );
      }

      if (
        existing.signature
        === signature
      ) {
        return existing.dispatcher;
      }

      await existing
        .dispatcher
        .close();

      this.allocationDispatchers
        .delete(
          allocation.allocationId,
        );
    }

    const dispatcher =
      createProxyAgent(
        settings,
      );

    this.allocationDispatchers
      .set(
        allocation.allocationId,
        {
          dispatcher,
          signature,
          proxyId:
            allocation.proxyId,
        },
      );

    return dispatcher;
  }

  async closeForAllocation(
    allocationId,
  ) {
    const existing =
      this.allocationDispatchers
        .get(allocationId);

    if (!existing) {
      return false;
    }

    this.allocationDispatchers
      .delete(allocationId);

    await existing
      .dispatcher
      .close();

    return true;
  }

  async closeForProxy(
    proxyId,
  ) {
    const existing =
      this.proxyDispatchers
        .get(proxyId);

    if (!existing) {
      return false;
    }

    this.proxyDispatchers
      .delete(proxyId);

    await existing
      .dispatcher
      .close();

    return true;
  }

  async closeAll() {
    const probeEntries =
      Array.from(
        this.proxyDispatchers
          .values(),
      );

    const allocationEntries =
      Array.from(
        this.allocationDispatchers
          .values(),
      );

    this.proxyDispatchers
      .clear();

    this.allocationDispatchers
      .clear();

    await Promise.allSettled(
      [
        ...probeEntries,
        ...allocationEntries,
      ].map(
        ({ dispatcher }) =>
          dispatcher.close(),
      ),
    );
  }

  get probeSize() {
    return this.proxyDispatchers
      .size;
  }

  get allocationSize() {
    return this.allocationDispatchers
      .size;
  }

  get size() {
    return (
      this.probeSize
      + this.allocationSize
    );
  }
}