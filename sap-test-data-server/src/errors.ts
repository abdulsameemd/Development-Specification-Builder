/* Error codes of the ABAP wrapper (specification §11) plus the server's own, each with a plain-language text that the
   AI assistant shows to the developer. */
export const ERROR_TEXT = {
  CLIENT_NOT_ALLOWED: 'This SAP system / client is not on the test data allow-list. Nothing was read or written.',
  SYSTEM_MISMATCH: 'The SAP system answering is not the expected test system. Writes are refused.',
  INFOTYPE_NOT_ALLOWED: 'This infotype (or subtype) is not enabled in the test data policy.',
  EMPLOYEE_NOT_ELIGIBLE: 'This employee is not eligible for test data (excluded or not in the test client).',
  LIMIT_EXCEEDED: 'The request is larger than the policy allows (default 10 employees / 50 records per plan).',
  DATE_NOT_ALLOWED: 'A date is outside what the policy allows.',
  VALIDATION_FAILED: 'SAP rejected the data – see SAP\'s messages.',
  EMPLOYEE_LOCKED: 'The employee is locked by another user or process. Try again later.',
  PLAN_EXPIRED: 'The plan has expired (plans are valid for 30 minutes). Create a new plan.',
  PLAN_STALE: 'The employee\'s data changed since the plan was made. Create a new plan.',
  PLAN_ALREADY_EXECUTED: 'This plan was already executed; the earlier result is returned.',
  RESTORE_CONFLICT: 'The data changed after the run; the restore skipped it instead of overwriting.',
  AUTHORIZATION_MISSING: 'The SAP user lacks an authorization for this request.',
  SERVICE_UNAVAILABLE: 'The test data service in SAP is not reachable.',
  // server-side
  CONFIG_MISSING: 'The test data server is not configured completely.',
  WRAPPER_VERSION: 'The ABAP wrapper in SAP has an unsupported version.',
  TIMEOUT: 'SAP did not answer in time.',
  INVALID_INPUT: 'The request is not valid.',
  WRITES_REFUSED: 'Writes are refused: the connected system, client or allow-list does not match the configuration.',
  NOT_AVAILABLE_PHASE1: 'Planning and executing changes are not available yet (Phase 1 is read-only). They come in Phase 2, after the SAP classes are verified (Phase 0).'
} as const;

export type ErrorCode = keyof typeof ERROR_TEXT;

export class TestDataError extends Error {
  readonly code: ErrorCode;
  readonly sapMessages: string[];
  constructor(code: ErrorCode, detail?: string, sapMessages: string[] = []) {
    super(ERROR_TEXT[code] + (detail ? ' ' + detail : ''));
    this.code = code;
    this.sapMessages = sapMessages;
  }
}

/** Anything thrown → a TestDataError (unknown codes from SAP become SERVICE_UNAVAILABLE with the text kept). */
export function toTestDataError(e: unknown): TestDataError {
  if (e instanceof TestDataError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new TestDataError('SERVICE_UNAVAILABLE', msg.slice(0, 300));
}

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TEXT, v);
}
