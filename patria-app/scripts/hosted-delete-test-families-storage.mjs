/**
 * Hosted Storage wipe for two test family_space UUID prefixes.
 * Invoked by hosted-delete-test-families-storage.sh (prompts for secrets).
 * Never logs the service role key.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL?.trim() ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
const id1 = process.env.SPACE_ID_1?.trim() ?? '';
const id2 = process.env.SPACE_ID_2?.trim() ?? '';
const confirm = process.env.CONFIRM?.trim() ?? '';

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!url.startsWith('https://') || !url.includes('supabase')) {
  fail('SUPABASE_URL looks wrong.');
}
if (!key || key.length < 20) {
  fail('Service role key missing.');
}
if (!uuidRe.test(id1) || !uuidRe.test(id2)) {
  fail('Both SPACE_ID_1 and SPACE_ID_2 must be UUIDs.');
}
if (id1 === id2) {
  fail('The two family_space ids must differ.');
}
if (confirm !== 'DELETE') {
  fail('Aborted (CONFIRM was not DELETE).');
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const prefixes = [id1, id2];

/**
 * @param {string} bucket
 * @param {string} path
 * @returns {Promise<string[]>}
 */
async function listFilesRecursive(bucket, path) {
  const { data, error } = await admin.storage.from(bucket).list(path, {
    limit: 1000,
    offset: 0,
  });
  if (error) {
    throw new Error(`${bucket}/${path || '(root)'}: ${error.message}`);
  }
  const files = [];
  for (const entry of data ?? []) {
    const child = path ? `${path}/${entry.name}` : entry.name;
    // Folders have null id / no metadata size in list; files have id.
    const isFile = Boolean(entry.id);
    if (isFile) {
      files.push(child);
    } else {
      files.push(...(await listFilesRecursive(bucket, child)));
    }
  }
  return files;
}

async function main() {
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) {
    fail(`listBuckets: ${bucketError.message}`);
  }
  if (!buckets?.length) {
    console.log('No storage buckets.');
    return;
  }

  console.log(`Buckets (${buckets.length}): ${buckets.map((b) => b.id).join(', ')}`);

  let totalRemoved = 0;
  for (const bucket of buckets) {
    for (const spaceId of prefixes) {
      const paths = await listFilesRecursive(bucket.id, spaceId);
      console.log(`${bucket.id} / ${spaceId}: ${paths.length} file(s)`);
      if (paths.length === 0) {
        continue;
      }
      // remove in chunks
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { error } = await admin.storage.from(bucket.id).remove(chunk);
        if (error) {
          fail(`remove ${bucket.id}: ${error.message}`);
        }
        totalRemoved += chunk.length;
      }
    }
  }

  console.log(`Removed ${totalRemoved} object(s).`);
  console.log('Re-run SQL section B counts; every objects_under_target_prefixes should be 0, then run D.');
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
