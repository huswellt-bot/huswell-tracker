import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CreateUserRequest = {
  full_name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  production_approval_enabled?: unknown;
};
type UserOperationRequest = {
  user_id?: unknown;
  action?: unknown;
  full_name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  production_approval_enabled?: unknown;
};

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status });
const isMissingProductionApprovalTable = (
  error: { code?: string } | null | undefined,
) => Boolean(error && ["42P01", "PGRST205"].includes(error.code ?? ""));

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
  return membership?.organization_id
    ? { organizationId: membership.organization_id, userId: user.id }
    : null;
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

async function setProductionApprovalPermission(
  admin: NonNullable<ReturnType<typeof adminClient>>,
  organizationId: string,
  userId: string,
  actorUserId: string,
  enabled: boolean,
): Promise<{ error: { message: string } | null }> {
  const now = new Date().toISOString();
  const result = enabled
    ? await admin.from("production_approval_permissions").upsert(
        {
          organization_id: organizationId,
          user_id: userId,
          is_active: true,
          granted_by: actorUserId,
          granted_at: now,
          revoked_by: null,
          revoked_at: null,
          updated_at: now,
        },
        { onConflict: "organization_id,user_id" },
      )
    : await admin
        .from("production_approval_permissions")
        .update({
          is_active: false,
          revoked_by: actorUserId,
          revoked_at: now,
          updated_at: now,
        })
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
  if (result.error && !enabled && isMissingProductionApprovalTable(result.error))
    return { error: null };
  return { error: result.error ? { message: result.error.message } : null };
}

