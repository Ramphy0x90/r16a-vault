import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { ClipboardService } from '../core/clipboard/clipboard.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { CredentialDetails, REVEAL_MS } from './credential-details';
import { CredentialsStore } from './credentials.store';

const SECRET = { password: 'correct-horse', mfaSecret: 'JBSWY3DPEHPK3PXP' };

describe('CredentialDetails', () => {
  let fixture: ComponentFixture<CredentialDetails>;
  let openSecret: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let vault: VaultSessionStore;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (label: string): HTMLButtonElement => {
    const b = el().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!b) throw new Error(`no button ${label}`);
    return b;
  };
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    openSecret = vi.fn().mockResolvedValue(SECRET);
    copy = vi.fn().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [CredentialDetails],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CredentialsStore, useValue: { openSecret, remove: vi.fn() } },
        { provide: ClipboardService, useValue: { copy } },
      ],
    }).compileComponents();
    vault = TestBed.inject(VaultSessionStore);
    vault.setUnlocked('alice', new Uint8Array(32));
    fixture = TestBed.createComponent(CredentialDetails);
    fixture.componentRef.setInput('credentialId', '0192f6c8-4b2a-4e7d-9a51-3c9e1d7b2a10');
    fixture.componentRef.setInput('meta', {
      name: 'Mail',
      url: 'https://mail.example.com/',
      username: 'alice',
      hasTotp: true,
    });
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  it('keeps the secret sealed until asked', () => {
    expect(openSecret).not.toHaveBeenCalled();
    expect(el().textContent).not.toContain(SECRET.password);
    expect(button('Reveal password').getAttribute('aria-pressed')).toBe('false');
  });

  it('reveals the password with an accessible toggle and hides it again after 30 seconds', async () => {
    button('Reveal password').click();
    await settle();
    expect(el().textContent).toContain(SECRET.password);
    expect(button('Hide password').getAttribute('aria-pressed')).toBe('true');

    vi.advanceTimersByTime(REVEAL_MS);
    await settle();
    expect(el().textContent).not.toContain(SECRET.password);
  });

  it('hides a revealed password when the vault locks', async () => {
    button('Reveal password').click();
    await settle();
    vault.lock();
    await settle();
    expect(el().textContent).not.toContain(SECRET.password);
  });

  it('copies the password without rendering it', async () => {
    button('Copy password').click();
    await settle();
    expect(copy).toHaveBeenCalledWith(SECRET.password, 'Password');
    expect(el().textContent).not.toContain(SECRET.password);
  });

  it('copies the username as non sensitive', () => {
    button('Copy username').click();
    expect(copy).toHaveBeenCalledWith('alice', 'Username', false);
  });

  it('shows a grouped live TOTP code with a countdown', async () => {
    vi.setSystemTime(59_000);
    const show = [...el().querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Show code'),
    );
    show?.click();
    await settle();
    expect(el().textContent).toMatch(/\d{3} \d{3}/);
    expect(el().textContent).toContain('1 seconds remaining');
    button('Hide one time code').click();
    await settle();
    expect(el().textContent).not.toMatch(/\d{3} \d{3}/);
  });
});
