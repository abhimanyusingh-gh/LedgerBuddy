/**
 * Static FE↔BE contract-diff CI gate (replaces the deleted
 * `check-realm-scoped-paths.sh`). Walks every `apiClient.<method>(...)` call
 * in the FE plus every `router.<method>(...)` definition in the BE, then
 * cross-checks: every FE-callable URL must have a BE handler at the same
 * URL + method. Drift errors fail CI; orphan BE routes (no FE caller) are
 * informational warnings only.
 *
 * Run: `yarn workspace ledgerbuddy-backend run check:contract`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const FRONTEND_SRC = join(REPO_ROOT, "frontend", "src");
const BACKEND_SRC = join(REPO_ROOT, "backend", "src");
const APP_TS = join(BACKEND_SRC, "app.ts");
const API_PATHS_TS = join(FRONTEND_SRC, "api", "apiPaths.ts");
const URL_PROVIDERS_DIR = join(FRONTEND_SRC, "api", "urls");

const PROVIDER_BUILDER = {
  NESTED: "buildNested",
  TENANT: "buildTenantNested"
} as const;
type ProviderBuilder = typeof PROVIDER_BUILDER[keyof typeof PROVIDER_BUILDER];

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
  HEAD: "HEAD"
} as const;
type HttpMethod = typeof HTTP_METHOD[keyof typeof HTTP_METHOD];
const METHOD_NAMES: ReadonlySet<string> = new Set(Object.values(HTTP_METHOD).map((m) => m.toLowerCase()));

const PATH_KIND = {
  REALM_SCOPED: "realm-scoped",
  TENANT_SCOPED: "tenant-scoped",
  NONE: "none"
} as const;
type PathKind = typeof PATH_KIND[keyof typeof PATH_KIND];

const TENANT_PARAM_PLACEHOLDER = ":tenantId";
const CLIENT_ORG_PARAM_PLACEHOLDER = ":clientOrgId";

/**
 * Call sites whose path arg cannot be resolved statically. Adding a file:line
 * here is a deliberate acknowledgment that the contract gate cannot verify
 * the URL — the call site must be exercised via e2e/manual coverage.
 */
const UNANALYZABLE_FE_CALL_SITES: ReadonlySet<string> = new Set<string>([
  // Currently empty — every FE apiClient call site uses a literal or template
  // literal whose static prefix the walker can resolve.
]);

/**
 * Routes the BE intentionally serves with no FE axios caller. Each entry
 * justifies WHY a non-FE caller exists; this list keeps the orphan-BE
 * warning from drowning meaningful signal in known-intentional noise. Match
 * format: `<METHOD> <normalized-url>` — see the diff loop for normalization
 * (`:tenantId` / `:clientOrgId` are preserved; all other path-params
 * collapse to `:id`).
 */
const KNOWN_ORPHAN_BE_ROUTES: ReadonlySet<string> = new Set<string>([
  // Liveness/readiness probes — consumed by k8s, not the FE.
  "GET /health",
  "GET /health/ready",
  // OAuth flows + token refresh — browser redirects + interceptor calls
  // that bypass the apiClient walker (auth.ts uses fetch / location.href).
  "GET /api/auth/login",
  "GET /api/auth/callback",
  "POST /api/auth/refresh",
  // Browser-redirect Gmail OAuth start + provider callback.
  "GET /api/connect/gmail",
  "GET /api/connect/gmail/callback",
  // Bank webhooks consumed by external AA / FI providers.
  "GET /api/bank/aa-callback",
  "GET /api/bank/mock-callback",
  "POST /api/bank/consent-notify",
  "POST /api/bank/fi-notify",
  // One-time email-link tenant invite acceptance.
  "POST /api/tenant/invites/accept",
  // Platform-admin operational dashboards — no FE surface yet.
  "GET /api/admin/workflow-health",
  // tdsRates per-section update — admin-only, no FE UI yet.
  "PUT /api/compliance/tds-rates/:id",
  // Per-realm gmail polling-config update — admin-only, surface tracked
  // separately from the FE GmailConnection panel.
  "PUT /api/tenants/:tenantId/integrations/gmail/:id/polling",
  // Legacy CSV bank-statement upload — kept until FE migration.
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/bank-statements/upload-csv",
  // Legacy direct-trigger Tally export (FE uses /exports/tally/download
  // which produces a downloadable file). Kept for parity with the older
  // export-then-download two-step flow.
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/exports/tally",
  // CSV exports — admin-only, no FE UI yet.
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/exports/csv",
  // Per-invoice manual compliance retrigger — admin debug surface, not
  // wired into FE.
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/invoices/:id/retrigger-compliance",
  // Per-realm export-config get/patch — surfaced via tenant admin UX that
  // currently writes via the parent tenant tally-export-config endpoint;
  // realm-scoped variant kept for the planned per-realm override flow.
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/export-config",
  "PATCH /api/tenants/:tenantId/clientOrgs/:clientOrgId/export-config",
  // Email-simulate test hook — only invoked from e2e + integration tests.
  // jobsRouter dual-mounts under tenantRouter AND clientOrgRouter, so the
  // hook surfaces under both URL trees.
  "POST /api/tenants/:tenantId/jobs/ingest/email-simulate",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/email-simulate",
  // jobsRouter dual-mounts on tenantRouter AND clientOrgRouter (see app.ts);
  // FE classifier sends `/jobs/upload` to the realm-scoped mount and
  // `/jobs/ingest{,/status,/sse,/pause}` to the tenant-scoped mount, so the
  // OTHER mount is intentionally never hit by the FE.
  "POST /api/tenants/:tenantId/jobs/upload",
  "POST /api/tenants/:tenantId/jobs/upload/by-keys",
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/status",
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/sse",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/pause",
  // Vendor detail GET — FE uses bulk list + patch only; per-id fetch surface
  // not yet wired into the vendors UI.
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/vendors/:id",
  // action-required dashboard — backend ready; FE surface tracked separately.
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/invoices/action-required",
  // viewer-scope GET/PUT — admin-only management of per-user invoice
  // visibility scoping; FE management surface tracked separately.
  "GET /api/tenants/:tenantId/admin/users/:id/viewer-scope",
  "PUT /api/tenants/:tenantId/admin/users/:id/viewer-scope"
]);

