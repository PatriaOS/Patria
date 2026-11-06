import { View } from 'react-native';

import { Body, Caption, ChoiceChip, Title } from '../../ui';
import { copy } from '../../lib/copy';
import { space } from '../../theme/tokens';
import type { LetterRow } from './letterApi';
import { letterOpensOnLabel } from './letterOpenLabel';

type Props = {
  letters: LetterRow[];
  recipientName: (recipientId: string) => string;
  timeZone: string;
  withdrawChosen: ReadonlySet<string>;
  onChange: (letterId: string, withdraw: boolean) => void;
};

/** Keep sealed (default) or withdraw, one row per sealed letter. */
export function LeaveLettersChoice({
  letters,
  recipientName,
  timeZone,
  withdrawChosen,
  onChange,
}: Props) {
  if (letters.length === 0) {
    return null;
  }
  return (
    <View testID="leave-letters" style={{ gap: space.sm }}>
      <Title>{copy.letters.leaveTitle}</Title>
      <Caption>{copy.letters.leaveBody}</Caption>
      {letters.map((letter) => {
        const withdraw = withdrawChosen.has(letter.id);
        const name = recipientName(letter.recipientId);
        const line = copy.letters.leaveLetterRow
          .replace('{name}', name)
          .replace('{date}', letterOpensOnLabel(letter, name, timeZone));
        return (
          <View key={letter.id} style={{ gap: space.xs }}>
            <Body>{line}</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <ChoiceChip
                testID={`leave-letter-keep-${letter.id}`}
                label={copy.letters.leaveKeep}
                accessibilityLabel={`${copy.letters.leaveKeep}: ${line}`}
                selected={!withdraw}
                onPress={() => onChange(letter.id, false)}
              />
              <ChoiceChip
                testID={`leave-letter-withdraw-${letter.id}`}
                label={copy.letters.leaveWithdraw}
                accessibilityLabel={`${copy.letters.leaveWithdraw}: ${line}`}
                selected={withdraw}
                onPress={() => onChange(letter.id, true)}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
