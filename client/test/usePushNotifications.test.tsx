import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PushNotificationsProvider, usePushNotifications } from "../src/hooks/usePushNotifications";

vi.mock("../src/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "../src/api/client";
const mockApi = vi.mocked(api);

function TestConsumer() {
  const { supported, subscribed, subscribe, unsubscribe } = usePushNotifications();
  if (!supported) return <div>Not supported</div>;
  return (
    <div>
      <div data-testid="subscribed">{String(subscribed)}</div>
      <button onClick={() => subscribe()}>Enable</button>
      <button onClick={() => unsubscribe()}>Disable</button>
    </div>
  );
}

describe("usePushNotifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports unsupported when the browser has no PushManager", () => {
    render(
      <PushNotificationsProvider>
        <TestConsumer />
      </PushNotificationsProvider>
    );

    expect(screen.getByText("Not supported")).toBeInTheDocument();
  });

  describe("on a browser with Web Push", () => {
    let getSubscription: ReturnType<typeof vi.fn>;
    let subscribeMock: ReturnType<typeof vi.fn>;
    let unsubscribeMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();

      const fakeSubscription = {
        endpoint: "https://push.example.com/abc",
        toJSON: () => ({ endpoint: "https://push.example.com/abc", keys: { p256dh: "p", auth: "a" } }),
        unsubscribe: (unsubscribeMock = vi.fn(async () => true)),
      };
      getSubscription = vi.fn(async () => null);
      subscribeMock = vi.fn(async () => fakeSubscription);

      vi.stubGlobal("PushManager", class {});
      vi.stubGlobal("Notification", {
        permission: "default",
        requestPermission: vi.fn(async () => "granted"),
      });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          ready: Promise.resolve({
            pushManager: { getSubscription, subscribe: subscribeMock },
          }),
        },
      });

      mockApi.get.mockResolvedValue({ publicKey: "dGVzdC1rZXk" });
      mockApi.post.mockResolvedValue({ ok: true });
      mockApi.delete.mockResolvedValue({ ok: true });
    });

    it("subscribes and posts the subscription to the server", async () => {
      const user = userEvent.setup();
      render(
        <PushNotificationsProvider>
          <TestConsumer />
        </PushNotificationsProvider>
      );

      await waitFor(() => expect(screen.getByTestId("subscribed")).toHaveTextContent("false"));

      await user.click(screen.getByText("Enable"));

      await waitFor(() => expect(screen.getByTestId("subscribed")).toHaveTextContent("true"));
      expect(subscribeMock).toHaveBeenCalled();
      expect(mockApi.post).toHaveBeenCalledWith(
        "/push/subscribe",
        expect.objectContaining({ endpoint: "https://push.example.com/abc" })
      );
    });

    it("unsubscribes and deletes the subscription on the server", async () => {
      getSubscription.mockResolvedValue({
        endpoint: "https://push.example.com/abc",
        unsubscribe: unsubscribeMock,
      });

      const user = userEvent.setup();
      render(
        <PushNotificationsProvider>
          <TestConsumer />
        </PushNotificationsProvider>
      );

      await waitFor(() => expect(screen.getByTestId("subscribed")).toHaveTextContent("true"));

      await user.click(screen.getByText("Disable"));

      await waitFor(() => expect(screen.getByTestId("subscribed")).toHaveTextContent("false"));
      expect(unsubscribeMock).toHaveBeenCalled();
      expect(mockApi.delete).toHaveBeenCalledWith(
        expect.stringContaining("/push/subscribe?endpoint=")
      );
    });
  });
});