interface FeUrl {
  method: HttpMethod;
  rawPath: string;
  resolvedUrl: string;
  source: string;
}

interface BeUrl {
  method: HttpMethod;
  url: string;
  source: string;
}

// ───────────────────────── FE classifier (mirrors apiPaths.ts) ─────────────────────────

interface ClassifierConfig {
  realmPrefixes: readonly string[];
  tenantPrefixes: readonly string[];
  bypassPrefixes: readonly string[];
  bypassSuffixes: readonly string[];
}

function loadClassifierConfig(): ClassifierConfig {
  const source = readFileSync(API_PATHS_TS, "utf8");
  const sf = ts.createSourceFile(API_PATHS_TS, source, ts.ScriptTarget.ES2022, true);
  const arrays: Record<string, string[]> = {};
  const targetNames = new Set([
    "REALM_SCOPED_PREFIXES",
    "TENANT_SCOPED_PREFIXES",
    "TENANT_SCOPED_BYPASS_PREFIXES",
    "TENANT_SCOPED_BYPASS_SUFFIXES"
  ]);
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      targetNames.has(node.name.text) &&
      node.initializer
    ) {
      const init = stripAsConst(node.initializer);
      if (ts.isArrayLiteralExpression(init)) {
        arrays[node.name.text] = init.elements
          .filter((e): e is ts.StringLiteral => ts.isStringLiteral(e))
          .map((e) => e.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  for (const name of targetNames) {
    if (!arrays[name]) {
      throw new Error(`apiPaths.ts: failed to extract ${name}`);
    }
  }
  return {
    realmPrefixes: arrays["REALM_SCOPED_PREFIXES"]!,
    tenantPrefixes: arrays["TENANT_SCOPED_PREFIXES"]!,
    bypassPrefixes: arrays["TENANT_SCOPED_BYPASS_PREFIXES"]!,
    bypassSuffixes: arrays["TENANT_SCOPED_BYPASS_SUFFIXES"]!
  };
}

function stripAsConst(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node)) return stripAsConst(node.expression);
  return node;
}

