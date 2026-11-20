import { getConnectionStatus } from './getConnectionStatus.js';
import { describeInfotype } from './describeInfotype.js';
import { findEmployees } from './findEmployees.js';
import { readInfotype } from './readInfotype.js';
import { listScenarios } from './listScenarios.js';
import { planChanges } from './planChanges.js';
import { executePlan } from './executePlan.js';
import { listRuns } from './listRuns.js';

/** The eight tools of specification §6, in the order Copilot should use them. */
export const TOOLS = [getConnectionStatus, describeInfotype, findEmployees, readInfotype, listScenarios, planChanges, executePlan, listRuns];
