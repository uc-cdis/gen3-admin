// Runs once in the browser before the app hydrates (Next.js 15.3+ convention).
// RUM is initialised here rather than at the top of pages/_app.jsx, which
// also ran during server rendering, and early enough that the first page view
// and its resources are captured.
import { datadogRum } from '@datadog/browser-rum';
import { nextjsPlugin } from '@datadog/browser-rum-nextjs';

import { datadogConfig, datadogEnabled } from '@/lib/datadog';

if (datadogEnabled) {
  datadogRum.init({
    ...datadogConfig,
    trackResources: true,
    trackUserInteractions: true,
    trackLongTasks: true,
    // The SDK's default is "mask", which replaces all text with x's and makes
    // replays look broken. Mask only what users type -- tokens, passwords,
    // AWS keys entered in the bootstrap wizard -- and show the rest.
    defaultPrivacyLevel: 'mask-user-input',
    plugins: [nextjsPlugin()],
  });
}
