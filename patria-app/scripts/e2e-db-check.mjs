import {
  APP_ROOT,
  assertLocalSupabaseUrl,
  loadLocalFiles,
  runLocalSql,
  supabaseStatusEnv,
  supabaseUrlFromEnv,
} from './e2e-lib.mjs';

const SCRIPT = 'e2e-db-check';

function query(dbUrl, statement) {
  return runLocalSql(dbUrl, statement, true);
}

const { e2eEnv } = loadLocalFiles();
let status;
try {
  status = supabaseStatusEnv();
} catch {
  console.error(`${SCRIPT} refused to run: local Supabase is not up.`);
  process.exit(1);
}
const url = e2eEnv.EXPO_PUBLIC_SUPABASE_URL || status.API_URL || supabaseUrlFromEnv(e2eEnv);
assertLocalSupabaseUrl(url, SCRIPT);
const dbUrl = status.DB_URL;
if (!dbUrl) {
  console.error(`${SCRIPT}: could not read local DB URL.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : '';
};

function spaceId(name) {
  const id = query(
    dbUrl,
    `SELECT id FROM public.family_spaces WHERE name = '${name.replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 1;`,
  );
  if (!id) {
    throw new Error(`No family space named ${name}`);
  }
  return id;
}

function userId(email) {
  const id = query(
    dbUrl,
    `SELECT id FROM auth.users WHERE email = '${email.replace(/'/g, "''")}' LIMIT 1;`,
  );
  if (!id) {
    throw new Error(`No user ${email}`);
  }
  return id;
}

