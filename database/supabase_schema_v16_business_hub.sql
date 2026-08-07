-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v16 (Business Hub)
-- ----------------------------------------------------------------------------
-- Supports the "Business Hub" (formerly "Distributor Hub") redesign:
--   • compute_business_health_score_breakdown — exposes the same five
--     sub-scores that compute_business_health_score (v8) already computes
--     internally, so the dashboard can render a breakdown instead of a
--     single number. No new metrics invented — same formula, split output.
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================================

create or replace function public.compute_business_health_score_breakdown(p_user_id uuid)
returns table (
  overall_score numeric,
  sales_score numeric,
  follow_up_score numeric,
  customer_score numeric,
  training_score numeric,
  ai_usage_score numeric
)
language sql
security definer
set search_path = public
as $$
  with metrics as (
    select
      least(25, coalesce((
        select sum(sales_amount) / 100 from distributor_analytics
        where distributor_id = p_user_id and metric_date >= current_date - 30
      ), 0)) as sales_score,
      least(25, case when (select count(*) from follow_ups where distributor_id = p_user_id and status in ('pending','completed')) = 0
        then 0
        else 25.0 * (select count(*) from follow_ups where distributor_id = p_user_id and status = 'completed') /
                     (select count(*) from follow_ups where distributor_id = p_user_id and status in ('pending','completed'))
      end) as follow_up_score,
      least(20, coalesce((
        select count(*) * 2 from customer_profiles where distributor_id = p_user_id and status = 'active_customer'
      ), 0)) as customer_score,
      least(15, coalesce((
        select avg(progress_pct) * 0.15 from training_enrollments where user_id = p_user_id
      ), 0)) as training_score,
      least(15, coalesce((
        select count(*) * 0.5 from distributor_analytics
        where distributor_id = p_user_id and metric_date >= current_date - 7 and ai_queries > 0
      ), 0)) as ai_score
  )
  select
    (sales_score + follow_up_score + customer_score + training_score + ai_score)::numeric(5,2) as overall_score,
    sales_score::numeric(5,2),
    follow_up_score::numeric(5,2),
    customer_score::numeric(5,2),
    training_score::numeric(5,2),
    ai_score::numeric(5,2)
  from metrics;
$$;

revoke execute on function public.compute_business_health_score_breakdown(uuid) from public, anon;
grant execute on function public.compute_business_health_score_breakdown(uuid) to authenticated;

-- ============================================================================
-- Done. Summary:
--   • 1 new function: compute_business_health_score_breakdown(user_id) —
--     same weighting as compute_business_health_score, returned as 5 parts
--     (sales/follow-up/customer/training/AI-usage) instead of one number.
-- ============================================================================
