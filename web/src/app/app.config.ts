import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  inject,
  type ApplicationConfig,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { csrfHeaderInterceptor, sessionExpiryInterceptor } from './core/api/interceptors';
import { ThemeService } from './core/theme/theme.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withFetch(),
      withInterceptors([csrfHeaderInterceptor, sessionExpiryInterceptor]),
    ),
    provideAppInitializer(() => inject(ThemeService).apply()),
  ],
};
