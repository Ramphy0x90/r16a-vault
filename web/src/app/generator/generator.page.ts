import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ClipboardService } from '../core/clipboard/clipboard.service';
import { CopyButton } from '../credentials/copy-button';
import { Icon } from '../shared/icon';
import { GeneratedHandoff } from './generated-handoff';
import { GeneratorPanel } from './generator-panel';
import { GeneratorStore } from './generator.store';

@Component({
  selector: 'app-generator-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GeneratorPanel, Icon, CopyButton],
  providers: [GeneratorStore],
  template: `
    <div class="page">
      <header class="page-head">
        <h1>Generator</h1>
        <p class="muted">
          Made on this device with a cryptographic random source. Nothing is sent to the server.
        </p>
      </header>
      <section class="card card-pad">
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
          <app-copy-button
            actions
            label="Copy generated value"
            [copied]="copied()"
            [disabled]="!gen.value()"
            (copyRequest)="copy()"
          />
        </app-generator-panel>
      </section>
      <div class="actions">
        <button
          type="button"
          class="btn btn-primary"
          (click)="useInNew()"
          [disabled]="!gen.value()"
        >
          <app-icon name="plus" [size]="16" /> Use in a new credential
        </button>
      </div>
    </div>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 20px;
      max-width: 720px;
      padding: 28px 32px 48px;
    }
    .page-head {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
    }
    @media (max-width: 860px) {
      .page {
        padding: 16px 16px 40px;
      }
    }
  `,
})
export class GeneratorPage {
  protected readonly gen = inject(GeneratorStore);
  private readonly clipboard = inject(ClipboardService);
  private readonly handoff = inject(GeneratedHandoff);
  private readonly router = inject(Router);

  protected readonly copied = signal(false);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  protected async copy(): Promise<void> {
    if (!(await this.clipboard.copy(this.gen.value(), 'Password'))) return;
    if (this.copiedTimer) clearTimeout(this.copiedTimer);
    this.copied.set(true);
    this.copiedTimer = setTimeout(() => this.copied.set(false), 1400);
  }

  protected useInNew(): void {
    this.handoff.offer(this.gen.value());
    void this.router.navigateByUrl('/vault?new=1');
  }
}
