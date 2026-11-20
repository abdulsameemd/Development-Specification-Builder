"! <p>Test data wrapper – web interface /v1 (specification §12), ICF service in the TEST SYSTEM ONLY.</p>
"! Phase 1: status, describe infotype, employee search, read records, runs. Plans answer NOT_AVAILABLE_PHASE1.
"! Every request first passes ZCL_HR_TD_SAFETY->ASSERT_ENVIRONMENT (rule 1), except GET /status which reports it.
CLASS zcl_hr_td_http_handler DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PRIVATE SECTION.
    DATA mo_safety TYPE REF TO zcl_hr_td_safety.
    METHODS respond IMPORTING io_server TYPE REF TO if_http_server iv_status TYPE i iv_json TYPE string.
    METHODS respond_error IMPORTING io_server TYPE REF TO if_http_server ix_error TYPE REF TO zcx_hr_td.
    METHODS route IMPORTING io_server TYPE REF TO if_http_server RAISING zcx_hr_td.
ENDCLASS.

CLASS zcl_hr_td_http_handler IMPLEMENTATION.
  METHOD if_http_extension~handle_request.
    mo_safety = NEW zcl_hr_td_safety( ).
    TRY.
        route( server ).
      CATCH zcx_hr_td INTO DATA(lx_td).
        respond_error( io_server = server ix_error = lx_td ).
      CATCH cx_root INTO DATA(lx_any).
        respond_error( io_server = server ix_error = NEW zcx_hr_td( code = 'SERVICE_UNAVAILABLE' text = lx_any->get_text( ) ) ).
    ENDTRY.
  ENDMETHOD.

  METHOD route.
    DATA(lv_method) = io_server->request->get_method( ).
    DATA(lv_path)   = io_server->request->get_header_field( '~path_info' ).
    DATA(lv_body)   = io_server->request->get_cdata( ).
    DATA(lv_requester) = io_server->request->get_header_field( 'x-requester' ).

    IF lv_method = 'GET' AND lv_path = '/status'.
      respond( io_server = io_server iv_status = 200 iv_json = /ui2/cl_json=>serialize(
        data = VALUE zif_hr_td_types=>ty_status( system = sy-sysid client = sy-mandt allow_listed = mo_safety->is_allow_listed( )
                                               user = sy-uname wrapper_version = zcl_hr_td_safety=>c_version )
        pretty_name = /ui2/cl_json=>pretty_mode-camel_case ) ).
      RETURN.
    ENDIF.

    mo_safety->assert_environment( ).   " rule 1 – everything else is refused unless allow-listed

    DATA(lo_pa) = NEW zcl_hr_td_pa_read( mo_safety ).
    CASE lv_method.
      WHEN 'POST'.
        CASE lv_path.
          WHEN '/infotypes/read'.
            DATA ls_read TYPE zif_hr_td_types=>ty_read_request.
            /ui2/cl_json=>deserialize( EXPORTING json = lv_body pretty_name = /ui2/cl_json=>pretty_mode-camel_case CHANGING data = ls_read ).
            DATA(lt_records) = COND zcl_hr_td_pa_read=>tt_records(
              WHEN ls_read-kind = 'organization'
              THEN NEW zcl_hr_td_om_read( mo_safety )->read_records( iv_otype = ls_read-object_type iv_objid = ls_read-object_id iv_infty = ls_read-infotype iv_subty = ls_read-subtype )
              ELSE lo_pa->read_records( iv_pernr = ls_read-object_id iv_infty = ls_read-infotype iv_subty = ls_read-subtype ) ).
            respond( io_server = io_server iv_status = 200 iv_json = /ui2/cl_json=>serialize( data = lt_records pretty_name = /ui2/cl_json=>pretty_mode-camel_case ) ).
          WHEN '/employees/search'.
            " TODO-PHASE1: criteria filter on top of LIST_EMPLOYEES + READ_RECORDS (0001) – spec §14 item H
            RAISE EXCEPTION NEW zcx_hr_td( code = 'SERVICE_UNAVAILABLE' text = 'Employee search is built after Phase 0 item H.' ).
          WHEN OTHERS.
            IF lv_path CP '/plans*'.
              RAISE EXCEPTION NEW zcx_hr_td( code = 'SERVICE_UNAVAILABLE' text = 'NOT_AVAILABLE_PHASE1: plans come in Phase 2.' ).
            ENDIF.
            RAISE EXCEPTION NEW zcx_hr_td( code = 'SERVICE_UNAVAILABLE' text = |Unknown path { lv_path }.| ).
        ENDCASE.
      WHEN 'GET'.
        IF lv_path CP '/infotypes/*'.
          DATA(lv_infty) = substring_after( val = lv_path sub = '/infotypes/' ).
          respond( io_server = io_server iv_status = 200 iv_json = /ui2/cl_json=>serialize( data = lo_pa->describe_fields( lv_infty ) ) ).
        ELSEIF lv_path = '/runs'.
          respond( io_server = io_server iv_status = 200 iv_json = '{"runs":[]}' ).   " Phase 1: no ledger yet
        ELSE.
          RAISE EXCEPTION NEW zcx_hr_td( code = 'SERVICE_UNAVAILABLE' text = |Unknown path { lv_path }.| ).
        ENDIF.
      WHEN OTHERS.
        RAISE EXCEPTION NEW zcx_hr_td( code = 'SERVICE_UNAVAILABLE' text = |Method { lv_method } not supported.| ).
    ENDCASE.
    CLEAR lv_requester.   " Phase 2: stored in the ledger with every plan
  ENDMETHOD.

  METHOD respond.
    io_server->response->set_status( code = iv_status reason = '' ).
    io_server->response->set_header_field( name = 'content-type' value = 'application/json; charset=utf-8' ).
    io_server->response->set_cdata( iv_json ).
  ENDMETHOD.

  METHOD respond_error.
    DATA(lv_status) = SWITCH i( ix_error->code
      WHEN 'CLIENT_NOT_ALLOWED' OR 'SYSTEM_MISMATCH' OR 'INFOTYPE_NOT_ALLOWED' OR 'EMPLOYEE_NOT_ELIGIBLE' OR 'AUTHORIZATION_MISSING' THEN 403
      WHEN 'SERVICE_UNAVAILABLE' THEN 503
      ELSE 422 ).
    respond( io_server = io_server iv_status = lv_status iv_json = /ui2/cl_json=>serialize(
      data = VALUE zif_hr_td_types=>ty_error_body( error = VALUE #( code = ix_error->code message = ix_error->text sap_messages = ix_error->sap_messages ) )
      pretty_name = /ui2/cl_json=>pretty_mode-camel_case ) ).
  ENDMETHOD.
ENDCLASS.
