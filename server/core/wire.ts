/** HTTP status codes this server sends or checks. */
export const HttpStatus = {
  Ok: 200,
  NotModified: 304,
  NotFound: 404,
  PayloadTooLarge: 413,
  ServiceUnavailable: 503,
} as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

/** Milliseconds in a second. */
export const MS_PER_SECOND = 1000;
/** Seconds in a minute. */
export const SECONDS_PER_MINUTE = 60;
/** Minutes in an hour. */
export const MINUTES_PER_HOUR = 60;
