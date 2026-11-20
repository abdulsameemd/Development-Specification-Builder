"! <p>Test data wrapper – Organizational Management READ operations (Phase 1).</p>
"! Uses RH_READ_INFTY (classic API, spec §4.4 alternative to CL_HRBAS_PD_OBJECT). No SELECT from HRPnnnn.
"! TODO-PHASE0 (item A): confirm whether CL_HRBAS_PD_OBJECT offers the same read and prefer it if so.
CLASS zcl_hr_td_om_read DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS constructor IMPORTING io_safety TYPE REF TO zcl_hr_td_safety.
    METHODS read_records
      IMPORTING iv_otype TYPE csequence iv_objid TYPE csequence iv_infty TYPE csequence iv_subty TYPE csequence OPTIONAL
                iv_begda TYPE d DEFAULT '19000101' iv_endda TYPE d DEFAULT '99991231'
      RETURNING VALUE(rt_records) TYPE zcl_hr_td_pa_read=>tt_records
      RAISING   zcx_hr_td.
  PRIVATE SECTION.
    DATA mo_safety TYPE REF TO zcl_hr_td_safety.
ENDCLASS.

CLASS zcl_hr_td_om_read IMPLEMENTATION.
  METHOD constructor.
    mo_safety = io_safety.
  ENDMETHOD.

  METHOD read_records.
    DATA lr_tab TYPE REF TO data.
    FIELD-SYMBOLS <lt_tab> TYPE STANDARD TABLE.
    mo_safety->assert_infotype_enabled( iv_kind = 'O' iv_infty = iv_infty iv_subty = iv_subty ).
    DATA(lt_masked) = mo_safety->masked_fields( iv_kind = 'O' iv_infty = iv_infty ).
    CREATE DATA lr_tab TYPE STANDARD TABLE OF (|P{ iv_infty }|).
    ASSIGN lr_tab->* TO <lt_tab>.
    " TODO-PHASE0 verify: RH_READ_INFTY parameter names (PLVAR, OTYPE, OBJID, INFTY, SUBTY, BEGDA, ENDDA, INNNN)
    CALL FUNCTION 'RH_READ_INFTY'
      EXPORTING
        plvar                = '01'
        otype                = iv_otype
        objid                = iv_objid
        infty                = iv_infty
        subty                = iv_subty
        begda                = iv_begda
        endda                = iv_endda
      TABLES
        innnn                = <lt_tab>
      EXCEPTIONS
        all_infty_with_subty = 1
        nothing_found        = 2
        no_objects           = 3
        wrong_condition      = 4
        wrong_parameters     = 5
        OTHERS               = 6.
    IF sy-subrc = 2 OR sy-subrc = 3.
      RETURN.
    ELSEIF sy-subrc <> 0.
      RAISE EXCEPTION NEW zcx_hr_td( code = 'VALIDATION_FAILED' text = |RH_READ_INFTY returned { sy-subrc }.| ).
    ENDIF.
    LOOP AT <lt_tab> ASSIGNING FIELD-SYMBOL(<ls_row>).
      ASSIGN COMPONENT 'SUBTY' OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_subty>).
      ASSIGN COMPONENT 'BEGDA' OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_begda>).
      ASSIGN COMPONENT 'ENDDA' OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_endda>).
      APPEND VALUE #( infotype = iv_infty subtype = <lv_subty> valid_from = |{ <lv_begda> DATE = ISO }| valid_to = |{ <lv_endda> DATE = ISO }| ) TO rt_records ASSIGNING FIELD-SYMBOL(<ls_rec>).
      DATA(lo_struct) = CAST cl_abap_structdescr( cl_abap_typedescr=>describe_by_data( <ls_row> ) ).
      LOOP AT lo_struct->get_components( ) INTO DATA(ls_comp) WHERE as_include = abap_false.
        ASSIGN COMPONENT ls_comp-name OF STRUCTURE <ls_row> TO FIELD-SYMBOL(<lv_value>).
        IF <lv_value> IS ASSIGNED AND <lv_value> IS NOT INITIAL AND ls_comp-name <> 'MANDT'.
          APPEND VALUE #( name = ls_comp-name value = COND #( WHEN line_exists( lt_masked[ table_line = ls_comp-name ] ) THEN '***' ELSE |{ <lv_value> }| ) ) TO <ls_rec>-fields.
        ENDIF.
        UNASSIGN <lv_value>.
      ENDLOOP.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
