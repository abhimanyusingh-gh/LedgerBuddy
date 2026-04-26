import { Types } from "mongoose";
import {
  TenantMailboxAssignmentModel,
  MAILBOX_ASSIGNED_TO
} from "@/models/integration/TenantMailboxAssignment.js";
import { TenantIntegrationModel } from "@/models/integration/TenantIntegration.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { HttpError } from "@/errors/HttpError.js";

const RECENT_INGESTIONS_DEFAULT_LIMIT = 50;
const RECENT_INGESTIONS_MAX_LIMIT = 100;

/**
 * Admin CRUD service for `TenantMailboxAssignment` (#174). Manages the
 * post-pivot `clientOrgIds[]` shape introduced in #159 — the legacy
 * `assignedTo` user-mapping field on the same document is owned by
 * `tenantAdminService` and must NOT be touched here. Per #167, every
 * `clientOrgIds` element must belong to the assignment's `tenantId`;
 * we re-check at every write via a single batched `ClientOrganization`
 * lookup even though the FE picker sources from a tenant-scoped
 * endpoint (defence-in-depth — schema only enforces `length >= 1`).
 */
export class MailboxAssignmentsAdminService {
  /**
   * List the tenant's mailbox assignments + their integration polling
   * status, sorted by integration `emailAddress` ascending. The
   * polling/status fields are joined from the parent `TenantIntegration`
   * row so the FE doesn't need a second round-trip.
   */
  async list(tenantId: string) {
    const assignments = await TenantMailboxAssignmentModel.find({ tenantId }).lean();
    if (assignments.length === 0) return [];

    const integrationIds = Array.from(
      new Set(assignments.map((a) => a.integrationId.toString()))
    ).map((id) => new Types.ObjectId(id));
    const integrations = await TenantIntegrationModel.find({
      _id: { $in: integrationIds },
      tenantId
    }).lean();
    const integrationMap = new Map(integrations.map((i) => [String(i._id), i]));

    const items = assignments.map((a) => {
      const integration = integrationMap.get(a.integrationId.toString()) ?? null;
      const pollingConfig = integration?.pollingConfig as
        | { enabled?: boolean; intervalHours?: number; lastPolledAt?: Date; nextPollAfter?: Date }
        | undefined;
      return {
        _id: String(a._id),
        integrationId: String(a.integrationId),
        email: integration?.emailAddress ?? null,
        clientOrgIds: a.clientOrgIds.map((id) => String(id)),
        assignedTo: a.assignedTo,
        status: integration?.status ?? null,
        lastSyncedAt: integration?.lastSyncedAt ?? null,
        pollingConfig: pollingConfig
          ? {
              enabled: pollingConfig.enabled ?? false,
              intervalHours: pollingConfig.intervalHours ?? 4,
              lastPolledAt: pollingConfig.lastPolledAt ?? null,
              nextPollAfter: pollingConfig.nextPollAfter ?? null
            }
          : null,
        createdAt: (a as { createdAt?: Date }).createdAt ?? null,
        updatedAt: (a as { updatedAt?: Date }).updatedAt ?? null
      };
    });

    items.sort((left, right) => (left.email ?? "").localeCompare(right.email ?? ""));
    return items;
  }

