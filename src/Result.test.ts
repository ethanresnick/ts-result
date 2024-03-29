import { describe, it, mock } from "node:test";
import { Result, Ok, Err, ErrUnchecked, isResult } from "./Result.js";
import assert from "node:assert";
import {
  makeCheckedErrorHolder,
  makeUncheckedErrorHolder,
} from "./ErrorHolder.js";

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

    it("should use the fallback fn if the result is a checked Err", () => {
      const fallback = mock.fn((e) => "fallback value");

      const error = new Error("Something went wrong");
      const result = Err(error);

      const value = result.valueOrFallback(fallback);

      assert.strictEqual(value, "fallback value");
      assert.strictEqual(fallback.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallback.mock.calls[0]?.arguments[0],
        makeCheckedErrorHolder(error)
      );
    });

    it("should use the fallback fn if the result is an unchecked Err", () => {
      const fallback = mock.fn((e) => 42);

      const error = new Error("Something went wrong");
      const result = Ok(34).then_<number>((_it) => {
        throw error;
      });

      const value = result.valueOrFallback(fallback);

      assert.strictEqual(value, 42);
      assert.strictEqual(fallback.mock.callCount(), 1);
      assert.deepStrictEqual(
        fallback.mock.calls[0]?.arguments[0],
        makeUncheckedErrorHolder(error)
      );
    });
  });

  describe("valueOrThrow", () => {
    it("should return the value if the result is Ok", () => {
      const result = Ok(42);
      assert.equal(result.valueOrThrow(), 42);
    });

    it("should throw an error if the result is a checked Err", () => {
      const error = new Error("Something went wrong");
      const result = Err(error);
      assert.throws(() => result.valueOrThrow(), error);
    });

    it("should throw an error if the result is an unchecked Err", () => {
      const error = new Error("Something went wrong");
      const result = Ok(34).then_<number>((_it) => {
        throw error;
      });
      assert.throws(() => result.valueOrThrow(), error);
    });
  });

  describe("then_", () => {
    it("if the result is Err, should return the existing Result as-is and not call callback", () => {
      const error = new Error("Something went wrong");
      const cb = mock.fn((value) => value * 2);
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

    it("should create a Result of UncheckedErr if the callback throws an error", () => {
      const error = new Error("Something went wrong");
      const mappedResult = Ok(42).then_((value) => {
        throw error;
      });
      assert.deepEqual(mappedResult, ErrUnchecked(error));
    });
  });

  describe("catch_", () => {
    it("if the result is Ok, should return the existing Result as-is and not call callback", () => {
      const result = Ok(42);
      const cb = mock.fn((error) => error.error);
      const mappedResult = result.catch_(cb);
      assert.deepEqual(mappedResult, Ok(42));
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is Err, should follow promise catch() and produce an Ok() from the return value", () => {
      const error = new Error("Something went wrong");

      // even though this return value was an Error object, it becomes an Ok
      const mappedResult1 = Err(error).catch_((error) => error.error);
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

    it("should create a Result of UncheckedErr if the callback throws an error", () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");
      const mappedResult = Err(error).catch_((_error) => {
        throw error2;
      });
      assert.deepEqual(mappedResult, ErrUnchecked(error2));
    });

    it("should pass the callback the correct ErrorHolder", () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      const mappedResult = Err(error).catch_((error_) => {
        assert.deepStrictEqual(error_, makeCheckedErrorHolder(error));
        return error_.error;
      });
      assert.deepEqual(mappedResult, Ok(error));

      const mappedResult2 = Err(error)
        .catch_((_e) => {
          throw error2;
        })
        .catch_((error_) => {
          assert.deepStrictEqual(error_, makeUncheckedErrorHolder(error2));
          return error2;
        });

      assert.deepEqual(mappedResult2, Ok(error2));
    });
  });

  describe("catchKnown", () => {
    it("if the result is Ok, should return the existing Result as-is and not call callback", () => {
      const result = Ok(42);
      const cb = mock.fn((error) => error.error);
      const mappedResult = result.catchKnown(cb);
      assert.deepEqual(mappedResult, Ok(42));
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is an unchecked Err, should return the existing Result as-is and not call callback", () => {
      const error = new Error("Something went wrong");
      const result = Ok(34).then_<number>((_it) => {
        throw error;
      });
      const cb = mock.fn((error) => error.error);
      const mappedResult = result.catchKnown(cb);
      assert.deepEqual(mappedResult, result);
      assert.strictEqual(cb.mock.callCount(), 0);
    });

    it("if the result is a known Err, should follow promise catch() and produce an Ok() from the return value", () => {
      const error = new Error("Something went wrong");

      // even though this return value was an Error object, it becomes an Ok
      const mappedResult1 = Err(error).catchKnown((error) => error);
      const mappedResult2 = Err(error).catchKnown((_error) => 42);

      assert.deepEqual(mappedResult1, Ok(error));
      assert.deepEqual(mappedResult2, Ok(42));
    });

    it("if the result is a known Err, should work as chain() and return a new Result with the returned value", () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");

      const mappedResult = Err(error).catchKnown((_error) => Err(error2));
      const mappedResult2 = Err(error).catchKnown((_error) => Ok(42));

      assert.deepEqual(mappedResult, Err(error2));
      assert.deepEqual(mappedResult2, Ok(42));
    });

    it("should create a Result of UncheckedErr if the callback throws an error", () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("Something went wrong 2");
      const mappedResult = Err(error).catchKnown((_error) => {
        throw error2;
      });
      assert.deepEqual(mappedResult, ErrUnchecked(error2));
    });

    it("should pass the callback the known error", () => {
      const error = new Error("Something went wrong");
      Err(error).catchKnown((error_) => {
        assert.equal(error_, error);
        return error_;
      });
    });
  });

  describe("catchKnownInstanceOf", () => {
    it("if the result is Err of the specified type, should call the callback correctly", () => {
      const result = Err(
        new CustomError("Something went wrong")
      ).catchKnownInstanceOf(CustomError, (e) => Ok(e.message));

      const result2 = Err(
        new CustomError("Something went wrong")
      ).catchKnownInstanceOf(CustomError, (e) =>
        Err(new CustomError("new message"))
      );

      assert.deepStrictEqual(result, Ok("Something went wrong"));
      assert.deepStrictEqual(result2, Err(new CustomError("new message")));
    });

    it("if the result is Err of a different type, should return the original error", () => {
      const fallbackFn = mock.fn((e) => Ok(e.message));

      const result = Err(new AnotherError()).catchKnownInstanceOf(
        CustomError,
        fallbackFn
      );
      const result2 = ErrUnchecked<CustomError>(
        new Error()
      ).catchKnownInstanceOf(CustomError, fallbackFn);

      assert.deepEqual(result, Err(new AnotherError()));
      assert.deepEqual(result2, ErrUnchecked(new Error()));
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });

    it("if the result is ErrUnchecked of the specified type, should not use the callback", () => {
      const result = ErrUnchecked<CustomError>(
        new CustomError("Something went wrong")
      ).catchKnownInstanceOf(CustomError, (e) => Ok(e.message));

      assert.deepStrictEqual(
        result,
        ErrUnchecked(new CustomError("Something went wrong"))
      );
    });

    it("if the result is Ok, should return the original result", () => {
      const fallbackFn = mock.fn((e) => Ok(e.message));

      const result = Ok(new CustomError()).catchKnownInstanceOf(
        CustomError as any,
        fallbackFn
      );

      assert.deepEqual(result, Ok(new CustomError()));
      assert.strictEqual(fallbackFn.mock.callCount(), 0);
    });

    it("is a type error if given a union of classes", () => {
      Err(new Error()).catchKnownInstanceOf<
        CustomError | AnotherError,
        undefined
      >(
        // @ts-expect-error
        AnotherError,
        () => undefined
      );

      class CustomError2 extends Error {}
      class AnotherError2 extends Error {}

      // NB: not flagged because CustomError2 and AnotherError2 are structurally
      // identical types.
      const _x = Err<CustomError2 | AnotherError2>(
        new Error()
      ).catchKnownInstanceOf<CustomError2 | AnotherError2, undefined>(
        CustomError2,
        () => undefined
      );
    });
  });

  describe("finally_", () => {
    it("should always call the callback function and return an equivalent result if it doesn't produce an error", () => {
      const finally1 = mock.fn(() => Ok(84) as any);
      const finally2 = mock.fn(() => 84 as any);

      const result = Ok(42).finally_(finally1);
      const result2 = Ok(42).finally_(finally2);
      const result3 = Err(new Error("hi")).finally_(finally1);
      const result4 = ErrUnchecked(new Error("hi")).finally_(finally2);

      assert.deepStrictEqual(result, Ok(42));
      assert.deepStrictEqual(result2, Ok(42));
      assert.deepStrictEqual(result3, Err(new Error("hi")));
      assert.deepStrictEqual(result4, ErrUnchecked(new Error("hi")));
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
      const result3 = ErrUnchecked(error).finally_(() => {
        return Err(new Error("Another error"));
      });

      assert.deepStrictEqual(result, Err(new Error("Another error")));
      assert.deepStrictEqual(result2, Err(new Error("Another error")));
      assert.deepStrictEqual(result3, Err(new Error("Another error")));
    });

    it("should catch and return an UncheckedErr if the callback function throws an error", () => {
      const result = Ok(42).finally_(() => {
        throw new Error("Error during cleanup");
      });
      const result2 = Err(new Error("hi")).finally_(() => {
        throw new Error("Error during cleanup");
      });
      const result3 = ErrUnchecked(new Error("hi")).finally_(() => {
        throw new Error("Error during cleanup");
      });

      assert.deepStrictEqual(
        result,
        ErrUnchecked(new Error("Error during cleanup"))
      );
      assert.deepStrictEqual(
        result2,
        ErrUnchecked(new Error("Error during cleanup"))
      );
      assert.deepStrictEqual(
        result3,
        ErrUnchecked(new Error("Error during cleanup"))
      );
    });

    it("should not give special treatment to promise return values", () => {
      const result = Ok(42).finally_(() => Promise.resolve(84) as any);
      const result2 = Err(new Error("hi")).finally_(
        () => Promise.resolve() as any
      );
      const result3 = ErrUnchecked(new Error("hi")).finally_(
        () => Promise.resolve() as any
      );

      assert.deepStrictEqual(result, Ok(42));
      assert.deepStrictEqual(result2, Err(new Error("hi")));
      assert.deepStrictEqual(result3, ErrUnchecked(new Error("hi")));
    });
  });

  describe("Result.all", () => {
    it("should return an Ok with an array of values if all results are Ok", () => {
      const result = Result.all([Ok(1), Ok(2), Ok(3)]);
      assert.deepEqual(result, Ok([1, 2, 3]));
    });

    it("should return an Err/ErrUnchecked with the first error if any result is not Ok", () => {
      const error = new Error("Something went wrong");
      const result = Result.all([Ok(1), Err(error), Err(new Error("hi"))]);
      const result2 = Result.all([Ok(1), Ok(2), ErrUnchecked<never>(error)]);

      assert.deepEqual(result, Err(error));
      assert.deepEqual(result2, ErrUnchecked(error));
    });
  });

  describe("Result.any", () => {
    it("should return an Ok with the first Ok value if any result is Ok", async () => {
      const result = Result.any([Err(new Error("")), Ok(1), Ok(2)]);
      assert.deepEqual(result, Ok(1));
    });

    it("should return an Err with an AggregateError of error holders if all results are not Ok", async () => {
      const error = new Error("Something went wrong");
      const error2 = new Error("hi");
      const result = Result.any([
        Err(error),
        Err(error2),
        ErrUnchecked(error2),
      ]);

      const expectedErrors = [
        makeCheckedErrorHolder(error),
        makeCheckedErrorHolder(error2),
        makeUncheckedErrorHolder(error2),
      ];

      assert.deepStrictEqual(result, Err(new AggregateError(expectedErrors)));
      assert.deepStrictEqual(
        (result.data.value.error as any).errors,
        expectedErrors
      );
    });
  });

  describe("Result.wrap", () => {
    it("should return a Result with the value if the callback does not throw", () => {
      const wrapped = Result.wrap(() => 43);
      assert.deepEqual(wrapped(), Ok(43));
    });

    it("should return a Result with the error if the callback throws", () => {
      const error = new Error("Something went wrong");
      const wrapped = Result.wrap(() => {
        throw error;
      });
      assert.deepEqual(wrapped(), ErrUnchecked(error));
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

      const result4 = Result.run(function* () {
        const _x = yield* Ok(42);
        throw new Error("Hi");
      });

      let finallyRan = false;
      const result5 = Result.run(function* () {
        try {
          const _x = yield* Ok(42);
          throw new Error("Hi");
        } finally {
          finallyRan = true;
        }
      });

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
          yield* Ok(Error("Hi"));
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
      assert.deepStrictEqual(result4, ErrUnchecked(new Error("Hi")));
      assert.deepStrictEqual(result5, ErrUnchecked(new Error("Hi")));
      assert.deepStrictEqual(result6, Err(new Error("Hi")));
      assert.deepStrictEqual(result7, Ok(42));
      assert.deepStrictEqual(result8, Ok(85));

      assert.strictEqual(finallyRan, true);
      assert.strictEqual(finallyRan2, true);
      assert.strictEqual(finallyRan3, true);
    });
  });
});
