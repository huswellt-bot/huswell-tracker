-- Quarterly sales targets for the KPI dashboard.
-- Run after 003_complete_workflows.sql. Additive and safe to re-run.

alter table public.target_goals
  drop constraint if exists target_goals_goal_type_check;

alter table public.target_goals
  add constraint target_goals_goal_type_check
  check (
    goal_type in (
      'monthly_item',
      'monthly_sales',
      'quarterly_sales',
      'annual_sales',
      'daily_task',
      'weekly_task',
      'monthly_task',
      'annual_task'
    )
  );
