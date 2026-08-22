import { describe, expect, it } from 'vitest';

import { resolveWeeklyReportDay } from './reportSettings';

describe('resolveWeeklyReportDay', () => {
    it('preserves Monday, encoded as zero', () => {
        expect(resolveWeeklyReportDay(0)).toBe(0);
    });

    it('defaults only missing values to Sunday', () => {
        expect(resolveWeeklyReportDay(null)).toBe(6);
        expect(resolveWeeklyReportDay(undefined)).toBe(6);
    });
});
