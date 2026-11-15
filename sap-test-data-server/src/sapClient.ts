/* Secure web client for the ABAP wrapper service in the test system (specification §5, §12).
   - https only, basic logon with the functional user, sap-client on every request;
   - session cookie kept for the server's lifetime;
   - SAP's CSRF token fetched with a GET before the first state-changing request, fetched again once when SAP says
     it is required;
   - every call has a timeout (default 60 s);
   - errors become TestDataError with the wrapper's code and SAP's own messages.
   Never logs or returns the password, cookies or tokens. */
import { TestDataError, isErrorCode } from './errors.js';
import type { Config } from './config.js';
import type { Wrapper, Status, InfotypeInfo, SearchCriteria, SearchResult, ReadRequest, ReadResult, RunInfo, ObjectKind } from './wrapper.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_SERVICE_PATH = '/sap/bc/zhr_testdata/v1';

export class SapClient {
  private cookies = new Map<string, string>();
  private csrf: string | null = null;
  constructor(private readonly cfg: Config, private readonly fetchFn: FetchLike = fetch, private readonly servicePath = process.env.SAP_SERVICE_PATH || DEFAULT_SERVICE_PATH) {}

  private url(path: string, query: Record<string, string | undefined> = {}): string {
    const u = new URL(this.cfg.host + this.servicePath + path);
    u.searchParams.set('sap-client', this.cfg.client);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
    return u.toString();
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      authorization: 'Basic ' + Buffer.from(this.cfg.user + ':' + this.cfg.password).toString('base64'),
      accept: 'application/json',
      'x-requester': this.cfg.requester,
      ...extra
    };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => k + '=' + v).join('; ');
    return h;
  }

  private keepCookies(res: Response): void {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
    for (const c of list) {
      const m = /^([^=;\s]+)=([^;]*)/.exec(c);
      if (m) this.cookies.set(m[1]!, m[2]!);
    }
  }

  private async send(method: 'GET' | 'POST', path: string, body?: unknown, query?: Record<string, string | undefined>, extra: Record<string, string> = {}): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchFn(this.url(path, query), {
        method,
        headers: this.headers(body !== undefined ? { 'content-type': 'application/json', ...extra } : extra),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
        redirect: 'manual'
      });
      this.keepCookies(res);
      return res;
    } catch (e) {
      if (ctl.signal.aborted) throw new TestDataError('TIMEOUT', 'No answer within ' + Math.round(this.cfg.timeoutMs / 1000) + ' s.');
      throw new TestDataError('SERVICE_UNAVAILABLE', (e instanceof Error ? e.message : String(e)).slice(0, 200));
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchToken(): Promise<string> {
    const res = await this.send('GET', '/status', undefined, undefined, { 'x-csrf-token': 'Fetch' });
    await this.parse(res);
    const t = res.headers.get('x-csrf-token');
    if (!t) throw new TestDataError('SERVICE_UNAVAILABLE', 'SAP did not return a security token.');
    this.csrf = t;
    return t;
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (res.ok && data !== null) return data as T;
    const err = (data && typeof data === 'object' && 'error' in data ? (data as { error: { code?: unknown; message?: unknown; sapMessages?: unknown } }).error : null);
    if (err && isErrorCode(err.code)) {
      const msgs = Array.isArray(err.sapMessages) ? err.sapMessages.map(String).slice(0, 20) : [];
      throw new TestDataError(err.code, typeof err.message === 'string' ? err.message.slice(0, 300) : '', msgs);
    }
    if (res.status === 401) throw new TestDataError('AUTHORIZATION_MISSING', 'SAP refused the logon (HTTP 401) – check user and password.');
    if (res.status === 403) throw new TestDataError('AUTHORIZATION_MISSING', 'SAP refused the request (HTTP 403).');
    if (res.status >= 300 && res.status < 400) throw new TestDataError('SERVICE_UNAVAILABLE', 'SAP redirected the request (HTTP ' + res.status + ') – is the service path right and the logon possible without a browser?');
    throw new TestDataError('SERVICE_UNAVAILABLE', 'HTTP ' + res.status + (res.ok ? ' with an empty or non-JSON answer' : ''));
  }

  async get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    return this.parse<T>(await this.send('GET', path, undefined, query));
  }

  /** State-changing (and search / read) requests: with the CSRF token; fetched again once if SAP asks for it. */
  async post<T>(path: string, body: unknown): Promise<T> {
    const token = this.csrf ?? (await this.fetchToken());
    let res = await this.send('POST', path, body, undefined, { 'x-csrf-token': token });
    if (res.status === 403 && /required/i.test(res.headers.get('x-csrf-token') || '')) {
      res = await this.send('POST', path, body, undefined, { 'x-csrf-token': await this.fetchToken() });
    }
    return this.parse<T>(res);
  }
}

export class HttpWrapper implements Wrapper {
  constructor(private readonly client: SapClient) {}
  status(): Promise<Status> { return this.client.get<Status>('/status'); }
  describeInfotype(infotype: string, kind: ObjectKind): Promise<InfotypeInfo> { return this.client.get<InfotypeInfo>('/infotypes/' + encodeURIComponent(infotype), { kind }); }
  searchEmployees(criteria: SearchCriteria, limit: number): Promise<SearchResult> { return this.client.post<SearchResult>('/employees/search', { criteria, limit }); }
  readInfotype(req: ReadRequest): Promise<ReadResult> { return this.client.post<ReadResult>('/infotypes/read', req); }
  async listRuns(filter: { requester?: string; status?: string; limit?: number }): Promise<RunInfo[]> {
    const r = await this.client.get<{ runs: RunInfo[] }>('/runs', { requester: filter.requester, status: filter.status, limit: filter.limit ? String(filter.limit) : undefined });
    return r.runs ?? [];
  }
}
