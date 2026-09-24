import { logger } from 'firebase-functions';
import { HttpsError } from 'firebase-functions/v2/https';

export { HttpsError };

/** Error thrown by AI / video providers. `code` is an HttpsError code. */
export class ProviderError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Wraps a callable handler: logs unexpected errors and converts them into safe HttpsErrors
 * so internal details (stack traces, keys) never leak to the client.
 */
export function withErrorHandling(name, handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      if (err instanceof ProviderError) {
        logger.warn(`[${name}] provider error`, { code: err.code, message: err.message, details: err.details });
        throw new HttpsError(err.code, err.message);
      }
      logger.error(`[${name}] unexpected error`, err);
      throw new HttpsError('internal', 'Unexpected server error. Please try again or contact your administrator.');
    }
  };
}