function stripQueryString(path: string): string {
  const idx = path.indexOf("?");
  return idx === -1 ? path : path.slice(0, idx);
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

function endsWithSuffix(path: string, suffix: string): boolean {
  return stripQueryString(path).endsWith(suffix);
}

function classifyApiPath(path: string, cfg: ClassifierConfig): PathKind {
  for (const bypass of cfg.bypassPrefixes) {
    if (matchesPrefix(path, bypass)) return PATH_KIND.TENANT_SCOPED;
  }
  const matchesAnyRealm = cfg.realmPrefixes.some((p) => matchesPrefix(path, p));
  if (matchesAnyRealm) {
    for (const suffix of cfg.bypassSuffixes) {
      if (endsWithSuffix(path, suffix)) return PATH_KIND.TENANT_SCOPED;
    }
  }
  if (cfg.tenantPrefixes.some((p) => matchesPrefix(path, p))) return PATH_KIND.TENANT_SCOPED;
  if (matchesAnyRealm) return PATH_KIND.REALM_SCOPED;
  return PATH_KIND.NONE;
}

function applyRewrite(barePath: string, kind: PathKind): string {
  const normalized = barePath.startsWith("/") ? barePath : `/${barePath}`;
  if (kind === PATH_KIND.REALM_SCOPED) {
    return `/api/tenants/${TENANT_PARAM_PLACEHOLDER}/clientOrgs/${CLIENT_ORG_PARAM_PLACEHOLDER}${normalized}`;
  }
  if (kind === PATH_KIND.TENANT_SCOPED) {
    return `/api/tenants/${TENANT_PARAM_PLACEHOLDER}${normalized}`;
  }
  return `/api${normalized}`;
}

// ───────────────────────── Provider method walk ─────────────────────────
// URL-provider methods (frontend/src/api/urls/*Urls.ts) bury the bare path
// inside `buildNested(...)` / `buildTenantNested(...)` calls, invisible to the
// apiClient call-site walker. Pre-extract a {provider.method -> {bare,scope}}
// map so callers like `invoiceUrls.preview(id)` resolve to a real FE URL.

interface ProviderMethodInfo {
  bare: string;
  builder: ProviderBuilder;
  source: string;
}

type ProviderMethodMap = Map<string, ProviderMethodInfo>;

function listProviderFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(URL_PROVIDERS_DIR)) {
    if (
      entry.endsWith("Urls.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(join(URL_PROVIDERS_DIR, entry));
    }
  }
  return out;
}

function extractProviderBare(node: ts.Expression, ctx: ResolveContext): string | null {
  const resolved = resolvePathExpr(node, ctx);
  return resolved ? resolved.bare : null;
}

function findBuilderCallInBody(
  body: ts.Node,
  ctx: ResolveContext
): { builder: ProviderBuilder; bare: string } | null {
  let found: { builder: ProviderBuilder; bare: string } | null = null;
  function visit(node: ts.Node) {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === PROVIDER_BUILDER.NESTED ||
        node.expression.text === PROVIDER_BUILDER.TENANT)
    ) {
      const arg0 = node.arguments[0];
      if (arg0) {
        const bare = extractProviderBare(arg0, ctx);
        if (bare !== null) {
          found = { builder: node.expression.text as ProviderBuilder, bare };
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

function buildProviderMethodMap(): ProviderMethodMap {
  const out: ProviderMethodMap = new Map();
  for (const file of listProviderFiles()) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    const ctx: ResolveContext = { source, constants: buildModuleConstants(source) };
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /Urls$/.test(node.name.text) &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        const providerName = node.name.text;
        for (const prop of node.initializer.properties) {
          if (
            (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) &&
            (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
          ) {
            const methodName = prop.name.text;
            const body = ts.isPropertyAssignment(prop) ? prop.initializer : prop;
            const found = findBuilderCallInBody(body, ctx);
            const key = `${providerName}.${methodName}`;
            const { line, character } = source.getLineAndCharacterOfPosition(prop.getStart());
            const loc = `${relative(REPO_ROOT, file)}:${line + 1}:${character + 1}`;
            if (!found) {
              throw new Error(
                `URL-provider method ${key} at ${loc} does not call ${PROVIDER_BUILDER.NESTED}/${PROVIDER_BUILDER.TENANT}; ` +
                  `extend the contract walker or add the consumer file:line to UNANALYZABLE_FE_CALL_SITES.`
              );
            }
            out.set(key, { bare: found.bare, builder: found.builder, source: loc });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return out;
}

function providerInfoToFullUrl(info: ProviderMethodInfo): string {
  const kind = info.builder === PROVIDER_BUILDER.NESTED ? PATH_KIND.REALM_SCOPED : PATH_KIND.TENANT_SCOPED;
  return applyRewrite(info.bare, kind);
}

// `apiClient.<verb>(invoiceUrls.list())` — detect when arg0 is itself a
// `<providerName>.<methodName>(...)` CallExpression. The outer apiClient
// branch uses this to emit with the real HTTP verb; the inner provider-call
// visit then skips itself (apiClient-parented) to avoid double-emission.
function resolveProviderCallArg(
  arg: ts.Expression,
  providerMap: ProviderMethodMap
): { key: string; info: ProviderMethodInfo } | null {
  if (!ts.isCallExpression(arg)) return null;
  const callee = arg.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  if (!ts.isIdentifier(callee.expression) || !ts.isIdentifier(callee.name)) return null;
  if (!/Urls$/.test(callee.expression.text)) return null;
  const key = `${callee.expression.text}.${callee.name.text}`;
  const info = providerMap.get(key);
  return info ? { key, info } : null;
}

function isApiClientCallParent(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent || !ts.isCallExpression(parent)) return false;
  if (parent.arguments[0] !== node) return false;
  const callee = parent.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "apiClient" &&
    ts.isIdentifier(callee.name) &&
    METHOD_NAMES.has(callee.name.text)
  );
}

// ───────────────────────── FE walker ─────────────────────────

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      listTsFiles(full, out);
    } else if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

interface ResolveContext {
  source: ts.SourceFile;
  constants: Map<string, string>;
}

function buildModuleConstants(source: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
        out.set(node.name.text, init.text);
      } else if (ts.isTemplateExpression(init)) {
        // Best-effort: emit `:param` placeholders for each interpolation.
        let val = init.head.text;
        for (const span of init.templateSpans) {
          val += ":param";
          val += span.literal.text;
        }
        out.set(node.name.text, val);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return out;
}

interface ResolvedPath {
  bare: string;
}

function resolvePathExpr(node: ts.Expression, ctx: ResolveContext): ResolvedPath | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { bare: node.text };
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const sub = resolveExprToString(span.expression, ctx);
      if (sub === null) {
        out += `:param`;
      } else {
        out += sub;
      }
      out += span.literal.text;
    }
    return { bare: out };
  }
  if (ts.isIdentifier(node)) {
    const v = ctx.constants.get(node.text);
    if (v !== undefined) return { bare: v };
  }
  return null;
}

