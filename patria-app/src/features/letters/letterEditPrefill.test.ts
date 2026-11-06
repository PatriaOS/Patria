import { letterEditIsUnchanged, type LetterEditBaseline } from './letterEditPrefill';

const baseline: LetterEditBaseline = {
  body: 'Hello from Mum',
  fromLabel: 'Mum',
  visibility: 'surprise',
  dateYmd: '2027-11-05',
  recipientId: 'recip-1',
  hadVoice: false,
  voiceDurationSeconds: null,
  fingerprint: 'abcd1234abcd',
  version: 1,
};

describe('letterEditIsUnchanged', () => {
  it('is unchanged when the form matches the loaded letter', () => {
    expect(
      letterEditIsUnchanged(baseline, {
        body: 'Hello from Mum',
        fromLabel: 'Mum',
        visibility: 'surprise',
        dateYmd: '2027-11-05',
        recipientId: 'recip-1',
        voiceDurationSeconds: null,
        hasVoice: false,
        voiceTouched: false,
      }),
    ).toBe(true);
  });

  it('treats trimmed body as the same', () => {
    expect(
      letterEditIsUnchanged(baseline, {
        body: '  Hello from Mum  ',
        fromLabel: 'Mum',
        visibility: 'surprise',
        dateYmd: '2027-11-05',
        recipientId: 'recip-1',
        voiceDurationSeconds: null,
        hasVoice: false,
        voiceTouched: false,
      }),
    ).toBe(true);
  });

  it('detects body edits', () => {
    expect(
      letterEditIsUnchanged(baseline, {
        body: 'Edited',
        fromLabel: 'Mum',
        visibility: 'surprise',
        dateYmd: '2027-11-05',
        recipientId: 'recip-1',
        voiceDurationSeconds: null,
        hasVoice: false,
        voiceTouched: false,
      }),
    ).toBe(false);
  });

  it('detects voice record or remove via voiceTouched', () => {
    expect(
      letterEditIsUnchanged(baseline, {
        body: 'Hello from Mum',
        fromLabel: 'Mum',
        visibility: 'surprise',
        dateYmd: '2027-11-05',
        recipientId: 'recip-1',
        voiceDurationSeconds: null,
        hasVoice: false,
        voiceTouched: true,
      }),
    ).toBe(false);
  });

  it('detects open-day or visibility changes', () => {
    expect(
      letterEditIsUnchanged(baseline, {
        body: 'Hello from Mum',
        fromLabel: 'Mum',
        visibility: 'announced',
        dateYmd: '2027-11-05',
        recipientId: 'recip-1',
        voiceDurationSeconds: null,
        hasVoice: false,
        voiceTouched: false,
      }),
    ).toBe(false);
    expect(
      letterEditIsUnchanged(baseline, {
        body: 'Hello from Mum',
        fromLabel: 'Mum',
        visibility: 'surprise',
        dateYmd: '2028-01-01',
        recipientId: 'recip-1',
        voiceDurationSeconds: null,
        hasVoice: false,
        voiceTouched: false,
      }),
    ).toBe(false);
  });

  it('keeps a loaded voice note unchanged when not touched', () => {
    const withVoice: LetterEditBaseline = {
      ...baseline,
      hadVoice: true,
      voiceDurationSeconds: 12,
    };
    expect(
      letterEditIsUnchanged(withVoice, {
        body: 'Hello from Mum',
        fromLabel: 'Mum',
        visibility: 'surprise',
        dateYmd: '2027-11-05',
        recipientId: 'recip-1',
        voiceDurationSeconds: 12,
        hasVoice: true,
        voiceTouched: false,
      }),
    ).toBe(true);
  });
});
