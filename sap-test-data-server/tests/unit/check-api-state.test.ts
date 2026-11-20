// Clean core gate (spec §4.5): SAP objects used in abap/ must be released or classicAPI; no direct table selects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractUsedObjects, indexLists, check, isOwn, stripComments } from '../../scripts/check-api-state.ts';

const lists = indexLists(JSON.parse(readFileSync('tests/fixtures/lists.json', 'utf8')), JSON.parse(readFileSync('tests/fixtures/release.json', 'utf8')));

const SRC = `CLASS zcl_hr_td_read DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
    DATA mo_read TYPE REF TO cl_hrpa_read_infotype.
ENDCLASS.
CLASS zcl_hr_td_read IMPLEMENTATION.
  METHOD x.
    " CALL FUNCTION 'HR_INFOTYPE_OPERATION' – only in a comment
    CALL FUNCTION 'BAPI_EMPLOYEE_GETLIST' EXPORTING x = 1.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.
    DATA(lo_d) = CAST cl_abap_structdescr( cl_abap_structdescr=>describe_by_name( 'P0006' ) ).
    DATA(json) = /ui2/cl_json=>serialize( data = ls ).
    SELECT * FROM zhr_td_policy INTO TABLE @DATA(lt_policy).
  ENDMETHOD.
ENDCLASS.`;

test('extracts classes, interfaces, function modules and selected tables; ignores comments', () => {
  const used = extractUsedObjects(SRC, 'a.abap').map((o) => o.type + ':' + o.name).sort();
  assert.deepEqual(used, ['CLAS:/UI2/CL_JSON', 'CLAS:CL_ABAP_STRUCTDESCR', 'CLAS:CL_HRPA_READ_INFOTYPE', 'FUNC:BAPI_EMPLOYEE_GETLIST', 'FUNC:BAPI_TRANSACTION_COMMIT', 'INTF:IF_HTTP_EXTENSION', 'TABL:ZHR_TD_POLICY']);
  assert.equal(stripComments(`x = '"not a comment'. " comment`)[0], `x = '"not a comment'. `);
});

test('zero findings for released / classicAPI objects and own tables', () => {
  assert.deepEqual(check(extractUsedObjects(SRC, 'a.abap'), lists), []);
  assert.ok(isOwn('ZCL_X') && isOwn('YTAB') && isOwn('/DEWA/CL_X', ['/DEWA/']) && !isOwn('CL_X'));
});

test('findings: unlisted, noAPI, deprecated (with successor) and direct SAP table selects', () => {
  const bad = `CALL FUNCTION 'HR_INFOTYPE_OPERATION'.
CALL FUNCTION 'BAPI_ABSENCE_CREATE'.
DATA o TYPE REF TO cl_old_thing.
SELECT SINGLE * FROM pa0001 WHERE pernr = @lv_pernr INTO @DATA(ls).
SELECT * FROM zhr_td_policy INNER JOIN hrp1000 ON x = y INTO TABLE @DATA(lt).`;
  const f = check(extractUsedObjects(bad, 'b.abap'), lists).map((x) => x.problem);
  assert.deepEqual(f, [
    'cl_old_thing'.toUpperCase() + ' is deprecated – successor: [{"objectType":"CLAS","objectKey":"CL_NEW_THING"}]',
    'HR_INFOTYPE_OPERATION is not on SAP\'s lists (unlisted)',
    'BAPI_ABSENCE_CREATE is noAPI',
    'direct SELECT from SAP table PA0001 – not allowed (use a classic API)',
    'direct SELECT from SAP table HRP1000 – not allowed (use a classic API)'
  ]);
});

test('"released" wins over "classicAPI" for the same object', () => {
  assert.equal(lists.get('CLAS:/UI2/CL_JSON')?.state, 'released');
});
