/** Tiny className joiner — replaces `clsx`/`classnames` per the no-new-deps
 *  constraint. Falsy entries (false/undefined/null/"") are dropped. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