export async function GET() {
  const context = await getSuperAdminOrganization();
  if (!context)
    return json({ error: "Only the Super Admin can view users." }, 403);
  const { organizationId } = context;
  const admin = adminClient();
  if (!admin)
    return json(
      {
        error:
          "User management is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.",
      },
      500,
    );

  const [{ data: memberships, error: membershipError }, { data: authData, error: authError }] = await Promise.all([
    admin
      .from("organization_members")
      .select("user_id,role,created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true }),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (membershipError || authError)
    return json(
      {
        error:
          membershipError?.message ??
          authError?.message ??
          "Unable to load users.",
      },
      500,
    );

  const userIds = (memberships ?? []).map((member) => member.user_id);
  const [
    { data: profiles, error: profileError },
    { data: projectTypeAssignments, error: assignmentError },
    { data: productionApprovals, error: productionApprovalError },
  ] = await Promise.all([
    userIds.length
      ? admin.from("profiles").select("id, signature_url").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? admin
          .from("pricing_officer_project_types")
          .select("pricing_officer_user_id, project_type")
          .in("pricing_officer_user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? admin
          .from("production_approval_permissions")
          .select("user_id, is_active")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (
    profileError ||
    assignmentError ||
    (productionApprovalError &&
      !isMissingProductionApprovalTable(productionApprovalError))
  )
    return json({ error: profileError?.message ?? assignmentError?.message ?? productionApprovalError?.message ?? "Unable to load user details." }, 500);

  const authUsers = new Map(
    (authData.users ?? []).map((user) => [user.id, user]),
  );
  const profileByUserId = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const projectTypesByUserId = new Map<string, string[]>();
  (projectTypeAssignments ?? []).forEach((assignment) => {
    const userProjectTypes = projectTypesByUserId.get(assignment.pricing_officer_user_id) ?? [];
    userProjectTypes.push(assignment.project_type);
    projectTypesByUserId.set(assignment.pricing_officer_user_id, userProjectTypes);
  });
  const productionApprovalUserIds = new Set(
    (productionApprovals ?? [])
      .filter((permission) => permission.is_active)
      .map((permission) => permission.user_id),
  );
  return Response.json({
    users: (memberships ?? [])
      .filter((member) => member.role !== "super_admin")
      .map((member) => {
        const user = authUsers.get(member.user_id);
        return {
          id: member.user_id,
          full_name:
            typeof user?.user_metadata.full_name === "string"
              ? user.user_metadata.full_name
              : (user?.email ?? "Unnamed user"),
          email: user?.email ?? "—",
          role: member.role,
          project_types: projectTypesByUserId.get(member.user_id) ?? [],
          production_approval_enabled: productionApprovalUserIds.has(member.user_id),
          signature_url: profileByUserId.get(member.user_id)?.signature_url ?? null,
          created_at: member.created_at,
          banned: Boolean(
            user?.banned_until &&
            new Date(user.banned_until).getTime() > Date.now(),
          ),
        };
      }),
  });
}

export async function POST(request: Request) {
  const context = await getSuperAdminOrganization();
  if (!context)
    return json({ error: "Only the Super Admin can add users." }, 403);
  const { organizationId, userId: actorUserId } = context;
  const admin = adminClient();
  if (!admin)
    return json(
      {
        error:
          "User management is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.",
      },
      500,
    );

  const body = (await request
    .json()
    .catch(() => null)) as CreateUserRequest | null;
  const fullName =
    typeof body?.full_name === "string" ? body.full_name.trim() : "";
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role =
    body?.role === "admin" ||
    body?.role === "project_manager" ||
    body?.role === "sales_pricing_officer"
      ? body.role
      : null;
  const productionApprovalEnabled = body?.production_approval_enabled === true;
  if (
    !fullName ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    password.length < 6 ||
    !role
  )
    return json(
      {
        error:
          "Enter a full name, valid email address, password with at least 6 characters, and user type.",
      },
      400,
    );
  if (productionApprovalEnabled && role !== "sales_pricing_officer")
    return json(
      { error: "Production approval can only be assigned to a Sales & Pricing Officer." },
      400,
    );

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
  if (createError || !created.user)
    return json(
      { error: createError?.message ?? "Unable to create the account." },
      400,
    );

  const userId = created.user.id;
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, full_name: fullName });
  const { error: membershipError } = profileError
    ? { error: profileError }
    : await admin
        .from("organization_members")
        .upsert(
          { organization_id: organizationId, user_id: userId, role },
          { onConflict: "organization_id,user_id" },
        );
  if (membershipError) {
    await admin.auth.admin.deleteUser(userId);
    return json({ error: membershipError.message }, 500);
  }

  if (productionApprovalEnabled) {
    const { error: permissionError } = await setProductionApprovalPermission(
      admin,
      organizationId,
      userId,
      actorUserId,
      true,
    );
    if (permissionError) {
      await admin.from("organization_members").delete().eq("organization_id", organizationId).eq("user_id", userId);
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
      return json({ error: permissionError.message }, 500);
    }
  }

  return Response.json(
    { message: "User account created.", user_id: userId },
    { status: 201 },
  );
}

async function getManagedUser(organizationId: string, userId: string) {
  const admin = adminClient();
  if (!admin)
    return {
      admin: null,
      role: null,
      error:
        "User management is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.",
    };
  const { data: membership, error } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { admin, role: null, error: error.message };
  if (!membership)
    return {
      admin,
      role: null,
      error: "This user is not assigned to this workspace.",
    };
  if (membership.role === "super_admin")
    return {
      admin,
      role: null,
      error: "The Super Admin account cannot be changed here.",
    };
  return { admin, role: membership.role, error: null };
}

export async function PATCH(request: Request) {
  const context = await getSuperAdminOrganization();
  if (!context)
    return json({ error: "Only the Super Admin can manage users." }, 403);
  const { organizationId, userId: actorUserId } = context;
  const body = (await request
    .json()
    .catch(() => null)) as UserOperationRequest | null;
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  const action =
    body?.action === "ban" ||
    body?.action === "unban" ||
    body?.action === "update"
      ? body.action
      : null;
  if (!userId || !action)
    return json({ error: "A valid user action is required." }, 400);
  const managed = await getManagedUser(organizationId, userId);
  if (!managed.admin || !managed.role || managed.error)
    return json({ error: managed.error ?? "Unable to manage the user." }, 400);

  if (action === "ban" || action === "unban") {
    const { error } = await managed.admin.auth.admin.updateUserById(userId, {
      ban_duration: action === "ban" ? "876000h" : "none",
    });
    if (error) return json({ error: error.message }, 500);
    return Response.json({
      message:
        action === "ban" ? "User account banned." : "User account unbanned.",
    });
  }

  const fullName =
    typeof body?.full_name === "string" ? body.full_name.trim() : "";
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role =
    body?.role === "admin" ||
    body?.role === "project_manager" ||
    body?.role === "sales_pricing_officer"
      ? body.role
      : null;
  const productionApprovalRequested =
    typeof body?.production_approval_enabled === "boolean"
      ? body.production_approval_enabled
      : null;
  if (
    !fullName ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !role ||
    (password && password.length < 6)
  )
    return json(
      {
        error:
          "Enter a full name, valid email address, user type, and a password with at least 6 characters if changing it.",
      },
      400,
    );
  if (productionApprovalRequested === true && role !== "sales_pricing_officer")
    return json(
      { error: "Production approval can only be assigned to a Sales & Pricing Officer." },
      400,
    );
  let productionApprovalEnabled = productionApprovalRequested === true;
  if (
    role === "sales_pricing_officer" &&
    productionApprovalRequested === null
  ) {
    const { data: existingPermission, error: permissionReadError } =
      await managed.admin
        .from("production_approval_permissions")
        .select("is_active")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
    if (
      permissionReadError &&
      !isMissingProductionApprovalTable(permissionReadError)
    )
      return json({ error: permissionReadError.message }, 500);
    productionApprovalEnabled = existingPermission?.is_active === true;
  }

  const { error: authError } = await managed.admin.auth.admin.updateUserById(
    userId,
    {
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      ...(password ? { password } : {}),
    },
  );
  if (authError) return json({ error: authError.message }, 500);

  const { error: profileError } = await managed.admin
    .from("profiles")
    .upsert({ id: userId, full_name: fullName });
  if (profileError) return json({ error: profileError.message }, 500);
  if (role !== "sales_pricing_officer") {
    const { error: assignmentError } = await managed.admin
      .from("pricing_officer_project_types")
      .delete()
      .eq("organization_id", organizationId)
      .eq("pricing_officer_user_id", userId);
    if (assignmentError) return json({ error: assignmentError.message }, 500);
  }
  const { error: membershipError } = await managed.admin
    .from("organization_members")
    .update({ role })
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (membershipError) return json({ error: membershipError.message }, 500);

  const { error: permissionError } = await setProductionApprovalPermission(
    managed.admin,
    organizationId,
    userId,
    actorUserId,
    productionApprovalEnabled,
  );
  if (permissionError) return json({ error: permissionError.message }, 500);

  return Response.json({ message: "User account updated." });
}

export async function DELETE(request: Request) {
  const context = await getSuperAdminOrganization();
  if (!context)
    return json({ error: "Only the Super Admin can manage users." }, 403);
  const { organizationId, userId: actorUserId } = context;
  const body = (await request
    .json()
    .catch(() => null)) as UserOperationRequest | null;
  const userId = typeof body?.user_id === "string" ? body.user_id : "";
  if (!userId) return json({ error: "A user is required." }, 400);
  const managed = await getManagedUser(organizationId, userId);
  if (!managed.admin || !managed.role || managed.error)
    return json({ error: managed.error ?? "Unable to delete the user." }, 400);

  const { error: permissionError } = await setProductionApprovalPermission(
    managed.admin,
    organizationId,
    userId,
    actorUserId,
    false,
  );
  if (permissionError) return json({ error: permissionError.message }, 500);

  const { error: membershipError } = await managed.admin
    .from("organization_members")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (membershipError) return json({ error: membershipError.message }, 500);

  const { error: profileError } = await managed.admin
    .from("profiles")
    .delete()
    .eq("id", userId);
  if (profileError) return json({ error: profileError.message }, 500);

  // A soft delete prevents sign-in without deleting workflow approvals and
  // audit history that still reference this account.
  const { error } = await managed.admin.auth.admin.deleteUser(userId, true);
  if (error) return json({ error: error.message }, 500);
  return Response.json({
    message:
      "User account deactivated and removed from this workspace. Workflow history was retained.",
  });
}
