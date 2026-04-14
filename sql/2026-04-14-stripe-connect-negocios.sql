-- Stripe Connect: cuenta conectada por negocio (Express).
-- Ejecutar en Supabase SQL Editor.

ALTER TABLE public.negocios
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_connect_details_submitted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.negocios.stripe_connect_account_id IS 'Stripe Connect Express account id (acct_xxx)';
COMMENT ON COLUMN public.negocios.stripe_connect_charges_enabled IS 'Synced from Stripe account.updated';
COMMENT ON COLUMN public.negocios.stripe_connect_details_submitted IS 'Onboarding submitted';
