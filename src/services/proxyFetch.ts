/**
 * Routes local service HTTP requests through the Vite/Node local backend bridge (/api/proxy)
 * so that Ollama, LM Studio, and ComfyUI work out-of-the-box without CORS errors.
 */
export async function proxyFetch(
  targetUrl: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  headers.set('x-target-url', targetUrl);

  try {
    const res = await fetch('/api/proxy', {
      ...options,
      headers,
    });
    return res;
  } catch {
    // Fallback to direct fetch (e.g., packaged Electron with webSecurity: false)
    return fetch(targetUrl, options);
  }
}
