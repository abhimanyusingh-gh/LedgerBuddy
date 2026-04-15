import type { ExtractionSchema } from "@/core/engine/DocumentDefinition.js";

export function buildExtractionPromptFromSchema(
  text: string,
  schema: ExtractionSchema
): string {
  const lines: string[] = [];

  lines.push("Extract the following fields from the document text below:");
  lines.push("");

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.type === "array" && prop.items?.type === "object" && prop.items.properties) {
      lines.push(`- ${key} (array): ${prop.description ?? ""}`);
      for (const [subKey, subProp] of Object.entries(prop.items.properties)) {
        lines.push(`  - ${subKey} (${subProp.type}): ${subProp.description ?? ""}`);
      }
    } else {
      lines.push(`- ${key} (${prop.type}): ${prop.description ?? ""}`);
    }
  }

  lines.push("");
  lines.push("DOCUMENT TEXT:");
  lines.push(text);
  lines.push("");

  lines.push("Respond with ONLY a valid JSON object matching the schema above. No explanation.");

  return lines.join("\n");
}
