import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { setTimeout } from "node:timers/promises";
import { AsyncResult } from "./AsyncResult.js";
import { Err, Ok, Result } from "./Result.js";

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
      assert.strictEqual(await result.valueOrReject(), 42);
    });

    it("should accept a Promise<Result<T, E>>", async () => {
      const result = AsyncResult(Promise.resolve(Ok(42)));
      assert.strictEqual(await result.valueOrReject(), 42);

      const err = new Error("Hi");
      const result2 = AsyncResult(Promise.resolve(Err(err)));
      await result2.valueOrReject().then(
        (_) => {
          throw new Error("should've rejected");
        },
        (e) => assert.strictEqual(e, err)
      );
    });

    it("should accept a Promise<AsyncResult<T, E>>", async () => {
      const result = AsyncResult(
        Promise.resolve(AsyncResult(Promise.resolve(42)))
      );
      assert.strictEqual(await result.valueOrReject(), 42);
    });

    it("should treat promise rejections as rejected AsyncResults", async () => {
      const err = new Error("Hi");
      const fallbackFn = mock.fn((_e) => "fallback value");

      try {
        const result = AsyncResult(Promise.reject(err));
        await result.valueOrFallback(fallbackFn);
      } catch (e) {
        assert.strictEqual(fallbackFn.mock.callCount(), 0);
        assert.strictEqual(e, err);
      }

      try {
        const result = AsyncResult(Promise.reject(err));
        await result.valueOrFallback(fallbackFn, fallbackFn);
      } catch (e) {
        assert.strictEqual(fallbackFn.mock.callCount(), 1);
        assert.strictEqual(fallbackFn.mock.calls[0]?.arguments[0], err);
        assert.strictEqual(e, "fallback value");
      }
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

    it("should use the fallback fn if the result is an Err", async () => {
      const fallback = mock.fn((_e) => "fallback value");

      const error = new Error("Something went wrong");
      const result = AsyncResult(Promise.resolve(Err(error)));

      const value = await result.valueOrFallback(fallback);

      assert.strictEqual(value, "fallback value");
      assert.strictEqual(fallback.mock.callCount(), 1);
      assert.deepStrictEqual(fallback.mock.calls[0]?.arguments[0], error);
    });

    it("should use the rejection cb if the result is rejected", async () => {
      const rejectionCb = mock.fn((_e) => "fallback value");
      const result = AsyncResult(
        Promise.reject(new Error("Something went wrong"))
      );
      const value = await result.valueOrFallback(() => undefined, rejectionCb);
      assert.strictEqual(value, "fallback value");
      assert.strictEqual(rejectionCb.mock.callCount(), 1);
    });

    it("should use the rejection cb if the result is rejected with an Err", async () => {
      const rejectionCb = mock.fn((_e) => "fallback value");
      const somethingError = new Error("Something went wrong");

      // If the AsyncResult is rejected with an Err, that shouldn't be treated
      // specially; rejections are independent of Result.
      const result = AsyncResult(Promise.reject(Err(somethingError)));
      const value = await result.valueOrFallback(() => undefined, rejectionCb);
      assert.strictEqual(rejectionCb.mock.callCount(), 1);
      assert.deepStrictEqual(
        rejectionCb.mock.calls[0]?.arguments[0],
        Err(somethingError)
      );
      assert.strictEqual(value, "fallback value");
    });

    it("should return the result of the fallback fn even if it returns an Err or rejects", async () => {
      const fallbackErr = new Error("fallback value");
      const fallback = mock.fn((_e) => Err(fallbackErr));
      const result = AsyncResult(
        Promise.reject(new Error("Something went wrong"))
      );
      const value = await result.valueOrFallback(() => undefined, fallback);
      assert.deepStrictEqual(value, Err(fallbackErr));

      const fallback2 = mock.fn((_e) => {
        throw fallbackErr;
      });
      const result2 = AsyncResult(Err(new Error("Something went wrong")));
      try {
        await result2.valueOrFallback(fallback2, () => undefined);
        throw new Error("should've rejected");
      } catch (e) {
        assert.strictEqual(e, fallbackErr);
      }
    });
  });

  describe("valueOrReject", () => {
    it("should return the value if the result is Ok", async () => {
      const result = AsyncResult(Promise.resolve(42));
      assert.equal(await result.valueOrReject(), 42);
    });

    it("should throw an error if the result is an Err", async () => {
      const error = new Error("Something went wrong");
      const result = AsyncResult(Err(error));
      assert.rejects(() => result.valueOrReject(), error);
    });

    it("should throw an error if the AsyncResult is already rejected", async () => {
      const error = new Error("Something went wrong");
      const result = AsyncResult(Ok(34)).then_((_it) => {
        throw error;
      });
      assert.rejects(() => result.valueOrReject(), error);
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
      assert.deepStrictEqual(fallbackCb.mock.calls[0]?.arguments[0], error);
    });

    it("if the result is Ok, should work as map() and return a new Result with the mapped value", async () => {
      const mappedResult = AsyncResult(42).then_((value) => value * 2);
      assert.deepEqual(await mappedResult.valueOrReject(), 84);
    });

    it("if the result is Ok, should work as chain() and return a new Result with the returned value", async () => {
      const result = AsyncResult(Promise.resolve(Ok(42)));
      const err = new Error("hi");

      const mappedResult = result.then_((value) => Ok(value * 2));
      const mappedResult2 = result.then_((_value) => Err(err));

      assert.deepEqual(await mappedResult.valueOrReject(), 84);
      await mappedResult2.valueOrReject().then(
        () => {
          throw new Error("should've rejected!");
        },
        (e) => {
          assert.deepEqual(e, err);
        }
      );
    });

    it("should create a rejected AsyncResult if the callback throws an error", async () => {
      const error = new Error("Something went wrong");
      const mappedResult = AsyncResult(Promise.resolve(Ok(42))).then_((_) => {
        throw error;
      });

      const fallbackCb = mock.fn((_errorHolder) => "fallback value");
      await mappedResult.valueOrFallback(() => {
        throw new Error("should not have been called");
      }, fallbackCb);

      assert.strictEqual(fallbackCb.mock.callCount(), 1);
      assert.deepStrictEqual(fallbackCb.mock.calls[0]?.arguments[0], error);
    });
  });

  describe("catch_", () => {
    it("if the result is Ok, should return (a copy of) the existing Result as-is and not call callback", async () => {
      const result = AsyncResult(Promise.resolve(Ok(42)));
      const cb = mock.fn((error) => error.error);
      const mappedResult = result.catch_(cb);
      assert.deepEqual(await mappedResult.valueOrReject(), 42);
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is Err, should follow promise catch() and produce an Ok() from the return value", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      // even though this return value was an Error object, it becomes an Ok
      const mappedResult1 = AsyncResult(Promise.resolve(Err(error))).catch_(
        (_) => error2
      );
      const mappedResult2 = AsyncResult(Promise.resolve(Err(error))).catch_(
        (_error) => 42
      );

      assert.deepEqual(await mappedResult1.valueOrReject(), error2);
      assert.deepEqual(await mappedResult2.valueOrReject(), 42);
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

      assert.rejects(async () => await mappedResult.valueOrReject(), error2);
      assert.deepEqual(await mappedResult2.valueOrReject(), 42);
    });

    it("should create a rejected AsyncResult if the callback throws an error", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      try {
        await AsyncResult(Promise.resolve(Err(error))).catch_((_error) => {
          throw error2;
        });
        throw new Error("should not have gotten here");
      } catch (e) {
        assert.strictEqual(e, error2);
      }
    });

    it("should pass the err and rejection callbacks the correct error", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");
      const unusedCb = (_err: unknown) => {
        throw new Error("should not have been called");
      };

      const mappedResult = AsyncResult(Promise.resolve(Err(error))).catch_(
        (error_) => assert.deepStrictEqual(error_, error) ?? true
      );
      assert.deepEqual(await mappedResult.valueOrReject(), true);

      const mappedResult2 = AsyncResult(Promise.resolve(Err(error)))
        .catch_((_e) => {
          throw error2;
        }, unusedCb)
        .catch_(unusedCb, (error_) => {
          assert.deepStrictEqual(error_, error2);
          return error2;
        });

      assert.deepEqual(await mappedResult2.valueOrReject(), error2);
    });

    it("if the result is a rejected, should return a copy of the existing Result as-is and not call callback", async () => {
      const error = new Error("Something went wrong");
      const fallbackCb = mock.fn((_errorHolder) => "fallback value");
      const cb = mock.fn(() => new Error("shouldn't be called"));

      await AsyncResult(Promise.resolve(Ok(34)))
        .then_((_it) => {
          throw error;
        })
        .catch_(cb)
        .valueOrFallback(() => {}, fallbackCb);

      assert.strictEqual(cb.mock.callCount(), 0);

      // tests that the Result returned by catch_(),
      // which valueOrFallback(), is called on, is an unchecked Err Result.
      assert.strictEqual(fallbackCb.mock.callCount(), 1);
      assert.deepStrictEqual(fallbackCb.mock.calls[0]?.arguments[0], error);
    });
  });

  describe("catchInstanceOf", () => {
    it("if the result is Err of the specified type, should call the callback correctly", async () => {
      const result = await AsyncResult(
        Promise.resolve(Err(new CustomError("Something went wrong")))
      )
        .catchInstanceOf(CustomError, (e) => Ok(e.message))
        .valueOrReject();

      const result2 = await AsyncResult(
        Promise.resolve(Err(new CustomError("Something went wrong")))
      )
        .catchInstanceOf(CustomError, (e) => e.message)
        .valueOrReject();

      const result3 = await AsyncResult(
        Promise.resolve(Err(new CustomError("Something went wrong")))
      )
        .catchInstanceOf(CustomError, () => Err(new CustomError("new message")))
        .valueOrFallback((it) => it);

      assert.deepStrictEqual(result, "Something went wrong");
      assert.deepStrictEqual(result2, "Something went wrong");
      assert.deepStrictEqual(result3, new CustomError("new message"));
    });

    it("if the result is Err of a different type, should return the original error", async () => {
      const fallbackFn = mock.fn((e) => Ok(e.message));

      const result = await AsyncResult(Promise.resolve(Err(new AnotherError())))
        .catchInstanceOf(CustomError, fallbackFn)
        .valueOrFallback((it) => it);

      const result2 = await AsyncResult<never, CustomError>(
        Promise.reject(new Error())
      )
        .catchInstanceOf(CustomError, fallbackFn)
        .valueOrFallback(
          (it) => it,
          (it) => it
        );

      assert.deepEqual(result, new AnotherError());
      assert.deepEqual(result2, new Error());
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });

    it("if the AsyncResult is already rejected with the specified type, should not use the error callback and should still call the rejection callback", async () => {
      const result = await AsyncResult<never, CustomError>(
        Promise.reject(new CustomError("Something went wrong"))
      )
        .catchInstanceOf(
          CustomError,
          (e: Error) => Ok(e.message),
          () => "rejection"
        )
        .valueOrReject();

      assert.deepStrictEqual(result, "rejection");
    });

    it("if the result is Ok, should return the original result", async () => {
      const fallbackFn = mock.fn((e) => Ok(e.message));

      const result = await AsyncResult(Promise.resolve(new CustomError()))
        .catchInstanceOf(CustomError as any, fallbackFn)
        .valueOrReject();

      assert.deepStrictEqual(result, new CustomError());
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });
  });

  describe("finally_", () => {
    it("should always call the callback function and return an equivalent result if it doesn't produce an error", async () => {
      const err = new CustomError("hello");
      const initialResults = [
        [AsyncResult(Promise.resolve(42)), 42],
        [AsyncResult(Promise.resolve(Err(err))), err],
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

      const finallyError = new Error("xxx");
      const finallyThatThrows = mock.fn(() => {
        throw finallyError;
      });

      for (const [result, expectedFinalResult] of initialResults) {
        for (const _returnValue of finallyNonErrorReturnValues) {
          assert.rejects(
            async () => await result.finally_(finallyThatThrows),
            finallyError
          );
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
        AsyncResult(Promise.resolve(Err(finalError))),
        Promise.resolve(Err(finalError)),
        Promise.resolve(AsyncResult(Promise.resolve(Err(finalError)))),
      ];

      for (const result of initialResults) {
        for (const [i, returnValue] of finallyErrorReturnValues.entries()) {
          const finallyCb = mock.fn(() => returnValue as any);

          assert.deepStrictEqual(
            await result.finally_(finallyCb).valueOrFallback((it) => it),
            finalError
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
          await result.finally_(finallyCb).valueOrFallback(
            (_) => {
              throw new Error("should not have been called");
            },
            (it) => it
          ),
          finalError
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
      ]).valueOrReject();

      assert.deepEqual(result, [1, 2, 3]);
    });

    it("should return an Err or rejected AsyncResult with the first error if any result is not Ok", async () => {
      const error = new Error("Something went wrong");
      const fallbackCb = mock.fn((it) => it);

      const result = await AsyncResult.all([
        AsyncResult(Promise.resolve(1)),
        AsyncResult(Promise.resolve(Err(error))),
        AsyncResult(Promise.reject(error)), // an unchecked error
      ]).valueOrFallback(() => {
        throw new Error("should not have been called");
      }, fallbackCb);

      const result2 = await AsyncResult.all([
        AsyncResult(Promise.resolve(1)),
        AsyncResult(Promise.resolve(Err(error))),
      ]).valueOrFallback(fallbackCb);

      assert.strictEqual(fallbackCb.mock.callCount(), 2);
      assert.deepEqual(result, error);
      assert.deepEqual(result2, error);
    });
  });

  describe("AsyncResult.allSettled", () => {
    it("should return a settled result for all given AsyncResults", async () => {
      const err = new Error("hi");
      const result = await AsyncResult.allSettled([
        AsyncResult(Promise.resolve(1)),
        AsyncResult(Promise.resolve(Err(err))),
        AsyncResult(Promise.reject(err)),
      ]).valueOrReject();

      assert.deepEqual(result, [
        { type: "ok", value: 1 },
        { type: "err", value: err },
        { type: "rejection", value: err },
      ]);
    });
  });

  describe("AsyncResult.race", () => {
    it("should return the first result to settle", async () => {
      const result = await AsyncResult.race([
        AsyncResult(setTimeout(10).then<number, never>((_) => 1)),
        AsyncResult(setTimeout(0).then<string, never>((_) => "2")),
        AsyncResult(setTimeout(500).then<boolean, never>((_) => true)),
      ]).valueOrReject();

      const result2 = await AsyncResult.race([
        AsyncResult<number, never>(setTimeout(10).then((_) => 1)),
        AsyncResult<never, never>(
          setTimeout(0).then((_) => Promise.reject("2"))
        ),
        AsyncResult<boolean, never>(setTimeout(500).then((_) => true)),
      ]).valueOrFallback(
        () => {
          throw new Error("should not have been called");
        },
        (it) => it
      );

      const result3 = await AsyncResult.race([
        AsyncResult<number, never>(setTimeout(10).then((_) => 1)),
        AsyncResult<never, Error>(
          setTimeout(0).then((_) => Err(new Error("2")))
        ),
        AsyncResult<boolean, never>(setTimeout(500).then((_) => true)),
      ]).valueOrFallback((it) => it);

      assert.deepStrictEqual(result, "2");
      assert.deepStrictEqual(result2, "2");
      assert.deepStrictEqual(result3, new Error("2"));
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
        await AsyncResult(2).then_(composed).valueOrReject(),
        10
      );
      assert.deepStrictEqual(
        await AsyncResult("Hello!")
          .then_(composed2)
          .valueOrFallback((it) => it),
        new CustomError()
      );
    });
  });

  describe("AsyncResult.run", () => {
    it("should run the callback and return the result", async () => {
      const hiError = new Error("Hi");
      const customError = new CustomError("Failed");

      const result = await AsyncResult.run(function* () {
        const x = yield* Ok(42);
        const y = yield* AsyncResult(Promise.resolve(Ok("43")));
        const z = yield* AsyncResult(
          Promise.resolve(AsyncResult(Promise.resolve(Ok(42))))
        );
        return x + parseInt(y) + z;
      }).valueOrReject();

      const result2 = await AsyncResult.run(function* () {
        try {
          const x = yield* Ok("42");
          throw hiError;
        } catch (e) {
          // catch should work for _thrown_ errors
          return undefined;
        }
      }).valueOrReject();

      const result3 = await AsyncResult.run(function* () {
        try {
          const x = yield* Ok("42");
          const y = yield* AsyncResult(Err(customError));
          return x + y;
        } catch (e) {
          // this should never run, because yielding an Err isn't throwing, it
          // just stops the composition.
          return undefined;
        }
      }).valueOrFallback((it) => it);

      const result4 = await AsyncResult.run(function* () {
        const _x = yield* Ok(42);
        throw hiError;
      }).valueOrFallback(
        (it) => {
          throw new Error("should not have been called");
        },
        (it) => it
      );

      let finallyRan = false;
      const result5 = await AsyncResult.run(function* () {
        try {
          const _x = yield* AsyncResult(Promise.resolve(Ok(42)));
          throw hiError;
        } finally {
          finallyRan = true;
        }
      }).valueOrFallback(
        () => {
          throw new Error("should not have been called");
        },
        (it) => it
      );

      let finallyRan2 = false;
      const result6 = await AsyncResult.run(function* () {
        try {
          yield* Err(hiError);
        } finally {
          finallyRan2 = true;
        }
      }).valueOrFallback((it) => it);

      let finallyRan3 = false;
      const result7 = await AsyncResult.run(function* () {
        try {
          yield* Ok(hiError);
          return 42;
        } finally {
          finallyRan3 = true;
        }
      }).valueOrReject();

      let finallyRan4 = false;
      const result8 = await AsyncResult.run(function* () {
        try {
          yield* AsyncResult(Promise.reject(hiError));
        } finally {
          finallyRan4 = true;
        }
      }).valueOrFallback(
        () => {
          throw new Error("should not have been called");
        },
        (it) => it
      );

      // should work with no yields.
      const result9 = await AsyncResult.run(function* () {
        return 85;
      }).valueOrReject();

      assert.deepStrictEqual(result, 127);
      assert.deepStrictEqual(result2, undefined);
      assert.deepStrictEqual(result3, customError);
      assert.deepStrictEqual(result4, hiError);
      assert.deepStrictEqual(result5, hiError);
      assert.deepStrictEqual(result6, hiError);
      assert.deepStrictEqual(result7, 42);
      assert.deepStrictEqual(result8, hiError);
      assert.deepStrictEqual(result9, 85);

      assert.strictEqual(finallyRan, true);
      assert.strictEqual(finallyRan2, true);
      assert.strictEqual(finallyRan3, true);
      assert.strictEqual(finallyRan4, true);
    });
  });
});

