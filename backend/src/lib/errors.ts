export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details)
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'unauthorized', msg)
export const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, 'forbidden', msg)
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`)
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'conflict', msg, details)
export const tooMany = (msg = 'Too many requests, please try again later') => new HttpError(429, 'rate_limited', msg)
