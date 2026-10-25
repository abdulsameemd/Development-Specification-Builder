'use strict';
/* Language-model tool the dewa-fs-discovery agent calls at the end of a Copilot Chat run: it hands the
   context pack to the open SAP Spec Builder panel, so the consultant does not need to copy and paste.
   The builder validates the pack again (it is untrusted input). */

const TOOL_NAME = 'dewa_submitContextPack';
const MAX_JSON = 1000000;

/* deliver(pack) → true when an open builder panel received it */
function register(vscode, deliver) {
  return vscode.lm.registerTool(TOOL_NAME, {
    prepareInvocation: function () {
      return { invocationMessage: 'Sending the SAP context pack to the Spec Builder' };
    },
    invoke: async function (options) {
      const pack = options && options.input;
      const text = (function () { try { return JSON.stringify(pack); } catch (e) { return ''; } })();
      let reply;
      if (!pack || typeof pack !== 'object' || pack.kind !== 'dewa-sap-context-pack') {
        reply = 'Not sent: the input must be the dewa-sap-context-pack JSON object (kind "dewa-sap-context-pack", version 1).';
      } else if (text.length > MAX_JSON) {
        reply = 'Not sent: the context pack is too large. Keep each list to the relevant items.';
      } else {
        reply = (await deliver(pack))
          ? 'The context pack was imported into the SAP Spec Builder. Tell the user to review the reference check in step 4.'
          : 'The SAP Spec Builder panel is not open. Ask the user to run "DEWA: Open SAP Spec Builder" and click Import from clipboard after copying your answer.';
      }
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(reply)]);
    }
  });
}

module.exports = { register: register, TOOL_NAME: TOOL_NAME };
