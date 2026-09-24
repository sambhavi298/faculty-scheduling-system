/** Thrown by AuthService on a bad email/password — deliberately the SAME message/shape for "no such user" and "wrong password" (never reveal which one), mapped to 401 by error-handler.middleware.ts. */
export class UnauthenticatedError extends Error {
  constructor(message = 'Invalid email or password.') {
    super(message);
    this.name = 'UnauthenticatedError';
    Object.setPrototypeOf(this, UnauthenticatedError.prototype);
  }
}
