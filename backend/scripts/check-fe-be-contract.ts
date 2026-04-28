import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const FRONTEND_SRC = join(REPO_ROOT, "frontend", "src");
const BACKEND_SRC = join(REPO_ROOT, "backend", "src");
const APP_TS = join(BACKEND_SRC, "app.ts");
const URL_PROVIDERS_DIR = join(FRONTEND_SRC, "api", "urls");
const BE_URL_PROVIDERS_DIR = join(BACKEND_SRC, "routes", "urls");

const PROVIDER_BUILDER = {
  NESTED: "buildClientOrgPathUrl",
  TENANT: "buildTenantPathUrl",
  NONE: "none"
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

const PROVIDER_KIND = {
  NESTED: "nested",
  TENANT: "tenant",
  NONE: "none"
} as const;
type ProviderKind = typeof PROVIDER_KIND[keyof typeof PROVIDER_KIND];

const TENANT_PARAM_PLACEHOLDER = ":tenantId";
const CLIENT_ORG_PARAM_PLACEHOLDER = ":clientOrgId";

const UNANALYZABLE_FE_CALL_SITES: ReadonlySet<string> = new Set<string>([
  // Currently empty — every FE apiClient call site uses a literal or template
  // literal whose static prefix the walker can resolve.
]);

const KNOWN_ORPHAN_BE_ROUTES: ReadonlySet<string> = new Set<string>([
  "GET /health",
  "GET /health/ready",
  "GET /api/auth/login",
  "GET /api/auth/callback",
  "GET /api/connect/gmail",
  "GET /api/connect/gmail/callback",
  "GET /api/bank/aa-callback",
  "GET /api/bank/mock-callback",
  "POST /api/bank/consent-notify",
  "POST /api/bank/fi-notify",
  "POST /api/tenant/invites/accept",
  "GET /api/admin/workflow-health",
  "PUT /api/compliance/tds-rates/:id",
  "PUT /api/tenants/:tenantId/integrations/gmail/:id/polling",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/bank-statements/upload-csv",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/exports/tally",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/exports/csv",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/invoices/:id/retrigger-compliance",
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/export-config",
  "PATCH /api/tenants/:tenantId/clientOrgs/:clientOrgId/export-config",
  "POST /api/tenants/:tenantId/jobs/ingest/email-simulate",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/email-simulate",
  "POST /api/tenants/:tenantId/jobs/upload",
  "POST /api/tenants/:tenantId/jobs/upload/by-keys",
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/status",
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/sse",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest",
  "POST /api/tenants/:tenantId/clientOrgs/:clientOrgId/jobs/ingest/pause",
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/vendors/:id",
  "GET /api/tenants/:tenantId/clientOrgs/:clientOrgId/invoices/action-required",
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

interface BeUrlPathMap {
  values: Map<string, string>;
  knownObjects: Set<string>;
}

function stripAsConst(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node)) return stripAsConst(node.expression);
  return node;
}

function listBeUrlProviderFiles(): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(BE_URL_PROVIDERS_DIR);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (
      entry.endsWith("Urls.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".d.ts")
    ) {
      out.push(join(BE_URL_PROVIDERS_DIR, entry));
    }
  }
  return out;
}

