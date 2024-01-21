import { makeCheckedErrorHolder, type ErrorHolder } from "./ErrorHolder.js";
import {
  Err,
  ErrUnchecked,
  Ok,
  _Result,
  isResult,
  type Result,
} from "./Result.js";
import type { NonEmptyArray, UnionToIntersection } from "./utils.js";

export type AsyncResult<T, E> = _AsyncResult<T, E>;

class _AsyncResult<T, E> {
  constructor(public readonly resultPromise: Promise<Result<T, E>>) {}

  /**
   * @see {_Result[Symbol.iterator]}
   */
  *[Symbol.iterator](): Iterator<AsyncResult<T, E>, T, any> {
    return yield this;
  }

  async valueOrFallback<U>(getFallback: (e: ErrorHolder<E>) => U) {
    return this.resultPromise.then((result) =>
      result.valueOrFallback(getFallback)
    );
  }

  async valueOrThrow() {
    return this.resultPromise.then((result) => result.valueOrThrow());
  }

  then_<T2, E2 = never>(
    okCb: (arg: T) => ResultPromisable<T2, E2>,
    errCb?: (arg: ErrorHolder<E>) => ResultPromisable<T2, E2>
  ): _AsyncResult<T2, E | E2> {
    return new _AsyncResult<T2, E | E2>(
      this.resultPromise
        .then(async (result) =>
          !result.data.isOk
            ? typeof errCb === "function"
              ? toResultPromise(errCb(result.data.value))
              : (result satisfies Result<T, E> as Result<never, E>)
            : toResultPromise(okCb(result.data.value))
        )
        .catch((error) => ErrUnchecked<E | E2>(error))
    );
  }

  catch_<T2, E2 = never>(
    cb: (arg: ErrorHolder<E>) => ResultPromisable<T2, E2>
  ): _AsyncResult<T | T2, E2> {
    return new _AsyncResult<T | T2, E2>(
      this.resultPromise
        .then(async (result) =>
          result.data.isOk
            ? (result satisfies Result<T, E> as Result<T, never>)
            : toResultPromise(cb(result.data.value))
        )
        .catch((error) => ErrUnchecked<E2>(error))
    );
  }

  catchKnown<T2, E2 = never>(
    cb: (arg: E) => ResultPromisable<T2, E2>
  ): _AsyncResult<T | T2, E2> {
    return this.catch_((error) => {
      return error.type === "UNCHECKED_ERROR"
        ? new _Result<never, E2>({ isOk: false, value: error })
        : cb(error.error);
    });
  }

  /**
   * Like `catchKnown`, but the callback is only called if the error is an
   * instance of the given class.
   *
   * NB: We use `UnionToIntersection` to help ensure (but not guarantee) that
   * `ToCatch` is instantiated with a single class's type, not a union type. If
   * we simply used `new (): ToCatch`, and ToCatch were a union, the return type
   * of this method would be misleading, as it'd indicate that certain error
   * types are impossible/handled, when they're actually not.
   *
   * Note that this isn't perfect when two potential error classes are
   * structurally identical, but that's TS.
   */
  catchKnownInstanceOf<ToCatch extends E, T2, E2 = never>(
    type: { new (): UnionToIntersection<ToCatch> },
    cb: (arg: ToCatch) => T2 | Result<T2, E2>
  ): AsyncResult<T | T2, Exclude<E, ToCatch> | E2> {
    return this.catch_<T | T2, E2 | Exclude<E, ToCatch>>((error) => {
      return error.type === "CHECKED_ERROR" && error.error instanceof type
        ? cb(error.error)
        : new _Result<T, Exclude<E, ToCatch>>({
            isOk: false,
            value: error as ErrorHolder<Exclude<E, ToCatch>>,
          });
    });
  }

  /**
   * Follows Promise.prototype.finally(), in that the callback is called
   * regardless of whether the Result is an Ok or an Err; but, the returned
   * result has the same result as the original, regardless of what the callback
   * returned, unless the callbac returns a new Err or throws.
   */
  finally_<E2 = never>(
    cb: () => void | ResultPromisable<never, E2>
  ): AsyncResult<T, E | E2> {
    const fn = async () => {
      const newResult = await toResultPromise<unknown, E2>(cb());
      return !newResult.data.isOk
        ? (newResult satisfies Result<unknown, E2> as Result<never, E2>)
        : this.resultPromise;
    };
    return this.then_<T, E | E2>(fn, fn);
  }
}

export function AsyncResult<T, E = never>(
  arg: Promise<T | Result<T, E> | AsyncResult<T, E>>
): _AsyncResult<T, E> {
  return new _AsyncResult(
    toResultPromise<T, E>(arg).catch((error) => ErrUnchecked<E>(error))
  );
}

// NB: allowing arg to be a function is potentially misleading -- the caller
// might think that the computation is lazy -- but it saves a level of
// indentation when the promise would be created by the user making an IIFE out
// of an async function, which is pretty common. I've decided that potential for
// confusion is worth the convenience, and it's mitigated by making this a
// dedicated method (that we can give a good name and docs to), rather than
// abusing the main `AsyncResult` "constructor".
AsyncResult.fromFunc = <T, E = never>(
  arg: () => Promise<T | Result<T, E> | AsyncResult<T, E>>
) => AsyncResult(arg());

