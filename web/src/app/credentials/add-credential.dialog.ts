import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';

import { messageFor } from '../core/api/api-error';
import { canonicalTotpSecret, groupCode, parseTotp, totpCode } from '../core/totp/totp';
import { ToastService } from '../core/ui/toast.service';
import { GeneratorPanel } from '../generator/generator-panel';
import { GeneratorStore } from '../generator/generator.store';
import { Dialog } from '../shared/dialog';
import { Icon } from '../shared/icon';
import { CredentialsStore } from './credentials.store';
import { normaliseUrl } from './url';

function validUrl(c: AbstractControl<string>): ValidationErrors | null {
  return normaliseUrl(c.value) === undefined ? { url: true } : null;
}

function validTotp(c: AbstractControl<string>): ValidationErrors | null {
  return c.value.trim() && !parseTotp(c.value) ? { totp: true } : null;
}

@Component({
  selector: 'app-add-credential-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Dialog, Icon, GeneratorPanel],
  providers: [GeneratorStore],
  template: `
    <app-dialog
      heading="Add credential"
      description="Encrypted on this device before it is saved."
      [width]="520"
      [open]="open()"
      (closed)="close()"
    >
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate autocomplete="off">
        <div class="field">
          <label for="cred-name">Name</label>
          <input
            id="cred-name"
            class="input"
            formControlName="name"
            autocomplete="off"
            placeholder="e.g. Work email"
            aria-describedby="cred-name-err"
            [attr.aria-invalid]="err('name') ? 'true' : null"
          />
          @if (err('name')) {
            <span id="cred-name-err" class="error-text">Give this credential a name.</span>
          }
        </div>

        <div class="two">
          <div class="field">
            <label for="cred-url">Website <span class="label-hint">(optional)</span></label>
            <input
              id="cred-url"
              class="input"
              formControlName="url"
              inputmode="url"
              autocomplete="off"
              spellcheck="false"
              placeholder="example.com"
              aria-describedby="cred-url-err"
              [attr.aria-invalid]="err('url') ? 'true' : null"
              (blur)="tidyUrl()"
            />
            @if (err('url')) {
              <span id="cred-url-err" class="error-text"
                >Enter a web address such as example.com.</span
              >
            }
          </div>
          <div class="field">
            <label for="cred-username">Username or email</label>
            <input
              id="cred-username"
              class="input"
              formControlName="username"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
              data-form-type="other"
            />
          </div>
        </div>

        <div class="field">
          <label for="cred-password">Password</label>
          <div class="input-group">
            <input
              id="cred-password"
              class="input mono"
              [type]="showPw() ? 'text' : 'password'"
              formControlName="password"
              autocomplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
              data-form-type="other"
              spellcheck="false"
              aria-describedby="cred-password-err"
              [attr.aria-invalid]="err('password') ? 'true' : null"
            />
            <button
              type="button"
              class="icon-btn"
              [attr.aria-pressed]="showPw()"
              [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'"
              (click)="showPw.set(!showPw())"
            >
              <app-icon [name]="showPw() ? 'eye-off' : 'eye'" [size]="16" />
            </button>
            <button
              type="button"
              class="icon-btn"
              [attr.aria-expanded]="generating()"
              aria-controls="cred-generator"
              aria-label="Generate a password"
              [attr.aria-pressed]="generating()"
              (click)="generating.set(!generating())"
            >
              <app-icon name="wand" [size]="16" />
            </button>
          </div>
          @if (err('password')) {
            <span id="cred-password-err" class="error-text">Enter or generate a password.</span>
          }
        </div>

        @if (generating()) {
          <div id="cred-generator" class="gen">
            <app-generator-panel
              [compact]="true"
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
            />
            <div class="gen-actions">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                (click)="useGenerated()"
                [disabled]="!gen.value()"
              >
                Use this password
              </button>
            </div>
          </div>
        }

        <div class="field">
          <label for="cred-totp"
            >Authenticator secret <span class="label-hint">(optional)</span></label
          >
          <input
            id="cred-totp"
            class="input mono"
            formControlName="mfaSecret"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore="true"
            data-form-type="other"
            placeholder="Base32 key or otpauth:// link"
            aria-describedby="cred-totp-hint cred-totp-err"
            [attr.aria-invalid]="err('mfaSecret') ? 'true' : null"
          />
          @if (err('mfaSecret')) {
            <span id="cred-totp-err" class="error-text"
              >This does not look like a valid authenticator secret.</span
            >
          } @else if (preview()) {
            <span id="cred-totp-hint" class="hint preview">
              Current code
              <strong class="mono tabular">{{ preview() }}</strong
              >, check it matches your authenticator.
            </span>
          } @else {
            <span id="cred-totp-hint" class="hint"
              >The key shown when you set up two factor sign in.</span
            >
          }
        </div>

        @if (error()) {
          <p class="alert alert-error" role="alert">
            <app-icon name="alert-circle" [size]="16" /><span>{{ error() }}</span>
          </p>
        }

        <footer>
          <button type="button" class="btn btn-secondary" (click)="close()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">
            @if (busy()) {
              <span class="spinner" aria-hidden="true"></span>
            }
            Save
          </button>
        </footer>
      </form>
    </app-dialog>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .gen {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border-radius: var(--radius);
      background: var(--color-surface-2);
      border: 1px solid var(--color-border-subtle);
    }
    .gen-actions {
      display: flex;
      justify-content: flex-end;
    }
    .preview {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }
    .preview app-icon {
      color: var(--color-accent);
    }
    .preview strong {
      color: var(--color-text);
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 6px;
    }
    @media (max-width: 520px) {
      .two {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AddCredentialDialog {
  private readonly store = inject(CredentialsStore);
  private readonly toast = inject(ToastService);
  protected readonly gen = inject(GeneratorStore);

  readonly open = input(false);
  readonly initialPassword = input<string | null>(null);
  readonly closed = output<void>();
  readonly created = output<string>();

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    url: ['', [validUrl, Validators.maxLength(2048)]],
    username: ['', [Validators.maxLength(512)]],
    password: ['', [Validators.required, Validators.maxLength(4096)]],
    mfaSecret: ['', [validTotp, Validators.maxLength(1024)]],
  });
  private readonly mfa = toSignal(this.form.controls.mfaSecret.valueChanges, { initialValue: '' });
  /** Ticks while the dialog is open, so the preview code rolls over like the real one. */
  private readonly now = signal(Date.now());
  protected readonly preview = computed(() => {
    const cfg = parseTotp(this.mfa());
    return cfg ? groupCode(totpCode(cfg, this.now())) : '';
  });
  protected readonly showPw = signal(false);
  protected readonly generating = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly showErrors = signal(false);

  constructor() {
    effect(() => {
      const pw = this.initialPassword();
      if (this.open() && pw) this.form.controls.password.setValue(pw);
    });
    effect((onCleanup) => {
      if (!this.open()) return;
      const ticker = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(ticker));
    });
  }

  protected err(name: keyof typeof this.form.controls): boolean {
    return this.showErrors() && this.form.controls[name].invalid;
  }

  protected tidyUrl(): void {
    const n = normaliseUrl(this.form.controls.url.value);
    if (n) this.form.controls.url.setValue(n);
  }

  protected useGenerated(): void {
    this.form.controls.password.setValue(this.gen.value());
    this.showPw.set(true);
    this.generating.set(false);
  }

  protected async submit(): Promise<void> {
    this.showErrors.set(true);
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const v = this.form.getRawValue();
    try {
      const id = await this.store.add({
        name: v.name.trim(),
        url: normaliseUrl(v.url) ?? null,
        username: v.username.trim(),
        password: v.password,
        mfaSecret: v.mfaSecret.trim() ? canonicalTotpSecret(v.mfaSecret) : null,
      });
      this.toast.show(`${v.name.trim()} was saved.`, 'success');
      this.close();
      this.created.emit(id);
    } catch (e) {
      this.error.set(messageFor(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    this.form.reset();
    this.showErrors.set(false);
    this.showPw.set(false);
    this.generating.set(false);
    this.error.set('');
    this.closed.emit();
  }
}
