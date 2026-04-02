import { BankStatementModel } from "../../models/BankStatement.js";
import { BankTransactionModel } from "../../models/BankTransaction.js";
import { logger } from "../../utils/logger.js";

interface ParsedTransaction {
  date: string;
  description: string;
  reference?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceMinor?: number;
}

export class BankStatementParser {
  async parseCsv(
    tenantId: string,
    fileName: string,
    csvContent: string,
    columnMapping: { date: number; description: number; debit: number; credit: number; reference?: number; balance?: number },
    uploadedBy: string
  ): Promise<{ statementId: string; transactionCount: number }> {
    const lines = csvContent.split("\n").filter(l => l.trim());
    if (lines.length < 2) throw new Error("CSV must have at least a header row and one data row.");

    const transactions: ParsedTransaction[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const date = cols[columnMapping.date]?.trim();
      const description = cols[columnMapping.description]?.trim();
      if (!date || !description) continue;

      const debitRaw = cols[columnMapping.debit]?.trim();
      const creditRaw = cols[columnMapping.credit]?.trim();
      const debitMinor = parseAmountToMinor(debitRaw);
      const creditMinor = parseAmountToMinor(creditRaw);

      if (!debitMinor && !creditMinor) continue;

      transactions.push({
        date: normalizeDate(date),
        description,
        reference: columnMapping.reference !== undefined ? cols[columnMapping.reference]?.trim() : undefined,
        debitMinor: debitMinor ?? undefined,
        creditMinor: creditMinor ?? undefined,
        balanceMinor: columnMapping.balance !== undefined ? parseAmountToMinor(cols[columnMapping.balance]?.trim()) ?? undefined : undefined
      });
    }

    const statement = await BankStatementModel.create({
      tenantId,
      fileName,
      transactionCount: transactions.length,
      matchedCount: 0,
      unmatchedCount: transactions.length,
      source: "csv-import",
      uploadedBy
    });

    const statementId = String(statement._id);

    if (transactions.length > 0) {
      await BankTransactionModel.insertMany(
        transactions.map(txn => ({
          tenantId,
          statementId,
          date: txn.date,
          description: txn.description,
          reference: txn.reference ?? null,
          debitMinor: txn.debitMinor ?? null,
          creditMinor: txn.creditMinor ?? null,
          balanceMinor: txn.balanceMinor ?? null,
          matchStatus: "unmatched",
          source: "csv-import"
        }))
      );
    }

    logger.info("bank.statement.csv.parsed", { tenantId, statementId, transactionCount: transactions.length });
    return { statementId, transactionCount: transactions.length };
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { result.push(current); current = ""; continue; }
    current += char;
  }
  result.push(current);
  return result;
}

function parseAmountToMinor(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.,\-]/g, "").trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    const parts = normalized.split(",");
    const lastPart = parts[parts.length - 1];
    normalized = lastPart.length <= 2 ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return Math.round(Math.abs(parsed) * 100);
}

function normalizeDate(value: string): string {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return value.substring(0, 10);

  const ddmmyyyy = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;

  return value;
}
