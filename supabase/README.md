# Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** and run `001_initial_schema.sql` once, as one script.
3. Run `002_initialize_huswell_trading.sql`.
4. Run `003_complete_workflows.sql` as one script. It is additive and safe to re-run; it adds approvals, target goals, cash flow, production material usage, audit logging, role support, and report views.
5. Run `004_project_manager_customer_access.sql` to allow Project Managers to create and manage customers.
6. If you already ran step 5 before this change, also run `005_project_manager_customer_management.sql`.
7. Run `006_fix_quotation_status_default.sql` to repair an outdated quotation status default, if quotation creation reports `unfulfilled`.
8. Run `007_fix_role_sensitive_transition_status_cast.sql` to repair the shared status trigger, if quotation creation reports `invalid input value for enum quotation_status: "unfulfilled"`.
9. Run `008_restore_admin_staff_management.sql` to restore administrator role-change and staff-management permissions.
10. Run `009_fix_admin_approval_authorization.sql` to align quotation approval authorization with the central owner/admin role check.
11. Run `010_role_workflow_and_finance.sql` to add Leads/Projects, Supplier Payables, finance classifications, and the revised role access.
12. Run `011_costing_and_price_quotation_workflow.sql` to separate internal Costing Breakdowns from approved, downloadable client Price Quotations.
13. Run `012_owner_staff_identity.sql` so Owner / General Manager can see each workspace staff member by name.
14. Run `013_link_leads_to_costing.sql` to make Lead / Project the required source for Costing Breakdowns and Price Quotations.
15. Run `014_auto_generate_lead_number.sql` to automatically create Lead / Project numbers.
16. Alternatively, after migrations `001` through `009`, run only `015_apply_revised_workflow.sql` to apply the combined updates from `010` through `014`.
17. Run `016_project_officer_private_submissions.sql` to keep Project Officer costings/quotations private and send submitted work to Owner / General Manager.
18. Run `017_quotation_item_images.sql` to enable optional product-image uploads for customer quotations.
19. Run `018_quotation_item_details.sql` to enable optional material descriptions in customer quotations.
20. Run `019_lead_delete_authorization.sql` to allow only the lead creator, Owner / General Manager, or Admin to delete Leads / Projects.
21. Run `020_lead_edit_authorization.sql` to apply the same ownership rule to editing Leads / Projects.
22. Run `021_lead_tracker_fields.sql` to align the Add Lead / Project registration form with the outbound tracker.
23. If you ran an earlier version of migration 021, also run `022_refine_lead_registration_fields.sql`.
24. Run `023_project_manager_caller_directory.sql` so the Outbound Caller dropdown can list your Project Managers.
25. Run `024_add_outbound_caller_column.sql` if saving a lead reports that `outbound_caller` is missing from the schema cache.
26. Run `025_fix_outbound_method_constraint.sql` if saving a lead reports `leads_contact_method_check`.
27. Run `026_add_super_admin_role.sql`, then run `027_enable_super_admin_access.sql` as a separate script to enable the separate Super Admin user type.
28. Create the separate login in Supabase Authentication, then run `028_assign_super_admin.sql` to assign that login to the Super Admin user type. Replace its placeholder email addresses first.
29. Run `029_add_done_deal_status.sql` to enable Done Deal workflow statuses in Leads.
30. Run `030_general_manager_costing_workflow.sql`, then `031_fix_quotation_policy_recursion.sql`, to activate the General Manager Costing review flow without recursive quotation policies.
31. Run `032_add_costing_project_details.sql` for the client, project-type, and delivery fields in Costing Breakdowns.
32. Run `033_material_list_images_and_availability.sql` to enable material images and Available / Unavailable materials.
33. Run `034_harden_costing_approval_flow.sql` to make submission, review, and generated Price Quotations atomic.
34. Run `035_fix_costing_approval_status_enum.sql` to fix the Costing Breakdown approval status type mismatch.
35. Run `036_general_manager_review_and_project_edits.sql` for General Manager review refinements and Project Officer project-edit approvals.
36. Run `037_enforce_supplier_first_materials.sql` after deploying the supplier-aware application version; it prevents new supplier-less materials and cross-organization links.
37. Run `038_guard_supplier_and_material_deletes.sql` to preserve dependent supplier/material history by preventing unsafe deletes.
38. Run `039_make_lead_company_name_optional.sql` to support individual clients without a company name.
39. Run `040_quotation_bank_details.sql` to enable quotation bank-account defaults.
40. Run `041_sales_project_officer_signatures.sql` before using Sales Project Officer signatures in PDFs.
41. Run `042_auto_assign_lead_creator.sql` and `043_restrict_lead_reads_to_creators.sql` to keep new Lead ownership aligned with the creating Sales Project Officer.
42. Run `044_sales_project_officer_lead_change_approvals.sql` to require General Manager approval for Sales Project Officer Lead edits and deletions.
43. Run `045_live_costing_and_price_quotation_revisions.sql` to require General Manager approval before revising an approved Costing Breakdown and to refresh its existing Price Quotation after re-approval.
44. Run `046_quarterly_sales_targets.sql` to add quarterly sales quotas used by the KPI dashboard.
45. Run `047_shared_kpi_aggregates.sql` to give the KPI dashboard shared organization totals without exposing source records.
46. Run `048_shared_open_costings_kpi.sql` to include the organization-wide Open Costings total on the Sales Project Officer KPI cards.
47. Run `049_expand_done_deal_statuses.sql` before using the twelve-stage Done Deal project workflow.
48. Run `050_project_calendar.sql` to enable approved Price Quotation project scheduling and the Project Calendar.
49. Run `051_project_schedule_approvals.sql` to require General Manager approval for each Project Calendar entry and add its approval workflow.
50. Run `052_project_officer_kpi_aggregates.sql` to show organization and personal KPI counts for each Sales Project Officer. Run this before deploying the corresponding app code.
51. Run `053_general_manager_project_schedule_submit.sql` to allow General Managers to add project schedules while preserving the approval workflow.
52. Run `054_correct_quotation_total_rounding.sql` to persist configured costing rates and calculate quotation totals from rounded subtotal and VAT amounts.
53. Run `055_delete_linked_price_quotation_with_costing.sql` to delete a Costing Breakdown and its linked Price Quotation together, while protecting invoiced, scheduled, and production-linked quotations.
54. Run `056_general_manager_costing_revisions.sql` to allow General Managers to request revisions for approved Costing Breakdowns.
55. Run `057_approve_price_quotations_with_costings.sql` to mark generated Price Quotations approved when their Costing Breakdown is General Manager-approved, including existing eligible quotations.
56. Run `058_fix_costing_revision_reopen_order.sql` to reopen the linked Price Quotation before its Costing Breakdown during an approved revision request.
57. Run `059_atomic_general_approval_decisions.sql` to make general approval decisions atomic with their related record updates.
58. Run `060_project_schedule_revisions.sql` to require General Manager approval before changing approved Project Calendar dates.
59. Run `061_project_completion_approvals.sql` to require General Manager approval before marking a scheduled project finished and to synchronize its Production Job and KPI count.
60. Run `062_chatbot_lead_intake_and_assignment.sql` before deploying chatbot lead intake. It adds idempotent chatbot lead receipt, lets the General Manager assign a lead to a Sales Project Officer, and limits each officer to their assigned leads.
61. Run `063_enable_realtime_leads.sql` to enable the initial Leads real-time publication.
62. Run `063_price_quotation_preparation_workflow.sql` to activate the direct Price Quotation preparation and General Manager pricing workflow. The shared `063` prefix is intentional; run both files in the order listed.
63. Run `064_enable_workspace_realtime.sql` to update every workspace screen automatically when authorized data is created, changed, or deleted.
64. Run `065_price_quotation_revision_approvals.sql` to require General Manager approval before a Sales Project Officer can revise an approved direct Price Quotation.
65. Run `066_remove_price_quotation_expiry.sql` to remove Price Quotation expiry dates and the default Validity term.
66. Run `067_fix_price_quotation_draft_totals_guard.sql` to let a Sales Project Officer save item-only revisions without bypassing General Manager price protection.
67. Run `068_exclusive_project_due_dates.sql` before migration 070 to install the initial project due-date integrity guard.
68. Run `069_price_quotation_project_type.sql` to let Sales Project Officers save Project Type on direct Price Quotations.
69. Run `070_project_due_dates_by_project_type.sql` to allow different Project Types on one due date while preventing duplicates of the same Project Type and due date.
70. Run `071_price_quotation_illustrations_and_resubmission.sql` to add up to five view-only item illustrations, date-based direct quotation numbers, and the edit-then-resubmit Price Quotation revision workflow.
71. Run `072_project_schedule_progress.sql` to add protected Project Officer progress percentage and remark updates.
72. Run `073_extend_workspace_realtime.sql` to deliver newer Price Quotation revision updates automatically to open workspaces.
73. Run `074_preserve_price_quotation_resubmission_prices.sql` to retain selling prices on existing items when an approved direct Price Quotation is revised and resubmitted.
74. Run `075_retire_costing_breakdown_workflow.sql` to disable the legacy Costing Breakdown workflow while preserving its historical records.
75. Run `076_return_project_and_lead_edits_for_revision.sql` to let General Managers return Project and Lead edits for officer revision before resubmission.
76. Run `077_officer_unsubmit_pending_requests.sql` to let Project Officers withdraw their own pending edit, revision, and completion requests before General Manager review.
77. Run `078_general_manager_management_workflow_boundaries.sql` to preserve GM lead management while keeping quotation and project submission work officer-owned.
78. Run `079_allow_gm_approved_lead_deletion.sql` to complete approved Lead deletions without granting quotation-content edit access.
79. Run `080_allow_lead_unlink_for_historical_costings.sql` to allow the automatic Lead unlink required by approved Lead deletions.
80. Run `081_delete_direct_price_quotations.sql` to provide a guarded deletion path for direct Price Quotations.
81. Run `082_cascade_direct_price_quotation_deletion.sql` to delete direct quotation-derived operational and finance records together.
82. Run `083_general_manager_lead_deletion.sql` to support General Manager Lead deletion with the required scoped quotation unlink.
83. Run `084_cascade_lead_deletion.sql` to remove Lead-derived workflow records when an authorized Lead deletion is completed.
84. Run `085_delete_historical_price_quotations.sql` to safely delete historical Price Quotations and their retired Costing Breakdown sources when authorized.
85. Run `086_fix_price_quotation_resubmission_prices.sql` to preserve General Manager selling prices when an officer revises and resubmits a direct Price Quotation.
86. Run `087_preserve_price_quotation_revision_items.sql` to retain existing priced item records during an officer revision, while requiring the General Manager to price every new item.
87. Run `088_mockup_workflow.sql` to add the separate Mockups workspace with Sales Project Officer updates and real-time, read-only General Manager oversight.
88. Run `089_mockup_approval_and_illustrations.sql` to require General Manager mockup approval/revisions, private officer-uploaded illustrations, and an approved mockup before Project scheduling.
89. Run `090_add_lead_deletion_request_notes.sql` to store the required reason for a Sales Project Officer Lead-deletion request.
90. Run `091_require_dropped_client_reason.sql` to require and retain the reason when a Lead becomes Dropped Client.
91. Run `092_price_quotation_illustration_gallery.sql` to add quotation-level illustration galleries.
92. Run `093_fix_price_quotation_gallery_save.sql` to correct the quotation-gallery draft-save workflow.
93. Run `094_price_quotation_product_costings.sql` to add General Manager-only per-product internal costings for direct Price Quotations.
94. Run `095_allow_price_quotation_item_content_revisions.sql` to let Sales Project Officers revise direct quotation content without changing General Manager prices.
95. Run `096_fixed_amount_internal_cost_lines.sql` to support fixed-amount internal expenses such as logistics and design fees.
96. Run `101_company_policies.sql` to add General Manager-managed company policy PDFs.
97. Run `102_secure_company_policy_storage.sql` to make policy PDFs private and restrict their storage writes to the General Manager.
98. Run `103_company_announcements.sql` to add General Manager announcements that every organization member can view. Run it after `102_secure_company_policy_storage.sql` and before deploying the matching app code.
99. Create the first user through the app. Huswell Trading is initialized automatically after that first sign-in.