function resolveExprToString(node: ts.Expression, ctx: ResolveContext): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node)) {
    const v = ctx.constants.get(node.text);
    if (v !== undefined) return v;
  }
  return null;
}

/**
 * Replace concrete dynamic segments emitted as `:param` with `:id` to
 * normalize against BE definitions which use named params.
 */
function normalizeDynamicSegments(path: string): string {
  // Replace `/:param/` (and trailing) inserted by template walker with a
  // canonical `:id`. We then ALSO normalize all `:<name>` segments to `:id`
  // for matching purposes (BE may name it `:invoiceId`, FE template just
  // injects a dynamic value).
  return path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":id");
}

function preserveScopeParams(path: string): string {
  // Keep the outer `/:tenantId` and `/:clientOrgId` from the rewriter; only
  // normalize segments AFTER those scope prefixes.
  const tenantMatch = path.match(/^(\/api\/tenants\/:tenantId(?:\/clientOrgs\/:clientOrgId)?)(.*)$/);
  if (!tenantMatch) {
    return normalizeDynamicSegments(path);
  }
  return tenantMatch[1] + normalizeDynamicSegments(tenantMatch[2] ?? "");
}

interface RawFeCall {
  method: HttpMethod;
  bare: string;
  fullUrlOverride: string | null;
  source: string;
}

