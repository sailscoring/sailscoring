export function log(module: string, ...args: unknown[]): void {
  try {
    if (localStorage.getItem('sailscoring:debug') !== '1') return;
  } catch {
    return;
  }
  console.debug(`[sailscoring:${module}]`, ...args);
}