Before connecting the app, replace the placeholders in the project-root `.env.local` with the **Project URL** and **Publishable key** from Supabase Dashboard > Connect. `.env.example` is the shareable template.

The schema covers customers, suppliers, employees, product/service and supply inventory, quotations and costing, production, POS invoices/payments, expenses, cash flow, target goals, leave requests, payroll, approvals, activity logging, and organization-scoped security.

Every application table has Row Level Security enabled. Members can access only records belonging to their own organization; no service-role key is needed in the browser.

Keep `SUPABASE_SERVICE_ROLE_KEY` server-only in `.env.local` (without the `NEXT_PUBLIC_` prefix). It is required only for the secure server route that creates Project Manager authentication accounts; never expose it in browser code.

## Confirmed chatbot leads

After running migration `062_chatbot_lead_intake_and_assignment.sql`, add these server-only deployment variables:

```text
CHATBOT_LEAD_WEBHOOK_SECRET=<a long random value shared only with the chatbot server>
CHATBOT_LEAD_ORGANIZATION_ID=<the Huswell organization UUID>
```

The chatbot should POST its already-confirmed lead payload to
`/api/integrations/chatbot/leads` with `Authorization: Bearer <shared secret>`.
The endpoint accepts the chatbot's existing `leadId`, `capturedAt`, `fields`, and
`fieldTypes` payload, stores it once, and returns `{ "ok": true }` on both an
initial delivery and a safe retry. Chatbot leads are initially unassigned; a
General Manager assigns them from the existing **Leads** workspace.

## If the first run failed

Use the latest local copy of `001_initial_schema.sql` and run the entire file again. It is safe to re-run: it recreates policies and triggers without dropping tables or business records.
