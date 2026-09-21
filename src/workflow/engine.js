import {
  JobCancelledError,
  WorkflowConfigError,
  WorkflowStepError,
} from '../core/errors.js';

import {
  validateWorkflowDefinition,
} from './schema.js';

import {
  renderTemplate,
} from './template.js';

function assertNotAborted(
  signal,
) {
  if (
    signal?.aborted
  ) {
    throw new JobCancelledError(
      'Workflow execution was cancelled.',
    );
  }
}

function createTemplateContext(
  jobContext,
) {
  return {
    input:
      jobContext.input
      ?? {},

    job:
      jobContext.job
      ?? {},

    allocation:
      jobContext.allocation
      ?? {},

    session: {
      sessionId:
        jobContext.session
          ?.sessionId
        ?? null,

      jobId:
        jobContext.session
          ?.jobId
        ?? null,

      allocationId:
        jobContext.session
          ?.allocationId
        ?? null,

      proxyId:
        jobContext.session
          ?.proxyId
        ?? null,

      assignedIp:
        jobContext.session
          ?.assignedIp
        ?? null,

      port:
        jobContext.session
          ?.port
        ?? null,
    },

    responses:
      jobContext.responses
      ?? {},

    otp:
      jobContext.otp
      ?? {},
  };
}

function renderHeaders(
  headers,
  context,
) {
  const output = {};

  for (
    const [
      name,
      templateValue,
    ]
    of Object.entries(
      headers ?? {},
    )
  ) {
    const rendered =
      renderTemplate(
        templateValue,
        context,
      );

    if (
      rendered === null
      || rendered === undefined
      || typeof rendered
        === 'object'
      || typeof rendered
        === 'function'
      || typeof rendered
        === 'symbol'
    ) {
      throw new WorkflowStepError(
        `Workflow header ${name} did not resolve to a scalar value.`,
      );
    }

    output[name] =
      String(
        rendered,
      );
  }

  return output;
}

function requireRenderedString(
  value,
  fieldName,
) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
  ) {
    throw new WorkflowStepError(
      `${fieldName} must resolve to a non-empty string.`,
    );
  }

  return value;
}

export class WorkflowEngine {
  constructor({
    targetHttpClient,
    otpService,
    maxSteps,
  }) {
    if (
      !targetHttpClient
      || typeof targetHttpClient
        .requestStep
        !== 'function'
    ) {
      throw new TypeError(
        'targetHttpClient with requestStep() is required.',
      );
    }

    if (
      !otpService
      || typeof otpService
        .prepareForJobContext
        !== 'function'
      || typeof otpService
        .waitForJobContext
        !== 'function'
    ) {
      throw new TypeError(
        'A valid otpService is required.',
      );
    }

    if (
      !Number.isInteger(
        maxSteps,
      )
      || maxSteps < 1
    ) {
      throw new TypeError(
        'maxSteps must be a positive integer.',
      );
    }

    this.targetHttpClient =
      targetHttpClient;

    this.otpService =
      otpService;

    this.maxSteps =
      maxSteps;
  }

  async execute({
    workflow,
    jobContext,
    signal = null,
  }) {
    let validatedWorkflow;

    try {
      validatedWorkflow =
        validateWorkflowDefinition(
          workflow,
        );
    } catch (error) {
      throw new WorkflowConfigError(
        'Workflow failed runtime validation.',
        {
          cause: error,
        },
      );
    }

    if (
      !validatedWorkflow.enabled
    ) {
      throw new WorkflowConfigError(
        'Workflow execution is disabled.',
      );
    }

    if (
      validatedWorkflow
        .steps.length
      > this.maxSteps
    ) {
      throw new WorkflowConfigError(
        `Workflow exceeds the configured maximum of ${this.maxSteps} steps.`,
      );
    }

    if (
      !jobContext
      || typeof jobContext
        .setCurrentStep
        !== 'function'
      || typeof jobContext
        .setResponse
        !== 'function'
    ) {
      throw new TypeError(
        'A valid jobContext is required.',
      );
    }

    let completedSteps =
      0;

    for (
      const step
      of validatedWorkflow.steps
    ) {
      assertNotAborted(
        signal,
      );

      jobContext.setCurrentStep(
        step.id,
      );

      const context =
        createTemplateContext(
          jobContext,
        );

      switch (
        step.type
      ) {
        case 'http': {
          const route =
            requireRenderedString(
              renderTemplate(
                step.route,
                context,
              ),
              `Workflow route for step ${step.id}`,
            );

          const headers =
            renderHeaders(
              step.headers,
              context,
            );

          const body =
            step.body === undefined
              ? undefined
              : renderTemplate(
                  step.body,
                  context,
                );

          const response =
            await this.targetHttpClient
              .requestStep({
                stepId:
                  step.id,

                method:
                  step.method,

                route,

                headers,

                body,

                expect:
                  step.expect,
              });

          jobContext.setResponse(
            step.id,
            response,
          );

          break;
        }

        case 'otp.prepare': {
          const phone =
            requireRenderedString(
              renderTemplate(
                step.phone,
                context,
              ),
              `OTP phone for step ${step.id}`,
            );

          const watch =
            await this.otpService
              .prepareForJobContext({
                jobContext,
                phone,
              });

          jobContext.setResponse(
            step.id,
            {
              prepared:
                true,

              watchId:
                watch.watchId,

              capturedAt:
                watch.capturedAt,

              baselineCount:
                watch
                  .baselineFingerprints
                  .length,
            },
          );

          break;
        }

        case 'otp.wait': {
          const result =
            await this.otpService
              .waitForJobContext({
                jobContext,
                signal,
              });

          /*
           * Do not copy the OTP value into generic
           * workflow responses. It remains available
           * only under jobContext.otp and therefore as
           * {{otp.code}} for a later workflow step.
           */
          jobContext.setResponse(
            step.id,
            {
              matched:
                true,

              createdAt:
                result.createdAt,

              matchedAt:
                result.matchedAt,

              polls:
                result.polls,
            },
          );

          break;
        }

        default:
          throw new WorkflowConfigError(
            `Unsupported workflow step type: ${step.type}`,
          );
      }

      completedSteps += 1;
    }

    jobContext.setCurrentStep(
      null,
    );

    return {
      status:
        'COMPLETED',

      workflowName:
        validatedWorkflow.name,

      completedSteps,
    };
  }
}