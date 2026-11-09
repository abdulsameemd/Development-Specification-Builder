'use strict';
/* "Check & read in SAP" (development spec): Copilot checks the object names of a development specification and
   reads the existing objects READ-ONLY, with the same tool filter as automatic discovery (discoveryRunner.js:
   allow-list + write-verb deny-list), and returns a dewa-dev-context JSON for the builder's review dialog. */

const runner = require('./discoveryRunner');

const MARKER = 'DEV-CONTEXT v1';
const KIND = 'dewa-dev-context';

const INSTRUCTIONS = [
  'You check and read SAP development objects for ABAP developers. The SAP system is read through the tools of the SAP MCP servers.',
  'Hard rules: READ ONLY – never create, change, delete, activate, lock, release, run or transport anything, and do not read table contents.',
  'Only report what a tool returned in this session; never invent objects, fields, signatures or logic. Everything you could not read goes into notFound.',
  'Give structures and signatures, not full source code; describe the current logic of programs in a few sentences.'
].join('\n');

function hasContext(text) { return new RegExp(KIND).test(text || '') && /\{[\s\S]*\}/.test(text || ''); }

const RESULT = {
  isDone: hasContext,
  label: KIND,
  budget: 'Tool budget: at most ' + runner.MAX_CALLS + ' tool calls in total. Never call a tool twice with the same input. ' +
    'Check each listed name once (one search per name), then read the objects to read: structure / signature first, source only where the logic matters. ' +
    'Then stop calling tools and write the answer: a short summary and exactly one ```json block with the ' + KIND + '.',
  repair: 'Stop calling tools. Return now a short summary and exactly one ```json block with the ' + KIND + ' (kind "' + KIND + '", version 1) ' +
    'as described in the first message – checked, objects, notFound – based only on what you read.'
};

/* opts: { prompt, allowPatterns, maxRounds, model, token, onProgress, exclude } → the model's answer */
function run(vscode, opts) {
  return runner.run(vscode, Object.assign({}, opts, { instructions: INSTRUCTIONS, result: RESULT }));
}

module.exports = { run: run, MARKER: MARKER, KIND: KIND, INSTRUCTIONS: INSTRUCTIONS, hasContext: hasContext };
