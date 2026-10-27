# Evidencia de predicción: despliegue pendiente de autorización

No ejecutar estos pasos contra Supabase real durante la Fase 6. No hay un entorno
PostgreSQL/Supabase de desarrollo configurado; las pruebas disponibles usan PGlite.

1. **Inspección de solo lectura:** ejecutar `20261027_prediction_evidence.inspect.sql`
   en SQL Editor. Confirmar tipos, PK, propietarios, RLS, predicados completos,
   privilegios heredados y firmas. Los hashes de políticas no validan su lógica.
   El script no consulta filas comerciales ni usuarios. Los inventarios actuales
   son compartidos entre miembros; esta propuesta no introduce multitenencia.
2. **Respaldo — requiere autorización posterior:** obtener un respaldo completo
   mediante las opciones disponibles del proyecto, incluyendo esquema, datos,
   funciones, ACL/RLS y secuencias. Verificar una restauración en un entorno
   aislado autorizado; guardar el respaldo y los resultados de inspección fuera
   de este repositorio y con acceso restringido. No asumir que el plan dispone de
   PITR ni que un export parcial permite recuperar todo.
3. **Ensayo aislado:** con esquema compatible y únicamente datos sintéticos,
   aplicar la propuesta y comprobar las sesiones anon, authenticated no miembro,
   miembro y revisor. La simulación `auth.uid()` de los tests no valida JWT,
   PostgREST ni las ACL efectivas de Supabase: repetir mediante sesiones reales
   del entorno aislado. Ensayar la reversión de una instalación vacía y confirmar
   que se rechaza con revisiones presentes; conservar evidencia al corregirla.
4. **Aplicación real — requiere autorización explícita:** acordar una ventana
   sin escrituras y comparar con el respaldo. Usar SQL Editor con rol `postgres`;
   comprobar `current_user`, no solo el usuario de conexión. Si el editor usa otro
   rol, revisar el procedimiento y permisos antes de cambiar el requisito.
   Ejecutar la propuesta completa como una transacción. No es una migración
   idempotente: si hay objetos previos, detenerse y revisar, no reemplazarlos.
5. **Verificación posterior:** repetir inspector, comparar funciones/ACL/RLS de
   tablas existentes y verificar con el respaldo que productos, ventas, importes,
   cantidades, fechas y movimientos permanecen intactos. Un conteo igual no prueba
   integridad. Comprobar tres tablas nuevas sin filas, índices, cuatro funciones,
   triggers de UPDATE/DELETE/TRUNCATE y ausencia de acceso directo de clientes.
6. **Primer revisor — autorización independiente:** el propietario identifica
   privadamente una cuenta existente y miembro del inventario. Con parámetros
   verificados, el propietario inserta su UUID en `inventory_prediction_reviewers`;
   revoca eliminando su asignación. No se incluyen UUID ni asignaciones de ejemplo
   ejecutables. Las verificaciones históricas conservan su autor tras una baja.
7. **Clasificación — autorización posterior:** un revisor clasifica explícitamente
   las ventas de desarrollo como `test`, con referencia. Ninguna venta nueva se
   vuelve comercial por defecto. Las revisiones correctivas agregan eventos.
   La cobertura exige registro completo y disponibilidad comprobada por día Lima;
   no derivarla de la primera venta ni del stock actual.
8. **Recuperación:** ante error antes de COMMIT, ejecutar ROLLBACK en esa sesión.
   Después de COMMIT, la reversión propuesta solo admite instalación vacía y no
   usa CASCADE. Con evidencia o revisores, bloquear consumo/administración y
   preservar auditoría; restaurar un respaldo solo con plan y autorización nuevos.
   Un propietario puede modificar DDL: los triggers no son protección criptográfica
   contra el administrador ni sustituyen respaldos/auditoría externa.

Fase 7: agregar lectura autenticada de `inventory_prediction_evidence` únicamente
desde el backend y propagar su respuesta, sin aceptar evidencia arbitraria del
navegador. Tratar dependencia ausente y permisos denegados como estados distintos.
Todavía no conectar, asignar revisores ni activar pronósticos comerciales.
