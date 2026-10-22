import { useEffect, useState } from 'react';
import { RefreshCw, Download, ChartNoAxesCombined, ArrowDownLeft, ArrowUpRight, Scale, PackageX, ArrowLeft, ArrowRight } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { loadReports } from '../api/inventoryApi';
import { buildReports, searchReport, reportPage, reportsCsv, reportDay, periodBucket } from './reportsData';
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import styles from './Reportes.module.css';

const number = n => n == null ? 'Sin datos' : new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(n);
const types = { flow:'Entradas y salidas', ranking:'Mayor rotación por salidas', inactive:'Productos sin movimiento', value:'Valor actual del inventario', counts:'Diferencias de conteos', sessions:'Sesiones de inventario físico' };
const signed = n => `${n > 0 ? '+' : ''}${number(n)}`;
const numericHeaders = new Set(['Stock actual','Unidades salientes','Movimientos','Costo unitario PEN','Valor actual PEN','Entradas (unidades)','Salidas (unidades)','Referencia','Físico','Diferencia','Sobrantes','Faltantes','Líneas contadas','Sin contar','Con diferencias']);
const chartDate = (date, group) => group==='month'
  ? new Date(`${date}T12:00:00Z`).toLocaleDateString('es-PE',{month:'short',year:'2-digit',timeZone:'America/Lima'})
  : `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(2,4)}`;

function FlowTooltip({ active, payload, group }) {
  if(!active || !payload?.length)return null;
  const row=payload[0].payload;
  return <div className={styles.tooltip}><strong>{group==='week'?'Semana del ':''}{chartDate(row.date,group)}</strong>
    <p><span className={styles.entryDot} aria-hidden="true" />Entradas <b>{number(row.entries)} uds.</b></p>
    <p><span className={styles.exitDot} aria-hidden="true" />Salidas <b>{number(row.exits)} uds.</b></p>
  </div>;
}

export function FlowReportRow({ row }) {
  const extraOrigin = row.origin && String(row.origin).trim() !== String(row.type ?? '').trim();
  return <tr>
    <td className={styles.flowDate}>{reportDay(row.date)}</td>
    <td className={styles.flowProduct}><strong>{row.product ?? 'No disponible'}</strong><span>{row.sku ?? 'No disponible'}</span></td>
    <td><span className={styles.typeBadge} data-kind={row.type}>{row.type ?? 'No disponible'}</span>{extraOrigin && <span className={styles.flowOrigin}>{row.origin}</span>}</td>
    <td className={styles.numeric}>{row.entries ?? 'No disponible'}</td>
    <td className={styles.numeric}>{row.exits ?? 'No disponible'}</td>
    <td className={styles.flowReason}>{row.reason ?? 'No disponible'}</td>
  </tr>;
}

