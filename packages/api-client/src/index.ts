import type { components } from "./schema";
export type { paths, components } from "./schema";
export type Subject = components["schemas"]["Subject"];
export type Skill = components["schemas"]["Skill"];
export type Child = components["schemas"]["Child"];
export type User = components["schemas"]["User"];
export type Session = components["schemas"]["Session"];
export type VerificationEmailResponse =
  components["schemas"]["VerificationEmailResponse"];
export type Choice = components["schemas"]["Choice"];
export type Question = components["schemas"]["Question"];
export type Feedback = components["schemas"]["Feedback"];
export type Attempt = components["schemas"]["Attempt"];
export type Progress = components["schemas"]["Progress"];
export type QuestionImportResult =
  components["schemas"]["QuestionImportResult"];
export type AdminQuestion = components["schemas"]["AdminQuestion"];
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string[]>,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export function createClient(base = "") {
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    retried = false,
  ): Promise<T> {
    const mutating = !["GET", "HEAD"].includes(method);
    if (
      mutating &&
      typeof document !== "undefined" &&
      !document.cookie.includes("XSRF-TOKEN=")
    )
      await fetch(`${base}/sanctum/csrf-cookie`, { credentials: "include" });
    const token =
      typeof document !== "undefined"
        ? document.cookie
            .split("; ")
            .find((c) => c.startsWith("XSRF-TOKEN="))
            ?.slice(11)
        : undefined;
    const multipart =
      typeof FormData !== "undefined" && body instanceof FormData;
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
        ...(token ? { "X-XSRF-TOKEN": decodeURIComponent(token) } : {}),
      },
      body:
        body === undefined
          ? undefined
          : multipart
            ? (body as FormData)
            : JSON.stringify(body),
    });
    if (res.status === 419 && mutating && !retried) {
      await fetch(`${base}/sanctum/csrf-cookie`, { credentials: "include" });
      return request<T>(path, method, body, true);
    }
    const data =
      res.status === 204
        ? {}
        : await res.json().catch(() => ({
            message: "We couldn’t connect. Please try again.",
          }));
    if (!res.ok) {
      const retryAfter = res.headers.get("Retry-After");
      throw new ApiError(
        data.message || "Something went wrong. Please try again.",
        res.status,
        data.errors,
        retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined,
      );
    }
    return data as T;
  }
  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) => request<T>(path, "POST", body),
    put: <T>(path: string, body: unknown) => request<T>(path, "PUT", body),
    delete: <T>(path: string, body?: unknown) =>
      request<T>(path, "DELETE", body),
    upload: <T>(path: string, body: FormData) => request<T>(path, "POST", body),
  };
}