  async create(input: {
    tenantId: string;
    integrationId: string;
    clientOrgIds: string[];
    assignedTo?: string;
  }) {
    const integrationOid = this.toOid(input.integrationId, "integrationId");
    const integration = await TenantIntegrationModel.findOne({
      _id: integrationOid,
      tenantId: input.tenantId
    }).lean();
    if (!integration) {
      throw new HttpError("Integration not found.", 404, "mailbox_integration_not_found");
    }

    const validatedIds = await this.validateClientOrgIds(input.tenantId, input.clientOrgIds);

    try {
      const created = await TenantMailboxAssignmentModel.create({
        tenantId: input.tenantId,
        integrationId: integrationOid,
        clientOrgIds: validatedIds,
        // Legacy `assignedTo` field is required by the schema (predates
        // the #159 pivot). Default to the `ALL` sentinel — the new admin
        // surface does not steer the user-mapping concern; that lives in
        // the legacy routes at tenantAdmin.ts.
        assignedTo: input.assignedTo?.trim() || MAILBOX_ASSIGNED_TO.ALL
      });
      return this.serialize(created.toObject(), integration);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new HttpError(
          "A mailbox assignment for this integration + assignee already exists.",
          409,
          "mailbox_assignment_duplicate"
        );
      }
      throw error;
    }
  }

  async update(input: {
    tenantId: string;
    assignmentId: string;
    clientOrgIds?: string[];
    assignedTo?: string;
  }) {
    const oid = this.toOid(input.assignmentId, "assignmentId");
    const existing = await TenantMailboxAssignmentModel.findOne({
      _id: oid,
      tenantId: input.tenantId
    });
    if (!existing) {
      throw new HttpError("Mailbox assignment not found.", 404, "mailbox_assignment_not_found");
    }

    if (input.clientOrgIds !== undefined) {
      existing.clientOrgIds = await this.validateClientOrgIds(
        input.tenantId,
        input.clientOrgIds
      );
    }
    if (input.assignedTo !== undefined) {
      const trimmed = input.assignedTo.trim();
      if (trimmed.length === 0) {
        throw new HttpError("assignedTo cannot be empty.", 400, "mailbox_assignment_assigned_to_required");
      }
      existing.assignedTo = trimmed;
    }
    await existing.save();

    const integration = await TenantIntegrationModel.findOne({
      _id: existing.integrationId,
      tenantId: input.tenantId
    }).lean();
    return this.serialize(existing.toObject(), integration);
  }

  async delete(input: { tenantId: string; assignmentId: string }) {
    const oid = this.toOid(input.assignmentId, "assignmentId");
    const result = await TenantMailboxAssignmentModel.deleteOne({
      _id: oid,
      tenantId: input.tenantId
    });
    if (result.deletedCount === 0) {
      throw new HttpError("Mailbox assignment not found.", 404, "mailbox_assignment_not_found");
    }
  }

  /**
   * Recent invoices stamped with this mailbox assignment as their
   * source (#181). Filters by `tenantId` (defence in depth) +
   * `sourceMailboxAssignmentId` (precise attribution) + `createdAt`.
   * Triage invoices stamped with the assignment ID are included;
   * pre-cutover invoices (no `sourceMailboxAssignmentId`) are not
   * surfaced — backfill is intentionally out of scope per the issue.
   *
   * `limit` is caller-controlled (default 50, capped at 100); the
   * applied limit is echoed back as `truncatedAt` so the FE can render
   * "showing first N of total".
   */
  async recentIngestions(input: {
    tenantId: string;
    assignmentId: string;
    days: number;
    limit?: number;
  }) {
    const oid = this.toOid(input.assignmentId, "assignmentId");
    const days = Number.isFinite(input.days) && input.days > 0 ? Math.min(input.days, 365) : 30;
    const limit = this.clampLimit(input.limit);
    const assignment = await TenantMailboxAssignmentModel.findOne({
      _id: oid,
      tenantId: input.tenantId
    }).lean();
    if (!assignment) {
      throw new HttpError("Mailbox assignment not found.", 404, "mailbox_assignment_not_found");
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filter = {
      tenantId: input.tenantId,
      sourceMailboxAssignmentId: oid,
      createdAt: { $gte: since }
    };
    const [items, total] = await Promise.all([
      InvoiceModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .select({
          _id: 1,
          clientOrgId: 1,
          status: 1,
          attachmentName: 1,
          receivedAt: 1,
          createdAt: 1,
          "parsed.vendorName": 1,
          "parsed.invoiceNumber": 1,
          "parsed.totalAmountMinor": 1,
          "parsed.currency": 1
        })
        .lean(),
      InvoiceModel.countDocuments(filter)
    ]);

    return {
      items: items.map((doc) => ({
        _id: String(doc._id),
        clientOrgId: doc.clientOrgId ? String(doc.clientOrgId) : null,
        status: doc.status,
        attachmentName: doc.attachmentName,
        receivedAt: doc.receivedAt,
        createdAt: (doc as { createdAt?: Date }).createdAt ?? null,
        vendorName: doc.parsed?.vendorName ?? null,
        invoiceNumber: doc.parsed?.invoiceNumber ?? null,
        totalAmountMinor: doc.parsed?.totalAmountMinor ?? null,
        currency: doc.parsed?.currency ?? null
      })),
      total,
      periodDays: days,
      truncatedAt: limit
    };
  }

  private clampLimit(raw: number | undefined): number {
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
      return RECENT_INGESTIONS_DEFAULT_LIMIT;
    }
    return Math.min(Math.floor(raw), RECENT_INGESTIONS_MAX_LIMIT);
  }

  /**
   * Validate that every supplied id is (a) a valid ObjectId, (b) unique
   * within the array, and (c) owned by the calling tenant. Single
   * batched `ClientOrganization` lookup — was per-id N+1 in the
   * original cut.
   */
  private async validateClientOrgIds(
    tenantId: string,
    clientOrgIds: unknown
  ): Promise<Types.ObjectId[]> {
    if (!Array.isArray(clientOrgIds) || clientOrgIds.length === 0) {
      throw new HttpError(
        "clientOrgIds must be a non-empty array.",
        400,
        "mailbox_assignment_client_org_ids_required"
      );
    }
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const raw of clientOrgIds) {
      if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
        throw new HttpError(
          "Every clientOrgIds element must be a valid ObjectId string.",
          400,
          "mailbox_assignment_invalid_client_org_id"
        );
      }
      if (seen.has(raw)) continue;
      seen.add(raw);
      ordered.push(raw);
    }

    const owned = await ClientOrganizationModel.find({
      tenantId,
      _id: { $in: ordered.map((id) => new Types.ObjectId(id)) }
    })
      .select("_id")
      .lean();
    const ownedSet = new Set(owned.map((doc) => String(doc._id)));
    const missing = ordered.filter((id) => !ownedSet.has(id));
    if (missing.length > 0) {
      throw new HttpError(
        `clientOrgId(s) ${missing.join(", ")} do not belong to this tenant.`,
        400,
        "mailbox_assignment_cross_tenant_client_org"
      );
    }
    return ordered.map((id) => new Types.ObjectId(id));
  }

  private serialize(
    assignment: Record<string, unknown> & {
      _id: unknown;
      integrationId: unknown;
      clientOrgIds: unknown[];
      assignedTo: string;
      createdAt?: Date;
      updatedAt?: Date;
    },
    integration: {
      emailAddress?: string | null;
      status?: string | null;
      lastSyncedAt?: Date | null;
      pollingConfig?: { enabled?: boolean; intervalHours?: number; lastPolledAt?: Date | null; nextPollAfter?: Date | null } | null;
    } | null
  ) {
    const pollingConfig = integration?.pollingConfig;
    return {
      _id: String(assignment._id),
      integrationId: String(assignment.integrationId),
      email: integration?.emailAddress ?? null,
      clientOrgIds: assignment.clientOrgIds.map((id) => String(id)),
      assignedTo: assignment.assignedTo,
      status: integration?.status ?? null,
      lastSyncedAt: integration?.lastSyncedAt ?? null,
      pollingConfig: pollingConfig
        ? {
            enabled: pollingConfig.enabled ?? false,
            intervalHours: pollingConfig.intervalHours ?? 4,
            lastPolledAt: pollingConfig.lastPolledAt ?? null,
            nextPollAfter: pollingConfig.nextPollAfter ?? null
          }
        : null,
      createdAt: assignment.createdAt ?? null,
      updatedAt: assignment.updatedAt ?? null
    };
  }

  private toOid(value: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new HttpError(`Invalid ${label}.`, 400, "mailbox_assignment_invalid_id");
    }
    return new Types.ObjectId(value);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === 11000
    );
  }
}
