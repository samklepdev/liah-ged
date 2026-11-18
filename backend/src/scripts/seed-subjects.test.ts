import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { db } from '../db/index.ts';
import { subjects } from '../models/schema.ts';
import { seedPlaceholderSubjects } from './seed-subjects.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

test('seedPlaceholderSubjects inserts the four core subjects', async () => {
  const count = await seedPlaceholderSubjects();
  assert.equal(count, 4);

  const rows = await db.select().from(subjects);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.slug).sort(),
    ['english-language-arts', 'mathematics', 'science', 'social-studies'],
  );
});

test('seedPlaceholderSubjects is idempotent', async () => {
  await seedPlaceholderSubjects();
  await seedPlaceholderSubjects();

  const rows = await db.select().from(subjects);
  assert.equal(rows.length, 4);
});
