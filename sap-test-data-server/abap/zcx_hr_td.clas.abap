"! <p>Test data wrapper – error with one of the codes of specification §11 and SAP's own messages.</p>
CLASS zcx_hr_td DEFINITION PUBLIC INHERITING FROM cx_static_check FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES tt_messages TYPE STANDARD TABLE OF string WITH EMPTY KEY.
    DATA code         TYPE string READ-ONLY.
    DATA text         TYPE string READ-ONLY.
    DATA sap_messages TYPE tt_messages READ-ONLY.
    METHODS constructor
      IMPORTING code         TYPE csequence
                text         TYPE csequence OPTIONAL
                sap_messages TYPE tt_messages OPTIONAL
                previous     LIKE previous OPTIONAL.
    METHODS get_text REDEFINITION.
ENDCLASS.

CLASS zcx_hr_td IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( previous = previous ).
    me->code = code.
    me->text = text.
    me->sap_messages = sap_messages.
  ENDMETHOD.
  METHOD get_text.
    result = |{ code }: { text }|.
  ENDMETHOD.
ENDCLASS.
