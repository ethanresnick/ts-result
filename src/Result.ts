import type { NonEmptyArray, UnionToIntersection } from "./utils.js";

/**
 * @fileoverview This file defines a `Result` type, which can be used to make
 * callers aware of error cases that would otherwise be untracked by the
 * compiler. Specifically, instead of throwing an exception, code can return a
 * Result value. `Result` uses a type parameter to track the type of the success
 * value _and_ one to track the type of any error values.
 *
 * This Result type deviates considerably from the standard, monadic
 * implementations seen in functional languages, with three goals:
 *
 * 1. **Lower the barrier to entry for people to use this type**. To that end,
 *    the methods on `Result` follow the conventions of the Promise API, in
 *    which `then` merges together the `map` and `chain` methods that would be
 *    found in a strict monadic implementation. This is definitely more familiar
 *    and arguably simpler, so we follow it in `Result`. For the same reason,
 *    more esoteric functional programming methods like `bimap` are omitted.
 *
 * 2. **Adapt to the particular nature of JS/TS**. The type signatures of
 *    `then_` and `catch_` have been adapted (by allowing the second type
 *    parameter to vary) to take advantage of TS's fundamentally set-based type
 *    system and allow our code to be more dynamic than would be possible in the
 *    type systems of most languages that have a `Result`.
 *
 * 3. **Have a story for async**. A promise is almost already an AsyncResult,
 *    except that the errors aren't typed and, if something rejects, there's no
 *    way to force-capture that and record it as an untyped error.
 */

export type Result<T, E> = _Result<T, E>;
export type Ok<T> = Result<T, never>;
export type Err<E> = Result<never, E>;

type ResultData<T, E> = { isOk: true; value: T } | { isOk: false; value: E };

/**
 * The Result type.
 *
 * Some notes:
 *
 * - We don't constrain `E extends Error`, because sometimes we want to
 *   construct Result with `never` as the Error type (e.g., when we're
 *   constructing an `Ok`). However, the `Err()` constructor exported from this
 *   file _does_ constrain its argument to be an `Error`, which feels like a
 *   nice sanity check given that these values can get thrown by `valueOrThrow`.
 *
 * - Some implementations of Result in TS use a separate class for Err and Ok,
 *   with `Result<T, E>` defined as `Ok<T> | Err<E>`. Both `Err` and `Ok` then
 *   have an `isOk` property, and consumers of a `Result` can check `isOk`,
 *   which TS will use to discriminate/narrow whether the branch is dealing with
 *   an Ok or Err. This seemed to confuse type inference and some assignability
 *   checks in certain use cases, though, so we use a single class for both Ok
 *   and Err, and then allow consumers to narrow by checking `result.data.isOk`,
 *   which discriminates the type of `result.data.value`.
 */
export class _Result<T, E> {
  constructor(public readonly data: ResultData<T, E>) {}

  /**
   * See {@link Result.run}.
   *
   * You generally should not be trying to iterate Result objects. If you do,
   * the iterator will return the Result itself once, and then terminate.
   *
   * NB: the type signature is a bit of a lie, as the `TReturn` type here
   * shouldn't always be `T`; the type at runtime will be the type of the value
   * passed as the argument `next()` on the second iteration.
   *
   * @internal
   */
  *[Symbol.iterator](): Iterator<Result<T, E>, T, any> {
    const self = this as Result<T, E>;
    return yield self;
  }

  valueOrFallback<U>(getFallback: (e: E) => U): T | U {
    return this.data.isOk ? this.data.value : getFallback(this.data.value);
  }

  valueOrThrow(): T {
    if (this.data.isOk) {
      return this.data.value;
    } else {
      throw this.data.value;
    }
  }