function buildBeUrlPathMap(): BeUrlPathMap {
  const values = new Map<string, string>();
  const knownObjects = new Set<string>();
  for (const file of listBeUrlProviderFiles()) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    function visit(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const init = stripAsConst(node.initializer);
        if (ts.isObjectLiteralExpression(init)) {
          const objName = node.name.text;
          knownObjects.add(objName);
          for (const prop of init.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
              (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))
            ) {
              values.set(`${objName}.${prop.name.text}`, prop.initializer.text);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { values, knownObjects };
}

function applyNoneShape(barePath: string): string {
  const normalized = barePath.startsWith("/") ? barePath : `/${barePath}`;
  return `/api${normalized}`;
}

function applyProviderKindShape(barePath: string, kind: ProviderKind): string {
  const normalized = barePath.startsWith("/") ? barePath : `/${barePath}`;
  if (kind === PROVIDER_KIND.NESTED) {
    return `/api/tenants/${TENANT_PARAM_PLACEHOLDER}/clientOrgs/${CLIENT_ORG_PARAM_PLACEHOLDER}${normalized}`;
  }
  if (kind === PROVIDER_KIND.TENANT) {
    return `/api/tenants/${TENANT_PARAM_PLACEHOLDER}${normalized}`;
  }
  return `/api${normalized}`;
}


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
  if (found) return found;
  const bare = findBareReturnInBody(body, ctx);
  if (bare !== null) return { builder: PROVIDER_BUILDER.NONE, bare };
  return null;
}

function findBareReturnInBody(body: ts.Node, ctx: ResolveContext): string | null {
  if (ts.isPropertyAssignment(body) || ts.isMethodDeclaration(body)) {
    const inner = ts.isPropertyAssignment(body) ? body.initializer : body;
    return findBareReturnInBody(inner, ctx);
  }
  if (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) {
    if (ts.isBlock(body.body)) {
      let result: string | null = null;
      function visit(node: ts.Node) {
        if (result !== null) return;
        if (ts.isReturnStatement(node) && node.expression) {
          const resolved = resolvePathExpr(node.expression, ctx);
          if (resolved !== null) {
            result = resolved.bare;
            return;
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(body.body);
      return result;
    }
    const resolved = resolvePathExpr(body.body, ctx);
    return resolved ? resolved.bare : null;
  }
  return null;
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
  if (info.builder === PROVIDER_BUILDER.NESTED) return applyProviderKindShape(info.bare, PROVIDER_KIND.NESTED);
  if (info.builder === PROVIDER_BUILDER.TENANT) return applyProviderKindShape(info.bare, PROVIDER_KIND.TENANT);
  return applyProviderKindShape(info.bare, PROVIDER_KIND.NONE);
}

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

function normalizeDynamicSegments(path: string): string {
  return path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":id");
}

function preserveScopeParams(path: string): string {
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

      if (
        ts.isIdentifier(callee) &&
        (callee.text === "rewriteToNestedShape" || callee.text === "rewriteToTenantShape") &&
        !file.endsWith("/api/urls/pathBuilder.ts")
      ) {
        const arg0 = node.arguments[0];
        if (arg0) {
          const resolved = resolvePathExpr(arg0, ctx);
          if (resolved !== null) {
            const kind = callee.text === "rewriteToNestedShape" ? PROVIDER_KIND.NESTED : PROVIDER_KIND.TENANT;
            const fullUrl = applyProviderKindShape(resolved.bare, kind);
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
        const isRewriterSpan =
          ts.isCallExpression(firstSpan.expression) &&
          ts.isIdentifier(firstSpan.expression.expression) &&
          (firstSpan.expression.expression.text === "rewriteToTenantShape" ||
            firstSpan.expression.expression.text === "rewriteToNestedShape");
        if (!isRewriterSpan && firstSpan.literal.text.startsWith("/")) {
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

function walkFrontend(): FeUrl[] {
  const providerMap = buildProviderMethodMap();
  const files = listTsFiles(FRONTEND_SRC);
  const seen = new Map<string, FeUrl>();
  for (const file of files) {
    const raws = collectRawFeCalls(file, providerMap);
    for (const raw of raws) {
      const resolvedUrl =
        raw.fullUrlOverride !== null ? raw.fullUrlOverride : applyNoneShape(raw.bare);
      const normalized = preserveScopeParams(resolvedUrl);
      const key = `${raw.method} ${normalized}`;
      if (!seen.has(key)) {
        seen.set(key, { method: raw.method, rawPath: raw.bare, resolvedUrl: normalized, source: raw.source });
      }
    }
  }
  return Array.from(seen.values());
}

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
  topLevelRouters: Map<string, string>; 
  subRouterMounts: Map<string, string>; 
  subRouterUsages: Array<{ parentVar: string; childVar: string; subPath: string | null; factoryName: string | null }>;
}

function walkAppTs(): BeWalkResult {
  const source = ts.createSourceFile(APP_TS, readFileSync(APP_TS, "utf8"), ts.ScriptTarget.ES2022, true);
  const factoryRefs: RouterFactoryRef[] = [];
  const topLevelRouters = new Map<string, string>();
  const subRouterMounts = new Map<string, string>();
  const subRouterUsages: BeWalkResult["subRouterUsages"] = [];

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

  const factoryInstanceVars = new Map<string, string>(); 
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

      let mountPath: string | null = null;
      let argIdx = 0;
      const arg0 = node.arguments[0];
      if (arg0 && ts.isStringLiteral(arg0)) {
        mountPath = arg0.text;
        argIdx = 1;
      }

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
            if (callerName === "app" && mountPath !== null) {
              subRouterMounts.set(arg.text, mountPath);
            } else if (callerName !== null && subRouterVars.has(callerName)) {
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
  const routesDir = join(BACKEND_SRC, "routes");
  const files = listBackendTsFiles(routesDir);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (text.includes(`function ${factoryName}(`) || text.includes(`function ${factoryName} `)) {
      return file;
    }
  }
  if (factoryName === "healthRouter") {
    return join(routesDir, "auth", "health.ts");
  }
  return null;
}

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

function extractRoutesFromNode(rootNode: ts.Node, beUrlMap: BeUrlPathMap, fileLabel: string): RouteDef[] {
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
      const method = node.expression.name.text.toUpperCase() as HttpMethod;
      if (arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))) {
        routes.push({ method, path: arg0.text });
      } else if (
        arg0 &&
        ts.isPropertyAccessExpression(arg0) &&
        ts.isIdentifier(arg0.expression) &&
        ts.isIdentifier(arg0.name) &&
        beUrlMap.knownObjects.has(arg0.expression.text)
      ) {
        const key = `${arg0.expression.text}.${arg0.name.text}`;
        const resolved = beUrlMap.values.get(key);
        if (resolved === undefined) {
          throw new Error(
            `BE route registration at ${fileLabel} uses ${key} but no matching property was found ` +
              `on that constants object. Check the *Urls.ts module under backend/src/routes/urls/.`
          );
        }
        routes.push({ method, path: resolved });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(rootNode);
  return routes;
}

function extractRouterRoutes(file: string, beUrlMap: BeUrlPathMap): RouteDef[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  return extractRoutesFromNode(source, beUrlMap, relative(REPO_ROOT, file));
}

function extractFactoryRoutes(file: string, factoryName: string, beUrlMap: BeUrlPathMap): RouteDef[] {
  const located = findFactoryFunctionNode(file, factoryName);
  if (located) return extractRoutesFromNode(located.fn, beUrlMap, `${relative(REPO_ROOT, file)} (${factoryName})`);
  return extractRouterRoutes(file, beUrlMap);
}

function joinUrl(base: string, sub: string): string {
  const a = base.endsWith("/") ? base.slice(0, -1) : base;
  const b = sub.startsWith("/") ? sub : `/${sub}`;
  return a + b;
}

function walkBackend(): BeUrl[] {
  const app = walkAppTs();
  const beUrlMap = buildBeUrlPathMap();
  const out: BeUrl[] = [];

  for (const [varName, mountPath] of app.topLevelRouters) {
    const file = findRouterFactorySource(varName);
    if (!file) continue;
    for (const r of extractRouterRoutes(file, beUrlMap)) {
      out.push({ method: r.method, url: joinUrl(mountPath, r.path), source: relative(REPO_ROOT, file) });
    }
  }

  for (const ref of app.factoryRefs) {
    const file = findRouterFactorySource(ref.factoryName);
    if (!file) continue;
    for (const r of extractFactoryRoutes(file, ref.factoryName, beUrlMap)) {
      out.push({ method: r.method, url: joinUrl(ref.mountPath, r.path), source: relative(REPO_ROOT, file) });
    }
  }

  function resolveMountPath(varName: string): string {
    return app.subRouterMounts.get(varName) ?? "";
  }

  const subRouterFullMount = new Map<string, string>();
  for (const [varName, mount] of app.subRouterMounts) {
    subRouterFullMount.set(varName, mount);
  }
  for (const usage of app.subRouterUsages) {
    if (usage.childVar && !subRouterFullMount.has(usage.childVar)) {
      const parentMount = subRouterFullMount.get(usage.parentVar) ?? resolveMountPath(usage.parentVar);
      const sub = usage.subPath ?? "";
      subRouterFullMount.set(usage.childVar, joinUrl(parentMount, sub));
    }
  }

  for (const usage of app.subRouterUsages) {
    if (!usage.factoryName) continue;
    const parentMount =
      subRouterFullMount.get(usage.parentVar) ?? resolveMountPath(usage.parentVar);
    const subPath = usage.subPath ?? "";
    const fullMount = joinUrl(parentMount, subPath);
    const file = findRouterFactorySource(usage.factoryName);
    if (!file) continue;
    for (const r of extractFactoryRoutes(file, usage.factoryName, beUrlMap)) {
      out.push({ method: r.method, url: joinUrl(fullMount, r.path), source: relative(REPO_ROOT, file) });
    }
  }

  return out;
}

function normalizeBeUrl(url: string): string {
  return preserveScopeParams(url);
}

function main(): void {
  const feUrls = walkFrontend();
  const beUrlsRaw = walkBackend();

  const beByKey = new Map<string, BeUrl>();
  for (const b of beUrlsRaw) {
    const norm = normalizeBeUrl(b.url);
    const key = `${b.method} ${norm}`;
    if (!beByKey.has(key)) beByKey.set(key, { method: b.method, url: norm, source: b.source });
  }

  const errors: string[] = [];
  let matched = 0;
  for (const fe of feUrls) {
    const key = `${fe.method} ${fe.resolvedUrl}`;
    if (beByKey.has(key)) {
      matched += 1;
      continue;
    }
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

  const feKeys = new Set(feUrls.map((f) => `${f.method} ${f.resolvedUrl}`));
  const orphans: string[] = [];
  for (const be of beByKey.values()) {
    const key = `${be.method} ${be.url}`;
    if (feKeys.has(key)) continue;
    if (KNOWN_ORPHAN_BE_ROUTES.has(key)) continue;
    orphans.push(`WARN: ${be.source} ${be.method} ${be.url} — no FE caller`);
  }

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
