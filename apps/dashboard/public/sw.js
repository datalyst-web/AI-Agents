// Minimal Web Push service worker — escalation alerts only. Registered by
// the Notifications settings page (apps/dashboard/app/(dashboard)/notifications/page.tsx)
// when a user opts into push; does nothing else (no caching/offline behavior).
self.addEventListener("push", (event) => {
  let payload = { title: "Notification", body: "" };
  try {
    payload = event.data ? event.data.json() : payload;
  } catch {
    payload.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (url) event.waitUntil(self.clients.openWindow(url));
});
