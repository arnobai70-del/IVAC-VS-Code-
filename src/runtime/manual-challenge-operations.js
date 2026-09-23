import {
  isTerminalJobState,
  JOB_STATES,
} from '../jobs/job-state.js';


const MANUAL_CHALLENGE_STATE =
  JOB_STATES
    .WAITING_FOR_MANUAL_CHALLENGE;


function requireObject(
  value,
  name,
) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(
      value,
    )
  ) {
    throw new TypeError(
      `${name} must be an object.`,
    );
  }

  return value;
}


function requireFunction(
  value,
  name,
) {
  if (
    typeof value !== 'function'
  ) {
    throw new TypeError(
      `${name} must be a function.`,
    );
  }

  return value;
}


function requireNonEmptyString(
  value,
  name,
) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new TypeError(
      `${name} must be a non-empty string.`,
    );
  }

  return value.trim();
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


function projectAllocation(
  allocation,
) {
  if (!allocation) {
    return null;
  }

  return Object.freeze({
    allocationId:
      requireNonEmptyString(
        allocation.allocationId,
        'allocation.allocationId',
      ),

    status:
      requireNonEmptyString(
        allocation.status,
        'allocation.status',
      ),
  });
}


function projectWaitingJob({
  job,
  allocation,
}) {
  requireObject(
    job,
    'job',
  );

  const state =
    requireNonEmptyString(
      job.state,
      'job.state',
    );

  const waiting =
    state
    === MANUAL_CHALLENGE_STATE;

  const projectedAllocation =
    projectAllocation(
      allocation,
    );

  return Object.freeze({
    jobId:
      requireNonEmptyString(
        job.id,
        'job.id',
      ),

    state,

    currentStep:
      typeof job.currentStep
        === 'string'
        && job.currentStep.trim() !== ''
        ? job.currentStep.trim()
        : null,

    retryCount:
      requireNonNegativeInteger(
        job.retryCount,
        'job.retryCount',
      ),

    version:
      requireNonNegativeInteger(
        job.version,
        'job.version',
      ),

    manualChallengeRequired:
      waiting,

    liveAllocation:
      projectedAllocation,

    /*
     * This is deliberately only the durable eligibility state.
     *
     * The original in-memory JobContext/session is still required
     * by ExecutionWorker.resumeManualChallenge().
     *
     * This service never claims restart-resume capability.
     */
    durableResumeEligible:
      waiting
      && projectedAllocation
        !== null,
  });
}


function projectResumeOutcome({
  jobId,
  outcome,
  job,
  allocation,
}) {
  requireObject(
    outcome,
    'manual challenge resume outcome',
  );

  const status =
    requireNonEmptyString(
      outcome.status,
      'manual challenge resume outcome.status',
    );

  return Object.freeze({
    jobId,

    status,

    errorCode:
      typeof outcome.errorCode
        === 'string'
        && outcome.errorCode.trim() !== ''
        ? outcome.errorCode.trim()
        : null,

    state:
      job
        ? requireNonEmptyString(
            job.state,
            'job.state',
          )
        : null,

    currentStep:
      job
        && typeof job.currentStep
          === 'string'
        && job.currentStep.trim() !== ''
        ? job.currentStep.trim()
        : null,

    liveAllocationPreserved:
      allocation
      !== null,

    allocationId:
      allocation
        ? requireNonEmptyString(
            allocation.allocationId,
            'allocation.allocationId',
          )
        : null,
  });
}


/*
 * Phase 35 explicit manual-challenge operations boundary.
 *
 * Safety properties:
 *
 * - no automatic resume;
 * - no new credentials or workflow input accepted;
 * - no replacement IP acquisition;
 * - no session recreation;
 * - no CAPTCHA/challenge bypass;
 * - only WAITING_FOR_MANUAL_CHALLENGE jobs may be resumed;
 * - a live existing allocation must still belong to the job;
 * - ExecutionWorker remains responsible for requiring the
 *   original same-process JobContext/session;
 * - restart cannot silently reconstruct a challenge session;
 * - only bounded operational metadata is returned;
 * - dashboard remains read-only.
 */
