/**
 * `FormData.get()` returns **null** for a field the caller never rendered, and a zod
 * `.optional()` accepts `undefined` — not null. Feeding one to the other fails with
 * "Invalid input: expected string, received null", which reads like a validation error in
 * the value the user typed but is really about a field that was not on the form at all.
 *
 * It stayed hidden while every caller was a full master-data form that rendered every
 * input; the quick-create popover sends a name and nothing else, and hit it immediately.
 *
 * So: normalise at the boundary. An absent field becomes `undefined` and the schema's own
 * `.optional()` / `.default()` decides what that means — which is what those modifiers are
 * there for. Required fields still fail, with their own message.
 */
export function str(v: FormDataEntryValue | null): string | undefined {
  return typeof v === "string" ? v : undefined;
}
