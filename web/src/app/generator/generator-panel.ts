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

const STRENGTH_LEVEL: Record<Strength, number> = { weak: 1, fair: 2, strong: 3, excellent: 4 };

/**
 * Presentational generator controls. State lives in the GeneratorStore of the parent.
 * Digits and symbols are tinted in the output so a password can be read back without
 * confusing similar glyphs.
 */
@Component({
  selector: 'app-generator-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  host: { '[class.compact]': 'compact()' },
  template: `
    <div class="output">
      <output
        class="value mono"
        [attr.aria-label]="'Generated ' + (mode() === 'random' ? 'password' : 'passphrase')"
      >
        @for (c of chars(); track $index) {
          <span [class]="c.kind">{{ c.ch }}</span>
        } @empty {
          …
        }
      </output>
      <div class="output-actions">
        <button
          type="button"
          class="icon-btn"
          (click)="regenerate.emit()"
          aria-label="Generate another"
        >
          <app-icon name="refresh" [size]="16" />
        </button>
        <ng-content select="[actions]" />
      </div>
    </div>

    <div class="meter" [attr.data-strength]="strength()">
      <div class="bars" aria-hidden="true">
        @for (i of [1, 2, 3, 4]; track i) {
          <span [class.on]="i <= level()"></span>
        }
      </div>
      <span class="meter-label"
        ><strong>{{ strengthLabel() }}</strong
        ><span class="muted tabular"> · {{ bits() }} bits</span></span
      >
    </div>
    @if (error()) {
      <p class="alert alert-error" role="alert">
        <app-icon name="alert-circle" [size]="16" /><span>{{ error() }}</span>
      </p>
    }

    <div class="segmented" role="group" aria-label="Generator type" [attr.data-mode]="mode()">
      <span class="thumb" aria-hidden="true"></span>
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
      <div class="slider">
        <label [for]="id + '-len'">Length</label>
        <input
          type="range"
          [id]="id + '-len'"
          [min]="minLength"
          [max]="maxLength"
          [value]="random().length"
          [style.--fill]="((random().length - minLength) / (maxLength - minLength)) * 100 + '%'"
          (input)="randomChange.emit({ length: +$any($event.target).value })"
        />
        <span class="readout tabular">{{ random().length }}</span>
      </div>
      <fieldset class="options">
        <legend class="visually-hidden">Characters</legend>
        @for (c of classes; track c) {
          <label class="opt">
            <span>{{ labels[c] }}</span>
            <input
              type="checkbox"
              role="switch"
              class="switch"
              [checked]="random().classes.includes(c)"
              [disabled]="random().classes.length === 1 && random().classes.includes(c)"
              (change)="toggleClass(c)"
            />
          </label>
        }
        <label class="opt wide">
          <span>Avoid look alike characters such as l, 1, O and 0</span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            [checked]="random().excludeAmbiguous"
            (change)="randomChange.emit({ excludeAmbiguous: !random().excludeAmbiguous })"
          />
        </label>
      </fieldset>
    } @else {
      <div class="slider">
        <label [for]="id + '-words'">Words</label>
        <input
          type="range"
          [id]="id + '-words'"
          [min]="minWords"
          [max]="maxWords"
          [value]="passphrase().words"
          [style.--fill]="((passphrase().words - minWords) / (maxWords - minWords)) * 100 + '%'"
          (input)="passphraseChange.emit({ words: +$any($event.target).value })"
        />
        <span class="readout tabular">{{ passphrase().words }}</span>
      </div>
      <fieldset class="options">
        <legend class="visually-hidden">Passphrase options</legend>
        <label class="opt">
          <span>Separator</span>
          <select
            class="input sep"
            [value]="passphrase().separator"
            (change)="passphraseChange.emit({ separator: $any($event.target).value })"
          >
            <option value="-">Hyphen</option>
            <option value=" ">Space</option>
            <option value=".">Dot</option>
            <option value="_">Underscore</option>
            <option value="">None</option>
          </select>
        </label>
        <label class="opt">
          <span>Capitalise words</span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            [checked]="passphrase().capitalise"
            (change)="passphraseChange.emit({ capitalise: !passphrase().capitalise })"
          />
        </label>
        <label class="opt">
          <span>Include a number</span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            [checked]="passphrase().includeNumber"
            (change)="passphraseChange.emit({ includeNumber: !passphrase().includeNumber })"
          />
        </label>
      </fieldset>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .output {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 16px 10px 16px 18px;
      border-radius: var(--radius);
      background: var(--color-surface-2);
      border: 1px solid var(--color-border-subtle);
    }
    .value {
      flex: 1;
      min-height: 1.5em;
      font-size: 20px;
      line-height: 1.45;
      word-break: break-all;
    }
    :host(.compact) .value {
      font-size: 15px;
    }
    :host(.compact) .output {
      padding: 10px 6px 10px 12px;
      background: var(--color-surface);
    }
    .digit {
      color: var(--color-accent-soft-text);
    }
    .symbol {
      color: var(--color-symbol);
    }
    .output-actions {
      display: flex;
      gap: 2px;
      margin-top: -2px;
    }
    .meter {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
    }
    .bars {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      width: 132px;
    }
    .bars span {
      height: 4px;
      border-radius: 2px;
      background: var(--color-surface-3);
      transition: background-color 200ms ease;
    }
    [data-strength='weak'] .bars .on {
      background: var(--color-danger);
    }
    [data-strength='fair'] .bars .on {
      background: var(--color-warning-text);
    }
    [data-strength='strong'] .bars .on,
    [data-strength='excellent'] .bars .on {
      background: var(--color-accent);
    }
    .meter-label strong {
      font-weight: 600;
    }
    .segmented {
      position: relative;
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: min(320px, 100%);
      padding: 3px;
      border-radius: var(--radius-sm);
      background: var(--color-surface-3);
    }
    .thumb {
      position: absolute;
      top: 3px;
      bottom: 3px;
      left: 3px;
      width: calc(50% - 3px);
      border-radius: 6px;
      background: var(--color-surface);
      box-shadow: var(--shadow-sm);
      transition: transform 220ms var(--ease-out);
    }
    :host-context([data-theme='dark']) .thumb {
      background: var(--neutral-700);
    }
    [data-mode='passphrase'] .thumb {
      transform: translateX(100%);
    }
    .segmented button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: calc(var(--control-h) - 6px);
      border: 0;
      background: transparent;
      color: var(--color-text-muted);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
      transition: color 150ms ease;
    }
    .segmented button[aria-pressed='true'] {
      color: var(--color-text);
    }
    .slider {
      display: grid;
      grid-template-columns: 72px 1fr 40px;
      align-items: center;
      gap: 12px;
    }
    .slider label {
      font-size: 13px;
      font-weight: 500;
    }
    .readout {
      justify-self: end;
      min-width: 36px;
      padding: 2px 0;
      border-radius: 6px;
      background: var(--color-surface-2);
      border: 1px solid var(--color-border-subtle);
      font-size: 13px;
      font-weight: 500;
      text-align: center;
    }
    .options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 24px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .opt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: var(--control-h);
      font-size: 13.5px;
      cursor: pointer;
    }
    .opt.wide {
      grid-column: 1 / -1;
    }
    .sep {
      width: 140px;
      height: var(--control-h-sm);
    }
    :host(.compact) .options {
      grid-template-columns: 1fr;
    }
    @media (max-width: 600px) {
      .options {
        grid-template-columns: 1fr;
      }
      .value {
        font-size: 17px;
      }
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
  readonly compact = input(false);

  readonly regenerate = output<void>();
  readonly modeChange = output<GeneratorMode>();
  readonly randomChange = output<Partial<RandomOptions>>();
  readonly passphraseChange = output<Partial<PassphraseOptions>>();

  protected readonly chars = computed(() =>
    [...this.value()].map((ch) => ({
      ch,
      kind: /[0-9]/.test(ch) ? 'digit' : /[A-Za-z]/.test(ch) ? '' : 'symbol',
    })),
  );
  protected readonly bits = computed(() => Math.floor(this.entropy()));
  protected readonly level = computed(() => STRENGTH_LEVEL[this.strength()]);
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
