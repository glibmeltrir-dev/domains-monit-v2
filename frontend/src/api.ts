const AUTH_PATH = "/api/auth/";

function isApiUrl(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith("/api") || url.includes("/api/");
}

const originalFetch = window.fetch.bind(window);

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const api = isApiUrl(input);
  const next: RequestInit = {
    ...init,
    credentials: api ? "include" : init?.credentials,
  };
  return originalFetch(input, next).then((res) => {
    if (api && res.status === 401 && !url.includes(AUTH_PATH)) {
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    return res;
  });
};