  /**
   * Supports chaining together Result-returning functions. This is very
   * analogous to Promise.prototype.then().
   *
   * If the Result is an Ok, the value in the Result is run through the first
   * callback, if any; if the Result is an Err, its error is run through the
   * second callback or, if no callback is given, a copy of the existing Result
   * is returned as-is. The callbacks can return a Result or a plain value,
   * which will be wrapped in `Ok()`, also like Promise.prototype.then().
   */
  then_<T2, E2 = never>(
    okCb: (arg: T) => T2 | Result<T2, E2>,
    errCb?: (arg: E) => T2 | Result<T2, E2>
  ): Result<T2, E | E2> {
    return this.data.isOk
      ? toResult(okCb(this.data.value))
      : typeof errCb === "function"
      ? toResult(errCb(this.data.value))
      : toResult(this satisfies Result<T, E> as unknown as Result<T2, E>);
  }

  thenChain<T2, E2 = never>(
    cb1: (arg: T, history: []) => T2 | Result<T2, E2>
  ): Result<T2, E | E2>;
  thenChain<T2, T3, E2 = never, E3 = never>(
    cb1: (arg: T, history: []) => T2 | Result<T2, E2>,
    cb2: (arg: T2, history: [T]) => T3 | Result<T3, E3>
  ): Result<T3, E | E2 | E3>;
  thenChain<T2, T3, T4, E2 = never, E3 = never, E4 = never>(
    cb1: (arg: T, history: []) => T2 | Result<T2, E2>,
    cb2: (arg: T2, history: [T]) => T3 | Result<T3, E3>,
    cb3: (arg: T3, history: [T, T2]) => T4 | Result<T4, E4>
  ): Result<T4, E | E2 | E3 | E4>;
  thenChain<T2, T3, T4, T5, E2 = never, E3 = never, E4 = never, E5 = never>(
    cb1: (arg: T, history: []) => T2 | Result<T2, E2>,
    cb2: (arg: T2, history: [T]) => T3 | Result<T3, E3>,
    cb3: (arg: T3, history: [T, T2]) => T4 | Result<T4, E4>,
    cb4: (arg: T4, history: [T, T2, T3]) => T5 | Result<T5, E5>
  ): Result<T5, E | E2 | E3 | E4 | E5>;
  thenChain<
    T2,
    T3,
    T4,
    T5,
    T6,
    E2 = never,
    E3 = never,
    E4 = never,
    E5 = never,
    E6 = never
  >(
    cb1: (arg: T, history: []) => T2 | Result<T2, E2>,
    cb2: (arg: T2, history: [T]) => T3 | Result<T3, E3>,
    cb3: (arg: T3, history: [T, T2]) => T4 | Result<T4, E4>,
    cb4: (arg: T4, history: [T, T2, T3]) => T5 | Result<T5, E5>,
    cb5: (arg: T5, history: [T, T2, T3, T4]) => T6 | Result<T6, E6>
  ): Result<T6, E | E2 | E3 | E4 | E5 | E6>;
  thenChain<
    T2,
    T3,
    T4,
    T5,
    T6,
    T7,
    E2 = never,
    E3 = never,
    E4 = never,
    E5 = never,
    E6 = never,
    E7 = never
  >(
    cb1: (arg: T, history: []) => T2 | Result<T2, E2>,
    cb2: (arg: T2, history: [T]) => T3 | Result<T3, E3>,
    cb3: (arg: T3, history: [T, T2]) => T4 | Result<T4, E4>,
    cb4: (arg: T4, history: [T, T2, T3]) => T5 | Result<T5, E5>,
    cb5: (arg: T5, history: [T, T2, T3, T4]) => T6 | Result<T6, E6>,
    cb6: (arg: T6, history: [T, T2, T3, T4, T5]) => T7 | Result<T7, E7>
  ): Result<T7, E | E2 | E3 | E4 | E5 | E6 | E7>;
  thenChain<
    T2,
    T3,
    T4,
    T5,
    T6,
    T7,
    T8,
    E2 = never,
    E3 = never,
    E4 = never,
    E5 = never,
    E6 = never,
    E7 = never,
    E8 = never
  >(
    cb1: (arg: T, history: []) => T2 | Result<T2, E2>,
    cb2: (arg: T2, history: [T]) => T3 | Result<T3, E3>,
    cb3: (arg: T3, history: [T, T2]) => T4 | Result<T4, E4>,
    cb4: (arg: T4, history: [T, T2, T3]) => T5 | Result<T5, E5>,
    cb5: (arg: T5, history: [T, T2, T3, T4]) => T6 | Result<T6, E6>,
    cb6: (arg: T6, history: [T, T2, T3, T4, T5]) => T7 | Result<T7, E7>,
    cb7: (arg: T7, history: [T, T2, T3, T4, T5, T6]) => T8 | Result<T8, E8>
  ): Result<T8, E | E2 | E3 | E4 | E5 | E6 | E7 | E8>;
  thenChain(...cbs: ((arg: any, history: any) => any)[]): Result<any, any> {
    const history: any[] = [];
    return cbs.reduce<Result<any, any>>((result, cb) => {
      return result.then_((arg) => {
        const currentHistory = [...history];
        history.push(arg);
        return cb(arg, currentHistory);
      });
    }, this);
  }

