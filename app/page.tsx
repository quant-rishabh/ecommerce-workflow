"use client";

import { FormEvent, useEffect, useState } from "react";

type Order = {
  id: string;
  customerName: string;
  status: string;
  expectedDelivery: string;
  items: { name: string; quantity: number }[];
  totalAmount: number;
  currency: string;
};

type Shipment = { orderId: string; delayMinutes?: number };

type Message = { role: "user" | "assistant"; content: string };

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("10492");
  const [gmailConnected, setGmailConnected] = useState(false);

  useEffect(() => {
    setGmailConnected(new URLSearchParams(window.location.search).get("gmail") === "connected");
    fetch("/api/orders")
      .then((response) => response.json())
      .then((data: { orders?: Order[]; shipments?: Shipment[] }) => {
        setOrders(data.orders ?? []);
        setShipments(data.shipments ?? []);
      });
  }, []);

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? orders[0];

  if (!selectedOrder) {
    return <main className="shell"><section className="chat-panel"><p>Loading orders...</p></section></main>;
  }

  function selectOrder(orderId: string) {
    setSelectedOrderId(orderId);
    setMessage(`Tell me about order #${orderId}`);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = message.trim();
    if (!value || loading) return;

    setMessages((current) => [...current, { role: "user", content: value }]);
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: value, selectedOrderId, messages })
      });
      const data = (await response.json()) as { reply?: string; error?: string };
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.reply ?? data.error ?? "Something went wrong." }
      ]);
    } catch {
      setMessages((current) => [...current, { role: "assistant", content: "Could not connect to the backend." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <aside className="orders-panel" aria-label="Orders">
        <div className="orders-heading">
          <div>
            <p className="eyebrow">CUSTOMER ORDERS</p>
            <h2>Order desk</h2>
          </div>
          <span className="order-count">{orders.length}</span>
        </div>
        <div className="order-list">
          {orders.map((order) => {
            const shipment = shipments.find((item) => item.orderId === order.id);
            const isSelected = order.id === selectedOrderId;
            const isDelayed = Boolean(shipment?.delayMinutes);
            return (
              <button
                type="button"
                className={`order-row${isSelected ? " selected" : ""}`}
                key={order.id}
                onClick={() => selectOrder(order.id)}
                aria-pressed={isSelected}
              >
                <span className="order-row-top">
                  <strong>#{order.id}</strong>
                  <span className={`order-status ${order.status.toLowerCase()}`}>{order.status.replaceAll("_", " ")}</span>
                </span>
                <span className="order-item">{order.items[0]?.name}</span>
                <span className="order-row-bottom">
                  <span>{order.currency} {order.totalAmount.toLocaleString("en-IN")}</span>
                  <span className={isDelayed ? "delay-text" : ""}>{isDelayed ? `${shipment?.delayMinutes}m delay` : order.expectedDelivery}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="orders-footer">
          <span className="status-dot small" />
          <span>Agent ready</span>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <p className="eyebrow">PHASE 03 / POLICY-AWARE OPERATIONS</p>
          <h1>OpsPilot</h1>
          <p className="subtitle">Customer operations agent <span className="header-divider">/</span> Order #{selectedOrder.id}</p>
          {gmailConnected && <p className="subtitle">Gmail connected. Future pickup confirmations will be sent through Gmail.</p>}
        </header>

        <div className="messages" aria-live="polite">
          {messages.length === 0 && (
            <div className="empty-state">
              <span className="status-dot" />
              <p>Ask about an order to test the agent.</p>
              <button type="button" onClick={() => setMessage(`Where is my order #${selectedOrder.id}?`)}>Try order #{selectedOrder.id}</button>
            </div>
          )}
          {messages.map((item, index) => (
            <div className={`message ${item.role}`} key={`${item.role}-${index}`}>
              <span>{item.role === "user" ? "You" : "Agent"}</span>
              <p>{item.content}</p>
            </div>
          ))}
          {loading && <div className="message assistant"><span>Agent</span><p>Checking the request...</p></div>}
        </div>

        <form onSubmit={sendMessage} className="composer">
          <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Where is my order #10492?" disabled={loading} />
          <button type="submit" disabled={loading || !message.trim()} aria-label="Send message">Send</button>
        </form>
      </section>
    </main>
  );
}