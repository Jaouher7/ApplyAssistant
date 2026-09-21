/** Derives a short human-readable summary of a tool call's input, for the
 *  assistant dock's compact `.tool` status line — never renders raw JSON
 *  inline (that stays behind the disclosure toggle in ToolCallBlock). */
export function summarizeToolInput(name: string, input: unknown): string {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

  const path = str(obj.file_path) ?? str(obj.path);
  if (path) return path;

  const command = str(obj.command);
  if (command) return command.length > 60 ? `${command.slice(0, 57)}...` : command;

  const pattern = str(obj.pattern);
  if (pattern) return pattern;

  const url = str(obj.url);
  if (url) return url;

  const skill = str(obj.skill) ?? str(obj.name);
  if (skill && name.toLowerCase() === "skill") return skill;

  const prompt = str(obj.prompt) ?? str(obj.description);
  if (prompt) return prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt;

  const keys = Object.keys(obj);
  if (keys.length === 0) return "";
  return `${keys.length} arg${keys.length === 1 ? "" : "s"}`;
}