export class ManualChallengeOperations {
  constructor({
    jobStore,
    ipAllocator,
    intakeExecutionHandler,
  }) {
    requireObject(
      jobStore,
      'jobStore',
    );

    requireFunction(
      jobStore.getJobById,
      'jobStore.getJobById',
    );

    requireFunction(
      jobStore.listIncompleteJobs,
      'jobStore.listIncompleteJobs',
    );

    requireObject(
      ipAllocator,
      'ipAllocator',
    );

    requireFunction(
      ipAllocator.getActiveForJob,
      'ipAllocator.getActiveForJob',
    );

    requireObject(
      intakeExecutionHandler,
      'intakeExecutionHandler',
    );

    requireFunction(
      intakeExecutionHandler
        .resumeManualChallenge,
      'intakeExecutionHandler.resumeManualChallenge',
    );

    this.jobStore =
      jobStore;

    this.ipAllocator =
      ipAllocator;

    this.intakeExecutionHandler =
      intakeExecutionHandler;
  }


  get(
    jobId,
  ) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    const job =
      this.jobStore
        .getJobById(
          normalizedJobId,
        );

    if (!job) {
      return null;
    }

    const allocation =
      this.ipAllocator
        .getActiveForJob(
          normalizedJobId,
        );

    return projectWaitingJob({
      job,
      allocation,
    });
  }


  listWaiting() {
    const jobs =
      this.jobStore
        .listIncompleteJobs();

    if (
      !Array.isArray(
        jobs,
      )
    ) {
      throw new TypeError(
        'jobStore.listIncompleteJobs() must return an array.',
      );
    }

    const projected =
      jobs
        .filter(
          (job) =>
            job?.state
            === MANUAL_CHALLENGE_STATE,
        )
        .map(
          (job) =>
            projectWaitingJob({
              job,

              allocation:
                this.ipAllocator
                  .getActiveForJob(
                    job.id,
                  ),
            }),
        );

    return Object.freeze(
      projected,
    );
  }


  async resume({
    jobId,
  }) {
    const normalizedJobId =
      requireNonEmptyString(
        jobId,
        'jobId',
      );

    const job =
      this.jobStore
        .getJobById(
          normalizedJobId,
        );

    if (!job) {
      throw new Error(
        `Job ${normalizedJobId} does not exist.`,
      );
    }

    if (
      job.state
      !== MANUAL_CHALLENGE_STATE
    ) {
      throw new Error(
        `Job ${normalizedJobId} is not waiting for manual challenge handling.`,
      );
    }

    const allocationBefore =
      this.ipAllocator
        .getActiveForJob(
          normalizedJobId,
        );

    if (!allocationBefore) {
      throw new Error(
        `Job ${normalizedJobId} cannot resume manual challenge without its live IP allocation.`,
      );
    }

    if (
      allocationBefore.jobId
      !== normalizedJobId
    ) {
      throw new Error(
        'Live allocation belongs to another job.',
      );
    }

    /*
     * No input, credential, OTP, cookie, dispatcher, session,
     * replacement IP, or challenge solution enters this boundary.
     *
     * The underlying execution runtime must reuse the original
     * same-process execution context.
     */
    const outcome =
      await this.intakeExecutionHandler
        .resumeManualChallenge({
          jobId:
            normalizedJobId,
        });

    const jobAfter =
      this.jobStore
        .getJobById(
          normalizedJobId,
        );

    const allocationAfter =
      this.ipAllocator
        .getActiveForJob(
          normalizedJobId,
        );

    if (!jobAfter) {
      throw new Error(
        'Manual challenge resume lost durable job state.',
      );
    }

    const terminalAfter =
      isTerminalJobState(
        jobAfter.state,
      );

    /*
     * A non-terminal manual-resume outcome must retain the exact
     * same live allocation. Never treat allocation disappearance
     * as a successful preservation state and never acquire a
     * replacement allocation here.
     */
    if (
      !terminalAfter
      && !allocationAfter
    ) {
      throw new Error(
        'Manual challenge resume lost the job live IP allocation before terminalization.',
      );
    }

    /*
     * Terminal finalization may legitimately release the allocation.
     *
     * If an allocation still exists after either terminal or
     * non-terminal handling, its job/IP binding must remain exactly
     * the same allocation that entered the explicit resume.
     */
    if (
      allocationAfter
      && (
        allocationAfter.allocationId
          !== allocationBefore.allocationId
        || allocationAfter.jobId
          !== allocationBefore.jobId
        || allocationAfter.ip
          !== allocationBefore.ip
        || allocationAfter.port
          !== allocationBefore.port
      )
    ) {
      throw new Error(
        'Manual challenge resume changed the job allocation identity.',
      );
    }

    return projectResumeOutcome({
      jobId:
        normalizedJobId,

      outcome,

      job:
        jobAfter,

      allocation:
        allocationAfter,
    });
  }
}