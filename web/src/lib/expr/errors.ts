export class ParseError extends Error {
  constructor(
    message: string,
    public readonly pos: number,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export class EvalError extends Error {
  constructor(
    message: string,
    public readonly pos?: number,
  ) {
    super(message);
    this.name = "EvalError";
  }
}
