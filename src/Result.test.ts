import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { Err, Ok, Result } from "./Result.js";

class CustomError extends Error {
  public override readonly name = "CustomError";
}
class AnotherError extends Error {
  public override readonly name = "AnotherError";
}

describe("Result", () => {
  describe("valueOrFallback", () => {
    it("should return the value if the result is Ok", () => {
      const result = Ok(42);
      const fallback = mock.fn(() => "fallback value");
      const value = result.valueOrFallback(fallback);
      assert.strictEqual(value, 42);
      assert.strictEqual(fallback.mock.calls.length, 0);
    });

    it("should use the fallback fn if the result is an Err", () => {
      const fallback = mock.fn((_e: any) => "fallback value");

      const error = new Error("Something went wrong");
      const result = Err(error);

      const value = result.valueOrFallback(fallback);

      assert.strictEqual(value, "fallback value");
      assert.strictEqual(fallback.mock.callCount(), 1);
      assert.deepStrictEqual(fallback.mock.calls[0]?.arguments[0], error);
    });
  });

  describe("valueOrThrow", () => {
    it("should return the value if the Result is Ok", () => {
      const result = Ok(42);
      assert.equal(result.valueOrThrow(), 42);
    });

    it("should throw an error if the Result is an Err", () => {
      const error = new Error("Something went wrong");
      const result = Err(error);
      assert.throws(() => result.valueOrThrow(), error);
    });
  });

  describe("then_", () => {
    it("if the result is Err, should return the existing Result as-is and not call callback", () => {
      const error = new Error("Something went wrong");
      const cb = mock.fn((value: number) => value * 2);
      const mappedResult = Err(error).then_(cb);
      assert.deepEqual(mappedResult, Err(error));
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is Ok, should work as map() and return a new Result with the mapped value", () => {
      const mappedResult = Ok(42).then_((value) => value * 2);
      assert.deepEqual(mappedResult, Ok(84));
    });

    it("if the result is Ok, should work as chain() and return a new Result with the returned value", () => {
      const result = Ok(42);
      const err = new Error("hi");

      const mappedResult = result.then_((value) => Ok(value * 2));
      const mappedResult2 = result.then_((_value) => Err(err));

      assert.deepEqual(mappedResult, Ok(84));
      assert.deepEqual(mappedResult2, Err(err));
    });

    it("should throw if the callback throws an error", () => {
      const error = new Error("Something went wrong");
      assert.throws(
        () =>
          Ok(42).then_(() => {
            throw error;
          }),
        error
      );
    });
  });

  describe("catch_", () => {
    it("if the result is Ok, should return the existing Result as-is and not call callback", () => {
      const result = Ok(42);
      const cb = mock.fn((error: Error) => error);
      const mappedResult = result.catch_(cb);
      assert.deepEqual(mappedResult, Ok(42));
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is Err, should follow promise catch() and produce an Ok() from the return value", () => {
      const error = new Error("Something went wrong");

      // even though this return value was an Error object, it becomes an Ok
      const mappedResult1 = Err(error).catch_((error) => error);
      const mappedResult2 = Err(error).catch_((_error) => 42);

      assert.deepEqual(mappedResult1, Ok(error));
      assert.deepEqual(mappedResult2, Ok(42));
    });

    it("if the result is Err, should work as chain() and return a new Result with the returned value", () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      const mappedResult = Err(error).catch_((_error) => Err(error2));
      const mappedResult2 = Err(error).catch_((_error) => Ok(42));

      assert.deepEqual(mappedResult, Err(error2));
      assert.deepEqual(mappedResult2, Ok(42));
    });

    it("should throw if the callback throws an error", () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");
      assert.throws(
        () =>
          Err(error).catch_((_error) => {
            throw error2;
          }),
        error2
      );
    });
  });

  describe("catchInstanceOf", () => {
    it("if the result is Err of the specified type, should call the callback correctly", () => {
      const result = Err(
        new CustomError("Something went wrong")
      ).catchInstanceOf(CustomError, (e) => Ok(e.message));

      const result2 = Err(
        new CustomError("Something went wrong")
      ).catchInstanceOf(CustomError, (e) =>
        Err(new CustomError("new message"))
      );

      assert.deepStrictEqual(result, Ok("Something went wrong"));
      assert.deepStrictEqual(result2, Err(new CustomError("new message")));
    });

    it("if the result is Err of a different type, should return the original error", () => {
      const fallbackFn = mock.fn((e) => Ok(e.message));

      const result = Err<AnotherError | CustomError>(
        new AnotherError()
      ).catchInstanceOf(CustomError, fallbackFn);

      assert.deepEqual(result, Err(new AnotherError()));
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });

    it("if the result is Ok, should return the original result", () => {
      const fallbackFn = mock.fn((e: Error) => Ok(e.message));

      const result = Ok(new CustomError()).catchInstanceOf(
        CustomError as any,
        fallbackFn
      );

      assert.deepEqual(result, Ok(new CustomError()));
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });

    it("is a type error if given a union of classes", () => {
      Err(new Error()).catchInstanceOf<CustomError | AnotherError, undefined>(
        // @ts-expect-error
        AnotherError,
        () => undefined
      );

      class CustomError2 extends Error {}
      class AnotherError2 extends Error {}

      // NB: not flagged because CustomError2 and AnotherError2 are structurally
      // identical types.
      const _x = Err<CustomError2 | AnotherError2>(new Error()).catchInstanceOf<
        CustomError2 | AnotherError2,
        undefined
      >(CustomError2, () => undefined);
    });
  });

  describe("finally_", () => {
    it("should always call the callback function and return an equivalent result if it doesn't produce an error", () => {
      const finally1 = mock.fn(() => Ok(84) as any);
      const finally2 = mock.fn(() => 84 as any);

      const result = Ok(42).finally_(finally1);
      const result2 = Ok(42).finally_(finally2);
      const result3 = Err(new Error("hi")).finally_(finally1);
      const result4 = Err(new Error("hi")).finally_(finally2);

      assert.deepStrictEqual(result, Ok(42));
      assert.deepStrictEqual(result2, Ok(42));
      assert.deepStrictEqual(result3, Err(new Error("hi")));
      assert.deepStrictEqual(result4, Err(new Error("hi")));
      assert.strictEqual(finally1.mock.callCount(), 2);
      assert.strictEqual(finally2.mock.callCount(), 2);
      assert.deepStrictEqual(finally1.mock.calls[0]?.arguments, []);
      assert.deepStrictEqual(finally2.mock.calls[0]?.arguments, []);
      assert.deepStrictEqual(finally1.mock.calls[1]?.arguments, []);
      assert.deepStrictEqual(finally2.mock.calls[1]?.arguments, []);
    });

    it("should call the callback function and return the new result if returns an Err", () => {
      const error = new Error("Something went wrong");
      const result = Err(error).finally_(() => {
        return Err(new Error("Another error"));
      });
      const result2 = Ok(error).finally_(() => {
        return Err(new Error("Another error"));
      });

      assert.deepStrictEqual(result, Err(new Error("Another error")));
      assert.deepStrictEqual(result2, Err(new Error("Another error")));
    });

    it("should propagate the error if the callback function throws an error", () => {
      const errDuringCleanup = new Error("Error during cleanup");
      try {
        Ok(42).finally_(() => {
          throw errDuringCleanup;
        });
        throw new Error("Expected finally_ to throw!");
      } catch (e) {
        assert.strictEqual(e, errDuringCleanup);
      }

      try {
        const result2 = Err(new Error("hi")).finally_(() => {
          throw errDuringCleanup;
        });
        throw new Error("Expected finally_ to throw!");
      } catch (e) {
        assert.strictEqual(e, errDuringCleanup);
      }
    });

    it("should not give special treatment to promise return values", () => {
      const result = Ok(42).finally_(() => Promise.resolve(84) as any);
      const result2 = Err(new Error("hi")).finally_(
        () => Promise.resolve() as any
      );

      assert.deepStrictEqual(result, Ok(42));
      assert.deepStrictEqual(result2, Err(new Error("hi")));
    });
  });

  describe("Result.all", () => {
    it("should return an Ok with an array of values if all results are Ok", () => {
      const result = Result.all([Ok(1), Ok(2), Ok(3)]);
      assert.deepEqual(result, Ok([1, 2, 3]));
    });

    it("should return an Err with the first error if any result is not Ok", () => {
      const error = new Error("Something went wrong");
      const result = Result.all([Ok(1), Err(error), Err(new Error("hi"))]);

      assert.deepEqual(result, Err(error));
    });
  });

  describe("Result.any", () => {
    it("should return an Ok with the first Ok value if any result is Ok", async () => {
      const result = Result.any([Err(new Error("")), Ok(1), Ok(2)]);
      assert.deepEqual(result, Ok(1));
    });

    it("should return an Err with an AggregateError if all results are not Ok", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("hi");
      const result = Result.any([Err(error), Err(error2)]);

      assert.deepStrictEqual(result, Err(new AggregateError([error, error2])));
    });
  });

  describe("Result.compose", () => {
    it("should compose all the functions with then_", () => {
      const fn1 = (x: number) => Ok("hello".repeat(x));
      const fn2 = (x: string) => Ok(x.length);
      const fn3 = (x: number) => Err(new Error());
      const composed = Result.compose(fn1, fn2);
      const composed2 = Result.compose(fn2, fn3, fn1);

      assert.deepStrictEqual(Ok(2).then_(composed), Ok(10));
      assert.deepStrictEqual(Ok("Hello!").then_(composed2), Err(new Error()));
    });
  });

  describe("Result.run", () => {
    it("should run the callback and return the result", () => {
      const result = Result.run(function* () {
        const x = yield* Ok(42);
        const y = yield* Ok("43");
        return x + parseInt(y);
      });

      const result2 = Result.run(function* () {
        try {
          const x = yield* Ok("42");
          throw new Error("Hi");
        } catch (e) {
          // catch should work for _thrown_ errors, just not yield* ones.
          return undefined;
        }
      });

      const hiErr = new Error("Hi");
      const result3 = Result.run(function* () {
        try {
          const x = yield* Ok("42");
          const y = yield* Err(new CustomError("Failed"));
          return x + y;
        } catch (e) {
          // this should never run, because yielding an Err isn't throwing,
          // it just stops the composition.
          return undefined;
        }
      });

      try {
        Result.run(function* () {
          const _x = yield* Ok(42);
          throw hiErr;
        });
        throw new Error("Expected run to throw!");
      } catch (e) {
        assert.strictEqual(e, hiErr);
      }

      try {
        let finallyRan = false;
        Result.run(function* () {
          try {
            const _x = yield* Ok(42);
            throw hiErr;
          } finally {
            finallyRan = true;
          }
        });
        throw new Error("Expected run to throw!");
      } catch (e) {
        assert.strictEqual(e, hiErr);
      }

      let finallyRan2 = false;
      const result6 = Result.run(function* () {
        try {
          yield* Err(Error("Hi"));
        } finally {
          finallyRan2 = true;
        }
      });

      let finallyRan3 = false;
      const result7 = Result.run(function* () {
        try {
          yield* Ok(hiErr);
          return 42;
        } finally {
          finallyRan3 = true;
        }
      });

      // should work with no yields.
      const result8 = Result.run(function* () {
        return 85;
      });

      assert.deepStrictEqual(result, Ok(85));
      assert.deepStrictEqual(result2, Ok(undefined));
      assert.deepStrictEqual(result3, Err(new CustomError("Failed")));
      assert.deepStrictEqual(result6, Err(hiErr));
      assert.deepStrictEqual(result7, Ok(42));
      assert.deepStrictEqual(result8, Ok(85));

      assert.strictEqual(finallyRan2, true);
      assert.strictEqual(finallyRan2, true);
      assert.strictEqual(finallyRan3, true);
    });
  });
});

