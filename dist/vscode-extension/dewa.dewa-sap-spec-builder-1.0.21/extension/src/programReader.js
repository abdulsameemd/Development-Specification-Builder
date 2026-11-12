'use strict';
/* "Read an existing program" (Functional spec, SAP): Copilot reads a program, the objects it uses and the SAP
   system READ-ONLY with the same tool filter as automatic discovery (discoveryRunner.js: allow-list + write-verb
   deny-list), and returns the current logic as an fs-draft for the builder's review dialog. */

const runner = require('./discoveryRunner');
const drafter = require('./draftRunner');

const MARKER = 'FS-PROGRAM v1';

const INSTRUCTIONS = [
  'You read existing SAP programs for functional consultants. The SAP system is read through the tools of the SAP MCP servers.',
  'Hard rules: READ ONLY – never create, change, delete, activate, lock, release, run or transport anything, and do not read table contents.',
  'Only report what a tool returned in this session; never invent objects, fields or logic. Objects you could not read are listed as "Not read:" in currentLogic.',
  'Describe the logic in business words; technical names belong only in "programs" and in the data table and field columns.'
].join('\n');

const RESULT = {
  isDone: drafter.hasDraft,
  label: 'fs-draft',
  budget: 'Tool budget: at most ' + runner.MAX_CALLS + ' tool calls in total. Never call a tool twice with the same input. ' +
    'Read the named objects first (for a transaction, the program behind it), then only the objects they call that matter for the business logic. ' +
    'Then stop calling tools and write the answer: a short summary and exactly one ```json block with the fs-draft.',
  repair: 'Stop calling tools. Return now a short summary and exactly one ```json block with the fs-draft (kind "fs-draft", version 1) ' +
    'as described in the first message – currentLogic, programs, asIs, rules, data, frs – based only on what you read.'
};

/* opts: { prompt, allowPatterns, maxRounds, model, token, onProgress, exclude } → the model's answer */
function run(vscode, opts) {
  return runner.run(vscode, Object.assign({}, opts, { instructions: INSTRUCTIONS, result: RESULT }));
}

module.exports = { run: run, MARKER: MARKER, INSTRUCTIONS: INSTRUCTIONS };