export default function Reportes() {
  const today=reportDay(new Date().toISOString());
  const [from,setFrom]=useState(today.slice(0,8)+'01');
  const [to,setTo]=useState(today);
  const [group,setGroup]=useState('day');
  const [top,setTop]=useState(10);
  const [kind,setKind]=useState('flow');
  const [query,setQuery]=useState('');
  const [sort,setSort]=useState('date');
  const [page,setPage]=useState(1);
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    loadReports(controller.signal).then(result=>{if(!controller.signal.aborted){setData(result);setLoading(false);}})
      .catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);}});
    return ()=>controller.abort();
  },[attempt]);
  function refresh(){setLoading(true);setData(null);setError('');setAttempt(n=>n+1);}
  let report=null, calculationError='';
  try { if(data) report=buildReports(data,{from,to,group,top}); } catch(e){calculationError=e.message;}
  const historyKnown=data && !data.readOnly;
  const countsKnown=data?.physical?.enabled===true;
  const unavailable=(['flow','ranking','inactive'].includes(kind)&&!historyKnown)||(['counts','sessions'].includes(kind)&&!countsKnown);
  const configs=report?{
    flow:{rows:report.movements,headers:['Fecha (Lima)','Periodo agrupado','SKU','Producto','Tipo registrado','Origen identificable','Entradas (unidades)','Salidas (unidades)','Motivo'],values:m=>[reportDay(m.date),periodBucket(m.day,group),m.sku,m.product,m.type,m.origin,m.entries,m.exits,m.reason]},
    ranking:{rows:report.ranking,headers:['SKU','Producto','Unidades salientes','Movimientos'],values:r=>[r.sku,r.name,r.units,r.operations]},
    inactive:{rows:report.inactive,headers:['SKU','Producto','Stock actual','Último movimiento conocido (Lima)','Situación'],values:r=>[r.sku,r.name,r.stock,r.last?reportDay(r.last):'Sin registro verificable',r.inactivity]},
    value:{rows:report.valuation,headers:['SKU','Producto','Stock actual','Costo unitario PEN','Valor actual PEN'],values:r=>[r.sku,r.name,r.stock,r.cost,r.value]},
    counts:{rows:report.differences,headers:['Sesión','Fecha de creación (Lima)','Estado','SKU','Producto','Referencia','Físico','Diferencia','Sobrantes','Faltantes','Motivo'],values:r=>[r.session_id,reportDay(r.session.created_at),r.session.status,r.sku,r.product_name,r.reference_stock,r.physical_quantity,r.delta,r.surplus,r.shortage,r.reason]},
    sessions:{rows:report.countSessions,headers:['Sesión','Fecha de creación (Lima)','Estado','Responsable','Líneas contadas','Sin contar','Con diferencias','Sobrantes','Faltantes'],values:r=>[r.id,reportDay(r.created_at),r.status,r.actor_email,r.counted,r.pending,r.differences,r.surplus,r.shortage]},
  }:null;
  const config=configs?.[kind];
  const tableHeaders=kind==='flow'?['Fecha','Producto / SKU','Movimiento','Entrada','Salida','Motivo']:config?.headers;
  const rows=config&&!unavailable?searchReport(config.rows,query,sort):[];
  const pagination=reportPage(rows,page,20);
  const note='Fechas inclusivas de Lima. Flujos por saldo posterior menos anterior; no suman ventas otra vez. Ranking solo Salida/Venta; no es tasa de rotación ni demanda certificada. Valor actual a costo de compra, independiente del periodo. Conteos por fecha de creación; precisión excluye sin contar y cancelados. Cancelados se muestran solo como historial. Consulta '+(data?.consultedAt||'');
  function download(){
    if(!config||unavailable||loading||calculationError||error)return;
    const summary=kind==='flow'?` Entradas de filas exportadas: ${rows.reduce((n,r)=>n+r.entries,0)}; salidas: ${rows.reduce((n,r)=>n+r.exits,0)}.`:'';
    const csv=reportsCsv(types[kind],config.headers,rows.map(config.values),{from:kind==='value'?'':from,to:kind==='value'?'':to,note:note+summary+` Búsqueda: ${query}; orden: ${sort}; Top: ${top}; agrupación: ${group}.`});
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    const link=document.createElement('a');link.href=url;link.download=`reporte-${kind}-${today}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function change(setter,value){setter(value);setPage(1);}
  function changeKind(value){setKind(value);setSort(value==='ranking'?'units':['flow','sessions','counts'].includes(value)?'date':'name');setPage(1);}
  return <div className={`${s.page} ${ui.workspace} ${styles.workspace}`} aria-busy={loading}>
    <header className={`${s.header} ${ui.heading} ${styles.heading}`}><div><h1>Reportes e indicadores</h1></div><button className={ui.secondary} disabled={loading} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />{loading?'Consultando…':'Actualizar'}</button></header>
    {loading&&<p role="status" className={ui.notice}>Consultando el historial completo autorizado…</p>}
    {(error||calculationError)&&<p role="alert" className={ui.alert}>{error||calculationError}</p>}
    <section className={`${s.card} ${styles.period} ${ui.productFilters}`} aria-labelledby="report-period-title"><h2 id="report-period-title">Período de análisis</h2><div className={`${s.filters} ${styles.periodFields}`}><label className={s.field}>Desde<input type="date" value={from} onChange={e=>change(setFrom,e.target.value)} /></label><label className={s.field}>Hasta<input type="date" value={to} onChange={e=>change(setTo,e.target.value)} /></label><label className={s.field}>Agrupar por<select value={group} onChange={e=>change(setGroup,e.target.value)}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></label></div></section>
    {report&&<>
      <section className={`${styles.cards} ${ui.summary}`} aria-label="Indicadores del periodo completo">
        {[
          ['Entradas',historyKnown?number(report.entries):'No disponible','unidades · periodo seleccionado','Variaciones positivas registradas',ArrowDownLeft,'entries'],
          ['Salidas',historyKnown?number(report.exits):'No disponible','unidades · periodo seleccionado','Variaciones negativas registradas',ArrowUpRight,'exits'],
          ['Balance neto',historyKnown?signed(report.net):'No disponible','unidades · entradas − salidas',historyKnown?(report.net>0?'Predominan las entradas':report.net<0?'Predominan las salidas':'Sin variación neta'):'Historial no habilitado',Scale,'balance'],
          ['Productos agotados',number(report.empty),'productos · stock actual = 0',report.empty>0?'Requieren atención de reposición':'Sin productos agotados en el catálogo',PackageX,report.empty>0?'empty':'clear'],
        ].map(([label,value,unit,description,Icon,tone])=><article key={label} className={styles.kpi} data-tone={tone}>
          <div className={styles.kpiHeading}><span>{label}</span><Icon size={16} aria-hidden="true" /></div>
          <strong className={styles.kpiValue}>{value}</strong><span className={styles.kpiUnit}>{unit}</span>
          <p className={styles.kpiDescription}>{description}</p>
        </article>)}
      </section>
      
      
      {!countsKnown&&<p className={ui.notice} role="status">Los reportes de conteos requieren habilitar las tablas y políticas de Fase 5. No se interpreta su ausencia como cero diferencias.</p>}
      {!historyKnown&&<p className={ui.notice} role="status">El historial de movimientos no está habilitado para esta cuenta. Los flujos, ranking y productos sin movimiento no están disponibles.</p>}
      <section className={`${s.card} ${styles.chartCard}`} aria-label="Gráfico de flujos"><div className={styles.chartHeading}><div><h2>Flujo de almacén</h2><p>Entradas y salidas por {group==='day'?'día':group==='week'?'semana':'mes'}</p></div></div>
        {historyKnown&&report.series.length?<div className={styles.chart} role="img" aria-label={`Entradas ${report.entries}, salidas ${report.exits} unidades`}><ResponsiveContainer width="100%" height="100%"><BarChart data={report.series} accessibilityLayer margin={{top:12,right:12,left:0,bottom:8}} barGap={4}>
          <CartesianGrid vertical={false} stroke="var(--inventory-border, #e5e7eb)" strokeDasharray="3 5" />
          <XAxis dataKey="date" tickFormatter={date=>chartDate(date,group)} tick={{fill:'var(--inventory-muted, #64748b)',fontSize:11}} minTickGap={24} tickMargin={12} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} width={48} tickFormatter={n=>new Intl.NumberFormat('es-PE',{notation:'compact',maximumFractionDigits:1}).format(n)} tick={{fill:'var(--inventory-muted, #64748b)',fontSize:11}} axisLine={false} tickLine={false} />
          <Tooltip cursor={{fill:'var(--inventory-surface-alt, #f8f9fb)'}} content={<FlowTooltip group={group} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12,paddingTop:20,color:'var(--inventory-ink, #202735)'}} />
          <Bar dataKey="entries" name="Entradas" fill="var(--report-entry)" radius={[4,4,0,0]} maxBarSize={32} isAnimationActive={false} />
          <Bar dataKey="exits" name="Salidas" fill="var(--report-exit)" radius={[4,4,0,0]} maxBarSize={32} isAnimationActive={false} />
        </BarChart></ResponsiveContainer></div>:<p role="status" className={styles.chartEmpty}>{historyKnown?'No hay movimientos en el periodo.':'Historial no disponible.'}</p>}
        <p className={styles.chartFootnote}>Solo periodos con movimientos registrados. Las semanas comienzan el lunes; sus barras incluyen únicamente las fechas seleccionadas.</p>
      </section>
    </>}
    <section className={`${s.card} ${styles.section}`} aria-labelledby="report-detail-title"><h2 id="report-detail-title">Detalle del reporte</h2><div className={`${s.filters} ${ui.productFilters} ${styles.detailFilters}`}>
      <label className={s.field}>Reporte<select value={kind} onChange={e=>changeKind(e.target.value)}>{Object.entries(types).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label className={s.field}>Buscar<input type="search" placeholder="Producto, SKU o sesión" value={query} onChange={e=>change(setQuery,e.target.value)} /></label>
      <label className={s.field}>Ordenar por<select value={sort} onChange={e=>change(setSort,e.target.value)}><option value="date">Fecha descendente</option><option value="name">Producto / referencia</option><option value="stock">Stock ascendente</option><option value="units">Unidades salientes descendentes</option></select></label>
      {kind==='ranking'&&<label className={s.field}>Ranking<select value={top} onChange={e=>change(setTop,Number(e.target.value))}>{[5,10,20].map(n=><option key={n} value={n}>Top {n}</option>)}</select></label>}
      <button className={ui.secondary} disabled={!config||unavailable||loading||!!error||!!calculationError} onClick={download}><Download size={16} aria-hidden="true" />Exportar CSV</button>
    </div><h3 className={styles.reportTitle}>{types[kind]}</h3>
    {kind==='ranking'&&<p className={ui.notice}>Indicador operativo por unidades salientes de tipos Salida y Venta. Excluye Ajuste, Alta y Baja; no es una tasa formal de rotación. El motivo libre de una Salida no permite certificar si fue consumo interno o demanda. Referencias sin ID se identifican solo por SKU.</p>}
    {kind==='inactive'&&<p className={ui.notice}>Catálogo actual sin registros en el periodo, incluidos cambios sin variación de stock. La última fecha conocida considera todo el historial disponible, incluso registros posteriores al periodo. Un historial sin ID no permite certificar identidad por SKU.</p>}
    <p className={`${s.muted} ${styles.counter}`} role="status">{rows.length} registros</p>
    <div className={`${s.tableWrap} ${ui.tableSurface}`} role="region" aria-label="Tabla del reporte" tabIndex={0}>{config&&rows.length?<table className={`${s.table} ${styles.table} ${kind==='flow'?styles.flowTable:''}`}><caption className={styles.srOnly}>{types[kind]}</caption><thead><tr>{tableHeaders.map(h=><th key={h} scope="col" aria-label={kind==='flow'&&['Entrada','Salida'].includes(h)?`${h} (unidades)`:undefined} className={numericHeaders.has(h)||kind==='flow'&&['Entrada','Salida'].includes(h)?styles.numeric:undefined}>{h}</th>)}</tr></thead><tbody>{pagination.rows.map((row,i)=>kind==='flow'?<FlowReportRow key={row.id} row={row} />:<tr key={`${row.id??row.session_id??row.sku}:${row.product_id??i}`}>{config.values(row).map((value,j)=>{
      const header=config.headers[j];
      const cellClass=header==='SKU'||header==='Sesión'?styles.identifier:header==='Producto'?styles.productName:numericHeaders.has(header)?styles.numeric:header==='Origen identificable'?styles.origin:undefined;
      return <td key={j} className={cellClass}>{header==='Tipo registrado'?<span className={styles.typeBadge} data-kind={value}>{value==null?'No disponible':String(value)}</span>:value==null?'No disponible':String(value)}</td>;
    })}</tr>)}</tbody></table>:<div className={s.empty}><ChartNoAxesCombined size={32} aria-hidden="true" /><p>{loading?'Cargando reportes…':unavailable?'Este reporte requiere datos o permisos aún no habilitados.':error||calculationError?'No se pudo generar el reporte.':'No hay registros para los filtros seleccionados.'}</p></div>}</div>
    {pagination.pages>1&&<nav className={ui.pagination} aria-label="Paginación del reporte"><button className={ui.secondary} disabled={pagination.page<=1} onClick={()=>setPage(pagination.page-1)}><ArrowLeft size={16} aria-hidden="true" />Anterior</button><span>Página {pagination.page} de {pagination.pages}</span><button className={ui.secondary} disabled={pagination.page>=pagination.pages} onClick={()=>setPage(pagination.page+1)}>Siguiente<ArrowRight size={16} aria-hidden="true" /></button></nav>}
    </section>
  </div>;
}
