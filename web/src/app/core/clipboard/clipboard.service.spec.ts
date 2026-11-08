import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ToastService } from '../ui/toast.service';
import { VaultSessionStore } from '../vault/vault-session.store';
import { CLIPBOARD_CLEAR_MS, ClipboardService } from './clipboard.service';

describe('ClipboardService', () => {
  let clip: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> };
  let service: ClipboardService;
  let toast: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    clip = { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn() };
    Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(ClipboardService);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => vi.useRealTimers());

  it('tells the user the clipboard will be cleared', async () => {
    await service.copy('s3cret', 'Password');
    expect(toast.toasts()[0].text).toContain('clipboard will be cleared in 30 seconds');
  });

  it('clears the clipboard when it still holds the copied value', async () => {
    clip.readText.mockResolvedValue('s3cret');
    await service.copy('s3cret', 'Password');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(clip.writeText).toHaveBeenLastCalledWith('');
  });

  it('leaves newer clipboard content alone', async () => {
    clip.readText.mockResolvedValue('something else');
    await service.copy('s3cret', 'Password');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(clip.writeText).toHaveBeenCalledTimes(1);
  });

  it('clears anyway when reading is refused', async () => {
    clip.readText.mockRejectedValue(new Error('denied'));
    await service.copy('s3cret', 'Password');
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(clip.writeText).toHaveBeenLastCalledWith('');
  });

  it('does not schedule a clear for non sensitive values', async () => {
    await service.copy('alice', 'Username', false);
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(clip.writeText).toHaveBeenCalledTimes(1);
  });

  it('retries a clear that failed while unfocused once the page regains focus', async () => {
    clip.readText.mockRejectedValue(new Error('not focused'));
    await service.copy('s3cret', 'Password');
    clip.writeText.mockRejectedValueOnce(new Error('not focused'));
    await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
    expect(clip.writeText).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(clip.writeText).toHaveBeenCalledTimes(3);
    expect(clip.writeText).toHaveBeenLastCalledWith('');
  });

  it('clears a pending secret when the vault locks', async () => {
    clip.readText.mockResolvedValue('s3cret');
    const vault = TestBed.inject(VaultSessionStore);
    vault.setUnlocked('alice', new Uint8Array(32));
    TestBed.tick();
    await service.copy('s3cret', 'Password');
    vault.lock();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(clip.writeText).toHaveBeenLastCalledWith('');
  });
});
