const allowedStepTypes =
  new Set([
    'http',
    'otp.prepare',
    'otp.wait',
    'documents.prepare',
    'documents.upload',
  ]);

const forbiddenWorkflowPatterns =
  [
    'captcha',
    'recaptcha',
    'hcaptcha',
    'turnstile',
    'cloudflare',
    'bypass',
    'token-steal',
    'credential-dump',
  ];

function normalizeText(
  value,
) {
  if (
    typeof value !== 'string'
  ) {
    return '';
  }

  return value
    .trim()
    .toLowerCase();
}

function assertSafeStepType(
  step,
) {
  if (
    !allowedStepTypes.has(
      step.type,
    )
  ) {
    throw new Error(
      `Unsupported IVAC workflow step type: ${step.type}`,
    );
  }
}

function assertNoForbiddenPattern(
  value,
  path,
) {
  const text =
    normalizeText(
      value,
    );

  for (
    const pattern
    of forbiddenWorkflowPatterns
  ) {
    if (
      text.includes(
        pattern,
      )
    ) {
      throw new Error(
        `Forbidden workflow pattern detected at ${path}.`,
      );
    }
  }
}

function inspectStep(
  step,
  index,
) {
  assertSafeStepType(
    step,
  );

  assertNoForbiddenPattern(
    step.id,
    `steps.${index}.id`,
  );

  if (
    step.route
  ) {
    assertNoForbiddenPattern(
      step.route,
      `steps.${index}.route`,
    );
  }

  if (
    step.body
  ) {
    assertNoForbiddenPattern(
      JSON.stringify(
        step.body,
      ),
      `steps.${index}.body`,
    );
  }
}

export function validateIvacWorkflowPolicy(
  workflow,
) {
  if (
    !workflow
    || typeof workflow
      !== 'object'
  ) {
    throw new TypeError(
      'Workflow must be an object.',
    );
  }

  if (
    workflow.version
      !== 1
  ) {
    throw new Error(
      'Unsupported IVAC workflow version.',
    );
  }

  if (
    !Array.isArray(
      workflow.steps,
    )
  ) {
    throw new Error(
      'Workflow steps must be an array.',
    );
  }

  for (
    let index = 0;
    index < workflow.steps.length;
    index += 1
  ) {
    inspectStep(
      workflow.steps[index],
      index,
    );
  }

  return true;
}

export function getIvacWorkflowCapabilities() {
  return {
    stepTypes:
      [
        ...allowedStepTypes,
      ],

    manualChallenge:
      'required',

    endpointVerification:
      'required',

    automaticChallengeBypass:
      false,

    credentialPersistence:
      false,

    otpPersistence:
      false,

    cookiePersistence:
      false,
  };
}