  /**
   * Analogous to Promise.prototype.catch(), this supports "recovering" from an
   * error, or transforming it into a new error, by taking the error value in
   * the existing Result (if the result is an Err) and passing it to the given
   * callback, which can return a new Result or a value to be wrapped in Ok.
   *
   * If the current Result was Ok, the callback is not called and a copy of the
   * existing Result is returned as-is.
   *
   * NB: if the callback returns a non-Result value, the value will be wrapped
   * in Ok -- not an `Err`, which you might expect if `catch_` were simply
   * combining `mapErr` and `bindErr`. This, again, follows the Promise API.
   */
  catch_<T2, E2 = never>(
    cb: (arg: E) => T2 | Result<T2, E2>
  ): Result<T | T2, E2> {
    return this.data.isOk
      ? toResult(this satisfies Result<T, E> as unknown as Result<T, E2>)
      : toResult(cb(this.data.value));
  }

  /**
   * Like `catch_`, but the callback is only called if the error is an instance
   * of the given class.
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
    type: { new (): UnionToIntersection<ToCatch> },
    cb: (arg: ToCatch) => T2 | Result<T2, E2>
  ): Result<T | T2, Exclude<E, ToCatch> | E2> {
    return this.catch_<T | T2, E2 | Exclude<E, ToCatch>>((error) => {
      return error instanceof type
        ? cb(error)
        : (this satisfies Result<T, E> as Result<T, Exclude<E, ToCatch>>);
    });
  }

  /**
   * Follows Promise.prototype.finally(), in that the callback is called
   * regardless of whether the Result is an Ok or an Err; but, the returned
   * result has the same result as the original, regardless of what the callback
   * returned, unless the callback returns a new Err.
   */
  finally_<E2 = never>(cb: () => void | Result<never, E2>): Result<T, E | E2> {
    const fn = () => {
      const newResult = cb();
      return isResult(newResult) && !newResult.data.isOk ? newResult : this;
    };

    return this.then_<T, E | E2>(fn, fn);
  }
}

export function isResult(it: unknown): it is Result<unknown, unknown> {
  return it instanceof _Result;
}

function toResult<T, E = never>(it: T | Result<T, E>): Result<T, E> {
  return isResult(it) ? new _Result<T, E>({ ...it.data }) : Ok(it);
}

export function Ok<O>(arg: O) {
  return new _Result<O, never>({ isOk: true, value: arg });
}

export function Err<E extends Error>(error: E) {
  return new _Result<never, E>({ isOk: false, value: error });
}

type OkType<T> = T extends Result<infer U, any> ? U : never;
type ErrType<T> = T extends Result<any, infer U> ? U : never;

// Takes T, a tuple or array of Result types,
// and returns a tuple or array with  all those results' Ok types.
type OkTypes<T extends Result<any, any>[]> = { [K in keyof T]: OkType<T[K]> };

