-- Run this file first, then run 027_enable_super_admin_access.sql.
-- It adds the separate Super Admin user type without changing existing Owners.

alter type public.member_role add value if not exists 'super_admin';
