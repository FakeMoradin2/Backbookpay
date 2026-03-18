-- Allow manual reservations for non-registered clients.
-- 1) usuario_id becomes nullable for guest bookings
-- 2) Contact fields are stored directly in reservas

alter table if exists public.reservas
  alter column usuario_id drop not null;

alter table if exists public.reservas
  add column if not exists cliente_manual_nombre varchar(100),
  add column if not exists cliente_manual_correo varchar(150),
  add column if not exists cliente_manual_telefono varchar(20);

alter table if exists public.reservas
  add constraint ck_reservas_cliente_manual_nombre_nonempty
  check (
    cliente_manual_nombre is null
    or length(btrim(cliente_manual_nombre)) > 0
  );