type AsyncOkType<T> = T extends AsyncResult<infer U, any> ? U : never;
type AsyncErrType<T> = T extends AsyncResult<any, infer E> ? E : never;

type AsyncOkTypes<T extends AsyncResult<any, any>[]> = {
  [K in keyof T]: AsyncOkType<T[K]>;
};

type AsyncErrTypes<T extends AsyncResult<any, any>[]> = {
  [key in keyof T]: AsyncErrType<T[key]>;
};

type AsyncResultTypes<T extends AsyncResult<any, any>[]> = {
  [key in keyof T]: T[key] extends AsyncResult<infer T, infer E>
    ? Result<T, E>
    : never;
};

AsyncResult.all = <T extends AsyncResult<any, any>[]>(
  asyncResults: T
): AsyncResult<AsyncOkTypes<T>, AsyncErrTypes<T>[number]> => {
  return AsyncResult<any, any>(
    Promise.all(asyncResults.map((it) => getValueOrRejectWithErrorHolder(it)))
      .then((resultValues) => Ok(resultValues as AsyncOkTypes<T>))
      .catch((error) => {
        const error_ = error as ErrorHolder<AsyncErrTypes<T>[number]>;

        return error_.type === "UNCHECKED_ERROR"
          ? ErrUnchecked(error_.error)
          : Err(error_.error as AsyncErrTypes<T>[number] & Error);
      })
  );
};

AsyncResult.any = <T extends [] | AsyncResult<any, any>[]>(
  asyncResults: T
): AsyncResult<
  AsyncOkTypes<T>[number],
  AggregateError & { errors: ErrorHolder<AsyncErrTypes<T>[number]>[] }
> => {
  return AsyncResult<any, any>(
    Promise.any(asyncResults.map((it) => getValueOrRejectWithErrorHolder(it)))
      .then((resultValue) => Ok(resultValue as AsyncOkTypes<T>[number]))
      .catch((error) => Err(error as AggregateError))
  );
};

AsyncResult.allSettled = <T extends [] | AsyncResult<any, any>[]>(
  asyncResults: T
): AsyncResult<AsyncResultTypes<T>, never> => {
  return AsyncResult<any, never>(
    Promise.allSettled(asyncResults.map((it) => it.resultPromise)).then(
      (settledResults) =>
        // NB: resultPromise is supposed to never reject (instead, there should
        // be an error inside the Result), so we can safely cast here.
        settledResults.map((it) => (it as PromiseFulfilledResult<any>).value)
    )
  );
};

AsyncResult.race = <T extends [] | AsyncResult<any, any>[]>(
  asyncResults: T
): T[number] => {
  return AsyncResult<any, any>(
    Promise.race(asyncResults.map((it) => it.resultPromise))
  );
};

/**
 * Simplifies working with a chain of AsyncResults, by hiding the unwrapping at
 * each step while the AsyncResult is an Ok, and short-circuiting the
 * computation once it becomes an Err.
 *
 * @example
 * ```
 * // with AsyncResult.run
 * function getUser() {
 *   return AsyncResult.run(function* () {
 *     const firstName = yield* getFirstName(); // AsyncResult<string, never>
 *     const lastName = yield* AsyncResult(getLastName() /* Promise<AsyncResult<string, never>> *\/)
 *     const defaultUsername = yield* genUsername(firstName, lastName) // Result<string, UnrecognizedLanguageError>
 *     return { firstName, lastName };
 *   });
 * }
 * ```
 *
 * In all cases, the semantics are identical: if getFirstNameResult() or
 * getLastNameResult() returns an Err, the Err is returned by getUser.
 *
 * Using yield* is similar to using await in an async function, or do notation
 * in Haskell, or the `?` operator in Rust.
 *
 * NB: for obscure reasons, you must use `yield*` instead of `yield`
 * throughout the generator.
 *
 * @template Yields - The type of the yielded values (given to `yield*`).
 * @template U - The type of the final result.
 * @param {() => Generator<Yields, U, any>} fn - The generator function to run.
 */
AsyncResult.run = <Yields extends AsyncResult<any, any> | Result<any, any>, U>(
  fn: () => Generator<Yields, U, any>
): AsyncResult<U, AsyncErrType<Yields>> => {
  /**
   * @see {Result.run} for implementation details.
   */
  return AsyncResult<any, any>(
    (async () => {
      const gen = fn();
      return AsyncResult<any, any>(Promise.resolve(Ok(undefined))).then_(
        async function andThen(
          v
        ): Promise<AsyncResult<any, any> | Result<any, any>> {
          try {
            const { value, done } = gen.next(v);
            const result = await toResultPromise(value);
            if (done) {
              return result;
            }

            if (!result.data.isOk) {
              gen.return?.(value as any);
              return result;
            }

            return AsyncResult(Promise.resolve(result)).then_(andThen);
          } catch (error) {
            return ErrUnchecked(error);
          }
        }
      );
    })()
  );
};

