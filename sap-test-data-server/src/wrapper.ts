/* The ABAP wrapper's web interface, version 1 (specification §12), as seen by the server. Two implementations:
   HttpWrapper (the real service in the test system) and MockWrapper (src/mock – fake answers, no SAP needed).
   The request / response examples in tests/contract/ describe the same shapes for both sides. */

export type ObjectKind = 'employee' | 'organization';

export interface Status {
  system: string;              // SAP system ID answering
  client: string;              // client logged on to
  allowListed: boolean;        // system + client are on the environment allow-list (rule 1)
  user: string;                // SAP user (the functional user)
  wrapperVersion: string;      // e.g. 1.0.0
  release?: string;            // SAP release / SP as the wrapper reports it
  warnings: string[];          // e.g. change pointers active
}

export interface FieldInfo { name: string; label: string; type: string; length?: number; mandatory: boolean; masked: boolean }
export interface InfotypeInfo {
  infotype: string;            // 0006, 2001, 1001, 9xxx …
  kind: ObjectKind;
  name: string;
  timeConstraint: string;      // 1, 2, 3, A, B, T … as SAP reports it
  subtypes: { subtype: string; text: string }[];
  fields: FieldInfo[];
  policy: { enabled: boolean; writable: boolean; maskedFields: string[] };
}

export interface SearchCriteria {
  personnelArea?: string;
  personnelSubarea?: string;
  employeeGroup?: string;
  employeeSubgroup?: string;
  companyCode?: string;
  orgUnit?: string;
  hasRecord?: { infotype: string; subtype?: string; present: boolean; onDate?: string };
}
export interface EmployeeHit { employee: string; reasons: string[] }
export interface SearchResult { employees: EmployeeHit[]; scanned: number; capReached: boolean }

export interface ReadRequest { kind: ObjectKind; objectId: string; objectType?: string; infotype: string; subtype?: string; from?: string; to?: string }
export interface InfotypeRecord { infotype: string; subtype: string; validFrom: string; validTo: string; fields: Record<string, string> }
export interface ReadResult { records: InfotypeRecord[]; maskedFields: string[] }

export interface RunInfo { runId: string; planId: string; kind: 'change' | 'restore'; status: string; requester: string; createdAt: string; items: number }

export interface Wrapper {
  status(): Promise<Status>;
  describeInfotype(infotype: string, kind: ObjectKind): Promise<InfotypeInfo>;
  searchEmployees(criteria: SearchCriteria, limit: number): Promise<SearchResult>;
  readInfotype(req: ReadRequest): Promise<ReadResult>;
  listRuns(filter: { requester?: string; status?: string; limit?: number }): Promise<RunInfo[]>;
}

export const SUPPORTED_WRAPPER_MAJOR = 1;
