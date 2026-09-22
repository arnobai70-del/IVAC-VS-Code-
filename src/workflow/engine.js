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

    /*
     * Strictly allowlisted memory-only runtime metadata.
     *
     * Do not expose the entire JobContext runtime container to
     * workflow templates. Only values explicitly required by the
     * verified workflow contract are projected here.
     */
    runtime: {
      deviceId:
        jobContext.runtime
          ?.deviceId
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
      headers
      ?? {},
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

    output[
      name
    ] =
      String(
        rendered,
      );
  }

  return output;
}

function renderFormFields(
  fields,
  context,
) {
  const output = {};

  for (
    const [
      name,
      templateValue,
    ]
    of Object.entries(
      fields
      ?? {},
    )
  ) {
    const rendered =
      renderTemplate(
        templateValue,
        context,
      );

    if (
      rendered === null
    ) {
      output[
        name
      ] =
        '';

      continue;
    }

    if (
      typeof rendered !== 'string'
      && typeof rendered
        !== 'number'
      && typeof rendered
        !== 'boolean'
    ) {
      throw new WorkflowStepError(
        `Multipart field ${name} did not resolve to a scalar value.`,
      );
    }

    output[
      name
    ] =
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

function publicDocument(
  document,
) {
  return {
    id:
      document.id,

    name:
      document.name,

    contentType:
      document.contentType,

    sizeBytes:
      document.sizeBytes,

    sha256:
      document.sha256,

    sourceOrigin:
      document.sourceOrigin,

    sourcePath:
      document.sourcePath,
  };
}

function findResumeIndex({
  steps,
  jobContext,
}) {
  let firstIncompleteIndex =
    steps.length;

  for (
    let index = 0;
    index < steps.length;
    index += 1
  ) {
    if (
      !jobContext.hasResponse(
        steps[index].id,
      )
    ) {
      firstIncompleteIndex =
        index;

      break;
    }
  }

  /*
   * Completed workflow responses must form one contiguous prefix.
   *
   * If an incomplete step appears before a later completed step,
   * the in-memory execution state is inconsistent. Fail closed
   * rather than skipping around potentially destructive steps.
   */
  for (
    let index =
      firstIncompleteIndex + 1;
    index < steps.length;
    index += 1
  ) {
    if (
      jobContext.hasResponse(
        steps[index].id,
      )
    ) {
      throw new WorkflowStepError(
        'Workflow resume state contains non-contiguous completed steps.',
      );
    }
  }

  if (
    firstIncompleteIndex
    < steps.length
    && jobContext.currentStep !== null
    && jobContext.currentStep !== undefined
    && jobContext.currentStep
      !== steps[
        firstIncompleteIndex
      ].id
  ) {
    throw new WorkflowStepError(
      'Workflow resume state does not match the current step.',
    );
  }

  if (
    firstIncompleteIndex
    === steps.length
    && jobContext.currentStep !== null
    && jobContext.currentStep !== undefined
  ) {
    throw new WorkflowStepError(
      'Workflow is fully completed but still has an active current step.',
    );
  }

  return firstIncompleteIndex;
}

export class WorkflowEngine {
  constructor({
    targetHttpClient,
    otpService,
    documentService = null,
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
      documentService !== null
      && (
        typeof documentService
          !== 'object'
        || typeof documentService
          .prepareForJobContext
          !== 'function'
      )
    ) {
      throw new TypeError(
        'documentService must expose prepareForJobContext().',
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

    this.documentService =
      documentService;

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
          cause:
            error,
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
      || typeof jobContext
        .hasResponse
        !== 'function'
    ) {
      throw new TypeError(
        'A valid resumable jobContext is required.',
      );
    }

    const resumeIndex =
      findResumeIndex({
        steps:
          validatedWorkflow
            .steps,

        jobContext,
      });

    /*
     * Responses are the in-memory completion markers.
     *
     * Only a contiguous completed prefix may be skipped. The first
     * step without a response is executed again. Therefore:
     *
     * - successful HTTP steps are not replayed;
     * - a challenged/failed HTTP step is re-attempted;
     * - completed OTP prepare/wait steps are not replayed;
     * - completed document preparation is not repeated;
     * - an incomplete documents.upload step re-enters its existing
     *   per-document upload markers and uploads only missing files.
     *
     * These markers are memory-only. No restart-resume guarantee is
     * made.
     */
    let completedSteps =
      resumeIndex;

    for (
      let index =
        resumeIndex;
      index
        < validatedWorkflow
          .steps.length;
      index += 1
    ) {
      const step =
        validatedWorkflow
          .steps[index];

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

        case 'documents.prepare': {
          if (
            !this.documentService
          ) {
            throw new WorkflowConfigError(
              'Workflow requires document integration but no documentService is configured.',
            );
          }

          const sources =
            renderTemplate(
              step.sources,
              context,
            );

          const result =
            await this.documentService
              .prepareForJobContext({
                jobContext,
                sources,
              });

          jobContext.setResponse(
            step.id,
            {
              prepared:
                true,

              count:
                result.count,

              totalBytes:
                result.totalBytes,

              documents:
                result.documents,
            },
          );

          break;
        }

        case 'documents.upload': {
          if (
            typeof this.targetHttpClient
              .uploadPdf
              !== 'function'
          ) {
            throw new WorkflowConfigError(
              'Target HTTP client does not support PDF upload.',
            );
          }

          if (
            !Array.isArray(
              jobContext.documents,
            )
            || jobContext.documents
              .length === 0
          ) {
            throw new WorkflowStepError(
              `Workflow step ${step.id} has no prepared documents to upload.`,
            );
          }

          const route =
            requireRenderedString(
              renderTemplate(
                step.route,
                context,
              ),
              `Document upload route for step ${step.id}`,
            );

          const headers =
            renderHeaders(
              step.headers,
              context,
            );

          const fields =
            renderFormFields(
              step.fields,
              context,
            );

          const uploaded = [];

          for (
            const document
            of jobContext.documents
          ) {
            assertNotAborted(
              signal,
            );

            const existing =
              typeof jobContext
                .getDocumentUpload
                === 'function'
                ? jobContext
                    .getDocumentUpload(
                      step.id,
                      document.id,
                    )
                : null;

            if (existing) {
              uploaded.push({
                document:
                  publicDocument(
                    document,
                  ),

                response:
                  existing,

                reused:
                  true,
              });

              continue;
            }

            const response =
              await this.targetHttpClient
                .uploadPdf({
                  stepId:
                    step.id,

                  route,

                  headers,

                  fieldName:
                    step.fieldName,

                  fields,

                  document,

                  expect:
                    step.expect,
                });

            if (
              typeof jobContext
                .setDocumentUpload
                === 'function'
            ) {
              jobContext
                .setDocumentUpload(
                  step.id,
                  document.id,
                  response,
                );
            }

            uploaded.push({
              document:
                publicDocument(
                  document,
                ),

              response,

              reused:
                false,
            });
          }

          jobContext.setResponse(
            step.id,
            {
              uploadedCount:
                uploaded.length,

              uploads:
                uploaded,
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