describe("thenChain", () => {
  it("should call a single callback with the value and empty history", () => {
    const cb = mock.fn((x: number, history: []) => x + 1);
    const result = Ok(1).thenChain(cb);
    assert.deepStrictEqual(result, Ok(2));
    assert.strictEqual(cb.mock.callCount(), 1);
    assert.deepStrictEqual(cb.mock.calls[0]?.arguments, [1, []]);
  });

  it("should chain two callbacks, passing correct history", () => {
    const cb1 = mock.fn((x: number, history: []) => x + 1);
    const cb2 = mock.fn((x: number, history: [number]) => x * 2);
    const result = Ok(1).thenChain(cb1, cb2);
    assert.deepStrictEqual(result, Ok(4));
    assert.strictEqual(cb1.mock.callCount(), 1);
    assert.strictEqual(cb2.mock.callCount(), 1);
    assert.deepStrictEqual(cb1.mock.calls[0]?.arguments, [1, []]);
    assert.deepStrictEqual(cb2.mock.calls[0]?.arguments, [2, [1]]);
  });

  it("should chain three callbacks, passing correct history", () => {
    const cb1 = mock.fn((x: number, history: []) => x + 1);
    const cb2 = mock.fn((x: number, history: [number]) => x * 2);
    const cb3 = mock.fn((x: number, history: [number, number]) => Ok(x - 3));
    const result = Ok(1).thenChain(cb1, cb2, cb3);
    assert.deepStrictEqual(result, Ok(1));
    assert.strictEqual(cb1.mock.callCount(), 1);
    assert.strictEqual(cb2.mock.callCount(), 1);
    assert.strictEqual(cb3.mock.callCount(), 1);
    assert.deepStrictEqual(cb1.mock.calls[0]?.arguments, [1, []]);
    assert.deepStrictEqual(cb2.mock.calls[0]?.arguments, [2, [1]]);
    assert.deepStrictEqual(cb3.mock.calls[0]?.arguments, [4, [1, 2]]);
  });

  it("should short-circuit on Err and not call further callbacks", () => {
    const err = new Error("fail");
    const cb1 = mock.fn((x: number, history: []) => x + 1);
    const cb2 = mock.fn((_x: number, _history: [number]) => Err(err));
    const cb3 = mock.fn((x: number, history: [number, number]) => x * 2);
    const result = Ok(1).thenChain(cb1, cb2, cb3);
    assert.deepStrictEqual(result, Err(err));
    assert.strictEqual(cb1.mock.callCount(), 1);
    assert.strictEqual(cb2.mock.callCount(), 1);
    assert.strictEqual(cb3.mock.callCount(), 0);
  });

  it("should work if a callback throws (propagates the error)", () => {
    const err = new Error("fail");
    const cb1 = (_x: number, _history: []) => {
      throw err;
    };
    assert.throws(() => Ok(1).thenChain(cb1), err);
  });

  it("should work with no callbacks (returns original result)", () => {
    // @ts-expect-error
    const result = Ok(1).thenChain();
    assert.deepStrictEqual(result, Ok(1));
  });

  it("should work with more than three callbacks and correct history", () => {
    const cb1 = (x: number, history: []) => x + 1;
    const cb2 = (x: number, history: [number]) => x * 2;
    const cb3 = (x: number, history: [number, number]) => x - 3;
    const cb4 = (x: number, history: [number, number, number]) => x * 10;
    const cb5 = (x: number, history: [number, number, number, number]) => x / 2;
    const result = Ok(1).thenChain(cb1, cb2, cb3, cb4, cb5);
    // 1 -> cb1: 2, cb2: 4, cb3: 1, cb4: 10, cb5: 5
    assert.deepStrictEqual(result, Ok(5));
  });

  it("should propagate Err if the initial result is Err", () => {
    const err = new Error("fail");
    const cb1 = mock.fn((x: number, history: []) => x + 1);
    const result = Err(err).thenChain(cb1);
    assert.deepStrictEqual(result, Err(err));
    assert.strictEqual(cb1.mock.callCount(), 0);
  });

  it("should pass correct history for each callback", () => {
    const historySnapshots: any[] = [];
    const cb1 = (x: number, history: []) => {
      historySnapshots.push([...history]);
      return x + 1;
    };
    const cb2 = (x: number, history: [number]) => {
      historySnapshots.push([...history]);
      return x * 2;
    };
    const cb3 = (x: number, history: [number, number]) => {
      historySnapshots.push([...history]);
      return x - 3;
    };
    Ok(1).thenChain(cb1, cb2, cb3);
    assert.deepStrictEqual(historySnapshots, [[], [1], [1, 2]]);
  });
});
