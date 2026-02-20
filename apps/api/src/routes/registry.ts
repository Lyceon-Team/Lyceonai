export const PUBLIC_ROUTES = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/questions/recent?limit=5" },
  { method: "GET", path: "/api/questions/search?q=test" },
  { method: "GET", path: "/api/auth/user" },
] as const;

export const PROTECTED_ROUTES = [
  { method: "GET", path: "/api/profile" },
  { method: "POST", path: "/api/rag" },
  { method: "POST", path: "/api/rag/v2" },
  { method: "POST", path: "/api/tutor/v2" },
  { method: "POST", path: "/api/practice/sessions" },
] as const;

export const ADMIN_ROUTES = [
  { method: "GET", path: "/api/admin/questions/needs-review" },
  { method: "GET", path: "/api/admin/health" },
] as const;
