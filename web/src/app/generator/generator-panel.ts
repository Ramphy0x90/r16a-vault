import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { Icon } from '../shared/icon';
import {
  MAX_LENGTH,
  MAX_WORDS,
  MIN_LENGTH,
  MIN_WORDS,
  type CharClass,
  type PassphraseOptions,
  type RandomOptions,
  type Strength,
} from './generator';
import type { GeneratorMode } from './generator.store';

const CLASS_LABELS: Record<CharClass, string> = {
  upper: 'Uppercase A to Z',
  lower: 'Lowercase a to z',
  digits: 'Digits 0 to 9',
  symbols: 'Symbols',
};

/** Presentational generator controls. All state lives in the GeneratorStore of the parent. */
@Component({
  selector: 'app-generator-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="stack">
      <div class="output">
        <output
          class="mono value"
          [attr.aria-label]="'Generated ' + (mode() === 'random' ? 'password' : 'passphrase')"
          >{{ value() || '…' }}</output
        >
        <button
          type="button"
          class="icon-btn"
          (click)="regenerate.emit()"
          aria-label="Generate another"
        >
          <app-icon name="refresh" />
        </button>
        <ng-content select="[actions]" />
      </div>
      <div class="meter" [attr.data-strength]="strength()">
        <span class="bar"><span [style.width.%]="meterWidth()"></span></span>
        <span class="label">{{ strengthLabel() }} · about {{ bits() }} bits</span>
      </div>
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }

      <div class="segmented" role="group" aria-label="Generator type">
        <button
          type="button"
          [attr.aria-pressed]="mode() === 'random'"
          (click)="modeChange.emit('random')"
        >
          Password
        </button>
        <button
          type="button"
          [attr.aria-pressed]="mode() === 'passphrase'"
          (click)="modeChange.emit('passphrase')"
        >
          Passphrase
        </button>
      </div>

      @if (mode() === 'random') {
        <div class="field">
          <label [for]="id + '-len'"
            >Length <span class="muted">{{ random().length }}</span></label
          >
          <input
            type="range"
            [id]="id + '-len'"
            [min]="minLength"
            [max]="maxLength"
            [value]="random().length"
            (input)="randomChange.emit({ length: +$any($event.target).value })"
          />
        </div>
        <fieldset class="options">
          <legend class="label">Characters</legend>
          @for (c of classes; track c) {
            <label class="checkbox">
              <input
                type="checkbox"
                [checked]="random().classes.includes(c)"
                [disabled]="random().classes.length === 1 && random().classes.includes(c)"
                (change)="toggleClass(c)"
              />
              {{ labels[c] }}
            </label>
          }
          <label class="checkbox">
            <input
              type="checkbox"
              [checked]="random().excludeAmbiguous"
              (change)="randomChange.emit({ excludeAmbiguous: !random().excludeAmbiguous })"
            />
            Avoid look alike characters such as l, 1, O and 0
          </label>
        </fieldset>
      } @else {
        <div class="field">
          <label [for]="id + '-words'"
            >Words <span class="muted">{{ passphrase().words }}</span></label
          >
          <input
            type="range"
            [id]="id + '-words'"
            [min]="minWords"
            [max]="maxWords"
            [value]="passphrase().words"
            (input)="passphraseChange.emit({ words: +$any($event.target).value })"
          />
        </div>
        <div class="field">
          <label [for]="id + '-sep'">Separator</label>
          <select
            class="input"
            [id]="id + '-sep'"
            [value]="passphrase().separator"
            (change)="passphraseChange.emit({ separator: $any($event.target).value })"
          >
            <option value="-">Hyphen</option>
            <option value=" ">Space</option>
            <option value=".">Dot</option>
            <option value="_">Underscore</option>
            <option value="">None</option>
          </select>
        </div>
        <fieldset class="options">
          <legend class="visually-hidden">Passphrase options</legend>
          <label class="checkbox">
            <input
              type="checkbox"
              [checked]="passphrase().capitalise"
              (change)="passphraseChange.emit({ capitalise: !passphrase().capitalise })"
            />
            Capitalise words
          </label>
          <label class="checkbox">
            <input
              type="checkbox"
              [checked]="passphrase().includeNumber"
              (change)="passphraseChange.emit({ includeNumber: !passphrase().includeNumber })"
            />
            Include a number
          </label>
        </fieldset>
      }
    </div>
  `,
  styles: `
    .output {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
      border-radius: var(--radius);
      background: var(--color-surface-2);
      border: 1px solid var(--color-border-subtle);
    }
    .value {
      flex: 1;
      font-size: 1.05rem;
      word-break: break-all;
      min-height: 1.5em;
    }
    .meter {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-size: 0.9rem;
    }
    .bar {
      flex: 1;
      height: 6px;
      border-radius: 3px;
      background: var(--color-border-subtle);
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--color-danger);
      transition: width 200ms ease;
    }
    [data-strength='fair'] .bar span {
      background: var(--color-warning-text);
    }
    [data-strength='strong'] .bar span,
    [data-strength='excellent'] .bar span {
      background: var(--color-accent);
    }
    .segmented {
      display: inline-flex;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 3px;
      gap: 3px;
      align-self: flex-start;
    }
    .segmented button {
      min-height: 38px;
      padding: 0 var(--space-4);
      border: 0;
      border-radius: calc(var(--radius) - 3px);
      background: transparent;
      color: var(--color-text);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .segmented button[aria-pressed='true'] {
      background: var(--color-primary);
      color: var(--color-on-primary);
    }
    .options {
      border: 0;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
    }
    input[type='range'] {
      width: 100%;
      accent-color: var(--color-primary);
      min-height: var(--touch);
    }
  `,
})
export class GeneratorPanel {
  private static seq = 0;
  protected readonly id = `gen-${GeneratorPanel.seq++}`;
  protected readonly classes: CharClass[] = ['upper', 'lower', 'digits', 'symbols'];
  protected readonly labels = CLASS_LABELS;
  protected readonly minLength = MIN_LENGTH;
  protected readonly maxLength = MAX_LENGTH;
  protected readonly minWords = MIN_WORDS;
  protected readonly maxWords = MAX_WORDS;

  readonly mode = input.required<GeneratorMode>();
  readonly value = input.required<string>();
  readonly entropy = input.required<number>();
  readonly strength = input.required<Strength>();
  readonly random = input.required<RandomOptions>();
  readonly passphrase = input.required<PassphraseOptions>();
  readonly error = input('');

  readonly regenerate = output<void>();
  readonly modeChange = output<GeneratorMode>();
  readonly randomChange = output<Partial<RandomOptions>>();
  readonly passphraseChange = output<Partial<PassphraseOptions>>();

  protected readonly bits = computed(() => Math.floor(this.entropy()));
  protected readonly meterWidth = computed(() => Math.min(100, (this.entropy() / 128) * 100));
  protected readonly strengthLabel = computed(() => {
    const s = this.strength();
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  protected toggleClass(c: CharClass): void {
    const current = this.random().classes;
    this.randomChange.emit({
      classes: current.includes(c) ? current.filter((x) => x !== c) : [...current, c],
    });
  }
}
