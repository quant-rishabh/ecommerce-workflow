import policies from "../data/policies.json";

export type PolicyIssue = keyof typeof policies;

type PolicyInput = {
  issueType: string;
  deliveredAt?: string;
  orderStatus?: string;
  orderAmount?: number;
};

export function checkPolicy(input: PolicyInput) {
  const issueType = input.issueType.toUpperCase() as PolicyIssue;
  const policy = policies[issueType];

  if (!policy) {
    return {
      issueType,
      eligible: false,
      reason: "No policy exists for this issue type."
    };
  }

  if (issueType === "REFUND") {
    const refundPolicy = policies.REFUND;
    const amount = input.orderAmount ?? 0;
    return {
      issueType,
      eligible: amount > 0,
      requiresApproval: amount > refundPolicy.automaticRefundLimit,
      automaticRefundLimit: refundPolicy.automaticRefundLimit,
      currency: refundPolicy.currency,
      reason:
        amount > refundPolicy.automaticRefundLimit
          ? "Refund amount exceeds the automatic refund limit."
          : "Refund is within the automatic refund limit."
    };
  }

  if (issueType === "CANCELLATION") {
    const cancellationPolicy = policies.CANCELLATION;
    const eligible = cancellationPolicy.cancellableStatuses.includes(input.orderStatus ?? "");
    return {
      issueType,
      eligible,
      reason: eligible
        ? "The order can still be cancelled."
        : "The order status is no longer cancellable."
    };
  }

  if (issueType === "RETURN") {
    const returnWindowDays = policies.RETURN.returnWindowDays;
    const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : null;
    const daysSinceDelivery = deliveredAt && !Number.isNaN(deliveredAt.getTime())
      ? Math.floor((Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const eligible = daysSinceDelivery === null || daysSinceDelivery <= returnWindowDays;
    return {
      issueType,
      eligible,
      returnWindowDays,
      reason: eligible
        ? `The item is eligible within the ${returnWindowDays}-day return window.`
        : `The ${returnWindowDays}-day return window expired ${daysSinceDelivery} days after delivery.`
    };
  }

  if (issueType === "DAMAGED_ITEM" || issueType === "WRONG_ITEM") {
    const itemIssuePolicy = policies[issueType];
    return {
      issueType,
      eligible: true,
      eligibleActions: itemIssuePolicy.eligibleActions,
      reason: "The issue is eligible for a replacement or refund review."
    };
  }

  return {
    issueType,
    eligible: true,
    returnWindowDays: policies.RETURN.returnWindowDays,
    reason: `The item is eligible within the ${policies.RETURN.returnWindowDays}-day return window.`
  };
}
