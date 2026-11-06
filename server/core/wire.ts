/** HTTP status codes this server sends or checks. */
export const HttpStatus = {
  Ok: 200,
  Found: 302,
  NotModified: 304,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  PayloadTooLarge: 413,
  TooManyRequests: 429,
  ServiceUnavailable: 503,
} as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

/** Milliseconds in a second. */
export const MS_PER_SECOND = 1000;
/** Seconds in a minute. */
export const SECONDS_PER_MINUTE = 60;
/** Minutes in an hour. */
export const MINUTES_PER_HOUR = 60;
/** Seconds in a day. */
export const SECONDS_PER_DAY = 86_400;
