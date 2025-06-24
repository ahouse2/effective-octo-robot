export function extractJsonFromMarkdown(text: string): any | null {
  const jsonBlockRegex = /```json\n([\s\S]*?)\n```/;
  const match = text.match(jsonBlockRegex);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.error("Failed to parse JSON from markdown:", e);
      return null;
    }
  }
  return null;
}