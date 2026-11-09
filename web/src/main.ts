import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';
import { installTrustedTypesPolicy } from './app/core/crypto/trusted-types';

installTrustedTypesPolicy();

bootstrapApplication(App, appConfig).catch(() => {
  document.body.textContent = 'Zaltys could not start. Please reload the page.';
});
