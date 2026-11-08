import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { ClipboardService } from '../core/clipboard/clipboard.service';
import { Icon } from '../shared/icon';
import { GeneratedHandoff } from './generated-handoff';
import { GeneratorPanel } from './generator-panel';
import { GeneratorStore } from './generator.store';

@Component({
  selector: 'app-generator-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GeneratorPanel, Icon],
  providers: [GeneratorStore],
  template: `
    <div class="stack page">
      <header>
        <h1>Password generator</h1>
        <p class="muted">
          Generated on this device with a cryptographic random source. Nothing is sent to the
          server.
        </p>
      </header>
      <section class="card">
        <app-generator-panel
          [mode]="gen.mode()"
          [value]="gen.value()"
          [entropy]="gen.entropy()"
          [strength]="gen.strength()"
          [random]="gen.random()"
          [passphrase]="gen.passphrase()"
          [error]="gen.error()"
          (regenerate)="gen.regenerate()"
          (modeChange)="gen.setMode($event)"
          (randomChange)="gen.updateRandom($event)"
          (passphraseChange)="gen.updatePassphrase($event)"
        >
          <button
            actions
            type="button"
            class="icon-btn"
            (click)="copy()"
            aria-label="Copy generated value"
            [disabled]="!gen.value()"
          >
            <app-icon name="copy" />
          </button>
        </app-generator-panel>
      </section>
      <div class="row">
        <button
          type="button"
          class="btn btn-primary"
          (click)="useInNew()"
          [disabled]="!gen.value()"
        >
          <app-icon name="plus" /> Use in a new credential
        </button>
      </div>
    </div>
  `,
  styles: `
    .page {
      max-width: 640px;
    }
  `,
})
export class GeneratorPage {
  protected readonly gen = inject(GeneratorStore);
  private readonly clipboard = inject(ClipboardService);
  private readonly handoff = inject(GeneratedHandoff);
  private readonly router = inject(Router);

  protected copy(): void {
    void this.clipboard.copy(this.gen.value(), 'Password');
  }

  protected useInNew(): void {
    this.handoff.offer(this.gen.value());
    void this.router.navigateByUrl('/vault?new=1');
  }
}
