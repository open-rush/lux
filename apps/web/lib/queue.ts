import { PgBoss } from 'pg-boss';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://rush:rush@localhost:5432/rush';

let _boss: PgBoss | null = null;

export async function getQueue(): Promise<PgBoss> {
  if (_boss) return _boss;

  _boss = new PgBoss(DATABASE_URL);

  _boss.on('error', (error: Error) => {
    console.error('[queue] pg-boss error:', error);
  });

  await _boss.start();
  return _boss;
}
