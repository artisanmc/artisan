- **Fixed**: Deploying a draft could erase changes made on the server since the draft was
  started: a tab still showing an older version saved it against the server's new files, and
  the deploy's check passed. A draft's base now only moves with its content, so such a deploy
  reports a conflict instead.
- **Changed**: Reopening a draft merges the server's changes to files the draft did not touch,
  and opens the conflict window on files both changed, instead of showing the draft's old
  version without a word.
- **Fixed**: A draft discarded in one tab no longer comes back from another open tab.
