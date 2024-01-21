// NB: we represent the error holders with classes so that they can extend
// Error. That way, when they ocassionally end up in an `AggregateError`'s
// `errors` list, they play nicer with other code/follow the convention of that
// array holding only Errors.

class CheckedErrorHolder<E> extends Error {
  public readonly type = "CHECKED_ERROR";
  constructor(public readonly error: E) {
    super();
  }
}

class UncheckedErrorHolder extends Error {
  public readonly type = "UNCHECKED_ERROR";
  constructor(public readonly error: unknown) {
    super();
  }
}

export type ErrorHolder<E> =
  | (E extends never ? never : CheckedErrorHolder<E>)
  | (E extends unknown ? CheckedErrorHolder<E> : never)
  | UncheckedErrorHolder;

export function isErrorHolder(it: unknown): it is ErrorHolder<unknown> {
  return it instanceof CheckedErrorHolder || it instanceof UncheckedErrorHolder;
}

export function isCheckedErrorHolder(
  it: unknown
): it is CheckedErrorHolder<unknown> {
  return it instanceof CheckedErrorHolder;
}

export function isUncheckedErrorHolder(
  it: unknown
): it is UncheckedErrorHolder {
  return it instanceof UncheckedErrorHolder;
}

export function makeUncheckedErrorHolder(error: unknown): ErrorHolder<never> {
  return new UncheckedErrorHolder(error);
}

export function makeCheckedErrorHolder<E>(error: E): ErrorHolder<E> {
  // @ts-ignore TS complains here b/c, if E is never, then `type: 'CHECKED_ERR'`
  // is invalid. But calling this with `never` should obv be impossible.
  return new CheckedErrorHolder(error);
}
