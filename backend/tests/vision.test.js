import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { createApi } from '../src/app.js';
import { createVisionService, readImage, readVideo, validateVisionResult, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '../src/modules/vision/visionService.js';

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
test('visión: MP4 se valida por MIME, firma y tamaño',async()=>{
  const bytes=Buffer.alloc(16);bytes.write('ftyp',4,'ascii');
  const req=Readable.from([bytes]);req.headers={'content-type':'video/mp4','content-length':String(bytes.length)};
  assert.equal((await readVideo(req)).length,16);
  const wrong=Readable.from([Buffer.from('not mp4')]);wrong.headers={'content-type':'video/mp4','content-length':'7'};
  await assert.rejects(readVideo(wrong),e=>e.status===415);
  const large=Readable.from([]);large.headers={'content-type':'video/mp4','content-length':String(MAX_VIDEO_BYTES+1)};
  await assert.rejects(readVideo(large),e=>e.status===413);
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
test('visión: proxy video permanece en loopback y valida resumen ByteTrack',async()=>{
  const bytes=Buffer.alloc(16);bytes.write('ftyp',4,'ascii');
  const req=Readable.from([bytes]);req.headers={'content-type':'video/mp4','content-length':'16'};
  const summary={...metadata,width:640,height:480,fps:25,totalFrames:10,processedFrames:10,line:{x:320,margin:8},
    events:[{trackId:7,type:'SALIDA',frame:6,classId:0,className:'caja-monitor',confidence:.9,box:[2,3,40,60]}],counts:{entradas:0,salidas:1},mode:'review'};
  let call;
  const service=createVisionService({fetcher:async(url,options)=>{call={url,options};return Response.json(summary);}});
  assert.deepEqual(await service.startVideo(req,{lineRatio:.4}),summary);
  assert.equal(call.url,'http://127.0.0.1:8001/video?lineRatio=0.4&leftToRight=SALIDA&rightToLeft=ENTRADA');assert.equal(call.options.headers['Content-Type'],'video/mp4');
  assert.ok(Buffer.isBuffer(call.options.body));
});
test('visión: tareas de video consultan estado, cancelan, validan resultado y exponen salida binaria',async()=>{
  const id='123e4567-e89b-42d3-a456-426614174000';
  const urls=[];
  const summary={...metadata,width:640,height:480,fps:25,totalFrames:1,processedFrames:1,line:{x:320,margin:8},events:[],counts:{entradas:0,salidas:0},elapsedSeconds:.1};
  const service=createVisionService({fetcher:async(url,options={})=>{
    urls.push({url,options});
    if(url.endsWith('/result'))return Response.json(summary);
    if(url.endsWith('/output'))return new Response(new Uint8Array([0,1,2]),{headers:{'Content-Type':'video/mp4'}});
    if(url.endsWith('/cancel'))return Response.json({status:'cancelling'});
    return Response.json({id,status:'processing',progress:48,processedFrames:48,totalFrames:100,elapsedSeconds:2});
  }});
  assert.equal((await service.videoStatus(id)).progress,48);
  assert.deepEqual((await service.videoResult(id)).events,[]);
  assert.equal((await service.cancelVideo(id)).status,'cancelling');
  assert.equal((await new Response(await service.videoOutput(id)).arrayBuffer()).byteLength,3);
  assert.throws(()=>service.videoStatus('bad'),e=>e.status===400);
  assert.equal(urls.length,4);
});
test('visión: endpoints Node exigen sesión y no acceden a Supabase ni inventario',async t=>{
  let authenticated=false,called=0;
  const server=createApi({secure:false},{clientFactory:()=>({auth:{
    signInWithPassword:async()=>{authenticated=true;return {data:{session:{},user:{id:'test'}}};},
    getUser:async()=>({data:{user:authenticated?{id:'test'}:null}}),
  }}),inventory:{},vision:{info:async()=>metadata,detect:async()=>{called++;return result;},
    startVideo:async(_req,config)=>({jobId:'123e4567-e89b-42d3-a456-426614174000',status:'queued',lineRatio:config.lineRatio}),
    videoStatus:async()=>({status:'processing',progress:35,processedFrames:35,totalFrames:100,elapsedSeconds:2}),
    videoResult:async()=>({events:[]}),cancelVideo:async()=>({status:'cancelling'}),
    videoOutput:async()=>new Response(new Uint8Array([0,1,2])).body,
    liveReset:async()=>({status:'ready'}),liveFrame:async()=>({...metadata,width:640,height:480,line:{x:320},detections:[]})}});
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
  const videoBytes=Buffer.alloc(16);videoBytes.write('ftyp',4,'ascii');
  const started=await fetch(base+'/api/vision/video?lineRatio=0.4',{method:'POST',headers:{Cookie:cookie,'Content-Type':'video/mp4'},body:videoBytes});
  assert.equal(started.status,202);assert.equal((await started.json()).lineRatio,.4);
  const status=await fetch(base+'/api/vision/video/status?jobId=123e4567-e89b-42d3-a456-426614174000',{headers:{Cookie:cookie}});
  assert.equal((await status.json()).progress,35);
  const output=await fetch(base+'/api/vision/video/output?jobId=123e4567-e89b-42d3-a456-426614174000',{headers:{Cookie:cookie}});
  assert.equal(output.headers.get('content-type'),'video/mp4');assert.equal((await output.arrayBuffer()).byteLength,3);
  const liveReset=await fetch(base+'/api/vision/live/reset?lineRatio=0.5',{method:'POST',headers:{Cookie:cookie}});
  assert.equal((await liveReset.json()).status,'ready');
  const liveFrame=await fetch(base+'/api/vision/live/frame',{method:'POST',headers:{Cookie:cookie,'Content-Type':'image/png'},body:header});
  assert.equal((await liveFrame.json()).detections.length,0);
  assert.equal((await fetch(base+'/api/vision/detect',{method:'POST',headers:{Cookie:cookie,Origin:'https://other.test'},body:header})).status,403);
});
