-- Add explicit staff assignment per reservation.
ALTER TABLE public.reservas
ADD COLUMN IF NOT EXISTS staff_id uuid NULL;

ALTER TABLE public.reservas
ADD CONSTRAINT reservas_staff_id_fkey
FOREIGN KEY (staff_id) REFERENCES public.usuarios(id)
ON UPDATE CASCADE
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservas_staff_id ON public.reservas(staff_id);
CREATE INDEX IF NOT EXISTS idx_reservas_negocio_staff_inicio
  ON public.reservas(negocio_id, staff_id, inicio_en);
