import {
  z,
} from 'zod';

const stepIdSchema =
  z.string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[A-Za-z_][A-Za-z0-9_-]*$/,
      'Step id contains unsupported characters.',
    );

const relativeRouteSchema =
  z.string()
    .trim()
    .min(1)
    .max(2000)
    .refine(
      (value) =>
        !value.includes('://')
        && !value.startsWith('//')
        && !value.includes('\\'),
      {
        message:
          'Workflow HTTP route must be relative to the configured target base URL.',
      },
    );

const statusesSchema =
  z.array(
    z.number()
      .int()
      .min(100)
      .max(599),
  )
    .min(1)
    .max(50)
    .refine(
      (statuses) =>
        new Set(
          statuses,
        ).size
        === statuses.length,
      {
        message:
          'Expected HTTP status list contains duplicates.',
      },
    );

const httpStepSchema =
  z.object({
    id:
      stepIdSchema,

    type:
      z.literal('http'),

    method:
      z.enum([
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'HEAD',
      ]),

    route:
      relativeRouteSchema,

    headers:
      z.record(
        z.string()
          .trim()
          .min(1),

        z.string(),
      )
        .optional()
        .default({}),

    body:
      z.unknown()
        .optional(),

    expect:
      z.object({
        statuses:
          statusesSchema,

        response:
          z.enum([
            'json',
            'text',
            'empty',
          ]),
      }),
  })
    .strict();

const otpPrepareStepSchema =
  z.object({
    id:
      stepIdSchema,

    type:
      z.literal(
        'otp.prepare',
      ),

    phone:
      z.string()
        .trim()
        .min(1),
  })
    .strict();

const otpWaitStepSchema =
  z.object({
    id:
      stepIdSchema,

    type:
      z.literal(
        'otp.wait',
      ),
  })
    .strict();

export const workflowStepSchema =
  z.discriminatedUnion(
    'type',
    [
      httpStepSchema,
      otpPrepareStepSchema,
      otpWaitStepSchema,
    ],
  );

export const workflowDefinitionSchema =
  z.object({
    version:
      z.literal(1),

    name:
      z.string()
        .trim()
        .min(1)
        .max(200),

    enabled:
      z.boolean(),

    steps:
      z.array(
        workflowStepSchema,
      ),
  })
    .strict()
    .superRefine(
      (
        workflow,
        context,
      ) => {
        if (
          workflow.enabled
          && workflow.steps.length
            === 0
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'steps',
            ],

            message:
              'Enabled workflow must contain at least one step.',
          });
        }

        const seen =
          new Set();

        for (
          let index = 0;
          index
            < workflow.steps.length;
          index += 1
        ) {
          const step =
            workflow.steps[index];

          if (
            seen.has(
              step.id,
            )
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode
                  .custom,

              path: [
                'steps',
                index,
                'id',
              ],

              message:
                `Duplicate workflow step id: ${step.id}`,
            });

            continue;
          }

          seen.add(
            step.id,
          );
        }
      },
    );

export function validateWorkflowDefinition(
  value,
) {
  return workflowDefinitionSchema
    .parse(
      value,
    );
}

export function formatWorkflowIssues(
  error,
) {
  if (
    !(error instanceof z.ZodError)
  ) {
    return [];
  }

  return error.issues.map(
    (issue) => ({
      path:
        issue.path.join('.'),

      message:
        issue.message,
    }),
  );
}