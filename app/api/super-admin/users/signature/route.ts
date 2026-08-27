import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNATURE_BUCKET = "staff-signatures";
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status });

async function getSuperAdminOrganization() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("role", "super_admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return membership?.organization_id ?? null;
}

function adminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function POST(request: Request) {
  const organizationId = await getSuperAdminOrganization();
  if (!organizationId)
    return json({ error: "Only the Super Admin can save user signatures." }, 403);
  const admin = adminClient();
  if (!admin)
    return json(
      {
        error:
          "User management is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.",
      },
      500,
    );

  const form = await request.formData().catch(() => null);
  const userId = typeof form?.get("user_id") === "string" ? form.get("user_id") : "";
  const signature = form?.get("signature");
  if (!userId || !(signature instanceof File))
    return json({ error: "Choose a signature image for a valid user." }, 400);
  if (!extensions[signature.type])
    return json({ error: "Use a PNG, JPG, or WebP signature image." }, 400);
  if (signature.size === 0 || signature.size > MAX_SIGNATURE_BYTES)
    return json({ error: "The signature image must be 2 MB or smaller." }, 400);

  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError || !membership)
    return json({ error: membershipError?.message ?? "This user is not assigned to this workspace." }, 404);
  if (!['project_manager', 'admin'].includes(membership.role))
    return json({ error: "A signature can only be saved for a Sales Project Officer or General Manager." }, 400);

  const path = `${organizationId}/${userId}/signature.${extensions[signature.type]}`;
  const { error: uploadError } = await admin.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, Buffer.from(await signature.arrayBuffer()), {
      contentType: signature.type,
      cacheControl: "3600",
      upsert: true,
    });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const publicUrl = admin.storage.from(SIGNATURE_BUCKET).getPublicUrl(path).data.publicUrl;
  const signatureUrl = `${publicUrl}?v=${Date.now()}`;
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, signature_url: signatureUrl });
  if (profileError) return json({ error: profileError.message }, 500);

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const quotationPatch =
    membership.role === "project_manager"
      ? { prepared_by_signature_url: signatureUrl }
      : {
          approved_by_signature_url: signatureUrl,
          ...(profile?.full_name ? { approved_by_name: profile.full_name } : {}),
        };
  const quotationUserColumn =
    membership.role === "project_manager" ? "prepared_by_user_id" : "approved_by";
  const { error: quotationError } = await admin
    .from("quotations")
    .update(quotationPatch)
    .eq("organization_id", organizationId)
    .eq(quotationUserColumn, userId);
  if (quotationError) return json({ error: quotationError.message }, 500);

  return Response.json({
    message: `${membership.role === "project_manager" ? "Sales Project Officer" : "General Manager"} signature saved.`,
    signature_url: signatureUrl,
  });
}
