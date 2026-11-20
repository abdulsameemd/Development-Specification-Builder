"! <p>Test data wrapper – safety rules (specification §8). All policy lives here, in SAP, not in the MCP server.</p>
"! Rule 1: hard block unless SY-SYSID / SY-MANDT are on the environment allow-list ZHR_TD_ALLOW (filled by hand in
"! the test system only, never transported; empty = refuse everything) AND equal the expected values the server sends.
"! Rule 3: enabled infotypes / subtypes (ZHR_TD_POLICY). Rule 4: exclusion list (ZHR_TD_EXCL). Rule 9: masking
"! (ZHR_TD_MASK). Rule 5: limits (ZHR_TD_LIMIT). Only our own tables are selected – never SAP tables.
CLASS zcl_hr_td_safety DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_policy,
             kind     TYPE c LENGTH 1,      " P = employee, O = organization
             infty    TYPE c LENGTH 4,
             subty    TYPE c LENGTH 4,
             enabled  TYPE abap_bool,
             writable TYPE abap_bool,
           END OF ty_policy,
           tt_fields TYPE STANDARD TABLE OF string WITH EMPTY KEY.

    CONSTANTS c_version TYPE string VALUE '1.0.0'.

    "! Rule 1 – raises ZCX_HR_TD with CLIENT_NOT_ALLOWED / SYSTEM_MISMATCH
    METHODS assert_environment
      IMPORTING iv_expected_system TYPE csequence OPTIONAL
                iv_expected_client TYPE csequence OPTIONAL
      RAISING   zcx_hr_td.
    METHODS is_allow_listed RETURNING VALUE(rv_ok) TYPE abap_bool.

    "! Rule 3 – raises INFOTYPE_NOT_ALLOWED
    METHODS assert_infotype_enabled
      IMPORTING iv_kind TYPE csequence iv_infty TYPE csequence iv_subty TYPE csequence OPTIONAL
      RAISING   zcx_hr_td.
    METHODS get_policy
      IMPORTING iv_kind TYPE csequence iv_infty TYPE csequence
      RETURNING VALUE(rs_policy) TYPE ty_policy.

    "! Rule 4 – raises EMPLOYEE_NOT_ELIGIBLE
    METHODS assert_employee_eligible IMPORTING iv_pernr TYPE csequence RAISING zcx_hr_td.

    "! Rule 9 – field names to mask for an infotype
    METHODS masked_fields
      IMPORTING iv_kind TYPE csequence iv_infty TYPE csequence
      RETURNING VALUE(rt_fields) TYPE tt_fields.

    "! Rule 5 – a numeric limit (MAX_EMPLOYEES, MAX_RECORDS, SCAN_CAP, PAST_MONTHS, PLAN_MINUTES)
    METHODS limit IMPORTING iv_key TYPE csequence iv_default TYPE i RETURNING VALUE(rv_value) TYPE i.
ENDCLASS.

CLASS zcl_hr_td_safety IMPLEMENTATION.
  METHOD is_allow_listed.
    SELECT SINGLE @abap_true FROM zhr_td_allow
      WHERE sysid = @sy-sysid AND mandt_allowed = @sy-mandt
      INTO @rv_ok.
  ENDMETHOD.

  METHOD assert_environment.
    IF is_allow_listed( ) = abap_false.
      RAISE EXCEPTION NEW zcx_hr_td( code = 'CLIENT_NOT_ALLOWED' text = |System { sy-sysid } client { sy-mandt } is not on the test data allow-list.| ).
    ENDIF.
    IF iv_expected_system IS NOT INITIAL AND to_upper( iv_expected_system ) <> sy-sysid.
      RAISE EXCEPTION NEW zcx_hr_td( code = 'SYSTEM_MISMATCH' text = |Expected { iv_expected_system }, this is { sy-sysid }.| ).
    ENDIF.
    IF iv_expected_client IS NOT INITIAL AND iv_expected_client <> sy-mandt.
      RAISE EXCEPTION NEW zcx_hr_td( code = 'SYSTEM_MISMATCH' text = |Expected client { iv_expected_client }, this is { sy-mandt }.| ).
    ENDIF.
  ENDMETHOD.

  METHOD get_policy.
    SELECT SINGLE kind, infty, subty, enabled, writable FROM zhr_td_policy
      WHERE kind = @iv_kind AND infty = @iv_infty AND subty = @space
      INTO CORRESPONDING FIELDS OF @rs_policy.
  ENDMETHOD.

  METHOD assert_infotype_enabled.
    DATA(ls_policy) = get_policy( iv_kind = iv_kind iv_infty = iv_infty ).
    IF ls_policy-enabled = abap_false.
      RAISE EXCEPTION NEW zcx_hr_td( code = 'INFOTYPE_NOT_ALLOWED' text = |Infotype { iv_infty } is not enabled for test data.| ).
    ENDIF.
    IF iv_subty IS NOT INITIAL.
      " a subtype row overrides the infotype row when it exists
      SELECT SINGLE enabled FROM zhr_td_policy
        WHERE kind = @iv_kind AND infty = @iv_infty AND subty = @iv_subty
        INTO @DATA(lv_sub_enabled).
      IF sy-subrc = 0 AND lv_sub_enabled = abap_false.
        RAISE EXCEPTION NEW zcx_hr_td( code = 'INFOTYPE_NOT_ALLOWED' text = |Subtype { iv_subty } of infotype { iv_infty } is not enabled.| ).
      ENDIF.
    ENDIF.
  ENDMETHOD.

  METHOD assert_employee_eligible.
    SELECT SINGLE @abap_true FROM zhr_td_excl WHERE pernr = @iv_pernr INTO @DATA(lv_excluded).
    IF lv_excluded = abap_true.
      RAISE EXCEPTION NEW zcx_hr_td( code = 'EMPLOYEE_NOT_ELIGIBLE' text = |Employee { iv_pernr } is on the exclusion list.| ).
    ENDIF.
  ENDMETHOD.

  METHOD masked_fields.
    SELECT fieldname FROM zhr_td_mask WHERE kind = @iv_kind AND infty = @iv_infty INTO TABLE @rt_fields.
  ENDMETHOD.

  METHOD limit.
    SELECT SINGLE value FROM zhr_td_limit WHERE limit_key = @iv_key INTO @rv_value.
    IF sy-subrc <> 0.
      rv_value = iv_default.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
