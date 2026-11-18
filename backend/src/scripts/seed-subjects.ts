import { db, pool } from '../db/index.ts';
import { subjects } from '../models/schema.ts';

const PLACEHOLDER_SUBJECTS = [
  { slug: 'mathematics', title: 'Mathematics' },
  { slug: 'english-language-arts', title: 'English Language Arts' },
  { slug: 'science', title: 'Science' },
  { slug: 'social-studies', title: 'Social Studies' },
];

/**
 * Seeds the four core subjects with no courses yet. Real content (courses,
 * modules, questions) arrives later via the quiz:parse / quiz:seed pipeline,
 * once an HSD quiz pack exists.
 */
export async function seedPlaceholderSubjects(): Promise<number> {
  let count = 0;
  for (const subject of PLACEHOLDER_SUBJECTS) {
    await db
      .insert(subjects)
      .values(subject)
      .onConflictDoUpdate({ target: subjects.slug, set: { title: subject.title } });
    count++;
  }
  return count;
}

async function main(): Promise<void> {
  const count = await seedPlaceholderSubjects();
  console.log(`Seeded ${count} placeholder subjects.`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
