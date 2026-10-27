-- REVERSION PROPUESTA: requiere autorizacion posterior para cualquier base real.
-- Solo instalacion VACIA, sin evidencia ni revisores. Nunca elimina auditoria.
-- Si ya hay revisiones: detener integracion y conservar tablas; respaldar/restaurar
-- mediante un plan revisado aparte. No usar CASCADE, TRUNCATE ni borrar eventos.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Evita que una verificacion concurrente aparezca entre el conteo y el DROP.
LOCK TABLE public.inventory_prediction_reviewers, public.inventory_prediction_sale_reviews,
  public.inventory_prediction_day_reviews IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'PREDICTION_OWNER_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_prediction_sale_reviews)
    OR EXISTS (SELECT 1 FROM public.inventory_prediction_day_reviews)
    OR EXISTS (SELECT 1 FROM public.inventory_prediction_reviewers) THEN
    RAISE EXCEPTION 'PREDICTION_ROLLBACK_REQUIRES_EMPTY_INSTALLATION';
  END IF;
END $$;
DROP FUNCTION public.inventory_prediction_evidence(timestamptz);
DROP FUNCTION public.inventory_prediction_review_day(bigint,date,boolean,text,text);
DROP FUNCTION public.inventory_prediction_classify_sale(uuid,text,text);
DROP TABLE public.inventory_prediction_day_reviews;
DROP TABLE public.inventory_prediction_sale_reviews;
DROP TABLE public.inventory_prediction_reviewers;
DROP FUNCTION public.inventory_prediction_immutable();
COMMIT;
