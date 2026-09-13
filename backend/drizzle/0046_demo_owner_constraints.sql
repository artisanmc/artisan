ALTER TABLE projects ADD CONSTRAINT projects_owner_check CHECK (
  (network_id IS NOT NULL AND demo_session_id IS NULL) OR
  (network_id IS NULL AND demo_session_id IS NOT NULL AND storage_kind = 'hosted')
);
--> statement-breakpoint
ALTER TABLE demo_sessions ADD CONSTRAINT demo_sessions_state_check CHECK (
  state IN ('active', 'claiming', 'claimed', 'expired') AND
  ((state IN ('claiming', 'claimed') AND claim_owner_id IS NOT NULL AND claim_network_id IS NOT NULL AND claim_operation_id IS NOT NULL) OR
   (state IN ('active', 'expired') AND claim_owner_id IS NULL AND claim_network_id IS NULL AND claim_operation_id IS NULL))
);
