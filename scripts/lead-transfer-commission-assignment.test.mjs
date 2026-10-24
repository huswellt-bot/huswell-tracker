import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/244_lead_transfer_commission_assignment.sql", "utf8");
const workspace = await readFile("components/huswell-workspace.tsx", "utf8");

assert.match(migration, /lead_transfer_origin_user_id uuid/);
assert.match(migration, /transfer_se_origin_user_id uuid/);
assert.match(migration, /transfer_co_worker_user_id uuid/);
assert.match(migration, /create trigger quotations_apply_lead_transfer_commission_assignment/);
assert.match(migration, /set assigned_to = p_recipient_user_id,\s+transfer_se_origin_user_id = v_transfer_origin_user_id,\s+transfer_co_worker_user_id = p_recipient_user_id/);
assert.match(migration, /v_handling_mode := 'shared'/);
assert.match(migration, /private\.validate_lead_transfer_commission_assignment/);
assert.match(workspace, /const transferCommissionLocked = Boolean\(transferCommissionOriginId\)/);
assert.match(workspace, /onChange=\{handleLeadChange\}/);
assert.match(workspace, /disabled=\{transferCommissionLocked \|\| commissionOriginSelectOptions\.length === 0\}/);
assert.match(workspace, /disabled=\{transferCommissionLocked\}/);
assert.match(workspace, /p_commission_handling_mode: effectiveHandlingMode/);
assert.match(workspace, /commissionOriginEditable=\{finalApproval && !transferCommissionLocked\}/);

console.log("lead transfer commission assignment contract passed");