describe("AsyncResult.prototype.thenChain", () => {
  it("should call a single callback with the value and empty history", async () => {
    const cb = mock.fn(async (x: number, history: []) => x + 1);
    const result = AsyncResult(1).thenChain(cb);
    assert.deepStrictEqual(await result.valueOrReject(), 2);
    assert.strictEqual(cb.mock.callCount(), 1);
    assert.deepStrictEqual(cb.mock.calls[0]?.arguments, [1, []]);
  });

  it("should chain two callbacks, passing correct history", async () => {
    const cb1 = mock.fn(async (x: number, history: []) => x + 1);
    const cb2 = mock.fn(async (x: number, history: [number]) => x * 2);
    const result = AsyncResult(1).thenChain(cb1, cb2);
    assert.deepStrictEqual(await result.valueOrReject(), 4);
    assert.strictEqual(cb1.mock.callCount(), 1);
    assert.strictEqual(cb2.mock.callCount(), 1);
    assert.deepStrictEqual(cb1.mock.calls[0]?.arguments, [1, []]);
    assert.deepStrictEqual(cb2.mock.calls[0]?.arguments, [2, [1]]);
  });

  it("should chain three callbacks, passing correct history", async () => {
    const cb1 = mock.fn(async (x: number, history: []) => x + 1);
    const cb2 = mock.fn(async (x: number, history: [number]) => x * 2);
    const cb3 = mock.fn(async (x: number, history: [number, number]) =>
      Ok(x - 3)
    );
    const result = AsyncResult(1).thenChain(cb1, cb2, cb3);
    assert.deepStrictEqual(await result.valueOrReject(), 1);
    assert.strictEqual(cb1.mock.callCount(), 1);
    assert.strictEqual(cb2.mock.callCount(), 1);
    assert.strictEqual(cb3.mock.callCount(), 1);
    assert.deepStrictEqual(cb1.mock.calls[0]?.arguments, [1, []]);
    assert.deepStrictEqual(cb2.mock.calls[0]?.arguments, [2, [1]]);
    assert.deepStrictEqual(cb3.mock.calls[0]?.arguments, [4, [1, 2]]);
  });

  it("should short-circuit on Err and not call further callbacks", async () => {
    const err = new Error("fail");
    const cb1 = mock.fn(async (x: number, history: []) => x + 1);
    const cb2 = mock.fn(async (_x: number, _history: [number]) => Err(err));
    const cb3 = mock.fn(async (x: number, history: [number, number]) => x * 2);
    const result = AsyncResult(1).thenChain(cb1, cb2, cb3);
    await result.valueOrReject().then(
      () => {
        throw new Error("should've rejected");
      },
      (e) => {
        assert.deepStrictEqual(e, err);
      }
    );
    assert.strictEqual(cb1.mock.callCount(), 1);
    assert.strictEqual(cb2.mock.callCount(), 1);
    assert.strictEqual(cb3.mock.callCount(), 0);
  });

  it("should work if a callback returns a non-Result value (wraps in Ok)", async () => {
    const cb1 = async (x: number, _history: []) => x + 1;
    const cb2 = async (x: number, _history: [number]) => x * 2;
    const result = AsyncResult(1).thenChain(cb1, cb2);
    assert.deepStrictEqual(await result.valueOrReject(), 4);
  });

  it("should work if a callback returns an AsyncResult", async () => {
    const cb1 = async (x: number, _history: []) => AsyncResult(x + 1);
    const cb2 = async (x: number, _history: [number]) => AsyncResult(x * 2);
    const result = AsyncResult(1).thenChain(cb1, cb2);
    assert.deepStrictEqual(await result.valueOrReject(), 4);
  });

  it("should work if a callback throws (propagates the error)", async () => {
    const err = new Error("fail");
    const cb1 = async (_x: number, _history: []) => {
      throw err;
    };
    const result = AsyncResult(1).thenChain(cb1);
    await assert.rejects(() => result.valueOrReject(), err);
  });

  it("should work with no callbacks (returns original result)", async () => {
    // @ts-expect-error
    const result = AsyncResult(1).thenChain();
    assert.deepStrictEqual(await result.valueOrReject(), 1);
  });

  it("should work with more than three callbacks and correct history", async () => {
    const cb1 = async (x: number, history: []) => x + 1;
    const cb2 = async (x: number, history: [number]) => x * 2;
    const cb3 = async (x: number, history: [number, number]) => x - 3;
    const cb4 = async (x: number, history: [number, number, number]) => x * 10;
    const cb5 = async (x: number, history: [number, number, number, number]) =>
      x / 2;

    const result = AsyncResult(1).thenChain(cb1, cb2, cb3, cb4, cb5);
    // 1 -> cb1: 2, cb2: 4, cb3: 1, cb4: 10, cb5: 5
    assert.deepStrictEqual(await result.valueOrReject(), 5);
  });

  it("should propagate Err if the initial result is Err", async () => {
    const err = new Error("fail");
    const cb1 = mock.fn(async (x: number, history: []) => x + 1);
    const result = AsyncResult(Err(err)).thenChain(cb1);
    await result.valueOrReject().then(
      () => {
        throw new Error("should've rejected");
      },
      (e) => {
        assert.deepStrictEqual(e, err);
      }
    );
    assert.strictEqual(cb1.mock.callCount(), 0);
  });

  it("should pass correct history for each callback", async () => {
    const historySnapshots: any[] = [];
    const cb1 = async (x: number, history: []) => {
      historySnapshots.push([...history]);
      return x + 1;
    };
    const cb2 = async (x: number, history: [number]) => {
      historySnapshots.push([...history]);
      return x * 2;
    };
    const cb3 = async (x: number, history: [number, number]) => {
      historySnapshots.push([...history]);
      return x - 3;
    };
    await AsyncResult(1).thenChain(cb1, cb2, cb3);
    assert.deepStrictEqual(historySnapshots, [[], [1], [1, 2]]);
  });
});
