import type { ExtractionSchema } from "@/core/engine/DocumentDefinition.js";

export const LLAMA_EXTRACT_BANK_STATEMENT_SCHEMA: ExtractionSchema = {
  type: "object",
  properties: {
    bank_name: {
      type: "string",
      description: "Name of the bank that issued this Indian bank statement."
    },
    account_number: {
      type: "string",
      description: "The bank account number. Include full number or last 4 digits if only partial is visible."
    },
    account_holder: {
      type: "string",
      description: "The full name of the account holder as printed on the statement."
    },
    period_from: {
      type: "string",
      description: "Statement period start date in YYYY-MM-DD format. Convert DD/MM/YYYY or DD.MM.YYYY if needed."
    },
    period_to: {
      type: "string",
      description: "Statement period end date in YYYY-MM-DD format."
    },
    transactions: {
      type: "array",
      description: "Every transaction in the statement — extract ALL without skipping. For Indian bank statements, common date formats are DD.MM.YYYY or DD/MM/YYYY — convert all to YYYY-MM-DD.",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "Transaction date in YYYY-MM-DD format. Convert DD.MM.YYYY or DD/MM/YYYY to YYYY-MM-DD." },
          description: { type: "string", description: "Full transaction description or narration/remarks as printed." },
          debit: { type: "number", description: "Debit amount in rupees (decimal number, NOT paise). Null if this is a credit transaction." },
          credit: { type: "number", description: "Credit amount in rupees (decimal number, NOT paise). Null if this is a debit transaction." },
          balance: { type: "number", description: "Running account balance after this transaction, in rupees (decimal number, NOT paise)." }
        }
      }
    }
  }
};

export const LLAMA_EXTRACT_BANK_STATEMENT_CHUNK_SCHEMA: ExtractionSchema = {
  type: "object",
  properties: {
    transactions: LLAMA_EXTRACT_BANK_STATEMENT_SCHEMA.properties["transactions"]!
  }
};
