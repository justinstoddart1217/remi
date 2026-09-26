import { describe, expect, it } from 'vitest';

import { RemiApiError } from '../../api';
import { asSentence, SAVE_FAILED, saveErrorCopy } from './useSave';

describe('saveErrorCopy', () => {
  it('shows the server’s reason for a refused value as a sentence', () => {
    const lower = new RemiApiError({
      status: 422,
      code: 'VALIDATION',
      message: 'hours a day must be more than 0 for a project with a forecast',
    });
    expect(saveErrorCopy(lower)).toBe('Couldn’t save that. Hours a day must be more than 0 for a project with a forecast.');
    const sentence = new RemiApiError({ status: 422, code: 'VALIDATION', message: 'Work left cannot be negative.' });
    expect(saveErrorCopy(sentence)).toBe('Couldn’t save that. Work left cannot be negative.');
  });

  it('is generic for other failures and blank reasons', () => {
    expect(saveErrorCopy(new RemiApiError({ status: 500, code: 'INTERNAL', message: 'boom' }))).toBe(SAVE_FAILED);
    expect(saveErrorCopy(new RemiApiError({ status: 422, code: 'VALIDATION', message: '  ' }))).toBe(SAVE_FAILED);
    expect(saveErrorCopy(new Error('offline'))).toBe(SAVE_FAILED);
  });

  it('keeps a closing mark that is already there', () => {
    expect(asSentence('done!')).toBe('Done!');
    expect(asSentence('')).toBe('');
  });
});
