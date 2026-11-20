/**
 * One expression evaluated in a page, and the shape its answer comes back in.
 *
 * `webdev_eval` is deliberately the plainest tool in the family: it is the
 * escape hatch for the question no fixed tool covers, and the field's need for
 * it was concrete — the only way to read `getBoundingClientRect()` and
 * `getComputedStyle()` out of a sidebar tab was to write a script into the
 * page's build output and read the console back. That works once, pollutes the
 * tree, and cannot be done to a site whose output nobody owns.
 *
 * What a value can be. CDP evaluates in the page's main world and can only hand
 * back what JSON can carry: a DOM node, a function or a live collection has no
 * value form, so the honest answer is its `description` ("div#app") plus a
 * marker, never a fabricated object. A long string is cut at the limit with an
 * explicit `truncated` flag rather than shipped whole, because a chatty page can
 * return megabytes over one evaluate.
 *
 * @module dsh-webdev-viewer/core/eval
 */

/** Characters of one JSON value a single `webdev_eval` may return. */
export const EVAL_MAX_VALUE_CHARS = 16_000

/** Deadline a single `webdev_eval` waits for the page by default. */
export const EVAL_DEFAULT_TIMEOUT_MS = 5_000

/** Longest deadline a caller may ask for. */
export const EVAL_MAX_TIMEOUT_MS = 30_000

/** What a caller asks the page to run. */
export interface EvalRequest {
  /** JavaScript to evaluate in the page's main world. */
  expression: string
  /** Whether to wait for a returned promise. @default true */
  awaitPromise?: boolean
  /** How long the host waits for an answer, in milliseconds. */
  timeoutMs?: number
}

/** A lossless JSON value: the only thing an evaluate can carry back from a page. */
export type EvalJsonValue =
  | null
  | boolean
  | number
  | string
  | EvalJsonValue[]
  | { [key: string]: EvalJsonValue }

/** A value that crossed back from the page, plus how faithfully it did. */
export interface EvalOutcome {
  /** JSON type CDP reported: `undefined`, `object`, `string`, `number`, ... */
  type: string
  /** The value itself, when it is JSON-carryable. */
  value?: EvalJsonValue
  /** `null` subtype, so `null` is distinguishable from an absent value. */
  isNull?: boolean
  /** The value had no JSON form (a node, a function, a live collection). */
  unserializable?: boolean
  /** CDP's one-line description of a value it could not serialize. */
  description?: string
  /** The value was longer than {@link EVAL_MAX_VALUE_CHARS} and was cut. */
  truncated?: boolean
  /** Characters the whole JSON value had before it was cut. */
  chars?: number
}

/** Payload `Runtime.evaluate` answers with. */
export interface RawEvalPayload {
  /** The evaluated value. */
  result?: {
    /** JSON type of the value. */
    type?: string
    /** Value when `returnByValue` could carry it. */
    value?: unknown
    /** CDP's description, used when the value has no JSON form. */
    description?: string
    /** `null` for a null value. */
    subtype?: string
  }
  /** Present when the expression threw. */
  exceptionDetails?: {
    /** Short sentence CDP gives the exception. */
    text?: string
    /** Line number inside the evaluated expression. */
    lineNumber?: number
    /** Column number inside the evaluated expression. */
    columnNumber?: number
    /** The thrown value, when CDP could describe it. */
    exception?: { description?: string; value?: unknown }
  }
}

/**
 * Build the CDP parameters for one evaluate.
 * @param request - expression and the two knobs the tool exposes.
 * @returns parameters for `Runtime.evaluate`.
 */
export function buildEvalParams(request: EvalRequest): Record<string, unknown> {
  return {
    expression: request.expression,
    returnByValue: true,
    awaitPromise: request.awaitPromise ?? true,
    userGesture: false,
    generatePreview: false,
  }
}

/**
 * Clamp a requested deadline into the range the host promises.
 * @param request - the caller's request.
 * @returns milliseconds to wait.
 */
export function evalTimeoutOf(request: EvalRequest): number {
  const requested = request.timeoutMs ?? EVAL_DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(requested)) return EVAL_DEFAULT_TIMEOUT_MS
  return Math.max(1, Math.min(EVAL_MAX_TIMEOUT_MS, Math.floor(requested)))
}

/**
 * Turn a raw evaluate payload into an outcome the model can read.
 *
 * Throwing an exception as a tool error — instead of returning it as a value —
 * keeps the one rule the tool descriptions repeat: a call that failed must not
 * look like a call that succeeded.
 * @param payload - raw `Runtime.evaluate` result.
 * @returns the normalized outcome.
 * @throws when the expression threw, with its own message.
 */
export function readEvalOutcome(payload: RawEvalPayload): EvalOutcome {
  const failure = payload.exceptionDetails
  if (failure !== undefined) {
    const thrown = failure.exception
    const described = typeof thrown?.description === 'string' && thrown.description !== ''
      ? thrown.description
      : thrown?.value !== undefined ? JSON.stringify(thrown.value) : undefined
    const where = failure.lineNumber === undefined
      ? ''
      : ` (line ${failure.lineNumber}${failure.columnNumber === undefined ? '' : `:${failure.columnNumber}`})`
    const message = [failure.text ?? 'the expression threw', described].filter(part => part !== undefined && part !== '').join(': ')
    throw new Error(`webdev.eval_failed: ${message}${where}`)
  }
  const result = payload.result
  if (result === undefined) throw new Error('the page returned no value for this expression')
  const type = typeof result.type === 'string' ? result.type : 'unknown'
  const outcome: EvalOutcome = { type }
  if (result.subtype === 'null') {
    outcome.isNull = true
    return outcome
  }
  if (result.value === undefined) {
    // A node, a function, a symbol: JSON cannot carry it. Reporting its
    // description is better than inventing an empty object.
    outcome.unserializable = true
    if (typeof result.description === 'string' && result.description !== '') outcome.description = result.description
    return outcome
  }
  const json = JSON.stringify(result.value)
  if (json === undefined) {
    outcome.unserializable = true
    return outcome
  }
  if (json.length > EVAL_MAX_VALUE_CHARS) {
    outcome.truncated = true
    outcome.chars = json.length
    outcome.value = `${json.slice(0, EVAL_MAX_VALUE_CHARS)}... (${json.length} characters, truncated)`
    return outcome
  }
  outcome.value = result.value as EvalJsonValue
  return outcome
}
