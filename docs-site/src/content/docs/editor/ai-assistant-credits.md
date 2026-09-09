---
title: AI model selection & credits
description: Choose a model, monitor your credit balance, and understand the out-of-credits state.
---

The AI Assistant can use different models, each with its own cost and capability. Your usage
is metered by credits, which deplete as you run assistant turns.

## Choosing a model

When you open the assistant panel, the **model selector** appears below the chat input. Models are
grouped into three tiers:

- **Cheap** (fast, lower cost): Good for quick edits and refinements.
- **Balanced** (standard, moderate cost): The recommended default for most use cases.
- **Premium** (capable, higher cost): Handles complex requests and large attachments.

Each model displays a **cost estimate** (e.g., "~50 credits per turn") so you know the
impact before sending. Your choice is **remembered** across sessions and changeable
at any time — you can switch mid-conversation without losing chat history.

## Credit balance

The **credit balance chip** appears in the assistant's top bar, showing your current balance
(e.g., "Balance: 1,500 cr"). It updates immediately after each turn, reflecting the cost of
the model you chose.

Your balance comes from your server admin — if you need more credits, contact them or ask
about purchasing options.

## Resumable migration credits

**Analyze selection** does not call the AI. **Start migration** and **Resume
migration** explicitly authorize generation and can consume credits. The selected
model stays fixed for the run; each menu uses that model's active catalog prices
at the time of conversion, not a price frozen during analysis.

There is no separate migration credit cap to enter. Network credits are consumed
menu by menu; generation stops when the available balance is exhausted.
**Pause after this menu** can still let the current menu finish and be charged.
Generation also respects the administrator's per-menu credit limit and your
available balance. An interruption does not automatically retry a paid call.

Reopening progress, retrieving completed proposals and applying them to your draft
do not consume credits. Resuming reuses completed steps without charging for them
again. Known usage from a failed attempt is recorded without a credit debit;
provider-side consumption before a process crash may be unavailable and cannot
be guaranteed exactly once.

## Out of credits

If you run out of credits, the assistant responds with an error message and prompts you to
visit the **Credits** page (`/credits`). That page is your entry point to purchase more
credits or contact support — it may be unavailable during this beta, but keep checking back.

For now, if you hit this limit:

1. Stop chatting with the assistant.
2. Reach out to your server admin to request a credit grant.

---

**Tip**: Start with the **Balanced** model and switch to **Cheap** for lighter tasks if you
want to stretch your budget.
