import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { installTrustedTypesPolicy } from './app/core/crypto/trusted-types';

installTrustedTypesPolicy();

bootstrapApplication(App, appConfig).catch(() => {
  document.body.textContent = 'r16a vault could not start. Please reload the page.';
});
