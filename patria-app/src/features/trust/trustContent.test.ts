// @ts-nocheck — reads docs/trust/*.md on disk (same pattern as phoneTestCoverage.test.ts).
import { readFileSync } from 'fs';
import { join } from 'path';

import { howPatriaProtectsDocument } from './generated/howPatriaProtects';
import { privacyStatementDocument } from './generated/privacyStatement';
import { PRIVACY_CONTACT_EMAIL } from './privacyContact';
import { parseTrustMarkdown } from './trustContent';

const docsDir = join(__dirname, '..', '..', '..', '..', 'docs', 'trust');

describe('trust documents stay in sync with docs/trust', () => {
  it('keeps the contact email constant matching both markdown sources', () => {
    const how = readFileSync(join(docsDir, 'HOW_PATRIA_PROTECTS_YOUR_FAMILY.md'), 'utf8');
    const statement = readFileSync(join(docsDir, 'PRIVACY_STATEMENT.md'), 'utf8');
    expect(PRIVACY_CONTACT_EMAIL).toBe('support.patria@gmail.com');
    expect(how).toContain(PRIVACY_CONTACT_EMAIL);
    expect(statement).toContain(PRIVACY_CONTACT_EMAIL);
    expect(how).not.toContain('[contact email to be added]');
    expect(statement).not.toContain('[contact email to be added]');
  });

  it('fails if How Patria protects your family drifts from the markdown', () => {
    const markdown = readFileSync(join(docsDir, 'HOW_PATRIA_PROTECTS_YOUR_FAMILY.md'), 'utf8');
    expect(howPatriaProtectsDocument.blocks).toEqual(parseTrustMarkdown(markdown));
  });

  it('fails if the Privacy statement drifts from the markdown', () => {
    const markdown = readFileSync(join(docsDir, 'PRIVACY_STATEMENT.md'), 'utf8');
    expect(privacyStatementDocument.blocks).toEqual(parseTrustMarkdown(markdown));
  });
});
