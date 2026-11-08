import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { ApiService } from '../core/api/api.service';
import { SessionService } from '../core/session/session.service';
import { VaultSessionStore } from '../core/vault/vault-session.store';
import { SettingsPage } from './settings.page';

describe('SettingsPage delete account', () => {
  let fixture: ComponentFixture<SettingsPage>;
  let deleteAccount: ReturnType<typeof vi.fn>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const type = async (selector: string, value: string): Promise<void> => {
    const input = el().querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`missing ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const deleteButton = (): HTMLButtonElement =>
    [...el().querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete my account'),
    ) as HTMLButtonElement;

  beforeEach(async () => {
    deleteAccount = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SessionService, useValue: { deleteAccount } },
        {
          provide: ApiService,
          useValue: {
            authConfig: () => Promise.resolve({ registrationEnabled: true, oidcEnabled: false }),
            listSessions: () => Promise.resolve([]),
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(VaultSessionStore).setUnlocked('alice', new Uint8Array(32));
    fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
  });

  it('stays disabled until the exact username and a password are entered', async () => {
    expect(deleteButton().disabled).toBe(true);
    await type('#del-username', 'alicia');
    await type('#del-password', 'pw');
    expect(deleteButton().disabled).toBe(true);
    await type('#del-username', 'Alice');
    expect(deleteButton().disabled).toBe(false);
    deleteButton().click();
    await fixture.whenStable();
    expect(deleteAccount).toHaveBeenCalledWith('pw');
  });

  it('shows the stored auto lock choice as selected', async () => {
    const select = el().querySelector<HTMLSelectElement>('#autolock');
    expect(select?.value).toBe('5');
  });
});