// Takes T, a tuple or array of Result types,
// and returns a tuple or array with all those results' Err types.
type ErrTypes<T extends Result<any, any>[]> = { [K in keyof T]: ErrType<T[K]> };

export const Result = {
  all<T extends [] | Result<any, any>[]>(
    results: T
  ): Result<OkTypes<T>, ErrTypes<T>[number]> {
    const okValues: unknown[] = [];
    for (const result of results) {
      if (result.data.isOk) {
        okValues.push(result.data.value);
      } else {
        return result as Err<ErrTypes<T>[number]>;
      }
    }

    return Ok(okValues as OkTypes<T>);
  },

  any<T extends [] | Result<any, any>[]>(
    results: T
  ): Result<OkTypes<T>[number], AggregateError & { errors: ErrTypes<T>[] }> {
    const errValues: ErrTypes<T>[] = [];
    for (const result of results) {
      if (result.data.isOk) {
        return result satisfies Result<any, any> as Ok<OkTypes<T>[number]>;
      } else {
        errValues.push(result.data.value satisfies any as ErrTypes<T>[number]);
      }
    }

    return Err(new AggregateError(errValues));
  },

  compose: c,

  /**
   * Simplifies working with a chain of results, by hiding the unwrapping at
   * each step while the Result is an Ok, and short-circuiting the computation
   * once the Result becomes an Err.
   *
   * @example
   * ```
   * // without Result.run, worst case
   * function getUser() {
   *   getFirstNameResult().then_((firstName) => {
   *     return getLastNameResult().then_((lastName) => {
   *       return { firstName, lastName };
   *     });
   *   });
   * });
   *
   * // with Result.all, somewhat better
   * function getUser() {
   *   return Result.all([getFirstNameResult(), getLastNameResult()])
   *     .then_(([firstName, lastName]) => {
   *       return { firstName, lastName };
   *     });
   * }
   *
   * // with Result.run
   * function getUser() {
   *   return Result.run(function* () {
   *     const firstName = yield* getFirstNameResult();
   *     const lastName = yield* getLastNameResult();
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
  run<Yields extends Result<any, any>, U>(
    fn: () => Generator<Yields, U, any>
  ): Result<U, ErrType<Yields>> {
    // Here's what's going on here...
    //
    // Result.run() initialize the generator by calling fn(), and then it's
    // gonna "run" that generator. The standard pattern here would be to run the
    // generator to each of its yield points (by calling `next()` repeatedly);
    // each time we'd get back a yielded Result and, if it's an Ok, we'd unwrap
    // it and resume the generator with the unwrapped value (by calling
    // `next(unwrapped)`).
    //
    // However, there's a major limitation with TS which means that, if we used
    // this standard approach, the type of the `yield` expression inside the
    // body of `fn` would be `any`, as TS doesn't know what value we're gonna
    // inject back in at that point. See
    // https://github.com/microsoft/TypeScript/issues/43632
    //
    // So, what we do instead is a bit of a hack:
    //
    // 1. We rely on the fact that, when `yield* X` occurs in a generator's
    //    body, the type of that expression is _the `TReturn` type of
    //    `X[Symbol.iterator]()`. I.e., an iterator is created for X, and its
    //    final value (the one yielded with `done: true`) is used as the value
    //    for the whole `yield*`. Because each `yield*` gets its own iterator,
    //    and because this iterator has a type parameter for its final, `done:
    //    true` value (`TReturn`), we can use this to get great typing in the
    //    generator body.
    //
    // 2. Then, since `yield*` will actuallly call `[Symbol.iterator]()` on the
    //    Result at runtime (which is unfortunate performance overhead), we have
    //    to give that iterator a coherent definition. We define it to first
    //    yield the `Result` object itself (with `done: false`) and then
    //    complete (return, using `done: true`) with the value passed to the
    //    iterator's next `next()` call. With this setup, the generator runner
    //    (i.e., `Result.run`) will get back the `Result` object -- since it's
    //    yielded from the iterator -- and therefore TS will use the type of
    //    what the iterator yields (which is the appropriate Result type) as
    //    part of intfering what the generator yields (i.e., this makes `Yields`
    //    inferred correctly from all the `yield*`s in the generator's body).
    //    Then, the generator runner will call `next()` on _the generator_ with
    //    the unwrapped value (if it's an `Ok`), and then (by the semantics of
    //    `yield*`) that unwrapped value gets passed in to the Result iterator's
    //    `next()`, which then returns it `done: true`, so it shows up in the
    //    generator body as the value of the `yield*`.
    const gen = fn();
    let done: boolean = false;
    let returnResult: any = Ok(undefined);

    while (!done) {
      returnResult = returnResult.then_((v: any) => {
        const { value, done: done_ = false } = gen.next(v);
        if (isResult(value) && !value.data.isOk) {
          done = true;
          // Let the generator do its cleanup, since we're
          // manually bailing early.
          gen.return?.(value as any);
        } else {
          done = done_;
        }
        // Return the yielded `Result`. If we're not done yet, the value in
        // this will be unpacked on the next iteration of the loop and passed
        // back into the generator (where it'll reach the Result's interator
        // per above and make it `return`, filling in the value of the
        // `yield*` and continuing the generator).
        return value as any;
      });
    }
    return returnResult;
  },
};

function c<T, U, V, W, X, Y, Z>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>
): (v: T) => Result<W, X>;
function c<T, U, V, W, X, Y, Z>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>
): (v: T) => Result<Y, Z>;
function c<T, U, V, W, X, Y, Z, A, B>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>
): (v: T) => Result<A, B>;
function c<T, U, V, W, X, Y, Z, A, B, C, D>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>,
  f4: (v: A) => Result<C, D>
): (v: T) => Result<C, D>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>,
  f4: (v: A) => Result<C, D>,
  f5: (v: C) => Result<E, F>
): (v: T) => Result<E, F>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>,
  f4: (v: A) => Result<C, D>,
  f5: (v: C) => Result<E, F>,
  f6: (v: E) => Result<G, H>
): (v: T) => Result<G, H>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>,
  f4: (v: A) => Result<C, D>,
  f5: (v: C) => Result<E, F>,
  f6: (v: E) => Result<G, H>,
  f7: (v: G) => Result<I, J>
): (v: T) => Result<I, J>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J, K, L>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>,
  f4: (v: A) => Result<C, D>,
  f5: (v: C) => Result<E, F>,
  f6: (v: E) => Result<G, H>,
  f7: (v: G) => Result<I, J>,
  f8: (v: I) => Result<K, L>
): (v: T) => Result<K, L>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J, K, L, M, N>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>,
  f4: (v: A) => Result<C, D>,
  f5: (v: C) => Result<E, F>,
  f6: (v: E) => Result<G, H>,
  f7: (v: G) => Result<I, J>,
  f8: (v: I) => Result<K, L>,
  f9: (v: K) => Result<M, N>
): (v: T) => Result<M, N>;
function c<T, U, V, W, X, Y, Z, A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P>(
  f0: (v: T) => Result<U, V>,
  f1: (v: U) => Result<W, X>,
  f2: (v: W) => Result<Y, Z>,
  f3: (v: Y) => Result<A, B>,
  f4: (v: A) => Result<C, D>,
  f5: (v: C) => Result<E, F>,
  f6: (v: E) => Result<G, H>,
  f7: (v: G) => Result<I, J>,
  f8: (v: I) => Result<K, L>,
  f9: (v: K) => Result<M, N>,
  f10: (v: M) => Result<O, P>
): (v: T) => Result<O, P>;
function c(...fns: NonEmptyArray<(v: any) => Result<any, any>>) {
  return (v: any) => {
    const [fn, ...restFns] = fns;
    let result = fn(v);
    for (const fn of restFns) {
      result = result.then_(fn);
    }
    return result;
  };
}
