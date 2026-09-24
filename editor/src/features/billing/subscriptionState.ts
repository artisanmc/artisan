import type { SubscriptionDto } from "@/lib/api/billing";

export function hasExistingSubscription(subscription: SubscriptionDto | null): boolean {
  return (
    !!subscription?.status && !["canceled", "incomplete_expired"].includes(subscription.status)
  );
}
