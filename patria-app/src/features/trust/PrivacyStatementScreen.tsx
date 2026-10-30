import { copy } from '../../lib/copy';
import { privacyStatementDocument } from './generated/privacyStatement';
import { TrustDocumentView } from './TrustDocumentView';

export function PrivacyStatementScreen() {
  return (
    <TrustDocumentView
      document={privacyStatementDocument}
      testID="screen-privacy-statement"
      accessibilityLabel={copy.trust.privacyStatementTitle}
    />
  );
}
