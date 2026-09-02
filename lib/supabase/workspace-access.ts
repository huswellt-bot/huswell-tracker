import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const workspaceRoles = [
  "super_admin",
  "owner",
  "admin",
  "project_manager",
  "pricing_officer",
  "sales",
  "production",
  "warehouse",
  "accountant",
  "payroll",
  "viewer",
] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];

const isWorkspaceRole = (role: unknown): role is WorkspaceRole =>
  typeof role === "string" &&
  (workspaceRoles as readonly string[]).includes(role);

export async function requireWorkspaceAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Every route uses this verified membership role. Never infer a role from
  // a route name or from a client-side setting.
  if (!membership?.organization_id || !isWorkspaceRole(membership.role))
    redirect("/auth");

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", membership.organization_id)
    .single();

  return {
    organizationId: membership.organization_id,
    organizationName: organization?.name ?? "Huswell Trading",
    profileName: user.user_metadata.full_name ?? user.email ?? "User",
    profileEmail: user.email ?? "",
    role: membership.role,
  };
}
