// Tiny URL helpers; no URL class dependency (works on bare runtimes).

export function encodeComponent(value) {
  if (typeof encodeURIComponent === "function") return encodeURIComponent(String(value));
  return String(value).replace(/[^A-Za-z0-9\-_.!~*'()]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

// Arrays repeat the key.
export function buildQuery(params) {
  const parts = [];
  if (!params) return "";
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) parts.push(encodeComponent(key) + "=" + encodeComponent(item));
      }
    } else {
      parts.push(encodeComponent(key) + "=" + encodeComponent(value));
    }
  }
  return parts.join("&");
}

export function withQuery(url, params) {
  const q = buildQuery(params);
  if (!q) return url;
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + q;
}

export function joinUrl(base, path) {
  const b = String(base || "").replace(/\/+$/, "");
  const p = String(path || "");
  if (!p) return b;
  return b + "/" + p.replace(/^\/+/, "");
}
