import { copy } from '../../lib/copy';
import { howPatriaProtectsDocument } from './generated/howPatriaProtects';
import { TrustDocumentView } from './TrustDocumentView';

export function HowPatriaProtectsScreen() {
  return (
    <TrustDocumentView
      document={howPatriaProtectsDocument}
      testID="screen-how-patria-protects"
      accessibilityLabel={copy.trust.howPatriaProtectsTitle}
    />
  );
}