AsyncResult.compose = c;

function c<T, U, V, W, X, Y, Z>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>
): (v: T) => ResultPromisable<W, X>;
function c<T, U, V, W, X, Y, Z>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>
): (v: T) => ResultPromisable<Y, Z>;
function c<T, U, V, W, X, Y, Z, A, B>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>
): (v: T) => ResultPromisable<A, B>;
function c<T, U, V, W, X, Y, Z, A, B, C, D>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>,
  f4: (v: A) => ResultPromisable<C, D>
): (v: T) => ResultPromisable<C, D>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>,
  f4: (v: A) => ResultPromisable<C, D>,
  f5: (v: C) => ResultPromisable<E, F>
): (v: T) => ResultPromisable<E, F>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>,
  f4: (v: A) => ResultPromisable<C, D>,
  f5: (v: C) => ResultPromisable<E, F>,
  f6: (v: E) => ResultPromisable<G, H>
): (v: T) => ResultPromisable<G, H>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>,
  f4: (v: A) => ResultPromisable<C, D>,
  f5: (v: C) => ResultPromisable<E, F>,
  f6: (v: E) => ResultPromisable<G, H>,
  f7: (v: G) => ResultPromisable<I, J>
): (v: T) => ResultPromisable<I, J>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J, K, L>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>,
  f4: (v: A) => ResultPromisable<C, D>,
  f5: (v: C) => ResultPromisable<E, F>,
  f6: (v: E) => ResultPromisable<G, H>,
  f7: (v: G) => ResultPromisable<I, J>,
  f8: (v: I) => ResultPromisable<K, L>
): (v: T) => ResultPromisable<K, L>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J, K, L, M, N>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>,
  f4: (v: A) => ResultPromisable<C, D>,
  f5: (v: C) => ResultPromisable<E, F>,
  f6: (v: E) => ResultPromisable<G, H>,
  f7: (v: G) => ResultPromisable<I, J>,
  f8: (v: I) => ResultPromisable<K, L>,
  f9: (v: K) => ResultPromisable<M, N>
): (v: T) => ResultPromisable<M, N>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P>(
  f0: (v: T) => ResultPromisable<U, V>,
  f1: (v: U) => ResultPromisable<W, X>,
  f2: (v: W) => ResultPromisable<Y, Z>,
  f3: (v: Y) => ResultPromisable<A, B>,
  f4: (v: A) => ResultPromisable<C, D>,
  f5: (v: C) => ResultPromisable<E, F>,
  f6: (v: E) => ResultPromisable<G, H>,
  f7: (v: G) => ResultPromisable<I, J>,
  f8: (v: I) => ResultPromisable<K, L>,
  f9: (v: K) => ResultPromisable<M, N>,
  f10: (v: M) => ResultPromisable<O, P>
): (v: T) => ResultPromisable<O, P>;
function c(...fns: NonEmptyArray<(v: any) => ResultPromisable<any, any>>) {
  return (v: any) => {
    const [fn, ...restFns] = fns;
    let result = fn(v);
    for (const fn of restFns) {
      result = result.then_(fn);
    }
    return result;
  };
}

type ResultPromisable<T, E> =
  | T
  | Promise<T>
  | Result<T, E>
  | Promise<Result<T, E>>
  | AsyncResult<T, E>
  | Promise<AsyncResult<T, E>>
  | Promise<T | Result<T, E>>
  | Promise<T | AsyncResult<T, E>>
  | Promise<Result<T, E> | AsyncResult<T, E>>
  | Promise<T | Result<T, E> | AsyncResult<T, E>>;

async function toResultPromise<T, E>(
  it: ResultPromisable<T, E>
): Promise<Result<T, E>> {
  const awaited = await it;
  if (isResult(awaited)) {
    return awaited;
  } else if (awaited instanceof _AsyncResult) {
    return awaited.resultPromise;
  } else {
    return Ok(awaited);
  }
}

/**
 * Given an AsyncResult<T, E>, a Promise that resolves with T or reqjects with
 * an ErrorHolder<E>. This is different from AsyncResult.valueOrThrow() in that
 * it will reject with an ErrorHolder<E> instead of an `E`, allowing the caller
 * to see if the error came from a checked or unchecked exception.
 *
 * This isn't a stndard method on AsyncResult because it's generally not good to
 * reject with non-Error values, but it's used as an internal helper to
 * implement various combinators above.
 */
async function getValueOrRejectWithErrorHolder<T, E>(
  it: AsyncResult<T, E>
): Promise<T> {
  return it
    .catch_(
      (errorHolder) =>
        // Return a new Err() case that wraps the given ErrorHolder in another
        // ErrorHolder. It doesn't actually matter if this outer ErrorHolder is
        // checked or unchecked, since it'll be thrown away by valueOrThrow() to
        // reveal the inner ErrorHolder.
        new _Result<never, ErrorHolder<any>>({
          isOk: false,
          value: makeCheckedErrorHolder(errorHolder),
        })
    )
    .valueOrThrow();
}
