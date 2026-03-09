import { BU, MONDAY_BOARDS } from './constants';

const MONDAY_API = 'https://api.monday.com/v2';

// ── CHECK IF MONDAY IS CONFIGURED ─────────────────────────
export function isMondayConfigured(): boolean {
  return !!process.env.MONDAY_API_KEY && Object.keys(MONDAY_BOARDS).length > 0;
}

// ── GET BOARD ID FOR BU ───────────────────────────────────
export function getBoardId(bu: BU): string | null {
  // Check direct match
  if (MONDAY_BOARDS[bu]) return MONDAY_BOARDS[bu]!;
  // Fall back to parent BU for iOLX sub-BUs
  if (['iOLX Supply', 'iOL X3 Supply', 'iOLX Demand'].includes(bu)) {
    return MONDAY_BOARDS['iOLX Supply'] ?? null;
  }
  return null;
}

// ── CREATE TASK (graceful — logs warning if unconfigured) ──
export async function createMondayTask(params: {
  bu: BU;
  title: string;
  description: string;
  assigneeEmail: string;
  emailSubject: string;
  emailId: string;
}): Promise<{ success: boolean; taskId?: string; reason?: string }> {
  if (!process.env.MONDAY_API_KEY) {
    console.warn('[Monday] API key not configured — skipping task creation');
    return { success: false, reason: 'monday_not_configured' };
  }

  const boardId = getBoardId(params.bu);
  if (!boardId) {
    console.warn(`[Monday] No board ID for BU "${params.bu}" — skipping task creation`);
    return { success: false, reason: 'board_id_missing' };
  }

  try {
    // Look up Monday user ID by email
    const userId = await getMondayUserId(params.assigneeEmail);
    if (!userId) {
      return { success: false, reason: 'user_not_found_in_monday' };
    }

    const mutation = `
      mutation {
        create_item(
          board_id: ${boardId},
          item_name: "${escapeGql(params.title)}",
          column_values: "${escapeGql(JSON.stringify({
            text: params.description,
            person: { personsAndTeams: [{ id: parseInt(userId), kind: 'person' }] },
            text0: params.emailId,
          }))}"
        ) { id }
      }
    `;

    const res = await mondayRequest(mutation);
    const createItem = res?.data?.create_item as { id: string } | undefined;
    return { success: true, taskId: createItem?.id };
  } catch (err) {
    console.error('[Monday] Task creation failed:', err);
    return { success: false, reason: 'api_error' };
  }
}

// ── GET USER ID BY EMAIL ──────────────────────────────────
async function getMondayUserId(email: string): Promise<string | null> {
  const q = `{ users(email: "${email}") { id } }`;
  try {
    const res = await mondayRequest(q);
    const users = res?.data?.users as Array<{ id: string }> | undefined;
    return users?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ── MONDAY API REQUEST ────────────────────────────────────
async function mondayRequest(query: string): Promise<{ data: Record<string, unknown> }> {
  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': process.env.MONDAY_API_KEY!,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Monday API error: ${res.status}`);
  return res.json() as Promise<{ data: Record<string, unknown> }>;
}

function escapeGql(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
