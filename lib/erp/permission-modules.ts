/** Pure mapping shared by web, API and future delegated transports. */
export function moduleOfPermission(permission: string): string {
  const prefix = permission.split(".")[0];
  return ["settings", "users", "organization", "approvals", "automation"].includes(prefix) ? "settings" : prefix;
}

export function entitledPermissions(
  permissions: ReadonlySet<string>, modules: ReadonlySet<string> | null,
  permission: string, moduleOverride?: string,
): Set<string> {
  const requestedModule = moduleOfPermission(permission);
  return new Set([...permissions].filter(p => {
    const mod = moduleOfPermission(p);
    return modules === null || mod === "settings" || modules.has(mod) ||
      (moduleOverride !== undefined && mod === requestedModule && modules.has(moduleOverride));
  }));
}
