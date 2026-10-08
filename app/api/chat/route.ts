import OpenAI from "openai";
import { getApprovalStatus, requestRefundApproval } from "../../../lib/approvals";
import { createPickupEvent, getAvailableSlots, getPickupStatus } from "../../../lib/calendar";
import { sendEmail } from "../../../lib/email";
import { getOrder } from "../../../lib/orders";
import { cancelOrder, markReturnPickupScheduled, requestReturn } from "../../../lib/order-actions";
import { checkPolicy } from "../../../lib/policies";
import { getShipment } from "../../../lib/shipments";

const toolDefinition = {
  type: "function" as const,
  function: {
    name: "getOrder",
    description: "Find an order by its order ID in the local order data.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

const shipmentToolDefinition = {
  type: "function" as const,
  function: {
    name: "getShipment",
    description: "Find shipment tracking details by order ID in the local shipment data.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

const policyToolDefinition = {
  type: "function" as const,
  function: {
    name: "checkPolicy",
    description: "Check the company policy for a customer issue. This only evaluates eligibility and never performs an action.",
    parameters: {
      type: "object",
      properties: {
        issueType: {
          type: "string",
          enum: ["REFUND", "CANCELLATION", "DAMAGED_ITEM", "WRONG_ITEM", "RETURN"]
        },
        orderStatus: {
          type: "string",
          description: "The current order status, when relevant"
        },
        orderId: {
          type: "string",
          description: "The order ID, when evaluating a return"
        },
        orderAmount: {
          type: "number",
          description: "The order or refund amount, when relevant"
        },
      },
      required: ["issueType"],
      additionalProperties: false
    }
  }
};

const cancellationToolDefinition = {
  type: "function" as const,
  function: {
    name: "cancelOrder",
    description: "Cancel an eligible order and process its automatic refund only after the customer explicitly confirms cancellation.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

const returnToolDefinition = {
  type: "function" as const,
  function: {
    name: "requestReturn",
    description: "Create a return request only after the customer explicitly confirms. The order must be delivered before a return can be requested.",
    parameters: {
      type: "object" as const,
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

const refundApprovalToolDefinition = {
  type: "function" as const,
  function: {
    name: "requestRefundApproval",
    description: "Create a pending refund approval request only after the customer explicitly confirms they want to request a refund. Do not process the refund.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

const approvalStatusToolDefinition = {
  type: "function" as const,
  function: {
    name: "getApprovalStatus",
    description: "Find the latest refund approval status for an order.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

const calendarAvailabilityToolDefinition = {
  type: "function" as const,
  function: {
    name: "checkCalendarAvailability",
    description: "Find available operations pickup slots for an order.",
    parameters: {
      type: "object",
      properties: {
        preference: {
          type: "string",
          description: "Legacy preference such as today_evening, tomorrow_morning, tomorrow_afternoon, or tomorrow. Prefer date and startTime for a specific requested day and time."
        },
        date: {
          type: "string",
          description: "Requested pickup date in YYYY-MM-DD format. Only today through the next 6 days is allowed."
        },
        startTime: {
          type: "string",
          description: "Requested pickup start time in 24-hour HH:mm format. Pickup windows are one hour and must start from 08:00 through 22:00."
        }
      },
      additionalProperties: false
    }
  }
};

const schedulePickupToolDefinition = {
  type: "function" as const,
  function: {
    name: "schedulePickup",
    description: "Book a confirmed pickup slot, create an operations calendar event, and send the customer a confirmation email. Call only after the customer explicitly chooses a slot.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        },
        slotId: {
          type: "string",
          description: "The slotId returned by checkCalendarAvailability. If the customer gives a date and time instead, also provide date and startTime."
        },
        date: {
          type: "string",
          description: "Requested pickup date in YYYY-MM-DD format, when the customer gives a date or relative day."
        },
        startTime: {
          type: "string",
          description: "Requested pickup start time in 24-hour HH:mm format, when the customer gives a time."
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

const pickupStatusToolDefinition = {
  type: "function" as const,
  function: {
    name: "getPickupStatus",
    description: "Find the scheduled pickup time for an order from the operations calendar.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, without a leading #"
        }
      },
      required: ["orderId"],
      additionalProperties: false
    }
  }
};

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function normalizeSlotText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getRequestedTime(value?: string) {
  if (!value) return null;
  const match = value.toLowerCase().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (match[3] === "pm" && hour < 12) hour += 12;
  if (match[3] === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

function getRequestedDate(value?: string) {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  const date = new Date();
  if (normalized.includes("tomorrow")) {
    date.setDate(date.getDate() + 1);
  } else if (!normalized.includes("today")) {
    const monthNames = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
    const dateMatch = normalized.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\b|\\b(${monthNames})\\s+(\\d{1,2})\\b`));
    if (!dateMatch) return undefined;
    const day = Number(dateMatch[1] ?? dateMatch[4]);
    const month = dateMatch[2] ?? dateMatch[3];
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(month);
    date.setMonth(monthIndex, day);
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getRequestedDayMonth(value?: string) {
  if (!value) return null;
  const monthNames = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  const match = value.toLowerCase().match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})\\b|\\b(${monthNames})\\s+(\\d{1,2})\\b`));
  if (!match) return null;
  return { day: match[1] ?? match[4], month: match[2] ?? match[3] };
}

function getSuggestedSlots<T extends { preference: string }>(slots: T[]) {
  const nearTermSlots = slots.filter((slot) => slot.preference === "day_0" || slot.preference === "day_1");
  return (nearTermSlots.length ? nearTermSlots : slots).slice(0, 3);
}

async function postChat(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "GEMINI_API_KEY is not configured. Copy .env.example to .env.local and add your key." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { message?: string; selectedOrderId?: string; messages?: ChatHistoryMessage[] };
  const message = body.message?.trim();

  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  const messageDate = getRequestedDate(message);
  const currentDate = new Date();
  const currentDateLabel = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;

  const openai = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
  });
  const history = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (item): item is ChatHistoryMessage =>
            (item?.role === "user" || item?.role === "assistant") && typeof item.content === "string"
        )
        .slice(-20)
    : [];
  const selectedOrderId = body.selectedOrderId?.trim();
  const selectedOrderContext = selectedOrderId && /^\d+$/.test(selectedOrderId)
    ? ` The customer currently has order #${selectedOrderId} selected in the order desk. If the customer refers to "this order" or asks an order question without another explicit order ID, use #${selectedOrderId}. An explicit order ID in the message always takes precedence.`
    : "";
  const messageOrderId = message.match(/#?(\d{4,})/)?.[1] ?? selectedOrderId;
  const previousAssistantMessage = history.filter((item) => item.role === "assistant").at(-1)?.content ?? "";
  const confirmsReturn = /\b(yes|proceed|submit|do it|return it)\b/i.test(message)
    && (/\breturn\b/i.test(message) || /\b(return|proceed)\b/i.test(previousAssistantMessage));

  if (confirmsReturn && messageOrderId) {
    const returnResult = await requestReturn(messageOrderId);
    if (!returnResult.requested) {
      return Response.json({ reply: returnResult.reason });
    }
    const slots = getSuggestedSlots(await getAvailableSlots());
    const slotText = slots.length
      ? slots.map((slot) => `* ${slot.label}`).join("\n")
      : "No pickup slots are currently available.";
    return Response.json({
      reply: `Your return request has been submitted. Here are the available pickup slots:\n${slotText}\nPlease choose one of these slots or provide another preferred date and time.`
    });
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
          `You are OpsPilot, a customer operations agent. The current date is ${currentDateLabel}. Help customers check orders, shipments, policies, cancellations, returns, refunds, approvals, and pickup scheduling. Always use getOrder when an order ID is provided. Use getShipment for delivery details. For cancellation, check policy and ask for explicit confirmation before calling cancelOrder. A return is available only after delivery. If a customer asks to return an undelivered order, explain that it is not returnable yet and offer cancellation only if the cancellation policy allows it; if it is already in transit, explain that neither return nor cancellation is currently available. For returns, ask for explicit confirmation before calling requestReturn; after a return request is created, check calendar availability and schedule the pickup only after the customer chooses a slot. Call schedulePickup only after an explicit slot choice; it creates the operations calendar event and attempts to send the customer a confirmation email. When presenting pickup availability, show no more than three suggested options, preferably from today or tomorrow, and ask the customer to provide another preferred date and time if those do not work. Never list every available slot across all seven days. When schedulePickup returns an email result, say the confirmation email was sent only when its status is SENT_GMAIL. When its status is SENT_MOCK, say the confirmation was recorded in the local mock outbox and was not sent through Gmail. When its status is FAILED, say the pickup was scheduled but the confirmation email could not be sent, and briefly explain the returned reason. Use getPickupStatus when the customer asks when a pickup is scheduled. For refunds, explain the policy and ask for confirmation before calling requestRefundApproval. That tool creates a PENDING approval request; it does not process a refund. Use getApprovalStatus for previous refund requests. Never claim an unsupported action was completed. Never invent information. Keep the final answer concise.` + selectedOrderContext
    },
    ...history,
    { role: "user", content: message }
  ];

  const tools = [
    toolDefinition,
    shipmentToolDefinition,
    policyToolDefinition,
    cancellationToolDefinition,
    returnToolDefinition,
    refundApprovalToolDefinition,
    approvalStatusToolDefinition,
    calendarAvailabilityToolDefinition,
    schedulePickupToolDefinition,
    pickupStatusToolDefinition
  ];
  let response = await openai.chat.completions.create({
    model: "gemini-2.5-flash",
    messages,
    tools,
    tool_choice: "auto"
  });

  for (let step = 0; step < 5; step += 1) {
    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) {
      return Response.json({ error: "The LLM returned no response." }, { status: 502 });
    }

    messages.push(assistantMessage);
    const toolCalls = assistantMessage.tool_calls ?? [];

    if (toolCalls.length === 0) {
      return Response.json({ reply: assistantMessage.content ?? "Please provide an order number." });
    }

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") {
        continue;
      }

      const argumentsValue = JSON.parse(toolCall.function.arguments) as {
        orderId?: string;
        issueType?: string;
        deliveredAt?: string;
        orderStatus?: string;
        orderAmount?: number;
        preference?: string;
        date?: string;
        startTime?: string;
        slotId?: string;
      };
      const orderId = (argumentsValue.orderId ?? selectedOrderId)?.replace(/^#/, "");
      let toolResult: unknown;

      if (toolCall.function.name === "getOrder") {
        const order = orderId ? await getOrder(orderId) : null;
        toolResult = order ?? { found: false, message: "No order found with that ID." };
      } else if (toolCall.function.name === "getShipment") {
        const shipment = orderId ? await getShipment(orderId) : null;
        toolResult = shipment ?? { found: false, message: "No shipment found for that order ID." };
      } else if (toolCall.function.name === "checkPolicy" && argumentsValue.issueType) {
        toolResult = checkPolicy({
          issueType: argumentsValue.issueType,
          deliveredAt: argumentsValue.deliveredAt ?? (argumentsValue.orderId ? (await getOrder(argumentsValue.orderId.replace(/^#/, "")))?.deliveredAt : undefined),
          orderStatus: argumentsValue.orderStatus,
          orderAmount: argumentsValue.orderAmount
        });
      } else if (toolCall.function.name === "cancelOrder" && orderId) {
        toolResult = await cancelOrder(orderId);
      } else if (toolCall.function.name === "requestReturn" && orderId) {
        toolResult = await requestReturn(orderId);
      } else if (toolCall.function.name === "requestRefundApproval" && orderId) {
        toolResult = await requestRefundApproval(orderId);
      } else if (toolCall.function.name === "getApprovalStatus" && orderId) {
        toolResult = (await getApprovalStatus(orderId)) ?? { found: false, message: "No approval request found for that order." };
      } else if (toolCall.function.name === "checkCalendarAvailability") {
        const availableSlots = await getAvailableSlots(argumentsValue.preference, messageDate ?? argumentsValue.date, argumentsValue.startTime);
        toolResult = { slots: getSuggestedSlots(availableSlots) };
      } else if (
        toolCall.function.name === "schedulePickup"
        && orderId
        && (
          argumentsValue.slotId
          || (argumentsValue.date && argumentsValue.startTime)
          || (getRequestedDate(message) && getRequestedTime(message))
        )
      ) {
        const requestedDate = messageDate ?? argumentsValue.date;
        const requestedTime = argumentsValue.startTime
          ? getRequestedTime(argumentsValue.startTime)
          : getRequestedTime(message);
        const requestedStartTime = requestedTime
          ? `${String(requestedTime.hour).padStart(2, "0")}:${String(requestedTime.minute).padStart(2, "0")}`
          : argumentsValue.startTime;
        const allAvailableSlots = await getAvailableSlots();
        const requestedDayMonth = getRequestedDayMonth(message);
        let availableSlots = await getAvailableSlots(undefined, requestedDate, requestedStartTime);
        let requestedSlot = allAvailableSlots.find(
          (slot) => {
            const normalizedLabel = normalizeSlotText(slot.label);
            const exactLabel = slot.slotId === argumentsValue.slotId
              || normalizedLabel === normalizeSlotText(argumentsValue.slotId ?? "");
            const labelDate = requestedDayMonth
              && (normalizedLabel.includes(`${requestedDayMonth.day}${requestedDayMonth.month}`)
                || normalizedLabel.includes(`${requestedDayMonth.month}${requestedDayMonth.day}`));
            const labelTime = requestedTime && getRequestedTime(slot.label);
            const exactDateTime = labelDate
              && requestedTime
              && labelTime
              && labelTime?.hour === requestedTime.hour
              && labelTime.minute === requestedTime.minute;
            return Boolean(exactLabel || exactDateTime);
          }
        );
        if (!requestedSlot && argumentsValue.slotId) {
          requestedSlot = availableSlots.find((slot) => slot.slotId === argumentsValue.slotId);
        }
        if (!requestedSlot && availableSlots.length === 1) {
          requestedSlot = availableSlots[0];
        }
        if (!requestedSlot && requestedTime) {
          requestedSlot = allAvailableSlots.find((slot) => {
            const slotTime = getRequestedTime(slot.label);
            return slotTime?.hour === requestedTime.hour && slotTime.minute === requestedTime.minute;
          });
        }
        if (!requestedSlot && requestedStartTime) requestedSlot = availableSlots[0];
        if (!requestedSlot && !argumentsValue.slotId) requestedSlot = availableSlots[0];
        if (!requestedSlot) {
          availableSlots = await getAvailableSlots();
          const slotRequest = argumentsValue.slotId ?? "";
          const requestedTime = getRequestedTime(slotRequest);
          const requestedText = slotRequest.toLowerCase();
          requestedSlot = availableSlots.find((slot) => {
            const slotTime = getRequestedTime(slot.label);
            const matchesTime = requestedTime
              && slotTime?.hour === requestedTime.hour
              && slotTime.minute === requestedTime.minute;
            const matchesDay = requestedText.includes("tomorrow")
              ? slot.preference === "day_1"
              : requestedText.includes("today")
                ? slot.preference === "day_0"
                : true;
            return Boolean(matchesTime && matchesDay);
          });
        }
        const pickupSlotId = requestedSlot?.slotId ?? argumentsValue.slotId;
        let pickupResult;
        try {
          pickupResult = pickupSlotId
            ? await createPickupEvent(orderId, pickupSlotId)
            : { created: false, reason: "That pickup slot could not be resolved." };
        } catch (error) {
          pickupResult = {
            created: false,
            reason: error instanceof Error ? error.message : "The calendar provider rejected the pickup event."
          };
        }
        if (pickupResult.created && pickupResult.event) {
          await markReturnPickupScheduled(orderId);
          const order = await getOrder(orderId);
          let email: { status: string; to?: string; reason?: string } | null = null;
          if (order?.email) {
            try {
              const sentEmail = await sendEmail({
                to: order.email,
                subject: `Pickup scheduled for order #${orderId}`,
                body: `Your pickup has been scheduled for ${pickupResult.event.slotLabel}.`,
                orderId
              });
              email = { status: sentEmail.status, to: sentEmail.to };
            } catch (emailError) {
              email = {
                status: "FAILED",
                to: order.email,
                reason: emailError instanceof Error ? emailError.message : "The email provider rejected the message."
              };
            }
          } else {
            email = { status: "NOT_SENT", reason: "Customer email is missing." };
          }
          toolResult = { ...pickupResult, email };
        } else {
          toolResult = pickupResult;
        }
      } else if (toolCall.function.name === "getPickupStatus" && orderId) {
        toolResult = (await getPickupStatus(orderId)) ?? { found: false, message: "No pickup is scheduled for that order." };
      } else {
        toolResult = { found: false, message: "Unknown or incomplete tool request." };
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolResult)
      });
    }

    response = await openai.chat.completions.create({
      model: "gemini-2.5-flash",
      messages,
      tools,
      tool_choice: "auto"
    });
  }

  return Response.json({ error: "The agent reached its tool-call limit." }, { status: 502 });
}

export async function POST(request: Request) {
  try {
    return await postChat(request);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The backend could not complete the request." },
      { status: 502 }
    );
  }
}