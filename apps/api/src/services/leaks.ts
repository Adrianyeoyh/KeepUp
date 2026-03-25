import type { LeakStatus } from '@flowguard/shared';
import { query } from '../db/client.js';

export async function updateLeakStatusById(leakId: string, status: LeakStatus): Promise<void> {
  await query(
    `UPDATE leak_instances
     SET status = $1, updated_at = NOW()
     WHERE id = $2`,
    [status, leakId],
  );
}

export async function markLeaksDelivered(leakIds: string[]): Promise<void> {
  if (leakIds.length === 0) {
    return;
  }

  await query(
    `UPDATE leak_instances
     SET status = 'delivered', updated_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [leakIds],
  );
}
