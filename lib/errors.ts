export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

export class AppError extends Error {
  readonly fields?: Record<string, string>;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
    this.fields = fields;
  }
}

export function validationError(message: string, fields?: Record<string, string>) {
  return new AppError("VALIDATION", message, 422, fields);
}

export function unauthorized(message = "Sign in to continue.") {
  return new AppError("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "You do not have access to this.") {
  return new AppError("FORBIDDEN", message, 403);
}

export function notFound(message = "That record could not be found.") {
  return new AppError("NOT_FOUND", message, 404);
}

export function conflict(message: string) {
  return new AppError("CONFLICT", message, 409);
}

export function rateLimited(message = "Too many attempts. Try again later.") {
  return new AppError("RATE_LIMITED", message, 429);
}

export function zodFields(issues: { path: PropertyKey[]; message: string }[]) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
