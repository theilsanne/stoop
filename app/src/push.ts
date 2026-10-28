// Phone alerts (web push) on the app side: ask permission, subscribe this phone
// with the server's public key, and save the subscription so the server can send to it.

import type { Api } from "./api.ts";

export type AlertState = "checking" | "unsupported" | "blocked" | "off" | "on";

export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Alerts need the installed app. Reload Stoop once and try again.");
  return navigator.serviceWorker.ready;
}

/** Whether this phone is set up to get alerts. */
export async function alertState(api: Api): Promise<AlertState> {
  if (api.demo || !pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

function keyBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function turnOnAlerts(api: Api) {
  if (!pushSupported()) throw new Error("This browser can't receive alerts. On Android, use Chrome.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications weren't allowed, so alerts stay off.");
  const reg = await registration();
  const key = await api.alertsKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const j = sub.toJSON();
  await api.savePushSubscription({ endpoint: sub.endpoint, p256dh: j.keys!.p256dh, auth: j.keys!.auth });
}

export async function turnOffAlerts(api: Api) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.removePushSubscription(sub.endpoint);
  await sub.unsubscribe();
}
