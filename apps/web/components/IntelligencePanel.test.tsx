import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntelligencePanel } from "./IntelligencePanel";
const fake = vi.hoisted(() => {
  const request = vi.fn();
  return {
    request,
    client: { current: { request } },
    sessionId: "guest-a",
    privacy: { history: false, analytics: false, personalization: false },
  };
});
vi.mock("../intelligence/useIntelligence", () => ({
  useIntelligence: () => ({
    client: fake.client,
    state: "ready",
    session: { sessionId: fake.sessionId, privacy: fake.privacy },
  }),
}));
const policy = {
  endpoint: "wss://sai.tailf8dcea.ts.net/terminal",
  expectedWebOrigin: "https://terminus-web.vercel.app",
};
const recommendation = {
  id: "date",
  command: "Get-Date",
  category: "system",
  purpose: "Read date",
  reason: "Catalog retrieval",
  risk: "read",
  sourceUrl: "https://learn.microsoft.com/powershell/",
};
const catalog = { mode: "catalog", items: [recommendation] };
beforeEach(() => {
  fake.request.mockReset();
  fake.sessionId = "guest-a";
  fake.privacy = { history: false, analytics: false, personalization: false };
  fake.request.mockImplementation(async (method) =>
    method === "recommendations.get" ? catalog : { recorded: true },
  );
});
afterEach(cleanup);
it("loads initial recommendations and selection only fills composer with collection off", async () => {
  const submit = vi.fn();
  render(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await screen.findByText("Use in composer");
  expect(fake.request).toHaveBeenCalledWith("recommendations.get", {});
  fireEvent.click(screen.getByText("Use in composer"));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Command composer")).toHaveValue("Get-Date");
  fireEvent.click(screen.getByText("Submit command"));
  expect(submit).toHaveBeenCalledWith("Get-Date\r");
  expect(fake.request).not.toHaveBeenCalledWith(
    "command.record",
    expect.anything(),
  );
});
it("refreshes contextual recommendations after opted-in recording", async () => {
  fake.privacy.history = true;
  const submit = vi.fn();
  render(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await screen.findByText("Use in composer");
  fireEvent.click(screen.getByText("Use in composer"));
  fireEvent.click(screen.getByText("Submit command"));
  await waitFor(() =>
    expect(
      fake.request.mock.calls.filter((c) => c[0] === "recommendations.get"),
    ).toHaveLength(2),
  );
  expect(fake.request.mock.calls.at(-1)).toEqual(["recommendations.get", {}]);
  expect(submit).toHaveBeenCalledTimes(1);
});
it("history failure does not prevent terminal submission", async () => {
  fake.privacy.history = true;
  fake.request.mockImplementation(async (method) => {
    if (method === "command.record") throw new Error("UNAVAILABLE");
    return catalog;
  });
  const submit = vi.fn();
  render(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await screen.findByText("Use in composer");
  fireEvent.click(screen.getByText("Use in composer"));
  fireEvent.click(screen.getByText("Submit command"));
  expect(submit).toHaveBeenCalledWith("Get-Date\r");
  expect(
    await screen.findByText(
      "Submitted to the terminal; history could not be recorded.",
    ),
  ).toBeInTheDocument();
});
it("ignores a late recommendation response and clears drafts after owner rotation", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  fake.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const submit = vi.fn();
  const view = render(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await waitFor(() =>
    expect(fake.request).toHaveBeenCalledWith("recommendations.get", {}),
  );
  fireEvent.change(screen.getByLabelText("Command composer"), {
    target: { value: "old draft" },
  });
  fireEvent.change(screen.getByLabelText("Find a command"), {
    target: { value: "old query" },
  });
  fake.sessionId = "guest-b";
  view.rerender(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await screen.findByText("Read date");
  await act(async () =>
    resolveOld({
      mode: "catalog",
      items: [{ ...recommendation, purpose: "Former owner recommendation" }],
    }),
  );
  expect(
    screen.queryByText("Former owner recommendation"),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Command composer")).toHaveValue("");
  expect(screen.getByLabelText("Find a command")).toHaveValue("");
});
it("does not refresh old identity after late submission recording", async () => {
  fake.privacy.history = true;
  let resolveRecord: (value: unknown) => void = () => {};
  fake.request.mockImplementation((method) =>
    method === "command.record"
      ? new Promise((resolve) => {
          resolveRecord = resolve;
        })
      : Promise.resolve(catalog),
  );
  const submit = vi.fn();
  const view = render(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await screen.findByText("Use in composer");
  fireEvent.click(screen.getByText("Use in composer"));
  fireEvent.click(screen.getByText("Submit command"));
  fake.sessionId = "guest-b";
  view.rerender(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await screen.findByText("Read date");
  const count = fake.request.mock.calls.length;
  await act(async () => resolveRecord({ recorded: true }));
  expect(fake.request).toHaveBeenCalledTimes(count);
});
it("blocks unresolved placeholders and disconnected submissions", async () => {
  const submit = vi.fn();
  const view = render(
    <IntelligencePanel
      policy={policy}
      connectionState="connected"
      onSubmit={submit}
    />,
  );
  await screen.findByText("Use in composer");
  fireEvent.change(screen.getByLabelText("Command composer"), {
    target: { value: "Get-Item <path>" },
  });
  expect(screen.getByText("Submit command")).toBeDisabled();
  expect(
    screen.getByText("Replace all <placeholders> before submitting."),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Command composer"), {
    target: { value: "Get-Date" },
  });
  view.rerender(
    <IntelligencePanel
      policy={policy}
      connectionState="disconnected"
      onSubmit={submit}
    />,
  );
  expect(screen.getByText("Submit command")).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});
