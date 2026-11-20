"! <p>Test data wrapper – Personnel Administration / Time Management READ operations (Phase 1).</p>
"! Uses only classic APIs of specification §4.4: CL_HRPA_READ_INFOTYPE (read), CL_HR_PNNNN_TYPE_CAST (record
"! conversion), BAPI_EMPLOYEE_GETLIST (search), RTTI (describe). No SELECT from PA tables.
"! Every SAP method name and parameter marked TODO-PHASE0 must be confirmed in ADT before activation (Phase 0, item A/H).
CLASS zcl_hr_td_pa_read DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_field_value,
             name  TYPE string,
             value TYPE string,
           END OF ty_field_value,
           tt_field_values TYPE STANDARD TABLE OF ty_field_value WITH EMPTY KEY,
           BEGIN OF ty_record,
             infotype   TYPE string,
             subtype    TYPE string,
             valid_from TYPE string,
             valid_to   TYPE string,
             fields     TYPE tt_field_values,
           END OF ty_record,
           tt_records TYPE STANDARD TABLE OF ty_record WITH EMPTY KEY,
           tt_pernr   TYPE STANDARD TABLE OF string WITH EMPTY KEY.

    METHODS constructor IMPORTING io_safety TYPE REF TO zcl_hr_td_safety.

    "! Records of one infotype for one employee, masked by the policy (rule 9)
    METHODS read_records
      IMPORTING iv_pernr TYPE csequence iv_infty TYPE csequence iv_subty TYPE csequence OPTIONAL
                iv_begda TYPE d DEFAULT '19000101' iv_endda TYPE d DEFAULT '99991231'
      RETURNING VALUE(rt_records) TYPE tt_records
      RAISING   zcx_hr_td.

    "! Fields of an infotype by RTTI on structure Pnnnn (works for custom 9nnn infotypes)
    METHODS describe_fields
      IMPORTING iv_infty TYPE csequence
      RETURNING VALUE(rt_fields) TYPE zcl_hr_td_safety=>tt_fields
      RAISING   zcx_hr_td.

    "! Employee numbers of the test client – paged scan up to the policy cap (no SELECT on PA0001, spec item H)
    METHODS list_employees
      IMPORTING iv_max TYPE i
      RETURNING VALUE(rt_pernr) TYPE tt_pernr.
  PRIVATE SECTION.
    DATA mo_safety TYPE REF TO zcl_hr_td_safety.
    CONSTANTS c_mask TYPE string VALUE '***'.
    CONSTANTS c_admin_fields TYPE string VALUE 'MANDT PERNR SUBTY OBJPS SPRPS ENDDA BEGDA SEQNR AEDTM UNAME HISTO ITXEX REFEX ORDEX ITBLD PREAS FLAG1 FLAG2 FLAG3 FLAG4 RESE1 RESE2 GRPVL INFTY'.
ENDCLASS.

