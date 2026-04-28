import { useState, useCallback } from "react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function usePushNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  const enable = useCallback(async () => {
    if (!supported) { setError("Push notifications not supported in this browser"); return; }
    setLoading(true);
    setError(null);
    try {
      const keyRes = await fetch(`${SERVER_URL}/push/vapid-public-key`);
      const { publicKey } = await keyRes.json();

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notification permission denied");
        setLoading(false);
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await fetch(`${SERVER_URL}/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      setEnabled(true);
    } catch (err: any) {
      setError(err.message ?? "Failed to enable notifications");
    }
    setLoading(false);
  }, [supported]);

  const disable = useCallback(() => setEnabled(false), []);

  return { enabled, loading, error, supported, enable, disable };
}
