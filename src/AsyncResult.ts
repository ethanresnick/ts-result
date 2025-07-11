import { Err, Ok, _Result, isResult, type Result } from "./Result.js";
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

  async valueOrFallback<U>(
    errCb: (e: E) => U,
    rejectionCb?: (arg: unknown) => U
  ) {
    return this.resultPromise.then(
      (result) => result.valueOrFallback(errCb),
      rejectionCb
    );
  }

  async valueOrReject() {
    return this.resultPromise.then((result) => result.valueOrThrow());
  }

  then<V>(
    _onfulfilled?: ((value: Result<T, E>) => V) | null | undefined,
    _onrejected?: ((reason: any) => unknown) | null | undefined
  ) {
    return this.resultPromise.then(...arguments);
  }

  then_<T2, E2 = never>(
    okCb: (arg: T) => ResultPromisable<T2, E2>,
    errCb?: (arg: E) => ResultPromisable<T2, E2>,
    rejectionCb?: (arg: unknown) => ResultPromisable<T2, E2>
  ): _AsyncResult<T2, E | E2> {
    return new _AsyncResult<T2, E | E2>(
      this.resultPromise.then(
        (result) =>
          !result.data.isOk
            ? typeof errCb === "function"
              ? toResultPromise(errCb(result.data.value))
              : (result satisfies Result<T, E> as unknown as Result<T2, E | E2>)
            : toResultPromise(okCb(result.data.value)),
        (error) => {
          if (typeof rejectionCb === "function") {
            return toResultPromise(rejectionCb(error));
          } else {
            throw error;
          }
        }
      )
    );
  }

  catch_<T2, E2 = never>(
    errCb: (arg: E) => ResultPromisable<T2, E2>,
    rejectionCb?: (arg: unknown) => ResultPromisable<T2, E2>
  ): _AsyncResult<T | T2, E2> {
    return new _AsyncResult<T | T2, E2>(
      this.resultPromise.then(
        (result) =>
          result.data.isOk
            ? (result satisfies Result<T, E> as unknown as Result<T | T2, E2>)
            : toResultPromise(errCb(result.data.value)),
        (error) => {
          if (typeof rejectionCb !== "function") {
            throw error;
          }
          return toResultPromise(rejectionCb(error));
        }
      )
    );
  }

  /**
   * Like `catch_`, but the callback is only called if the error is an Err
   * that's an instance of the given class. If the AsyncResult is already
   * rejected, the rejection callback is called unconditionally.
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
  catchInstanceOf<ToCatch extends E, T2, E2 = never>(
    type: { new (...args: any[]): UnionToIntersection<ToCatch> },
    errCb: (arg: ToCatch) => ResultPromisable<T2, E2>,
    rejectionCb?: (arg: unknown) => ResultPromisable<T2, E2>
  ): AsyncResult<T | T2, Exclude<E, ToCatch> | E2> {
    return this.catch_<T | T2, E2 | Exclude<E, ToCatch>>((error) => {
      return error instanceof type
        ? errCb(error)
        : new _Result<T, Exclude<E, ToCatch>>({
            isOk: false,
            value: error satisfies E as Exclude<E, ToCatch>,
          });
    }, rejectionCb);
  }

  /**
   * Follows Promise.prototype.finally(), in that the callback is called
   * regardless of whether the Result is an Ok or an Err; but, the returned
   * result has the same result as the original, regardless of what the callback
   * returned, unless the callback returns a new Err or throws.
   */
  finally_<E2 = never>(
    cb: () => void | ResultPromisable<never, E2>
  ): AsyncResult<T, E | E2> {
    const fn = async () => {
      const newResult = await toResultPromise<unknown, E2>(cb());
      return !newResult.data.isOk
        ? (newResult satisfies Result<unknown, E2> as Result<never, E2>)
        : Promise.resolve(this.resultPromise);
    };
    return this.then_<T, E | E2>(fn, fn, fn);
  }
}

export function AsyncResult<T, E = never>(
  arg: ResultPromisable<T, E>
): _AsyncResult<T, E> {
  return new _AsyncResult(toResultPromise(arg));
}

// NB: allowing arg to be a function is potentially misleading -- the caller
// might think that the computation is lazy -- but it saves a level of
// indentation when the promise would be created by the user making an IIFE out
// of an async function, which is pretty common. I've decided that potential for
// confusion is worth the convenience, and it's mitigated by making this a
// dedicated method (that we can give a good name and docs to), rather than
// abusing the main `AsyncResult` "constructor".
AsyncResult.fromFunc = <T, E = never>(arg: () => ResultPromisable<T, E>) =>
  AsyncResult(arg());

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

/**
 * Returns an AsyncResult that resolves with an array of the results of the
 * given AsyncResults, if all were successful. If any of the AsyncResults
 * rejected, the returned AsyncResult is in a rejected state with the first
 * rejection. If there were no rejections but one or more AsyncResults were
 * Errs, the AsyncResult is an AsyncResult holding the first Err.
 */
AsyncResult.all = <T extends [] | AsyncResult<any, any>[]>(
  asyncResults: T
): AsyncResult<AsyncOkTypes<T>, AsyncErrTypes<T>[number]> => {
  return AsyncResult(
    Promise.all(asyncResults.map((it) => it.resultPromise)).then(
      (resultValues) => {
        // nothing rejected, but we still might have some Errs.
        const firstError = resultValues.find((it) => !it.data.isOk);
        if (firstError) {
          return Err(firstError.data.value);
        }
        return Ok(
          resultValues.map((it) => it.data.value) as unknown as AsyncOkTypes<T>
        );
      }
    )
  );
};

AsyncResult.allSettled = <T extends [] | AsyncResult<any, any>[]>(
  asyncResults: T
): AsyncResult<
  {
    [K in keyof T]:
      | { type: "ok"; value: AsyncOkType<T[K]> }
      | { type: "err"; value: AsyncErrType<T[K]> }
      | { type: "rejection"; value: unknown };
  },
  never
> => {
  return AsyncResult<any, never>(
    Promise.allSettled(asyncResults.map((it) => it.resultPromise)).then(
      (settledResults) =>
        // NB: resultPromise is supposed to never reject (instead, there should
        // be an error inside the Result), so we can safely cast here.
        settledResults.map((it) =>
          it.status === "fulfilled"
            ? {
                type: it.value.data.isOk ? "ok" : "err",
                value: it.value.data.value,
              }
            : { type: "rejection", value: it.reason }
        )
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
          const { value, done } = gen.next(v);

          if (done) {
            return toResultPromise(value);
          }

          return AsyncResult(toResultPromise(value)).then_(
            (value) => andThen(value),
            (err) =>
              AsyncResult(Err(err)).finally_(() => {
                return gen.return?.(err as any) as any;
              }),
            (err) =>
              AsyncResult(Promise.reject(err)).finally_(() => {
                return gen.return?.(err as any) as any;
              })
          );
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

// NB: The order of items in this union effects type inference!
// Leave the more specific ones first.
type ResultPromisable<T, E = never> =
  | Promise<
      | T
      | Result<T, E>
      | AsyncResult<T, E>
      | AsyncResult<never, E>
      | Result<never, E>
    >
  | AsyncResult<T, E>
  | Result<T, E>
  | AsyncResult<never, E>
  | Result<never, E>
  | T;

async function toResultPromise<T, E = never>(
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