function collectRawFeCalls(file: string, providerMap: ProviderMethodMap): RawFeCall[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const ctx: ResolveContext = { source, constants: buildModuleConstants(source) };
  const calls: RawFeCall[] = [];
  const isProviderModule = file.startsWith(URL_PROVIDERS_DIR);

  function loc(node: ts.Node): string {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart());
    return `${relative(REPO_ROOT, file)}:${line + 1}:${character + 1}`;
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;

      // apiClient.<method>(path, ...)
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "apiClient" &&
        ts.isIdentifier(callee.name) &&
        METHOD_NAMES.has(callee.name.text)
      ) {
        const method = callee.name.text.toUpperCase() as HttpMethod;
        const arg0 = node.arguments[0];
        if (arg0) {
          // Provider call as apiClient arg — `apiClient.post(invoiceUrls.x())`.
          // Resolve via providerMap and emit with the real HTTP verb; the
          // inner provider-call visit will skip itself (parent-aware).
          const providerInfo = resolveProviderCallArg(arg0, providerMap);
          if (providerInfo) {
            calls.push({
              method,
              bare: providerInfo.info.bare,
              fullUrlOverride: providerInfoToFullUrl(providerInfo.info),
              source: loc(node)
            });
          } else {
            const resolved = resolvePathExpr(arg0, ctx);
            if (resolved === null) {
              const tag = `${relative(REPO_ROOT, file)}:${source.getLineAndCharacterOfPosition(arg0.getStart()).line + 1}`;
              if (!UNANALYZABLE_FE_CALL_SITES.has(tag)) {
                throw new Error(
                  `Unanalyzable FE apiClient.${callee.name.text} path at ${loc(arg0)}. ` +
                    `Add the file:line to UNANALYZABLE_FE_CALL_SITES in check-fe-be-contract.ts ` +
                    `if this is intentional.`
                );
              }
            } else {
              calls.push({
                method,
                bare: resolved.bare,
                fullUrlOverride: null,
                source: loc(node)
              });
            }
          }
        }
      }

      // <providerName>.<methodName>(...) call — provider modules expose their
      // bare path inside `buildNested(...)` bodies that the apiClient walker
      // cannot see. Resolve via the pre-built providerMap and emit a synthetic
      // GET entry (provider URLs are bypass-route consumers: <img>, EventSource,
      // authenticatedUrl). Skip the provider modules themselves; also skip
      // when the parent is an apiClient call — that branch already emitted
      // with the real HTTP verb.
      if (
        !isProviderModule &&
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        ts.isIdentifier(callee.name) &&
        /Urls$/.test(callee.expression.text) &&
        !isApiClientCallParent(node)
      ) {
        const key = `${callee.expression.text}.${callee.name.text}`;
        const info = providerMap.get(key);
        if (info) {
          calls.push({
            method: HTTP_METHOD.GET,
            bare: info.bare,
            fullUrlOverride: providerInfoToFullUrl(info),
            source: loc(node)
          });
        } else if (providerMap.size > 0) {
          throw new Error(
            `Unknown URL-provider method ${key} at ${loc(node)} — no matching entry in providerMethodMap. ` +
              `Add the method to a *Urls.ts module under api/urls/, or add the file:line to UNANALYZABLE_FE_CALL_SITES.`
          );
        }
      }

      // rewriteToNestedShape(path, ...) / rewriteToTenantShape(path, ...) called
      // OUTSIDE the apiClient interceptor (i.e., in api/invoices.ts for
      // getInvoicePreviewUrl). The interceptor itself in api/client.ts is the
      // canonical caller — skip it. Anything else is an interceptor-bypass
      // call site that issues a GET against the resolved URL via
      // authenticatedUrl + window.fetch / <img> / EventSource.
      if (
        ts.isIdentifier(callee) &&
        (callee.text === "rewriteToNestedShape" || callee.text === "rewriteToTenantShape") &&
        !file.endsWith("/api/client.ts")
      ) {
        const arg0 = node.arguments[0];
        if (arg0) {
          const resolved = resolvePathExpr(arg0, ctx);
          if (resolved !== null) {
            const kind = callee.text === "rewriteToNestedShape" ? PATH_KIND.REALM_SCOPED : PATH_KIND.TENANT_SCOPED;
            const fullUrl = applyRewrite(resolved.bare, kind);
            calls.push({
              method: HTTP_METHOD.GET,
              bare: resolved.bare,
              fullUrlOverride: fullUrl,
              source: loc(node)
            });
          }
        }
      }

    }

    ts.forEachChild(node, visit);
  }
  visit(source);

  // Detect EventSource bypass URLs: scan the module for template literals
  // whose head contains `apiClient.defaults.baseURL` — extract the literal
  // suffix as the bare path.
  function visitEventSourceTemplates(node: ts.Node) {
    if (ts.isTemplateExpression(node)) {
      const head = node.head.text;
      const isApiBaseUrlTemplate = node.templateSpans.some((span) => {
        const expr = span.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          return /apiClient\.defaults\.baseURL/.test(expr.getText(source));
        }
        if (ts.isBinaryExpression(expr)) {
          return /apiClient\.defaults\.baseURL/.test(expr.getText(source));
        }
        return false;
      });
      if (isApiBaseUrlTemplate && head === "" && node.templateSpans.length >= 1) {
        const firstSpan = node.templateSpans[0]!;
        // Suffix can be either the literal AFTER the baseURL span, OR a
        // call to rewriteToTenantShape(...) whose first arg is the bare path.
        const isRewriterSpan =
          ts.isCallExpression(firstSpan.expression) &&
          ts.isIdentifier(firstSpan.expression.expression) &&
          (firstSpan.expression.expression.text === "rewriteToTenantShape" ||
            firstSpan.expression.expression.text === "rewriteToNestedShape");
        if (!isRewriterSpan && firstSpan.literal.text.startsWith("/")) {
          // Pattern: `${apiClient.defaults.baseURL ?? ""}/bank-statements/parse/sse`
          // Use the literal suffix as the bare path. Method = GET (EventSource).
          const bare = firstSpan.literal.text;
          const { line, character } = source.getLineAndCharacterOfPosition(node.getStart());
          calls.push({
            method: HTTP_METHOD.GET,
            bare,
            fullUrlOverride: `/api${bare.startsWith("/") ? bare : `/${bare}`}`,
            source: `${relative(REPO_ROOT, file)}:${line + 1}:${character + 1}`
          });
        }
      }
    }
    ts.forEachChild(node, visitEventSourceTemplates);
  }
  visitEventSourceTemplates(source);

  return calls;
}

