export class NotFoundError extends Error {
  constructor(message = 'The requested resource was not found or you do not have access to it.') {
    super(message);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}