CLASS zcl_hr_td_pa_read IMPLEMENTATION.
  METHOD constructor.
    mo_safety = io_safety.
  ENDMETHOD.

  METHOD read_records.
    DATA lo_reader  TYPE REF TO if_hrpa_read_infotype.
    DATA lt_prelp   TYPE prelp_tab.
    DATA lv_exists  TYPE abap_bool.
    DATA lr_pnnnn   TYPE REF TO data.
    FIELD-SYMBOLS <ls_pnnnn> TYPE any.

    mo_safety->assert_infotype_enabled( iv_kind = 'P' iv_infty = iv_infty iv_subty = iv_subty ).
    mo_safety->assert_employee_eligible( iv_pernr ).
    DATA(lt_masked) = mo_safety->masked_fields( iv_kind = 'P' iv_infty = iv_infty ).

    " TODO-PHASE0 verify: GET_INSTANCE signature and IF_HRPA_READ_INFOTYPE~READ parameters (tclas, infty, begda, endda,
    " no_auth_check, infotype_tab, data_exists) in S/4HANA 2023.
    cl_hrpa_read_infotype=>get_instance( IMPORTING infotype_reader = lo_reader ).
    lo_reader->read( EXPORTING tclas = 'A' pernr = CONV #( iv_pernr ) infty = CONV #( iv_infty )
                               begda = iv_begda endda = iv_endda no_auth_check = abap_false
                     IMPORTING infotype_tab = lt_prelp data_exists = lv_exists ).
    IF lv_exists = abap_false.
      RETURN.
    ENDIF.

    CREATE DATA lr_pnnnn TYPE (|P{ iv_infty }|).
    ASSIGN lr_pnnnn->* TO <ls_pnnnn>.
    LOOP AT lt_prelp INTO DATA(ls_prelp).
      IF iv_subty IS NOT INITIAL AND ls_prelp-subty <> iv_subty.
        CONTINUE.
      ENDIF.
      " TODO-PHASE0 verify: CL_HR_PNNNN_TYPE_CAST=>PRELP_TO_PNNNN parameter names
      cl_hr_pnnnn_type_cast=>prelp_to_pnnnn( EXPORTING prelp = ls_prelp IMPORTING pnnnn = <ls_pnnnn> ).
      APPEND VALUE #( infotype = iv_infty subtype = ls_prelp-subty
                      valid_from = |{ ls_prelp-begda+0(4) }-{ ls_prelp-begda+4(2) }-{ ls_prelp-begda+6(2) }|
                      valid_to   = |{ ls_prelp-endda+0(4) }-{ ls_prelp-endda+4(2) }-{ ls_prelp-endda+6(2) }| ) TO rt_records ASSIGNING FIELD-SYMBOL(<ls_rec>).
      DATA(lo_struct) = CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_data( <ls_pnnnn> ) ).
      LOOP AT lo_struct->get_components( ) INTO DATA(ls_comp) WHERE as_include = abap_false.
        IF c_admin_fields CS ls_comp-name.
          CONTINUE.
        ENDIF.
        ASSIGN COMPONENT ls_comp-name OF STRUCTURE <ls_pnnnn> TO FIELD-SYMBOL(<lv_value>).
        IF <lv_value> IS ASSIGNED AND <lv_value> IS NOT INITIAL.
          " rule 9: masked fields never leave SAP
          APPEND VALUE #( name = ls_comp-name value = COND #( WHEN line_exists( lt_masked[ table_line = ls_comp-name ] ) THEN c_mask ELSE |{ <lv_value> }| ) ) TO <ls_rec>-fields.
        ENDIF.
        UNASSIGN <lv_value>.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.

  METHOD describe_fields.
    cl_abap_typedescr=>describe_by_name( EXPORTING p_name = |P{ iv_infty }| RECEIVING p_descr_ref = DATA(lo_type) EXCEPTIONS type_not_found = 1 OTHERS = 2 ).
    IF sy-subrc <> 0.
      RAISE EXCEPTION NEW zcx_hr_td( code = 'INFOTYPE_NOT_ALLOWED' text = |Infotype { iv_infty } does not exist.| ).
    ENDIF.
    LOOP AT CAST cl_abap_structdescr( lo_type )->get_components( ) INTO DATA(ls_comp) WHERE as_include = abap_false.
      IF c_admin_fields NS ls_comp-name.
        APPEND ls_comp-name TO rt_fields.
      ENDIF.
    ENDLOOP.
    " TODO-PHASE0: mandatory fields, subtypes and time constraint must come from the classic infotype classes (not from
    " T582A / T591A, which are not classified) – confirm which class / method exposes them (spec §4.4, item A).
  ENDMETHOD.

  METHOD list_employees.
    DATA lt_list TYPE STANDARD TABLE OF bapiemplb.
    " TODO-PHASE0 verify: BAPI_EMPLOYEE_GETLIST parameters for a broad search (spec §14 item H) and the scan cap
    CALL FUNCTION 'BAPI_EMPLOYEE_GETLIST'
      EXPORTING
        date          = sy-datum
      TABLES
        employee_list = lt_list.
    LOOP AT lt_list INTO DATA(ls_emp) TO iv_max.
      APPEND |{ ls_emp-perno }| TO rt_pernr.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
