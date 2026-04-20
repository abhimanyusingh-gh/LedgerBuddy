export function formatInvoiceType(type?: string): string {
  if (!type) return "";
  return type.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
