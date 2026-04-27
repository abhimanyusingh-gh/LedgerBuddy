/**
 * @jest-environment jsdom
 */
import { bankUrls } from "@/api/urls/bankUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

beforeEach(() => {
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("client-1");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/bankUrls — collection routes", () => {
  it.each([
    ["accountsList", "/tenants/tenant-1/clientOrgs/client-1/bank/accounts"],
    ["accountsCreate", "/tenants/tenant-1/clientOrgs/client-1/bank/accounts"],
    ["statementsList", "/tenants/tenant-1/clientOrgs/client-1/bank-statements"],
    ["statementUpload", "/tenants/tenant-1/clientOrgs/client-1/bank-statements/upload"],
    ["vendorGstins", "/tenants/tenant-1/clientOrgs/client-1/bank-statements/vendor-gstins"],
    ["accountNames", "/tenants/tenant-1/clientOrgs/client-1/bank-statements/account-names"]
  ] as const)("%s resolves to %s", (method, expected) => {
    const fn = bankUrls[method] as () => string;
    expect(fn()).toBe(expected);
  });
});

describe("api/urls/bankUrls — id-bearing routes", () => {
  it("accountDelete encodes the account id into the nested path", () => {
    expect(bankUrls.accountDelete("acct/1")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/bank/accounts/acct%2F1"
    );
  });

  it("accountRefresh appends /refresh after the encoded id", () => {
    expect(bankUrls.accountRefresh("acct 2")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/bank/accounts/acct%202/refresh"
    );
  });

  it("statementMatches encodes the statement id and appends /matches", () => {
    expect(bankUrls.statementMatches("stmt#9")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/bank-statements/stmt%239/matches"
    );
  });

  it("statementGstin encodes the statement id and appends /gstin", () => {
    expect(bankUrls.statementGstin("stmt-1")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/bank-statements/stmt-1/gstin"
    );
  });

  it("statementTransactions encodes the statement id and appends /transactions", () => {
    expect(bankUrls.statementTransactions("stmt-1")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/bank-statements/stmt-1/transactions"
    );
  });

  it("statementReconcile encodes the statement id and appends /reconcile", () => {
    expect(bankUrls.statementReconcile("stmt-1")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/bank-statements/stmt-1/reconcile"
    );
  });

  it("transactionMatch encodes the transaction id under /transactions/.../match", () => {
    expect(bankUrls.transactionMatch("tx 7")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/bank-statements/transactions/tx%207/match"
    );
  });
});

describe("api/urls/bankUrls — missing-context guards", () => {
  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => bankUrls.accountsList()).toThrow(MissingActiveClientOrgError);
    expect(() => bankUrls.statementsList()).toThrow(MissingActiveClientOrgError);
    expect(() => bankUrls.accountDelete("acct-1")).toThrow(
      MissingActiveClientOrgError
    );
  });

  it("throws MissingActiveClientOrgError when clientOrgId is unset", () => {
    setActiveClientOrgId(null);
    expect(() => bankUrls.accountsList()).toThrow(MissingActiveClientOrgError);
    expect(() => bankUrls.statementsList()).toThrow(MissingActiveClientOrgError);
    expect(() => bankUrls.transactionMatch("tx-1")).toThrow(
      MissingActiveClientOrgError
    );
  });
});