try {
  if (command === 'invite-url') {
    const email = flag('email');
    const token = query(
      dbUrl,
      `SELECT token FROM public.invites WHERE email = '${email.replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 1;`,
    );
    if (!token) {
      throw new Error('No invite token for that email');
    }
    process.stdout.write(`patria://invite/${token}\n`);
    process.exit(0);
  }

  if (command === 'assert-epoch') {
    const family = flag('family');
    const equals = flag('equals');
    const actual = query(
      dbUrl,
      `SELECT key_epoch FROM public.family_key_meta WHERE family_space_id = '${spaceId(family)}';`,
    );
    if (actual !== equals) {
      throw new Error(`key epoch is ${actual}, expected ${equals}`);
    }
    console.log('assert-epoch ok');
    process.exit(0);
  }

  if (command === 'assert-wraps') {
    const family = flag('family');
    const min = Number(flag('min') || '1');
    const email = flag('email');
    const extra = email
      ? ` AND user_id = '${userId(email)}'`
      : '';
    const count = Number(
      query(
        dbUrl,
        `SELECT count(*) FROM public.family_key_wraps WHERE family_space_id = '${spaceId(family)}'${extra};`,
      ),
    );
    if (count < min) {
      throw new Error(`wrap rows ${count}, expected at least ${min}`);
    }
    console.log('assert-wraps ok');
    process.exit(0);
  }

  if (command === 'assert-no-wraps') {
    const family = flag('family');
    const email = flag('email');
    const count = Number(
      query(
        dbUrl,
        `SELECT count(*) FROM public.family_key_wraps WHERE family_space_id = '${spaceId(family)}' AND user_id = '${userId(email)}';`,
      ),
    );
    if (count !== 0) {
      throw new Error(`expected no wraps for ${email}, found ${count}`);
    }
    console.log('assert-no-wraps ok');
    process.exit(0);
  }

  if (command === 'assert-no-print-columns') {
    const hits = query(
      dbUrl,
      `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (column_name ILIKE '%mnemonic%' OR column_name ILIKE '%printed%' OR column_name ILIKE '%recovery_words%');`,
    );
    if (Number(hits) !== 0) {
      throw new Error('found columns that look like printed-code storage');
    }
    const table = query(
      dbUrl,
      `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'recovery_key_wraps';`,
    );
    if (Number(table) !== 0) {
      throw new Error('recovery_key_wraps table still exists');
    }
    console.log('assert-no-print-columns ok');
    process.exit(0);
  }

  if (command === 'assert-recovery-public') {
    const family = flag('family');
    const min = Number(flag('min') || '1');
    const count = Number(
      query(
        dbUrl,
        `SELECT count(*) FROM public.recovery_public_keys WHERE family_space_id = '${spaceId(family)}';`,
      ),
    );
    if (count < min) {
      throw new Error(`recovery_public_keys ${count}, expected at least ${min}`);
    }
    console.log('assert-recovery-public ok');
    process.exit(0);
  }

  if (command === 'assert-under-recovery') {
    const family = flag('family');
    const email = flag('email');
    const none = args.includes('--none');
    const count = Number(
      query(
        dbUrl,
        `SELECT count(*) FROM public.family_key_under_recovery WHERE family_space_id = '${spaceId(family)}' AND user_id = '${userId(email)}';`,
      ),
    );
    if (none && count !== 0) {
      throw new Error(`expected no under-recovery rows for that member`);
    }
    if (!none && count < 1) {
      throw new Error(`expected under-recovery rows for that member`);
    }
    console.log('assert-under-recovery ok');
    process.exit(0);
  }

  if (command === 'memory-path') {
    const caption = flag('caption');
    const path = query(
      dbUrl,
      `SELECT full_path FROM public.memory_items WHERE caption = '${caption.replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 1;`,
    );
    if (!path) {
      throw new Error(`No memory with caption ${caption}`);
    }
    process.stdout.write(`${path}\n`);
    process.exit(0);
  }

  if (command === 'memory-files-gone') {
    const path = flag('path');
    const count = Number(
      query(
        dbUrl,
        `SELECT count(*) FROM storage.objects WHERE bucket_id = 'memories' AND name IN ('${path.replace(/'/g, "''")}', '${path.replace(/full\.jpg$/, 'thumb.jpg').replace(/'/g, "''")}');`,
      ),
    );
    if (count !== 0) {
      throw new Error(`expected memory files gone, found ${count}`);
    }
    console.log('memory-files-gone ok');
    process.exit(0);
  }

  if (command === 'assert-letter-withdrawn') {
    const family = flag('family');
    const sid = spaceId(family);
    const letters = Number(
      query(dbUrl, `SELECT count(*) FROM public.letters WHERE family_space_id = '${sid}';`),
    );
    if (letters !== 0) {
      throw new Error(`expected 0 letters after withdraw, found ${letters}`);
    }
    const withdrawnIds = query(
      dbUrl,
      `SELECT coalesce(string_agg(letter_id::text, ','), '') FROM public.letter_events WHERE family_space_id = '${sid}' AND event_type = 'withdrawn';`,
    );
    if (!withdrawnIds) {
      throw new Error('expected a withdrawn letter_events row');
    }
    const ids = withdrawnIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    for (const letterId of ids) {
      const payload = Number(
        query(dbUrl, `SELECT count(*) FROM public.letter_payloads WHERE letter_id = '${letterId}';`),
      );
      const authorShare = Number(
        query(
          dbUrl,
          `SELECT count(*) FROM public.letter_author_shares WHERE letter_id = '${letterId}';`,
        ),
      );
      const recipientShare = Number(
        query(
          dbUrl,
          `SELECT count(*) FROM public.letter_recipient_shares WHERE letter_id = '${letterId}';`,
        ),
      );
      const patriaShare = Number(
        query(
          dbUrl,
          `SELECT count(*) FROM public.letter_patria_shares WHERE letter_id = '${letterId}';`,
        ),
      );
      if (payload + authorShare + recipientShare + patriaShare !== 0) {
        throw new Error(
          `withdraw left content or shares for ${letterId}: payload=${payload} author=${authorShare} recipient=${recipientShare} patria=${patriaShare}`,
        );
      }
    }
    console.log('assert-letter-withdrawn ok');
    process.exit(0);
  }

  if (command === 'letter-fingerprint') {
    const family = flag('family');
    const sid = spaceId(family);
    const fingerprint = query(
      dbUrl,
      `SELECT fingerprint FROM public.letters WHERE family_space_id = '${sid}' ORDER BY sealed_at DESC NULLS LAST, created_at DESC LIMIT 1;`,
    );
    if (!fingerprint || !/^[0-9a-f]{12}$/i.test(fingerprint)) {
      throw new Error(`missing or invalid letter fingerprint: ${fingerprint || '(empty)'}`);
    }
    process.stdout.write(`${fingerprint}\n`);
    process.exit(0);
  }

  if (command === 'assert-letter-keepers') {
    const family = flag('family');
    const min = Number(flag('min') || '3');
    const sid = spaceId(family);
    // Join family_spaces so orphan letters from bad deletes never count.
    const count = Number(
      query(
        dbUrl,
        `SELECT count(*) FROM public.letter_keepers AS k
           JOIN public.letters AS l ON l.id = k.letter_id AND l.version = k.version
           JOIN public.family_spaces AS s ON s.id = l.family_space_id
          WHERE l.family_space_id = '${sid}'
            AND l.status IN ('sealed', 'pending', 'released');`,
      ),
    );
    if (count < min) {
      throw new Error(`letter keepers ${count}, expected at least ${min}`);
    }
    console.log('assert-letter-keepers ok');
    process.exit(0);
  }

  if (command === 'assert-letter-due') {
    const family = flag('family');
    const sid = spaceId(family);
    const row = query(
      dbUrl,
      `SELECT status::text || '|' || (trigger_at <= now())::text
         FROM public.letters
        WHERE family_space_id = '${sid}'
        ORDER BY sealed_at DESC NULLS LAST, created_at DESC
        LIMIT 1;`,
    );
    if (!row) {
      throw new Error('no letter to assert due');
    }
    const [status, past] = row.split('|');
    if (past !== 't' && past !== 'true') {
      throw new Error(`letter trigger_at not in the past (status=${status})`);
    }
    if (status !== 'pending' && status !== 'sealed') {
      throw new Error(`expected sealed or pending after mark due, got ${status}`);
    }
    console.log('assert-letter-due ok');
    process.exit(0);
  }

  if (command === 'assert-letterbox') {
    const family = flag('family');
    const email = flag('email');
    const count = Number(
      query(
        dbUrl,
        `SELECT count(*) FROM public.letterbox_keys WHERE family_space_id = '${spaceId(family)}' AND user_id = '${userId(email)}';`,
      ),
    );
    if (count < 1) {
      throw new Error(`expected a letterbox key for ${email}`);
    }
    console.log('assert-letterbox ok');
    process.exit(0);
  }

  if (command === 'assert-keeper-eligible') {
    const family = flag('family');
    const email = flag('email');
    const author = flag('author');
    const recipient = flag('recipient');
    const sid = spaceId(family);
    const ok = query(
      dbUrl,
      `SELECT CASE WHEN coalesce(
         public.letter_keeper_eligible(
           '${sid}'::uuid,
           '${userId(email)}'::uuid,
           '${userId(author)}'::uuid,
           '${userId(recipient)}'::uuid
         ),
         false
       ) THEN 'yes' ELSE 'no' END;`,
    );
    if (ok !== 'yes') {
      throw new Error(
        `expected ${email} letter_keeper_eligible (author=${author}, recipient=${recipient}), got ${ok}`,
      );
    }
    console.log('assert-keeper-eligible ok');
    process.exit(0);
  }

  // Every family-key wrap device must also have a personal-key wrap (keeper Help).
  if (command === 'assert-personal-wraps') {
    const family = flag('family');
    const email = flag('email');
    const sid = spaceId(family);
    const uid = userId(email);
    const missing = query(
      dbUrl,
      `SELECT coalesce(string_agg(f.device_id::text, ','), '')
         FROM public.family_key_wraps f
        WHERE f.family_space_id = '${sid}'
          AND f.user_id = '${uid}'
          AND NOT EXISTS (
            SELECT 1 FROM public.personal_key_wraps p
             WHERE p.family_space_id = f.family_space_id
               AND p.user_id = f.user_id
               AND p.device_id = f.device_id
          );`,
    );
    if (missing) {
      throw new Error(
        `family wrap device(s) for ${email} lack personal wraps: ${missing}`,
      );
    }
    console.log('assert-personal-wraps ok');
    process.exit(0);
  }

  if (command === 'reset-letterbox-personal') {
    const family = flag('family');
    const email = flag('email');
    const sid = spaceId(family);
    const uid = userId(email);
    runLocalSql(
      dbUrl,
      `DELETE FROM public.letterbox_keys
        WHERE family_space_id = '${sid}' AND user_id = '${uid}';
       DELETE FROM public.personal_key_wraps
        WHERE family_space_id = '${sid}' AND user_id = '${uid}';
       DELETE FROM public.personal_key_under_recovery
        WHERE family_space_id = '${sid}' AND user_id = '${uid}';`,
    );
    console.log('reset-letterbox-personal ok');
    process.exit(0);
  }

  console.error(
    `${SCRIPT} usage: invite-url | assert-epoch | assert-wraps | assert-no-wraps | assert-no-print-columns | assert-recovery-public | assert-under-recovery | memory-path | memory-files-gone | assert-letter-withdrawn | letter-fingerprint | assert-letter-keepers | assert-letter-due | assert-letterbox | assert-keeper-eligible | assert-personal-wraps | reset-letterbox-personal`,
  );
  process.exit(1);
} catch (error) {
  console.error(`${SCRIPT} failed: ${error instanceof Error ? error.message : 'check failed'}`);
  process.exit(1);
}