function walkFrontend(cfg: ClassifierConfig): FeUrl[] {
  const providerMap = buildProviderMethodMap();
  const files = listTsFiles(FRONTEND_SRC);
  const seen = new Map<string, FeUrl>();
  for (const file of files) {
    const raws = collectRawFeCalls(file, providerMap);
    for (const raw of raws) {
      const resolvedUrl =
        raw.fullUrlOverride !== null
          ? raw.fullUrlOverride
          : applyRewrite(raw.bare, classifyApiPath(raw.bare, cfg));
      const normalized = preserveScopeParams(resolvedUrl);
      const key = `${raw.method} ${normalized}`;
      if (!seen.has(key)) {
        seen.set(key, { method: raw.method, rawPath: raw.bare, resolvedUrl: normalized, source: raw.source });
      }
    }
  }
  return Array.from(seen.values());
}

// ───────────────────────── BE walker ─────────────────────────

interface MountInfo {
  routerVar: string;
  mountPath: string;
}

interface RouterFactoryRef {
  factoryName: string;
  mountPath: string;
}

interface BeWalkResult {
  factoryRefs: RouterFactoryRef[];
  /** Top-level Routers exported from app.ts (e.g. `healthRouter`). */
  topLevelRouters: Map<string, string>; // varName -> mountPath
  /** Sub-router var assignments: e.g. `const tenantRouter = express.Router()`, then `app.use("/api/tenants/:tenantId", ..., tenantRouter)`. */
  subRouterMounts: Map<string, string>; // varName -> mountPath
  subRouterUsages: Array<{ parentVar: string; childVar: string; subPath: string | null; factoryName: string | null }>;
}

