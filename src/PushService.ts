import webpush, { PushSubscription } from "web-push";
import { randomUUID } from "crypto";

export class PushService {
  private subscriptions = new Map<string, PushSubscription>();

  constructor() {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set");
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL ?? "admin@localhost"}`,
      pub,
      priv
    );
  }

  get publicKey(): string {
    return process.env.VAPID_PUBLIC_KEY!;
  }

  add(sub: PushSubscription): string {
    const id = randomUUID();
    this.subscriptions.set(id, sub);
    console.log(`[Push] Subscription added (total: ${this.subscriptions.size})`);
    return id;
  }

  async broadcast(payload: { title: string; body: string; tag?: string }): Promise<void> {
    if (this.subscriptions.size === 0) return;
    const msg = JSON.stringify(payload);
    await Promise.allSettled(
      [...this.subscriptions.entries()].map(async ([id, sub]) => {
        try {
          await webpush.sendNotification(sub, msg);
        } catch (err: any) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            this.subscriptions.delete(id);
          }
        }
      })
    );
  }
}
