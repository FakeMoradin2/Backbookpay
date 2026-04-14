-- Supabase Storage: bucket público para logos de negocio e imágenes de servicios.
-- Rutas esperadas desde la app: {negocio_id}/... (el primer segmento debe ser el UUID del negocio).
-- Ejecutar en el SQL Editor del proyecto Supabase (Dashboard → SQL).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-assets',
  'business-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura pública (URLs getPublicUrl / CDN)
DROP POLICY IF EXISTS "business_assets_select_public" ON storage.objects;
CREATE POLICY "business_assets_select_public"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'business-assets');

-- Alta: solo usuarios autenticados cuyo perfil tiene negocio_id = primer segmento de la ruta
DROP POLICY IF EXISTS "business_assets_insert_own_negocio" ON storage.objects;
CREATE POLICY "business_assets_insert_own_negocio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  );

-- Actualizar / borrar: misma regla de carpeta
DROP POLICY IF EXISTS "business_assets_update_own_negocio" ON storage.objects;
CREATE POLICY "business_assets_update_own_negocio"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  );

DROP POLICY IF EXISTS "business_assets_delete_own_negocio" ON storage.objects;
CREATE POLICY "business_assets_delete_own_negocio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND EXISTS (
      SELECT 1
      FROM public.usuarios u
      WHERE u.id = auth.uid()
        AND u.negocio_id IS NOT NULL
        AND u.negocio_id::text = (string_to_array(name, '/'))[1]
    )
  );
