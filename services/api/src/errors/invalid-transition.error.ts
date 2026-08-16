export class InvalidTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`INVALID_TRANSITION: ${from} -> ${to} is not allowed`);
    this.name = 'InvalidTransitionError';
    Object.setPrototypeOf(this, InvalidTransitionError.prototype);
  }
}
