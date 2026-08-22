import { describe, expect, it } from 'vitest';
import { buildWhatsAppReminderUrl, getCreditAgeInDays, normalizeWhatsAppPhone } from './creditReminder';

describe('credit reminder helpers', () => {
  it('normalizes common Moroccan phone formats', () => {
    expect(normalizeWhatsAppPhone('06 12 34 56 78')).toBe('212612345678');
    expect(normalizeWhatsAppPhone('+212 6 12 34 56 78')).toBe('212612345678');
    expect(normalizeWhatsAppPhone('00212 6 12 34 56 78')).toBe('212612345678');
  });

  it('builds an encoded WhatsApp deep link', () => {
    expect(buildWhatsAppReminderUrl('0612345678', 'Solde: 120 DH')).toBe(
      'https://wa.me/212612345678?text=Solde%3A%20120%20DH',
    );
  });

  it('calculates credit age deterministically and never returns a negative age', () => {
    const now = new Date('2026-08-18T12:00:00Z').getTime();
    expect(getCreditAgeInDays('2026-07-18T12:00:00Z', now)).toBe(31);
    expect(getCreditAgeInDays('2026-08-19T12:00:00Z', now)).toBe(0);
    expect(getCreditAgeInDays('invalid', now)).toBe(0);
  });
});
