import { Badge } from "@/components/ds/Badge";
import { EXPORT_BATCH_ITEM_STATUS, type ExportBatchItemStatus } from "@/types";

const STATUS_TONE: Record<ExportBatchItemStatus, "neutral" | "success" | "danger"> = {
  [EXPORT_BATCH_ITEM_STATUS.PENDING]: "neutral",
  [EXPORT_BATCH_ITEM_STATUS.SUCCESS]: "success",
  [EXPORT_BATCH_ITEM_STATUS.FAILURE]: "danger"
};

const STATUS_LABEL: Record<ExportBatchItemStatus, string> = {
  [EXPORT_BATCH_ITEM_STATUS.PENDING]: "Pending",
  [EXPORT_BATCH_ITEM_STATUS.SUCCESS]: "Success",
  [EXPORT_BATCH_ITEM_STATUS.FAILURE]: "Failure"
};

interface ExportBatchItemBadgeProps {
  status: ExportBatchItemStatus;
}

export function ExportBatchItemBadge({ status }: ExportBatchItemBadgeProps) {
  return (
    <Badge tone={STATUS_TONE[status]} size="sm">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
