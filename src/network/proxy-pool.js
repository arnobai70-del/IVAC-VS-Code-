import {
  ProxyConfigurationError,
  ProxyNotFoundError,
  ProxyUnavailableError,
} from '../core/errors.js';

import {
  isOwnedProxyState,
  PROXY_STATES,
} from './proxy-state.js';

function mapProxy(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    ip: row.ip,
    port: row.port,
    protocol: row.protocol,
    label: row.label,
    enabled: Boolean(row.enabled),
    status: row.status,
    lastHealthOk: Boolean(row.last_health_ok),
    lastHealthAt: row.last_health_at,
    latencyMs: row.latency_ms,
    successCount: row.success_count,
    failureCount: row.failure_count,
    cooldownUntil: row.cooldown_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeLastError(value) {
  if (!value) {
    return null;
  }

  return String(value)
    .replace(
      /\/\/[^/@\s]+:[^/@\s]+@/g,
      '//[REDACTED]@',
    )
    .slice(0, 500);
}

export class ProxyPool {
  constructor(database) {
    this.database = database;
    this.connectionSettings = new Map();

    this.statements = {
      getById: database.prepare(`
        SELECT *
        FROM proxies
        WHERE id = ?
      `),

      list: database.prepare(`
        SELECT *
        FROM proxies
        ORDER BY id
      `),

      insert: database.prepare(`
        INSERT INTO proxies (
          id,
          ip,
          port,
          protocol,
          label,
          enabled,
          status,
          last_health_ok,
          last_health_at,
          latency_ms,
          success_count,
          failure_count,
          cooldown_until,
          last_error,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @ip,
          @port,
          @protocol,
          @label,
          @enabled,
          @status,
          0,
          NULL,
          NULL,
          0,
          0,
          NULL,
          NULL,
          @now,
          @now
        )
      `),

      updateDefinition: database.prepare(`
        UPDATE proxies
        SET
          ip = @ip,
          port = @port,
          protocol = @protocol,
          label = @label,
          enabled = @enabled,

          status = CASE
            WHEN status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
              THEN status

            WHEN @enabled = 0
              THEN 'DISABLED'

            WHEN last_health_ok = 1
              THEN 'AVAILABLE'

            ELSE 'COOLDOWN'
          END,

          updated_at = @now
        WHERE id = @id
      `),

      markMissing: database.prepare(`
        UPDATE proxies
        SET
          enabled = 0,

          status = CASE
            WHEN status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
              THEN status

            ELSE 'DISABLED'
          END,

          updated_at = @now
        WHERE id = @id
      `),

      countHealthyAvailable: database.prepare(`
        SELECT COUNT(*) AS count
        FROM proxies
        WHERE
          enabled = 1
          AND status = 'AVAILABLE'
          AND last_health_ok = 1
      `),

      healthSuccess: database.prepare(`
        UPDATE proxies
        SET
          last_health_ok = 1,
          last_health_at = @now,
          latency_ms = @latencyMs,
          success_count = success_count + 1,
          last_error = NULL,

          status = CASE
            WHEN status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
              THEN status

            WHEN enabled = 0
              THEN 'DISABLED'

            ELSE 'AVAILABLE'
          END,

          cooldown_until = CASE
            WHEN status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
              THEN cooldown_until

            ELSE NULL
          END,

          updated_at = @now
        WHERE id = @id
      `),

      healthFailure: database.prepare(`
        UPDATE proxies
        SET
          last_health_ok = 0,
          last_health_at = @now,
          failure_count = failure_count + 1,
          last_error = @lastError,
          cooldown_until = @cooldownUntil,

          status = CASE
            WHEN status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
              THEN status

            WHEN enabled = 0
              THEN 'DISABLED'

            ELSE 'COOLDOWN'
          END,

          updated_at = @now
        WHERE id = @id
      `),

      disable: database.prepare(`
        UPDATE proxies
        SET
          enabled = 0,

          status = CASE
            WHEN status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
              THEN status

            ELSE 'DISABLED'
          END,

          updated_at = @now
        WHERE id = @id
      `),

      enable: database.prepare(`
        UPDATE proxies
        SET
          enabled = 1,

          status = CASE
            WHEN status IN (
              'RESERVED',
              'ACTIVE',
              'RETRY_RESERVED',
              'RELEASING'
            )
              THEN status

            WHEN last_health_ok = 1
              THEN 'AVAILABLE'

            ELSE 'COOLDOWN'
          END,

          updated_at = @now
        WHERE id = @id
      `),
    };

    this.syncTransaction =
      database.transaction(
        ({
          definitions,
          now,
        }) => {
          const configuredIds = new Set();

          for (const definition of definitions) {
            configuredIds.add(definition.id);

            const existing =
              this.statements
                .getById
                .get(definition.id);

            if (existing) {
              const endpointChanged =
                existing.ip !== definition.ip
                || existing.port !== definition.port
                || existing.protocol !== definition.protocol;

              if (
                endpointChanged
                && isOwnedProxyState(existing.status)
              ) {
                throw new ProxyConfigurationError(
                  `Cannot change endpoint for owned proxy ${definition.id}.`,
                );
              }

              this.statements
                .updateDefinition
                .run({
                  id: definition.id,
                  ip: definition.ip,
                  port: definition.port,
                  protocol: definition.protocol,
                  label:
                    definition.label ?? null,
                  enabled:
                    definition.enabled ? 1 : 0,
                  now,
                });

              continue;
            }

            this.statements.insert.run({
              id: definition.id,
              ip: definition.ip,
              port: definition.port,
              protocol: definition.protocol,
              label:
                definition.label ?? null,

              enabled:
                definition.enabled ? 1 : 0,

              status:
                definition.enabled
                  ? PROXY_STATES.COOLDOWN
                  : PROXY_STATES.DISABLED,

              now,
            });
          }

          const stored =
            this.statements.list.all();

          for (const proxy of stored) {
            if (configuredIds.has(proxy.id)) {
              continue;
            }

            this.statements
              .markMissing
              .run({
                id: proxy.id,
                now,
              });
          }
        },
      );
  }

  syncFromConfig(definitions) {
    const nextConnectionSettings =
      new Map();

    for (const definition of definitions) {
      nextConnectionSettings.set(
        definition.id,
        {
          id: definition.id,
          ip: definition.ip,
          port: definition.port,
          protocol: definition.protocol,
          enabled: definition.enabled,
          username:
            definition.username ?? null,
          password:
            definition.password ?? null,
        },
      );
    }

    try {
      this.syncTransaction.immediate({
        definitions,
        now: new Date().toISOString(),
      });
    } catch (error) {
      if (
        error
        instanceof ProxyConfigurationError
      ) {
        throw error;
      }

      throw new ProxyConfigurationError(
        'Unable to synchronize proxy configuration.',
        {
          cause: error,
        },
      );
    }

    this.connectionSettings =
      nextConnectionSettings;

    return this.listProxies();
  }

  getProxyById(proxyId) {
    return mapProxy(
      this.statements.getById.get(proxyId),
    );
  }

  getRequiredProxy(proxyId) {
    const proxy =
      this.getProxyById(proxyId);

    if (!proxy) {
      throw new ProxyNotFoundError(proxyId);
    }

    return proxy;
  }

  listProxies() {
    return this.statements
      .list
      .all()
      .map(mapProxy);
  }

  countHealthyAvailable() {
    return this.statements
      .countHealthyAvailable
      .get()
      .count;
  }

  getConnectionSettings(proxyId) {
    const settings =
      this.connectionSettings.get(proxyId);

    if (!settings) {
      throw new ProxyUnavailableError(
        `Connection settings are unavailable for proxy ${proxyId}.`,
      );
    }

    return {
      ...settings,
    };
  }

  recordHealthSuccess(
    proxyId,
    {
      latencyMs,
    },
  ) {
    this.getRequiredProxy(proxyId);

    this.statements.healthSuccess.run({
      id: proxyId,
      latencyMs:
        Math.max(
          0,
          Math.round(latencyMs),
        ),
      now: new Date().toISOString(),
    });

    return this.getRequiredProxy(proxyId);
  }

  recordHealthFailure(
    proxyId,
    {
      errorMessage,
      cooldownMs,
    },
  ) {
    this.getRequiredProxy(proxyId);

    const now = new Date();

    this.statements.healthFailure.run({
      id: proxyId,
      lastError:
        safeLastError(errorMessage),

      cooldownUntil:
        new Date(
          now.getTime() + cooldownMs,
        ).toISOString(),

      now: now.toISOString(),
    });

    return this.getRequiredProxy(proxyId);
  }

  disableProxy(proxyId) {
    this.getRequiredProxy(proxyId);

    this.statements.disable.run({
      id: proxyId,
      now: new Date().toISOString(),
    });

    return this.getRequiredProxy(proxyId);
  }

  enableProxy(proxyId) {
    this.getRequiredProxy(proxyId);

    this.statements.enable.run({
      id: proxyId,
      now: new Date().toISOString(),
    });

    return this.getRequiredProxy(proxyId);
  }
}