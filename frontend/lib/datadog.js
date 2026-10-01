// Datadog RUM settings, read from NEXT_PUBLIC_* variables.
//
// Next.js inlines NEXT_PUBLIC_* values into the browser bundle at BUILD time,
// and only when each is written out literally as process.env.NEXT_PUBLIC_X --
// so these are listed one by one rather than looked up by name, and an image
// must be built with them set (see Dockerfile.frontend).
//
// RUM stays off unless both the application ID and client token are provided.
// They used to be hardcoded, which meant every install of this repo -- including
// other organisations' -- reported into one Datadog account.

function rate(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}

export const datadogConfig = {
  applicationId: process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID || '',
  clientToken: process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN || '',
  // US1-FED (Datadog for Government). Override for a commercial site, e.g.
  // datadoghq.com or us5.datadoghq.com.
  site: process.env.NEXT_PUBLIC_DD_SITE || 'ddog-gov.com',
  service: process.env.NEXT_PUBLIC_DD_SERVICE || 'csoc',
  // Defaulting to "production" sent every local dev session into prod data.
  env: process.env.NEXT_PUBLIC_DD_ENV || process.env.NEXT_PUBLIC_ENV || 'dev',
  version: process.env.NEXT_PUBLIC_DD_VERSION || undefined,
  sessionSampleRate: rate(process.env.NEXT_PUBLIC_DD_SESSION_SAMPLE_RATE, 100),
  sessionReplaySampleRate: rate(process.env.NEXT_PUBLIC_DD_SESSION_REPLAY_SAMPLE_RATE, 20),
  // Optional: send through your own endpoint so ad blockers, which commonly
  // block browser-intake-ddog-gov.com, do not drop sessions and replays.
  proxy: process.env.NEXT_PUBLIC_DD_PROXY || undefined,
};

export const datadogEnabled = Boolean(datadogConfig.applicationId && datadogConfig.clientToken);
