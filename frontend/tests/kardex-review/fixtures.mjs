// Datos sintéticos exclusivos de la revisión local; nunca se envían a Supabase.
const products = [
  {id:1,name:'Mouse de revisión Kardex',sku:'REV-M01',category:'Periféricos',stock:14,minStock:3,price:80,version:6},
  {id:2,name:'Producto paginado de revisión',sku:'REV-PAG',category:'Periféricos',stock:30,minStock:3,price:10,version:30},
  {id:3,name:'Producto antiguo de revisión',sku:'REV-ANT',category:'Periféricos',stock:12,minStock:3,price:20,version:2},
  {id:4,name:'Producto sin historial',sku:'REV-VAC',category:'Periféricos',stock:0,minStock:3,price:15,version:1},
];
const move=(id,productId,type,before,after,day,extra={})=>({id,productId,product:products.find(p=>p.id===productId)?.name||'Referencia histórica',
  sku:products.find(p=>p.id===productId)?.sku||'REV-BAJA',type,before,after,quantity:after-before,
  date:`2026-10-${day}T15:00:00Z`,user:'revision@example.test',reason:'Operación sintética de revisión',...extra});
const movements=[move(1,1,'Alta',0,10,'01',{sku:'SKU-ANTERIOR'}),move(2,1,'Entrada',10,15,'02'),
  move(3,1,'Venta',15,12,'03',{saleId:'venta-review',unitPrice:75,total:225}),
  move(4,1,'Ajuste',12,12,'04',{reason:'Edición descriptiva de producto'}),move(5,1,'Ajuste',12,16,'05'),move(6,1,'Ajuste',16,14,'06'),
  ...Array.from({length:30},(_,i)=>move(100+i,2,i===0?'Alta':'Entrada',i,i+1,'01')),
  move(201,3,'Entrada',10,12,'03'),move(301,99,'Alta',0,3,'02'),move(302,99,'Baja',3,0,'03'),
  move(401,null,'Entrada',5,7,'04',{sku:'REV-SIN-ID'}),
];
export const kardexReview={products,movements,categories:[{id:'c1',name:'Periféricos'}],
  sales:[{id:'venta-review',productId:1,product:products[0].name,sku:'REV-M01',quantity:3,unitPrice:75,total:225,movementId:'3',date:'2026-10-03T15:00:00Z',user:'revision@example.test'}],
  salesEnabled:true,stockEnabled:true,readOnly:false};
