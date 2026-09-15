-- Repair default names left behind by completed folder renames, including chains.
UPDATE projects AS p
SET name = p.external_id, updated_at = now()
WHERE p.deleted_at IS NULL
  AND p.identity_kind <> 'addon'
  AND p.external_id IS NOT NULL
  AND p.name <> p.external_id
  AND EXISTS (
    SELECT 1 FROM project_renames AS r
    WHERE r.project_id = p.id AND r.status = 'complete' AND r.source_id = p.name
  )
  AND EXISTS (
    SELECT 1 FROM project_renames AS r
    WHERE r.project_id = p.id AND r.status = 'complete' AND r.target_id = p.external_id
  );
