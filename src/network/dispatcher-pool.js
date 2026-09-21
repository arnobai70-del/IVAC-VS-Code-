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

export class DispatcherPool {
  constructor({
    proxyPool,
  }) {
    this.proxyPool = proxyPool;
    this.dispatchers = new Map();
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

    if (
      proxy.status === PROXY_STATES.DISABLED
      && !allowDisabled
    ) {
      throw new ProxyUnavailableError(
        `Proxy ${proxyId} is disabled.`,
      );
    }

    if (
      !proxy.enabled
      && !isOwnedProxyState(proxy.status)
      && !allowDisabled
    ) {
      throw new ProxyUnavailableError(
        `Proxy ${proxyId} is not enabled.`,
      );
    }

    const settings =
      this.proxyPool
        .getConnectionSettings(proxyId);

    const signature =
      getSettingsSignature(settings);

    const existing =
      this.dispatchers.get(proxyId);

    if (
      existing
      && existing.signature === signature
    ) {
      return existing.dispatcher;
    }

    if (existing) {
      await existing.dispatcher.close();
      this.dispatchers.delete(proxyId);
    }

    const proxyUrl =
      buildProxyUrl(settings);

    const dispatcher =
      new ProxyAgent(proxyUrl.toString());

    this.dispatchers.set(
      proxyId,
      {
        dispatcher,
        signature,
      },
    );

    return dispatcher;
  }

  async getForAllocation(allocation) {
    if (
      !allocation
      || !allocation.proxyId
    ) {
      throw new ProxyUnavailableError(
        'A valid IP allocation is required before creating a dispatcher.',
      );
    }

    return this.getForProxy(
      allocation.proxyId,
    );
  }

  async closeForProxy(proxyId) {
    const existing =
      this.dispatchers.get(proxyId);

    if (!existing) {
      return false;
    }

    this.dispatchers.delete(proxyId);

    await existing.dispatcher.close();

    return true;
  }

  async closeAll() {
    const entries =
      Array.from(
        this.dispatchers.values(),
      );

    this.dispatchers.clear();

    await Promise.allSettled(
      entries.map(
        ({ dispatcher }) =>
          dispatcher.close(),
      ),
    );
  }

  get size() {
    return this.dispatchers.size;
  }
}