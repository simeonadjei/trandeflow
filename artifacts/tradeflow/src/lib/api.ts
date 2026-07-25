// When VITE_API_URL is set (e.g. on Render), prefix all raw fetch calls with it.
// In dev / single-origin deployments the env var is unset and relative paths work fine.
export const apiBase: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
