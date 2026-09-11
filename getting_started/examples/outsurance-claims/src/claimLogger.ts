import fs from 'fs';
import path from 'path';
import type { ConversationState } from './state.js';

const LOG_FILE = path.join(process.cwd(), 'claims-log.jsonl');

/**
 * Appends a claim record to a local JSONL file, one JSON object per line.
 * Quick-and-dirty persistence for testing/demo purposes — not meant for
 * production (no concurrency safety, no rotation, no real database).
 * Replace with Twilio Sync or a real database before going live.
 */
export function saveClaimRecord(conversationId: string, state: ConversationState): void {
  try {
    const record = {
      timestamp: new Date().toISOString(),
      conversationId,
      customerName: state.customerName,
      policyNumber: state.policyNumber,
      phoneNumber: state.phoneNumber,
      email: state.email,
      injuryReported: state.injuryReported,
      accident: state.accident,
      claimChecklistSent: state.claimChecklistSent,
      topicsDiscussed: state.topicsDiscussed,
    };

    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
    console.log(`[claimLogger] Saved claim record for ${conversationId} to ${LOG_FILE}`);
  } catch (err) {
    console.error('[claimLogger] Failed to save claim record:', err);
  }
}