import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { createApi } from '../src/app.js';
import { createVisionService, readImage, validateVisionResult, MAX_IMAGE_BYTES } from '../src/modules/vision/visionService.js';

const header=Buffer.from([137,80,78,71,13,10,26,10]);
const metadata={model:'monitores_v1/best.pt',classes:[{id:0,name:'caja-monitor'}],imageSize:640,confidenceThreshold:0.25};
const result={...metadata,width:640,height:480,elapsedMs:100,detections:[{classId:0,className:'caja-monitor',confidence:0.9,box:[1,2,200,300]}]};
function request(bytes=header,type='image/png'){
  const req=Readable.from([bytes]);req.headers={'content-type':type,'content-length':String(bytes.length)};return req;
}
test('visión: límites y formato binario antes de enviar al modelo',async()=>{
  assert.equal((await readImage(request())).bytes.length,8);
  await assert.rejects(readImage(request(Buffer.from('<svg>'),'image/svg+xml')),e=>e.status===415);
  await assert.rejects(readImage(request(Buffer.from('not png'))),e=>e.status===415);
  const large=request();large.headers['content-length']=String(MAX_IMAGE_BYTES+1);
  await assert.rejects(readImage(large),e=>e.status===413);
  const chunked=request(Buffer.alloc(MAX_IMAGE_BYTES+1));delete chunked.headers['content-length'];
  await assert.rejects(readImage(chunked),e=>e.status===413);
  await assert.rejects(readImage(request(Buffer.alloc(0))),e=>e.status===413);
});
test('visión: valida clases, confianza, coordenadas y ausencia de detecciones',()=>{
  assert.equal(validateVisionResult(result,true),result);
  assert.deepEqual(validateVisionResult({...result,detections:[]},true).detections,[]);
  for(const change of [{className:'Producto inventado'},{confidence:2},{box:[0,0,900,600]},{box:[20,20,10,10]}])
    assert.throws(()=>validateVisionResult({...result,detections:[{...result.detections[0],...change}]},true));
  assert.throws(()=>validateVisionResult({...result,model:'yolov8n.pt'},true));
});
test('visión: proxy loopback, timeouts, errores y varias imágenes consecutivas',async()=>{
  const calls=[];
  const service=createVisionService({fetcher:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/health')?metadata:result);}});
  await service.info();await service.detect(request());await service.detect(request());
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.url.startsWith('http://127.0.0.1:8001/')));
  assert.ok(Buffer.isBuffer(calls[1].options.body));assert.equal(calls[1].options.headers['Content-Type'],'image/png');
  const offline=createVisionService({fetcher:async()=>{throw Error('offline');}});
  await assert.rejects(offline.info(),e=>e.status===503);
  const timeout=createVisionService({fetcher:async()=>{throw Object.assign(Error(),{name:'TimeoutError'});}});
  await assert.rejects(timeout.detect(request()),e=>e.status===504);
  const rejected=createVisionService({fetcher:async()=>Response.json({error:'Formato inválido'},{status:400})});
  await assert.rejects(rejected.detect(request()),e=>e.status===400);
});
test('visión: un único análisis simultáneo y recuperación del bloqueo',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const service=createVisionService({fetcher:async()=>{await wait;return Response.json(result);}});
  const running=service.detect(request());
  await assert.rejects(service.detect(request()),e=>e.status===429);
  release();await running;await service.detect(request());
});
test('visión: endpoints Node exigen sesión y no acceden a Supabase ni inventario',async t=>{
  let authenticated=false,called=0;
  const server=createApi({secure:false},{clientFactory:()=>({auth:{
    signInWithPassword:async()=>{authenticated=true;return {data:{session:{},user:{id:'test'}}};},
    getUser:async()=>({data:{user:authenticated?{id:'test'}:null}}),
  }}),inventory:{},vision:{info:async()=>metadata,detect:async()=>{called++;return result;}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/vision/model')).status,401);
  assert.equal((await fetch(base+'/api/vision/detect',{method:'POST',body:header})).status,401);
  assert.equal(called,0);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.test',password:'test-password'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+'/api/vision/detect',{method:'POST',headers:{Cookie:cookie,'Content-Type':'image/png'},body:header});
  assert.equal(response.status,200);assert.equal(called,1);
  assert.equal((await response.json()).model,'monitores_v1/best.pt');
  assert.equal((await fetch(base+'/api/vision/detect',{method:'POST',headers:{Cookie:cookie,Origin:'https://other.test'},body:header})).status,403);
});
