import {
  randomUUID,
} from 'node:crypto';

import {
  SessionAllocationMismatchError,
  SessionClosedError,
  SessionError,
} from '../core/errors.js';

import {
  CookieJar,
} from './cookie-jar.js';

function freezeIdentity(value) {
  return Object.freeze({
    ...value,
  });
}

export class SessionManager {
  constructor({
    dispatcherPool,
  }) {
    if (
      !dispatcherPool
      || typeof dispatcherPool
        .getForAllocation
        !== 'function'
      || typeof dispatcherPool
        .closeForAllocation
        !== 'function'
    ) {
      throw new TypeError(
        'dispatcherPool must provide getForAllocation() and closeForAllocation().',
      );
    }

    this.dispatcherPool =
      dispatcherPool;

    this.sessions =
      new Map();
  }

  async createForJob({
    job,
    allocation,
  }) {
    if (
      !job
      || typeof job !== 'object'
    ) {
      throw new TypeError(
        'job is required.',
      );
    }

    if (
      !allocation
      || typeof allocation
        !== 'object'
    ) {
      throw new TypeError(
        'allocation is required.',
      );
    }

    if (
      allocation.jobId !== job.id
    ) {
      throw new SessionAllocationMismatchError(
        'Cannot create session from an allocation owned by another job.',
      );
    }

    const existing =
      this.sessions.get(job.id);

    if (existing) {
      if (existing.closed) {
        this.sessions.delete(
          job.id,
        );
      } else if (
        existing.allocationId
        === allocation.allocationId
      ) {
        return existing;
      } else {
        throw new SessionAllocationMismatchError(
          'Job already has a session bound to a different allocation.',
        );
      }
    }

    const dispatcher =
      await this.dispatcherPool
        .getForAllocation(
          allocation,
        );

    if (!dispatcher) {
      throw new SessionError(
        'Dispatcher pool did not return a dispatcher.',
      );
    }

    const cookieJar =
      new CookieJar();

    const session = {
      sessionId:
        randomUUID(),

      jobId:
        job.id,

      allocationId:
        allocation.allocationId,

      proxyId:
        allocation.proxyId,

      assignedIp:
        allocation.ip,

      port:
        allocation.port,

      dispatcher,
      cookieJar,

      createdAt:
        new Date().toISOString(),

      closedAt: null,
      closed: false,
    };

    const immutableIdentity =
      freezeIdentity({
        sessionId:
          session.sessionId,

        jobId:
          session.jobId,

        allocationId:
          session.allocationId,

        proxyId:
          session.proxyId,

        assignedIp:
          session.assignedIp,

        port:
          session.port,

        createdAt:
          session.createdAt,
      });

    Object.defineProperties(
      session,
      {
        sessionId: {
          value:
            immutableIdentity
              .sessionId,

          enumerable: true,
        },

        jobId: {
          value:
            immutableIdentity
              .jobId,

          enumerable: true,
        },

        allocationId: {
          value:
            immutableIdentity
              .allocationId,

          enumerable: true,
        },

        proxyId: {
          value:
            immutableIdentity
              .proxyId,

          enumerable: true,
        },

        assignedIp: {
          value:
            immutableIdentity
              .assignedIp,

          enumerable: true,
        },

        port: {
          value:
            immutableIdentity
              .port,

          enumerable: true,
        },

        createdAt: {
          value:
            immutableIdentity
              .createdAt,

          enumerable: true,
        },
      },
    );

    this.sessions.set(
      job.id,
      session,
    );

    return session;
  }

  getForJob(jobId) {
    const session =
      this.sessions.get(jobId);

    if (!session) {
      return null;
    }

    if (session.closed) {
      throw new SessionClosedError(
        `Session for job ${jobId} is closed.`,
      );
    }

    return session;
  }

  async closeForJob(jobId) {
    const session =
      this.sessions.get(jobId);

    if (!session) {
      return false;
    }

    if (session.closed) {
      this.sessions.delete(
        jobId,
      );

      return false;
    }

    session.cookieJar.clear();

    session.closed = true;

    session.closedAt =
      new Date().toISOString();

    this.sessions.delete(
      jobId,
    );

    await this.dispatcherPool
      .closeForAllocation(
        session.allocationId,
      );

    return true;
  }

  async closeAll() {
    const jobIds =
      Array.from(
        this.sessions.keys(),
      );

    for (const jobId of jobIds) {
      await this.closeForJob(
        jobId,
      );
    }
  }

  get size() {
    return this.sessions.size;
  }
}