function walkAppTs(): BeWalkResult {
  const source = ts.createSourceFile(APP_TS, readFileSync(APP_TS, "utf8"), ts.ScriptTarget.ES2022, true);
  const factoryRefs: RouterFactoryRef[] = [];
  const topLevelRouters = new Map<string, string>();
  const subRouterMounts = new Map<string, string>();
  const subRouterUsages: BeWalkResult["subRouterUsages"] = [];

  // Track sub-router var declarations so we can resolve `clientOrgRouter.use(...)`.
  const subRouterVars = new Set<string>();
  function visitDecls(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isPropertyAccessExpression(node.initializer.expression) &&
      ts.isIdentifier(node.initializer.expression.expression) &&
      node.initializer.expression.expression.text === "express" &&
      ts.isIdentifier(node.initializer.expression.name) &&
      node.initializer.expression.name.text === "Router"
    ) {
      subRouterVars.add(node.name.text);
    }
    ts.forEachChild(node, visitDecls);
  }
  visitDecls(source);

  // Also: `const jobsRouter = createJobsRouter(...)` — these are router instances
  // returned from a factory; track varName -> factoryName so a later
  // tenantRouter.use(jobsRouter) resolves correctly.
  const factoryInstanceVars = new Map<string, string>(); // varName -> factoryName
  function visitFactoryInstances(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      /^create[A-Z][A-Za-z]*Router$/.test(node.initializer.expression.text)
    ) {
      factoryInstanceVars.set(node.name.text, node.initializer.expression.text);
    }
    ts.forEachChild(node, visitFactoryInstances);
  }
  visitFactoryInstances(source);

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      node.expression.name.text === "use"
    ) {
      const callerExpr = node.expression.expression;
      const callerName = ts.isIdentifier(callerExpr) ? callerExpr.text : null;

      // First arg may be a string mount path or a router/middleware.
      let mountPath: string | null = null;
      let argIdx = 0;
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) {
        mountPath = arg0.text;
        argIdx = 1;
      }

      // Walk the remaining args. For each arg, see if it's a Router-shaped
      // value: a `createXRouter(...)` call, an identifier that names a known
      // sub-router var, or an identifier that names a factory-instance var.
      for (let i = argIdx; i < node.arguments.length; i += 1) {
        const arg = node.arguments[i]!;

        if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && /^create[A-Z][A-Za-z]*Router$/.test(arg.expression.text)) {
          if (callerName === "app" && mountPath !== null) {
            factoryRefs.push({ factoryName: arg.expression.text, mountPath });
          } else if (callerName !== null && subRouterVars.has(callerName)) {
            subRouterUsages.push({
              parentVar: callerName,
              childVar: "",
              subPath: mountPath,
              factoryName: arg.expression.text
            });
          }
        } else if (ts.isIdentifier(arg)) {
          if (subRouterVars.has(arg.text)) {
            // Mounting a sub-router: record the mount path.
            if (callerName === "app" && mountPath !== null) {
              subRouterMounts.set(arg.text, mountPath);
            } else if (callerName !== null && subRouterVars.has(callerName)) {
              // tenantRouter.use("/clientOrgs/:clientOrgId", ..., clientOrgRouter)
              subRouterUsages.push({
                parentVar: callerName,
                childVar: arg.text,
                subPath: mountPath,
                factoryName: null
              });
            }
          } else if (factoryInstanceVars.has(arg.text)) {
            const factoryName = factoryInstanceVars.get(arg.text)!;
            if (callerName === "app" && mountPath !== null) {
              factoryRefs.push({ factoryName, mountPath });
            } else if (callerName !== null && subRouterVars.has(callerName)) {
              subRouterUsages.push({
                parentVar: callerName,
                childVar: "",
                subPath: mountPath,
                factoryName
              });
            }
          } else if (arg.text === "healthRouter") {
            // healthRouter is the only directly imported Router instance.
            if (callerName === "app" && mountPath !== null) {
              topLevelRouters.set("healthRouter", mountPath);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  return { factoryRefs, topLevelRouters, subRouterMounts, subRouterUsages };
}

function findRouterFactorySource(factoryName: string): string | null {
  // Walk backend/src/routes for an exported function with this name.
  const routesDir = join(BACKEND_SRC, "routes");
  const files = listBackendTsFiles(routesDir);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (text.includes(`function ${factoryName}(`) || text.includes(`function ${factoryName} `)) {
      return file;
    }
  }
  // healthRouter lives in routes/auth/health.ts.
  if (factoryName === "healthRouter") {
    return join(routesDir, "auth", "health.ts");
  }
  return null;
}

/**
 * Locate the factory function body and walk only its router defs. Multiple
 * factories may share a single file (e.g. createGmailPublicRouter +
 * createGmailConnectionRouter in tenant/gmailConnection.ts), so we cannot
 * walk the entire file.
 */
function findFactoryFunctionNode(file: string, factoryName: string): { source: ts.SourceFile; fn: ts.FunctionDeclaration } | null {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  let found: ts.FunctionDeclaration | null = null;
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.name.text === factoryName
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found ? { source, fn: found } : null;
}

function listBackendTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      listBackendTsFiles(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

interface RouteDef {
  method: HttpMethod;
  path: string;
}

function extractRoutesFromNode(rootNode: ts.Node): RouteDef[] {
  const routes: RouteDef[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ts.isIdentifier(node.expression.name) &&
      METHOD_NAMES.has(node.expression.name.text)
    ) {
      const arg0 = node.arguments[0];
      if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
        routes.push({
          method: node.expression.name.text.toUpperCase() as HttpMethod,
          path: arg0.text
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(rootNode);
  return routes;
}

function extractRouterRoutes(file: string): RouteDef[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  return extractRoutesFromNode(source);
}

function extractFactoryRoutes(file: string, factoryName: string): RouteDef[] {
  const located = findFactoryFunctionNode(file, factoryName);
  if (located) return extractRoutesFromNode(located.fn);
  // Fall back to whole-file extraction for files with no matching factory
  // (shouldn't happen post-walker, but keep the safety net).
  return extractRouterRoutes(file);
}

function joinUrl(base: string, sub: string): string {
  const a = base.endsWith("/") ? base.slice(0, -1) : base;
  const b = sub.startsWith("/") ? sub : `/${sub}`;
  return a + b;
}

function walkBackend(): BeUrl[] {
  const app = walkAppTs();
  const out: BeUrl[] = [];

  // Top-level routers (healthRouter — single Router instance, walk full file).
  for (const [varName, mountPath] of app.topLevelRouters) {
    const file = findRouterFactorySource(varName);
    if (!file) continue;
    for (const r of extractRouterRoutes(file)) {
      out.push({ method: r.method, url: joinUrl(mountPath, r.path), source: relative(REPO_ROOT, file) });
    }
  }

  // Direct factory mounts on app (e.g., createAuthRouter).
  for (const ref of app.factoryRefs) {
    const file = findRouterFactorySource(ref.factoryName);
    if (!file) continue;
    for (const r of extractFactoryRoutes(file, ref.factoryName)) {
      out.push({ method: r.method, url: joinUrl(ref.mountPath, r.path), source: relative(REPO_ROOT, file) });
    }
  }

  // Sub-router tree. Build mount paths recursively.
  function resolveMountPath(varName: string): string {
    return app.subRouterMounts.get(varName) ?? "";
  }

  // First, sub-router-of-sub-router relationships (e.g. clientOrgRouter
  // mounted under tenantRouter at "/clientOrgs/:clientOrgId").
  const subRouterFullMount = new Map<string, string>();
  for (const [varName, mount] of app.subRouterMounts) {
    subRouterFullMount.set(varName, mount);
  }
  // Resolve nested sub-router mounts.
  for (const usage of app.subRouterUsages) {
    if (usage.childVar && !subRouterFullMount.has(usage.childVar)) {
      const parentMount = subRouterFullMount.get(usage.parentVar) ?? resolveMountPath(usage.parentVar);
      const sub = usage.subPath ?? "";
      subRouterFullMount.set(usage.childVar, joinUrl(parentMount, sub));
    }
  }

  // Now process router-factory usages on sub-routers.
  for (const usage of app.subRouterUsages) {
    if (!usage.factoryName) continue;
    const parentMount =
      subRouterFullMount.get(usage.parentVar) ?? resolveMountPath(usage.parentVar);
    const subPath = usage.subPath ?? "";
    const fullMount = joinUrl(parentMount, subPath);
    const file = findRouterFactorySource(usage.factoryName);
    if (!file) continue;
    for (const r of extractFactoryRoutes(file, usage.factoryName)) {
      out.push({ method: r.method, url: joinUrl(fullMount, r.path), source: relative(REPO_ROOT, file) });
    }
  }

  return out;
}

// ───────────────────────── Diff + report ─────────────────────────

function normalizeBeUrl(url: string): string {
  return preserveScopeParams(url);
}

function main(): void {
  const cfg = loadClassifierConfig();
  const feUrls = walkFrontend(cfg);
  const beUrlsRaw = walkBackend();

  // Dedupe BE.
  const beByKey = new Map<string, BeUrl>();
  for (const b of beUrlsRaw) {
    const norm = normalizeBeUrl(b.url);
    const key = `${b.method} ${norm}`;
    if (!beByKey.has(key)) beByKey.set(key, { method: b.method, url: norm, source: b.source });
  }

  // Match FE → BE.
  const errors: string[] = [];
  let matched = 0;
  for (const fe of feUrls) {
    const key = `${fe.method} ${fe.resolvedUrl}`;
    if (beByKey.has(key)) {
      matched += 1;
      continue;
    }
    // Method-mismatch detection: any BE entry with same path?
    const sameUrl: BeUrl[] = [];
    for (const be of beByKey.values()) {
      if (be.url === fe.resolvedUrl) sameUrl.push(be);
    }
    if (sameUrl.length > 0) {
      const allowed = sameUrl.map((b) => b.method).sort().join(", ");
      errors.push(
        `ERROR: ${fe.source} ${fe.method} ${fe.resolvedUrl} — BE only accepts ${allowed} at this path`
      );
    } else {
      errors.push(
        `ERROR: ${fe.source} ${fe.method} ${fe.resolvedUrl} — no BE handler found`
      );
    }
  }

  // Orphan BE warnings.
  const feKeys = new Set(feUrls.map((f) => `${f.method} ${f.resolvedUrl}`));
  const orphans: string[] = [];
  for (const be of beByKey.values()) {
    const key = `${be.method} ${be.url}`;
    if (feKeys.has(key)) continue;
    if (KNOWN_ORPHAN_BE_ROUTES.has(key)) continue;
    orphans.push(`WARN: ${be.source} ${be.method} ${be.url} — no FE caller`);
  }

  // Print report.
  const totalFe = feUrls.length;
  const totalBe = beByKey.size;
  if (errors.length > 0) {
    console.error("✗ FE↔BE contract drift detected:");
    for (const e of errors) console.error(`  ${e}`);
    console.error("");
    if (orphans.length > 0) {
      console.error(`(${orphans.length} orphan-BE warning${orphans.length === 1 ? "" : "s"} suppressed; pass --show-orphans to list.)`);
    }
    console.error(
      `Summary: ${totalFe} FE URLs, ${totalBe} BE URLs, ${matched} matched, ${errors.length} errors, ${orphans.length} orphan-BE warnings.`
    );
    process.exit(1);
  }

  if (process.argv.includes("--show-orphans") && orphans.length > 0) {
    for (const o of orphans) console.warn(`  ${o}`);
  }
  console.log(
    `✓ FE↔BE contract: ${totalFe} FE URLs, ${totalBe} BE URLs, ${matched} matched, 0 errors, ${orphans.length} orphan-BE warning${orphans.length === 1 ? "" : "s"}.`
  );
}

main();
