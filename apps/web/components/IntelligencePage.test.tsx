import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IntelligencePage } from "./IntelligencePage";
const fake = vi.hoisted(() => {
  const request = vi.fn();
  return {
    client: { current: { request } },
    request,
    setSession: vi.fn(),
    session: {
      sessionId: "guest",
      identity: "guest",
      user: null,
      privacy: { history: false, analytics: false, personalization: false },
      retentionDays: 30,
      admin: false,
    },
    state: "ready",
  };
});
vi.mock("../intelligence/useIntelligence", () => ({
  useIntelligence: () => fake,
}));
const profiles: [] = [];
beforeEach(() => {
  fake.request.mockReset();
  fake.setSession.mockReset();
  fake.state = "ready";
  fake.request.mockResolvedValue(fake.session);
});
afterEach(cleanup);
it("shows consent off and forbids personalization without history", () => {
  render(<IntelligencePage page="privacy" profiles={profiles} />);
  for (const box of screen.getAllByRole("checkbox"))
    expect(box).not.toBeChecked();
  expect(
    screen.getByLabelText(
      "Personalize recommendations using my redacted history",
    ),
  ).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Save redacted composer history"));
  expect(fake.request).toHaveBeenCalledWith("privacy.update", {
    history: true,
    analytics: false,
    personalization: false,
  });
});
it("deletes only caller-owned data with no browser owner parameter", async () => {
  render(<IntelligencePage page="privacy" profiles={profiles} />);
  fireEvent.click(screen.getByText("Delete guest data"));
  await waitFor(() =>
    expect(fake.request).toHaveBeenCalledWith("guest.delete", {}),
  );
  expect(fake.setSession).toHaveBeenCalledWith(fake.session);
});
it("uses private RPC for login and clears password immediately", async () => {
  render(<IntelligencePage page="account" profiles={profiles} />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "synthetic@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "synthetic test password" },
  });
  fireEvent.click(screen.getByText("Sign in"));
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByLabelText("Password")).not.toHaveAttribute("minlength");
  await waitFor(() =>
    expect(fake.request).toHaveBeenCalledWith("account.login", {
      email: "synthetic@example.test",
      password: "synthetic test password",
    }),
  );
});
it("renders truthful empty history without outcome claims", async () => {
  fake.request.mockResolvedValue({ items: [] });
  render(<IntelligencePage page="history" profiles={profiles} />);
  expect(
    await screen.findByText("No recorded commands match this view."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Execution status, exit codes, and durations are unknown/),
  ).toBeInTheDocument();
});
it("does not present unauthorized administration as data", async () => {
  fake.request.mockRejectedValue(new Error("FORBIDDEN"));
  render(<IntelligencePage page="admin" profiles={profiles} />);
  expect(
    await screen.findByText("You are not authorized for this action."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("definition")).not.toBeInTheDocument();
});
it("keeps commercial operations disabled", async () => {
  fake.request.mockResolvedValue({
    plan: "Personal prototype",
    commercialEnabled: false,
    tokenLimit: 100000,
    tokensUsed: 0,
  });
  render(<IntelligencePage page="billing" profiles={profiles} />);
  expect(await screen.findByText(/0 actual tokens used/)).toBeInTheDocument();
  expect(screen.getByText("Paid upgrades unavailable")).toBeDisabled();
});
it("shows unavailable state without fabricated usage", () => {
  fake.state = "unavailable";
  render(<IntelligencePage page="usage" profiles={profiles} />);
  expect(
    screen.getByText(/Private intelligence is unavailable/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Total tokens")).not.toBeInTheDocument();
});
