import type { Routes } from '@angular/router';

import { anonymousGuard, lockedGuard, unlockedGuard } from './core/session/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'vault' },
  {
    path: 'login',
    canActivate: [anonymousGuard],
    title: 'Sign in · r16a vault',
    loadComponent: () => import('./auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [anonymousGuard],
    title: 'Create account · r16a vault',
    loadComponent: () => import('./auth/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'unlock',
    canActivate: [lockedGuard],
    title: 'Unlock · r16a vault',
    loadComponent: () => import('./auth/unlock.page').then((m) => m.UnlockPage),
  },
  {
    path: '',
    canActivate: [unlockedGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      {
        path: 'vault',
        title: 'Vault · r16a vault',
        loadComponent: () =>
          import('./credentials/credentials.page').then((m) => m.CredentialsPage),
      },
      {
        path: 'generator',
        title: 'Generator · r16a vault',
        loadComponent: () => import('./generator/generator.page').then((m) => m.GeneratorPage),
      },
      {
        path: 'settings',
        title: 'Settings · r16a vault',
        loadComponent: () => import('./settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: 'vault' },
];
