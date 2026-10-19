import { useState } from 'react';

import { Button, ErrorState, Field, Muted } from '../../ui';
import { copy } from '../../lib/copy';
import { tokenFromInviteUrl } from '../../lib/inviteUrl';

type PasteInviteFieldProps = {
  onOpen: (token: string) => void;
};

export function PasteInviteField({ onOpen }: PasteInviteFieldProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onPressOpen = () => {
    const token = tokenFromInviteUrl(value);
    if (!token) {
      setError(copy.invite.pasteInvalid);
      return;
    }
    setError(null);
    onOpen(token);
  };

  return (
    <>
      <Muted>{copy.invite.pastePrompt}</Muted>
      <Field
        label={copy.invite.pasteLabel}
        autoCapitalize="none"
        autoCorrect={false}
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setError(null);
        }}
      />
      <Button label={copy.invite.openLink} variant="secondary" onPress={onPressOpen} />
      {error ? <ErrorState message={error} /> : null}
    </>
  );
}
