import { describe, it, mock } from "node:test";
import { setTimeout } from "node:timers/promises";
import { Ok, Err, ErrUnchecked, Result } from "./Result.js";
import { AsyncResult } from "./AsyncResult.js";
import assert from "node:assert";
import {
  isCheckedErrorHolder,
  makeCheckedErrorHolder,
  makeUncheckedErrorHolder,
} from "./ErrorHolder.js";

class CustomError extends Error {
  public override readonly name = "CustomError";
}
class AnotherError extends Error {
  public override readonly name = "AnotherError";
}

describe("AsyncResult", () => {
  describe("creation", () => {
    it("should accept a Promise<T> as an Ok value", async () => {
      const result = AsyncResult(Promise.resolve(42));
      assert.strictEqual(await result.valueOrThrow(), 42);
    });

    it("should accept a Promise<Result<T, E>>", async () => {
      const result = AsyncResult(Promise.resolve(Ok(42)));
      assert.strictEqual(await result.valueOrThrow(), 42);

      const err = new Error("Hi");
      const result2 = AsyncResult(Promise.resolve(Err(err)));
      await result2.valueOrThrow().catch((e) => assert.strictEqual(e, err));
    });

    it("should accept a Promise<AsyncResult<T, E>>", async () => {
      const result = AsyncResult(
        Promise.resolve(AsyncResult(Promise.resolve(42)))
      );
      assert.strictEqual(await result.valueOrThrow(), 42);
    });

    it("should treat promise rejections as an unchecked Err", async () => {
      const err = new Error("Hi");
      const fallbackFn = mock.fn((_errorHolder) => "fallback value");
      const result = AsyncResult(Promise.reject(err));

      await result.valueOrFallback(fallbackFn);

      assert.strictEqual(fallbackFn.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallbackFn.mock.calls[0]?.arguments[0],
        makeUncheckedErrorHolder(err)
      );
    });
  });

  describe("valueOrFallback", () => {
    it("should return the value if the result is Ok", async () => {
      const result = AsyncResult(Promise.resolve(42));
      const fallback = mock.fn(() => "fallback value");
      const value = await result.valueOrFallback(fallback);
      assert.strictEqual(value, 42);
      assert.strictEqual(fallback.mock.callCount(), 0);
    });

    it("should use the fallback fn if the result is a checked Err", async () => {
      const fallback = mock.fn((_e) => "fallback value");

      const error = new Error("Something went wrong");
      const result = AsyncResult(Promise.resolve(Err(error)));

      const value = await result.valueOrFallback(fallback);

      assert.strictEqual(value, "fallback value");
      assert.strictEqual(fallback.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallback.mock.calls[0]?.arguments[0],
        makeCheckedErrorHolder(error)
      );
    });

    it("should use the fallback fn if the result is an unchecked Err", async () => {
      const fallback = mock.fn((_e) => 42);

      const error = new Error("Something went wrong");
      const result = AsyncResult(Promise.resolve(Ok(34))).then_((_it) => {
        throw error;
      });

      const value = await result.valueOrFallback(fallback);

      assert.strictEqual(value, 42);
      assert.strictEqual(fallback.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallback.mock.calls[0]?.arguments[0],
        makeUncheckedErrorHolder(error)
      );
    });
  });

  describe("valueOrThrow", () => {
    it("should return the value if the result is Ok", async () => {
      const result = AsyncResult(Promise.resolve(42));
      assert.equal(await result.valueOrThrow(), 42);
    });

    it("should throw an error if the result is a checked Err", async () => {
      const error = new Error("Something went wrong");
      const result = AsyncResult(Err(error));
      assert.rejects(() => result.valueOrThrow(), error);
    });

    it("should throw an error if the result is an unchecked Err", async () => {
      const error = new Error("Something went wrong");
      const result = AsyncResult(Ok(34)).then_((_it) => {
        throw error;
      });
      assert.rejects(() => result.valueOrThrow(), error);
    });
  });

  describe("then_", () => {
    it("if the result is Err, should return the existing Result as-is and not call callback", async () => {
      const error = new Error("Something went wrong");
      const cb = mock.fn((value) => value * 2);
      const mappedResult = AsyncResult(Promise.resolve(Err(error))).then_(cb);

      const fallbackCb = mock.fn((_errorHolder) => "fallback value");
      await mappedResult.valueOrFallback(fallbackCb);

      assert.strictEqual(cb.mock.callCount(), 0);
      assert.strictEqual(fallbackCb.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallbackCb.mock.calls[0]?.arguments[0],
        makeCheckedErrorHolder(error)
      );
    });

    it("if the result is Ok, should work as map() and return a new Result with the mapped value", async () => {
      const mappedResult = AsyncResult(42).then_((value) => value * 2);
      assert.deepEqual(await mappedResult.valueOrThrow(), 84);
    });

    it("if the result is Ok, should work as chain() and return a new Result with the returned value", async () => {
      const result = AsyncResult(Promise.resolve(Ok(42)));
      const err = new Error("hi");

      const mappedResult = result.then_((value) => Ok(value * 2));
      const mappedResult2 = result.then_((_value) => Err(err));

      assert.deepEqual(await mappedResult.valueOrThrow(), 84);
      await mappedResult2.valueOrThrow().then(
        () => {
          throw new Error("should've rejected!");
        },
        (e) => {
          assert.deepEqual(e, err);
        }
      );
    });

    it("should create a Result of UncheckedErr if the callback throws an error", async () => {
      const error = new Error("Something went wrong");
      const mappedResult = AsyncResult(Promise.resolve(Ok(42))).then_((_) => {
        throw error;
      });

      const fallbackCb = mock.fn((_errorHolder) => "fallback value");
      await mappedResult.valueOrFallback(fallbackCb);

      assert.strictEqual(fallbackCb.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallbackCb.mock.calls[0]?.arguments[0],
        makeUncheckedErrorHolder(error)
      );
    });
  });

  describe("catch_", () => {
    it("if the result is Ok, should return the existing Result as-is and not call callback", async () => {
      const result = AsyncResult(Promise.resolve(Ok(42)));
      const cb = mock.fn((error) => error.error);
      const mappedResult = result.catch_(cb);
      assert.deepEqual(await mappedResult.valueOrThrow(), 42);
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is Err, should follow promise catch() and produce an Ok() from the return value", async () => {
      const error = new Error("Something went wrong");

      // even though this return value was an Error object, it becomes an Ok
      const mappedResult1 = AsyncResult(Promise.resolve(Err(error))).catch_(
        (error) => error.error
      );
      const mappedResult2 = AsyncResult(Promise.resolve(Err(error))).catch_(
        (_error) => 42
      );

      assert.deepEqual(await mappedResult1.valueOrThrow(), error);
      assert.deepEqual(await mappedResult2.valueOrThrow(), 42);
    });

    it("if the result is Err, should work as chain() and return a new Result with the returned value", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      const mappedResult = AsyncResult(Promise.resolve(Err(error))).catch_(
        (_error) => Err(error2)
      );
      const mappedResult2 = AsyncResult(Promise.resolve(Err(error))).catch_(
        (_error) => Ok(42)
      );

      assert.deepEqual(
        await mappedResult.valueOrThrow().then(
          () => {
            throw new Error("should've rejected!");
          },
          (e) => e
        ),
        error2
      );
      assert.deepEqual(await mappedResult2.valueOrThrow(), 42);
    });

    it("should create a Result of UncheckedErr if the callback throws an error", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");
      const mappedResult = AsyncResult(Promise.resolve(Err(error))).catch_(
        (_error) => {
          throw error2;
        }
      );

      const fallbackCb = mock.fn((_errorHolder) => "fallback value");
      await mappedResult.valueOrFallback(fallbackCb);
      assert.strictEqual(fallbackCb.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallbackCb.mock.calls[0]?.arguments[0],
        makeUncheckedErrorHolder(error2)
      );
    });

    it("should pass the callback the correct ErrorHolder", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      const mappedResult = AsyncResult(Promise.resolve(Err(error))).catch_(
        (error_) => {
          assert.deepStrictEqual(error_, makeCheckedErrorHolder(error));
          return error_.error;
        }
      );
      assert.deepEqual(await mappedResult.valueOrThrow(), error);

      const mappedResult2 = AsyncResult(Promise.resolve(Err(error)))
        .catch_((_e) => {
          throw error2;
        })
        .catch_((error_) => {
          assert.deepStrictEqual(error_, makeUncheckedErrorHolder(error2));
          return error2;
        });

      assert.deepEqual(await mappedResult2.valueOrThrow(), error2);
    });
  });

  describe("catchKnown", () => {
    it("if the result is Ok, should return the existing Result as-is and not call callback", async () => {
      const result = AsyncResult(Promise.resolve(Ok(42)));
      const cb = mock.fn((error) => error.error);

      const mappedResult = result.catchKnown(cb);

      assert.deepEqual(await mappedResult.valueOrThrow(), 42);
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is an unchecked Err, should return the existing Result as-is and not call callback", async () => {
      const error = new Error("Something went wrong");
      const fallbackCb = mock.fn((_errorHolder) => "fallback value");
      const cb = mock.fn(() => new Error("shouldn't be called"));

      await AsyncResult(Promise.resolve(Ok(34)))
        .then_((_it) => {
          throw error;
        })
        .catchKnown(cb)
        .valueOrFallback(fallbackCb);

      assert.strictEqual(cb.mock.callCount(), 0);

      // tests that the Result returned by catchKnown(),
      // which valueOrFallback(), is called on, is an unchecked Err Result.
      assert.strictEqual(fallbackCb.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallbackCb.mock.calls[0]?.arguments[0],
        makeUncheckedErrorHolder(error)
      );
    });

    it("if the result is a known Err, should follow promise catch() and produce an Ok() from the return value", async () => {
      const error = new Error("Something went wrong");
      const cb = mock.fn((error) => error);

      // even though this return value was an Error object, it becomes an Ok
      const mappedResult1 = AsyncResult(Promise.resolve(Err(error))).catchKnown(
        cb
      );
      const mappedResult2 = AsyncResult(Promise.resolve(Err(error))).catchKnown(
        (_error) => 42
      );

      assert.deepEqual(await mappedResult1.valueOrThrow(), error);
      assert.deepEqual(await mappedResult2.valueOrThrow(), 42);

      assert.strictEqual(cb.mock.callCount(), 1);
      assert.deepStrictEqual(cb.mock.calls[0]?.arguments[0], error);
    });

    it("if the result is a known Err, should work as chain() and return a new Result with the returned value", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      const mappedResult = AsyncResult(Promise.resolve(Err(error))).catchKnown(
        (_error) => Err(error2)
      );
      const mappedResult2 = AsyncResult(Promise.resolve(Err(error))).catchKnown(
        (_error) => Ok(42)
      );

      assert.deepStrictEqual(
        await mappedResult.valueOrFallback((it) => it),
        makeCheckedErrorHolder(error2)
      );
      assert.deepEqual(await mappedResult2.valueOrThrow(), 42);
    });

    it("should create a Result of UncheckedErr if the callback throws an error", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");
      const mappedResult = AsyncResult(Promise.resolve(Err(error))).catchKnown(
        (_error) => {
          throw error2;
        }
      );

      const fallbackCb = mock.fn((_errorHolder) => "fallback value");
      await mappedResult.valueOrFallback(fallbackCb);
      assert.strictEqual(fallbackCb.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallbackCb.mock.calls[0]?.arguments[0],
        makeUncheckedErrorHolder(error2)
      );
    });
  });

  describe("catchKnownInstanceOf", () => {
    it("if the result is Err of the specified type, should call the callback correctly", async () => {
      const result = await AsyncResult(
        Promise.resolve(Err(new CustomError("Something went wrong")))
      )
        .catchKnownInstanceOf(CustomError, (e) => Ok(e.message))
        .valueOrThrow();

      const result2 = await AsyncResult(
        Promise.resolve(Err(new CustomError("Something went wrong")))
      )
        .catchKnownInstanceOf(CustomError, (e) => e.message)
        .valueOrThrow();

      const result3 = await AsyncResult(
        Promise.resolve(Err(new CustomError("Something went wrong")))
      )
        .catchKnownInstanceOf(CustomError, () =>
          Err(new CustomError("new message"))
        )
        .valueOrFallback((it) => it);

      assert.deepStrictEqual(result, "Something went wrong");
      assert.deepStrictEqual(result2, "Something went wrong");
      assert.deepStrictEqual(
        result3,
        makeCheckedErrorHolder(new CustomError("new message"))
      );
    });

    it("if the result is Err of a different type, should return the original error", async () => {
      const fallbackFn = mock.fn((e) => Ok(e.message));

      const result = await AsyncResult(Promise.resolve(Err(new AnotherError())))
        .catchKnownInstanceOf(CustomError, fallbackFn)
        .valueOrFallback((it) => it);

      const result2 = await AsyncResult<never, CustomError>(
        ErrUnchecked(new Error())
      )
        .catchKnownInstanceOf(CustomError, fallbackFn)
        .valueOrFallback((it) => it);

      assert.deepEqual(result, makeCheckedErrorHolder(new AnotherError()));
      assert.deepEqual(result2, makeUncheckedErrorHolder(new Error()));
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });

    it("if the result is ErrUnchecked of the specified type, should not use the callback", async () => {
      const result = await AsyncResult<never, CustomError>(
        Promise.reject(new CustomError("Something went wrong"))
      )
        .catchKnownInstanceOf(CustomError, (e) => Ok(e.message))
        .valueOrFallback((it) => it);

      assert.deepStrictEqual(
        result,
        makeUncheckedErrorHolder(new CustomError("Something went wrong"))
      );
    });

    it("if the result is Ok, should return the original result", async () => {
      const fallbackFn = mock.fn((e) => Ok(e.message));

      const result = await AsyncResult(Promise.resolve(new CustomError()))
        .catchKnownInstanceOf(CustomError as any, fallbackFn)
        .valueOrThrow();

      assert.deepStrictEqual(result, new CustomError());
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });
  });

  describe("finally_", () => {
    it("should always call the callback function and return an equivalent result if it doesn't produce an error", async () => {
      const err = new CustomError("hello");
      const initialResults = [
        [AsyncResult(Promise.resolve(42)), 42],
        [AsyncResult(Promise.resolve(Err(err))), makeCheckedErrorHolder(err)],
        [AsyncResult(Promise.reject(err)), makeUncheckedErrorHolder(err)],
      ] as const;

      const finallyNonErrorReturnValues = [
        84,
        Ok(84),
        AsyncResult(Promise.resolve(84)),
        Promise.resolve(84),
        Promise.resolve(Ok(84)),
        Promise.resolve(AsyncResult(Promise.resolve(84))),
      ];

      for (const [result, expectedFinalResult] of initialResults) {
        for (const returnValue of finallyNonErrorReturnValues) {
          const finallyCb = mock.fn(() => returnValue as any);

          assert.deepStrictEqual(
            await result.finally_(finallyCb).valueOrFallback((it) => it),
            expectedFinalResult
          );
          assert.strictEqual(finallyCb.mock.callCount(), 1);
          assert.deepStrictEqual(finallyCb.mock.calls[0]?.arguments, []);
        }
      }
    });

    it("should call the callback function and return the new result if returns an Err", async () => {
      const initialErr = new CustomError("hello");
      const finalError = new CustomError("Another Error");
      const initialResults = [
        AsyncResult(Promise.resolve(42)),
        AsyncResult(Promise.resolve(Err(initialErr))),
        AsyncResult(Promise.reject(initialErr)),
      ] as const;

      const finallyErrorReturnValues = [
        Err(finalError),
        ErrUnchecked(finalError),
        AsyncResult(Promise.resolve(Err(finalError))),
        AsyncResult(Promise.resolve(ErrUnchecked(finalError))),
        Promise.resolve(Err(finalError)),
        Promise.resolve(ErrUnchecked(finalError)),
        Promise.resolve(AsyncResult(Promise.resolve(Err(finalError)))),
        Promise.resolve(AsyncResult(Promise.resolve(ErrUnchecked(finalError)))),
      ];

      for (const result of initialResults) {
        for (const [i, returnValue] of finallyErrorReturnValues.entries()) {
          const finallyCb = mock.fn(() => returnValue as any);

          assert.deepStrictEqual(
            await result.finally_(finallyCb).valueOrFallback((it) => it),
            i % 2 === 0
              ? makeCheckedErrorHolder(finalError)
              : makeUncheckedErrorHolder(finalError)
          );
          assert.strictEqual(finallyCb.mock.callCount(), 1);
          assert.deepStrictEqual(finallyCb.mock.calls[0]?.arguments, []);
        }
      }

      // Special check for callback throwing an error, since we don't have any
      // tests above where the callback directly rejects.
      for (const result of initialResults) {
        const finallyCb = mock.fn(async () => {
          throw finalError;
        });

        assert.deepStrictEqual(
          await result.finally_(finallyCb).valueOrFallback((it) => it),
          makeUncheckedErrorHolder(finalError)
        );
        assert.strictEqual(finallyCb.mock.callCount(), 1);
        assert.deepStrictEqual(finallyCb.mock.calls[0]?.arguments, []);
      }
    });
  });

  describe("AsyncResult.all", () => {
    it("should return an Ok AsyncResult with an array of values if all results are Ok", async () => {
      const result = await AsyncResult.all([
        AsyncResult(Promise.resolve()).then_(() => 1),
        AsyncResult(Promise.resolve()).then_(() => 2),
        AsyncResult(Promise.resolve()).then_(() => 3),
      ]).valueOrThrow();

      assert.deepEqual(result, [1, 2, 3]);
    });

    it("should return an Err/ErrUnchecked AsyncResult with the first error if any result is not Ok", async () => {
      const error = new Error("Something went wrong");
      const fallbackCb = mock.fn((it) => it);

      const result = await AsyncResult.all([
        AsyncResult(Promise.resolve(1)),
        AsyncResult(Promise.resolve(Err(error))),
        AsyncResult(Promise.reject(error)), // an unchecked error
      ]).valueOrFallback(fallbackCb);

      const result2 = await AsyncResult.all([
        AsyncResult(Promise.resolve(1)),
        AsyncResult(Promise.reject(error)), // an unchecked error
        AsyncResult(Promise.resolve(Err(new Error("hi")))),
      ]).valueOrFallback(fallbackCb);

      assert.strictEqual(fallbackCb.mock.callCount(), 2);
      assert.deepEqual(result, makeCheckedErrorHolder(error));
      assert.deepEqual(result2, makeUncheckedErrorHolder(error));
    });
  });

  describe("AsyncResult.any", () => {
    it("should return an Ok with the first Ok value to resolve if any result is Ok", async () => {
      const result = await AsyncResult.any([
        AsyncResult(Promise.reject(new Error(""))),
        AsyncResult(setTimeout(100).then((_) => Ok(100))),
        AsyncResult(setTimeout(30).then((_) => Ok(3))),
      ]).valueOrThrow();

      // Even though the second result is earlier in the list, the third
      // result's value should be returned since it resolved first.
      assert.deepEqual(result, 3);
    });

    it("should return an Err with an AggregateError of error holders if all results are not Ok", async () => {
      const error = new Error("Something went wrong");
      const result = await AsyncResult.any([
        AsyncResult(Promise.resolve(Err(error))),
        AsyncResult(Promise.reject<never>(error)),
      ]).valueOrFallback((it) => it);

      const expectedErrors = [
        makeCheckedErrorHolder(error),
        makeUncheckedErrorHolder(error),
      ];

      assert.ok(isCheckedErrorHolder(result));
      assert.ok(result.error instanceof AggregateError);
      assert.deepStrictEqual((result.error as any).errors, expectedErrors);
    });
  });

  describe("AsyncResult.allSettled", () => {
    it("should return Results for all given AsyncResults", async () => {
      const err = new Error("hi");
      const result = await AsyncResult.allSettled([
        AsyncResult(Promise.resolve(1)),
        AsyncResult(Promise.resolve(Err(err))),
        AsyncResult(Promise.reject(err)),
      ]).valueOrThrow();

      assert.deepEqual(result, [Ok(1), Err(err), ErrUnchecked(err)]);
    });
  });

  describe("AsyncResult.race", () => {
    it("should return the first result to settle", async () => {
      const result = await AsyncResult.race([
        AsyncResult(setTimeout(10).then<number, never>((_) => 1)),
        AsyncResult(setTimeout(0).then<string, never>((_) => "2")),
        AsyncResult(setTimeout(500).then<boolean, never>((_) => true)),
      ]).valueOrThrow();

      const result2 = await AsyncResult.race([
        AsyncResult<number, never>(setTimeout(10).then((_) => 1)),
        AsyncResult<never, never>(
          setTimeout(0).then((_) => Promise.reject("2"))
        ),
        AsyncResult<boolean, never>(setTimeout(500).then((_) => true)),
      ]).valueOrFallback((it) => it);

      const result3 = await AsyncResult.race([
        AsyncResult<number, never>(setTimeout(10).then((_) => 1)),
        AsyncResult<never, Error>(
          setTimeout(0).then((_) => Err(new Error("2")))
        ),
        AsyncResult<boolean, never>(setTimeout(500).then((_) => true)),
      ]).valueOrFallback((it) => it);

      assert.deepStrictEqual(result, "2");
      assert.deepStrictEqual(result2, makeUncheckedErrorHolder("2"));
      assert.deepStrictEqual(result3, makeCheckedErrorHolder(new Error("2")));
    });
  });

  describe("AsyncResult.compose", () => {
    it("should compose all the functions with then_", async () => {
      const fn1 = (x: number) => Ok("hello".repeat(x));
      const fn2 = (x: string) => Ok(x.length);
      const fn3 = (x: number) => Err(new CustomError());
      const composed = AsyncResult.compose(fn1, fn2);
      const composed2 = AsyncResult.compose(fn2, fn3, fn1);

      assert.deepStrictEqual(
        await AsyncResult(2).then_(composed).valueOrThrow(),
        10
      );
      assert.deepStrictEqual(
        await AsyncResult("Hello!")
          .then_(composed2)
          .valueOrFallback((it) => it),
        makeCheckedErrorHolder(new CustomError())
      );
    });
  });

  describe("AsyncResult.run", () => {
    it("should run the callback and return the result", async () => {
      const result = await AsyncResult.run(function* () {
        const x = yield* Ok(42);
        const y = yield* AsyncResult(Promise.resolve(Ok("43")));
        const z = yield* AsyncResult(
          Promise.resolve(AsyncResult(Promise.resolve(Ok(42))))
        );
        return x + parseInt(y) + z;
      }).valueOrThrow();

      // TODO: does this make sense??
      const result2 = await AsyncResult.run(function* () {
        try {
          const x = yield* Ok("42");
          throw new Error("Hi");
        } catch (e) {
          // catch should work for _thrown_ errors, just not yield* ones.
          return undefined;
        }
      }).valueOrThrow();

      const result3 = await AsyncResult.run(function* () {
        try {
          const x = yield* Ok("42");
          const y = yield* AsyncResult(Err(new CustomError("Failed")));
          return x + y;
        } catch (e) {
          // this should never run, because yielding an Err isn't throwing, it
          // just stops the composition.
          return undefined;
        }
      }).valueOrFallback((it) => it);

      const result4 = await AsyncResult.run(function* () {
        const _x = yield* Ok(42);
        throw new Error("Hi");
      }).valueOrFallback((it) => it);

      let finallyRan = false;
      const result5 = await AsyncResult.run(function* () {
        try {
          const _x = yield* AsyncResult(Promise.resolve(Ok(42)));
          throw new Error("Hi");
        } finally {
          finallyRan = true;
        }
      }).valueOrFallback((it) => it);

      let finallyRan2 = false;
      const result6 = await AsyncResult.run(function* () {
        try {
          yield* Err(Error("Hi"));
        } finally {
          finallyRan2 = true;
        }
      }).valueOrFallback((it) => it);

      let finallyRan3 = false;
      const result7 = await AsyncResult.run(function* () {
        try {
          yield* Ok(Error("Hi"));
          return 42;
        } finally {
          finallyRan3 = true;
        }
      }).valueOrThrow();

      let finallyRan4 = false;
      const result8 = await AsyncResult.run(function* () {
        try {
          yield* AsyncResult(Promise.reject(new Error("Hi")));
        } finally {
          finallyRan4 = true;
        }
      }).valueOrFallback((it) => it);

      // should work with no yields.
      const result9 = await AsyncResult.run(function* () {
        return 85;
      }).valueOrThrow();

      assert.deepStrictEqual(result, 127);
      assert.deepStrictEqual(result2, undefined);
      assert.deepStrictEqual(
        result3,
        makeCheckedErrorHolder(new CustomError("Failed"))
      );
      assert.deepStrictEqual(
        result4,
        makeUncheckedErrorHolder(new Error("Hi"))
      );
      assert.deepStrictEqual(
        result5,
        makeUncheckedErrorHolder(new Error("Hi"))
      );
      assert.deepStrictEqual(result6, makeCheckedErrorHolder(new Error("Hi")));
      assert.deepStrictEqual(result7, 42);
      assert.deepStrictEqual(
        result8,
        makeUncheckedErrorHolder(new Error("Hi"))
      );
      assert.deepStrictEqual(result9, 85);

      assert.strictEqual(finallyRan, true);
      assert.strictEqual(finallyRan2, true);
      assert.strictEqual(finallyRan3, true);
      assert.strictEqual(finallyRan4, true);
    });
  });
});
