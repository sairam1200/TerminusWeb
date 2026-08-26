import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const schema = JSON.parse(
  await readFile(new URL("./environment.schema.json", import.meta.url), "utf8"),
);
const immutableSha = /^[0-9a-f]{40}$/i;

export function validateEnvironment(environment, profileName) {
  const profile = schema.profiles[profileName];
  if (!profile) {
    return failure([`unknown profile: ${profileName}`], profileName);
  }

  const errors = [];
  const present = [];
  for (const name of profile.required) {
    if (!environment[name]?.trim())
      errors.push(`missing required variable: ${name}`);
    else present.push(name);
  }

  const evidenceClass = environment.TERMINUS_EVIDENCE_CLASS?.trim();
  if (
    evidenceClass &&
    !profile.allowedEvidenceClasses.includes(evidenceClass)
  ) {
    errors.push(
      `TERMINUS_EVIDENCE_CLASS is not allowed for profile ${profileName}`,
    );
  }

  for (const name of schema.shaVariables) {
    const value = environment[name]?.trim();
    if (value && !immutableSha.test(value))
      errors.push(`${name} must be a 40-character immutable Git SHA`);
  }

  for (const [name, protocols] of Object.entries(schema.urlVariables)) {
    const value = environment[name]?.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (!protocols.includes(parsed.protocol))
        errors.push(`${name} must use ${protocols.join(" or ")}`);
      if (parsed.username || parsed.password)
        errors.push(`${name} must not embed credentials`);
    } catch {
      errors.push(`${name} must be an absolute URL`);
    }
  }

  for (const [name, allowed] of Object.entries(schema.fixedValues)) {
    const value = environment[name]?.trim();
    if (value && !allowed.includes(value))
      errors.push(`${name} must be one of: ${allowed.join(", ")}`);
  }

  const browserBaseUrl = environment.TERMINUS_BROWSER_BASE_URL?.trim();
  const expectedBrowserOrigin =
    environment.TERMINUS_EXPECTED_BROWSER_ORIGIN?.trim();
  if (browserBaseUrl && expectedBrowserOrigin) {
    try {
      const parsedExpectedOrigin = new URL(expectedBrowserOrigin);
      if (
        parsedExpectedOrigin.href !== `${parsedExpectedOrigin.origin}/` ||
        new URL(browserBaseUrl).origin !== parsedExpectedOrigin.origin
      ) {
        errors.push(
          "TERMINUS_EXPECTED_BROWSER_ORIGIN must exactly match the browser page origin",
        );
      }
    } catch {
      // The individual URL checks above report malformed inputs without exposing values.
    }
  }

  return Object.freeze({
    ok: errors.length === 0,
    profile: profileName,
    evidenceClass: evidenceClass ?? null,
    present: present.sort(),
    secretVariablesPresent: schema.secretVariables.filter((name) =>
      Boolean(environment[name]?.trim()),
    ),
    errors,
  });
}

function failure(errors, profile) {
  return Object.freeze({
    ok: false,
    profile,
    evidenceClass: null,
    present: [],
    secretVariablesPresent: [],
    errors,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const profile = process.argv[2] ?? "double";
  const result = validateEnvironment(process.env, profile);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
