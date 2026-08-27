import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateProjectManagerRequest = {
  full_name?: unknown;
  email?: unknown;
  password?: unknown;
};

const json = (body: Record<string, string>, status: number) =>
  Response.json(body, { status });

async function getSuperAdminOrganization() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("role", "super_admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return membership?.organization_id ? membership.organization_id : null;
}

export async function POST(request: Request) {
  const organizationId = await getSuperAdminOrganization();
  if (!organizationId)
    return json({ error: "Only the Super Admin can create Project Manager accounts." }, 403);

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey)
    return json({ error: "Project Manager account creation is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment." }, 500);

  const body = (await request.json().catch(() => null)) as CreateProjectManagerRequest | null;
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!fullName || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6)
    return json({ error: "Enter a full name, valid email address, and a password with at least 6 characters." }, 400);

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user)
    return json({ error: createError?.message ?? "Unable to create the account." }, 400);

  const userId = created.user.id;
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, full_name: fullName });
  const { error: membershipError } = profileError
    ? { error: profileError }
    : await admin.from("organization_members").upsert(
        {
          organization_id: organizationId,
          user_id: userId,
          role: "project_manager",
        },
        { onConflict: "organization_id,user_id" },
      );

  if (membershipError) {
    await admin.auth.admin.deleteUser(userId);
    return json({ error: membershipError.message }, 500);
  }

  return Response.json({ message: "Project Manager account created." }, { status: 201 });
}
