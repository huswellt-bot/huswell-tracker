import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RECEIPT_BUCKET = "quotation-payment-receipts";
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MAX_NOTES_LENGTH = 1000;
const receiptExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status });

const formString = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};

function isSameOrigin(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const originHeader = request.headers.get("origin");
  if (originHeader) return originHeader === requestOrigin;

  const refererHeader = request.headers.get("referer");
  if (!refererHeader) return false;
  try {
    return new URL(refererHeader).origin === requestOrigin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "The payment receipt form could not be read." }, 400);

  const organizationId = formString(form, "organization_id");
  const quotationId = formString(form, "quotation_id");
  const resubmissionPaymentId = formString(form, "payment_id");
  const paymentKind = formString(form, "payment_kind");
  const amount = formString(form, "amount");
  const paidAt = formString(form, "paid_at");
  const financeAccountId = formString(form, "finance_account_id");
  const referenceNo = formString(form, "reference_no");
  const notes = formString(form, "notes");
  const receipt = form.get("receipt");

  if (!organizationId || !quotationId || !paymentKind || !amount || !paidAt || !financeAccountId || !(receipt instanceof File)) {
    return json({ error: "Complete the payment details and upload the receipt image." }, 400);
  }
  if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(quotationId) || !UUID_PATTERN.test(financeAccountId) || (resubmissionPaymentId && !UUID_PATTERN.test(resubmissionPaymentId))) {
    return json({ error: "The workspace, quotation, or receiving account is invalid." }, 400);
  }
  if (!['downpayment', 'full_payment'].includes(paymentKind)) {
    return json({ error: "Choose a valid quotation payment type." }, 400);
  }
  const amountValue = Number(amount);
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    return json({ error: "Enter a payment amount greater than zero." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
    return json({ error: "Choose a valid payment date." }, 400);
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    return json({ error: "Payment note must be 1,000 characters or fewer." }, 400);
  }

  const extension = receiptExtensions[receipt.type];
  if (!extension || receipt.size <= 0 || receipt.size > MAX_RECEIPT_BYTES) {
    return json({ error: "Payment receipts must be JPEG, PNG, or WebP files no larger than 10 MB." }, 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Your session has expired. Sign in again and retry." }, 401);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token || session.user?.id !== user.id) {
    return json({ error: "Your session could not be used for the receipt upload. Sign in again and retry." }, 401);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .eq("role", "external_finance")
    .maybeSingle();
  if (membershipError) return json({ error: membershipError.message }, 500);
  if (!membership) return json({ error: "Only External Finance can submit a quotation payment receipt." }, 403);

  const { data: quotationRows, error: quotationError } = await supabase.rpc("external_finance_quotation_rows", {
    p_organization_id: organizationId,
  });
  if (quotationError) return json({ error: quotationError.message }, 500);
  const quotationExists = Array.isArray(quotationRows)
    && quotationRows.some((row) => row && typeof row === "object" && "id" in row && row.id === quotationId);
  if (!quotationExists) {
    return json({ error: "Payments can only be recorded against an approved direct Price Quotation." }, 400);
  }

  const paymentId = resubmissionPaymentId || crypto.randomUUID();
  const receiptObjectId = resubmissionPaymentId ? crypto.randomUUID() : paymentId;
  const path = `${organizationId}/${quotationId}/${receiptObjectId}.${extension}`;
  const storageClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    },
  );
  const { error: uploadError } = await storageClient.storage
    .from(RECEIPT_BUCKET)
    .upload(path, Buffer.from(await receipt.arrayBuffer()), {
      contentType: receipt.type,
      upsert: false,
    });
  if (uploadError) return json({ error: `Receipt upload failed: ${uploadError.message}` }, 500);

  try {
    const { error: registerError } = resubmissionPaymentId
      ? await supabase.rpc("resubmit_quotation_payment_with_account", {
          p_payment_id: paymentId,
          p_payment_kind: paymentKind,
          p_amount: amountValue,
          p_paid_at: paidAt,
          p_finance_account_id: financeAccountId,
          p_reference_no: referenceNo || null,
          p_notes: notes || null,
          p_receipt_storage_path: path,
          p_receipt_file_name: receipt.name,
          p_receipt_content_type: receipt.type,
          p_receipt_file_size: receipt.size,
        })
      : await supabase.rpc("register_quotation_payment_with_account", {
          p_payment_id: paymentId,
          p_quotation_id: quotationId,
          p_payment_kind: paymentKind,
          p_amount: amountValue,
          p_paid_at: paidAt,
          p_finance_account_id: financeAccountId,
          p_reference_no: referenceNo || null,
          p_notes: notes || null,
          p_receipt_storage_path: path,
          p_receipt_file_name: receipt.name,
          p_receipt_content_type: receipt.type,
          p_receipt_file_size: receipt.size,
        });
    if (!registerError) return json({ ok: true });

    await storageClient.storage.from(RECEIPT_BUCKET).remove([path]);
    return json({ error: `Payment registration failed: ${registerError.message}` }, 400);
  } catch (error) {
    await storageClient.storage.from(RECEIPT_BUCKET).remove([path]);
    return json({ error: `Payment registration failed: ${error instanceof Error ? error.message : "Payment receipt could not be registered."}` }, 500);
  }
}
