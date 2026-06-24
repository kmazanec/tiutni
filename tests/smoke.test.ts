import { describe, it, expect } from 'vitest';
import { createApp } from '../src/server/index.js';
import { SAMPLE_W2 } from '../src/fixtures/sample-w2.js';

describe('scaffold smoke', () => {
  it('builds an app and exposes health', async () => {
    const app = createApp();
    expect(app).toBeDefined();
  });

  it('has a realistic ~$40k sample W-2 fixture', () => {
    expect(SAMPLE_W2.wages).toBeGreaterThan(35000);
    expect(SAMPLE_W2.wages).toBeLessThan(50000);
    expect(SAMPLE_W2.federalIncomeTaxWithheld).toBeGreaterThan(0);
  });
});
