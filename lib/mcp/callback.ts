/** Only local CLI callbacks can use an extra handoff window. Web clients own
 * their OAuth browsing context (sessionStorage/opener) and must get it back. */
export function usesLocalCallbackPopup(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch { return false; }
}
