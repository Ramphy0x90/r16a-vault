import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AuthLayout } from './auth-layout';

/**
 * Landing page for the mobile sign in link. Normally the phone hands this link straight to
 * the Zaltys app. It only opens in a browser when the app is not installed or the domain
 * association is not set up, and then the one time code is useless here, it needs a secret
 * that only the app holds. The page never reads or sends the code.
 */
@Component({
  selector: 'app-app-callback-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthLayout],
  template: `
    <app-auth-layout
      heading="Continue in the app"
      subtitle="This sign in link belongs to the Zaltys mobile app."
    >
      <p class="muted">
        Open Zaltys on your phone and start single sign on there again. If this page keeps
        appearing, the app is not installed or this server is not set up to open the app.
      </p>
    </app-auth-layout>
  `,
})
export class AppCallbackPage {}
