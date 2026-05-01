/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TenantBadge, ActiveRealmBadge } from "@/components/workspace/HierarchyBadges";
import {
  ACTIVE_CLIENT_ORG_QUERY_PARAM,
  ACTIVE_CLIENT_ORG_STORAGE_KEY,
  setActiveClientOrgId
} from "@/hooks/useActiveClientOrg";
import { resetStores } from "@/test-utils/resetStores";

function clearActiveRealm() {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetStores();
}

describe("components/workspace/TenantBadge", () => {
  it("renders the tenant (CA firm) name passed via props", () => {
    render(<TenantBadge tenantName="Mahir & Co." />);
    const badge = screen.getByTestId("tenant-badge");
    expect(badge).toHaveTextContent("Mahir & Co.");
    expect(badge).toHaveAttribute("title", "CA firm: Mahir & Co.");
    expect(badge).toHaveAttribute("aria-label", "Tenant Mahir & Co.");
  });

  it("renders an explicit 'Unknown tenant' placeholder when the tenant name is blank", () => {
    // Whitespace-only fallback would mask the data-quality issue — surface it.
    render(<TenantBadge tenantName="   " />);
    expect(screen.getByTestId("tenant-badge")).toHaveTextContent("Unknown tenant");
  });

});

describe("components/workspace/ActiveRealmBadge", () => {
  beforeEach(clearActiveRealm);
  afterEach(clearActiveRealm);

  it("renders the matching companyName when an active realm is set", () => {
    setActiveClientOrgId("org-1");
    render(
      <ActiveRealmBadge
        clientOrgs={[
          { id: "org-1", companyName: "Sharma Textiles" },
          { id: "org-2", companyName: "Bose Steel" }
        ]}
      />
    );
    const badge = screen.getByTestId("active-realm-badge");
    expect(badge).toHaveTextContent("Sharma Textiles");
    expect(badge).toHaveAttribute("title", "Active client: Sharma Textiles");
  });

  it("renders the 'Select a client' CTA button when no realm is active", () => {
    const onOpenSwitcher = jest.fn();
    render(<ActiveRealmBadge clientOrgs={[]} onOpenSwitcher={onOpenSwitcher} />);
    const cta = screen.getByTestId("select-client-cta");
    expect(cta.tagName).toBe("BUTTON");
    expect(cta).toHaveTextContent("Select a client");
    expect(cta).not.toBeDisabled();
    expect(cta).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(cta);
    expect(onOpenSwitcher).toHaveBeenCalledTimes(1);
  });

  it("renders the 'Select a client' CTA disabled when no onOpenSwitcher handler is provided", () => {
    // Until #152 wires the realm switcher, render disabled instead of a silent no-op.
    render(<ActiveRealmBadge clientOrgs={[]} />);
    const cta = screen.getByTestId("select-client-cta");
    expect(cta.tagName).toBe("BUTTON");
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute("aria-disabled", "true");
    expect(cta).toHaveAttribute("title", "Realm switcher coming soon");
    // Clicking a disabled button is a no-op — nothing to assert on the handler
    // (there is none); just verify the click doesn't throw.
    fireEvent.click(cta);
  });

  it("renders a loading state while clientOrgs is undefined and a realm is active", () => {
    setActiveClientOrgId("org-1");
    render(<ActiveRealmBadge clientOrgs={undefined} />);
    const badge = screen.getByTestId("active-realm-badge");
    expect(badge).toHaveAttribute("data-loading", "true");
    expect(badge).toHaveTextContent("Loading");
  });

  it("auto-clears a stale activeClientOrgId when the loaded list has no match", async () => {
    // Boot with a persisted id that points at a deleted/revoked clientOrg.
    // Once `clientOrgs` loads and we can confirm the id has no match, the
    // badge should clear the stale id and fall through to the CTA branch
    // instead of leaving the user stuck with every realm-scoped call 400ing.
    setActiveClientOrgId("org-deleted");
    render(<ActiveRealmBadge clientOrgs={[{ id: "org-1", companyName: "Sharma" }]} />);
    // Effect fires after first render — assert via findBy* so we wait.
    await screen.findByTestId("select-client-cta");
    expect(screen.queryByTestId("active-realm-badge")).not.toBeInTheDocument();
  });

  it("reads the active id from the URL query parameter (URL > store)", () => {
    setActiveClientOrgId("from-storage");
    window.history.replaceState({}, "", `/?${ACTIVE_CLIENT_ORG_QUERY_PARAM}=from-url`);
    render(
      <ActiveRealmBadge
        clientOrgs={[
          { id: "from-url", companyName: "URL-driven Co." },
          { id: "from-storage", companyName: "Storage-driven Co." }
        ]}
      />
    );
    expect(screen.getByTestId("active-realm-badge")).toHaveTextContent("URL-driven Co.");
  });

  it("falls back to the store when the URL has no active id", () => {
    setActiveClientOrgId("from-storage");
    window.history.replaceState({}, "", "/");
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBe("from-storage");
    render(
      <ActiveRealmBadge
        clientOrgs={[{ id: "from-storage", companyName: "Storage-driven Co." }]}
      />
    );
    expect(screen.getByTestId("active-realm-badge")).toHaveTextContent("Storage-driven Co.");
  });

  it("renders the active badge as a clickable button when onOpenSwitcher is provided", () => {
    setActiveClientOrgId("org-1");
    const onOpenSwitcher = jest.fn();
    render(
      <ActiveRealmBadge
        clientOrgs={[{ id: "org-1", companyName: "Sharma Textiles" }]}
        onOpenSwitcher={onOpenSwitcher}
      />
    );
    const badge = screen.getByTestId("active-realm-badge");
    expect(badge.tagName).toBe("BUTTON");
    expect(badge).toHaveAttribute("aria-haspopup", "listbox");
    fireEvent.click(badge);
    expect(onOpenSwitcher).toHaveBeenCalledTimes(1);
  });

});
