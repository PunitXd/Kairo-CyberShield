// An intentional, client-safe API error. The error middleware turns it into
// ARCH §9's shape: { "error": { "code": "NOT_FOUND", "message": "…" } }.

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export { ApiError };
