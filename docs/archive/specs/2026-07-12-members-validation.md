# Members validation — manual

1. Owner: network settings → Members → Invite (no email) → link copied.
2. Second account (private browsing): open the link → preview → login → Join → network visible, projects editable, deploy OK.
3. The member does NOT see the member/server actions (rotate, delete, invites); direct API → 403.
4. Invite with email (if SMTP configured): mail received with the link; otherwise: link returned anyway.
5. Revoking an invite → the link shows "revoked".
6. Promote member → owner; demoting the last owner is impossible (disabled button + 409 API).
7. Remove member → the network disappears from their account on next load.
