import test from 'node:test';
import assert from 'node:assert/strict';
import {visionFileError,visionDimensionsError,MAX_IMAGE_BYTES} from '../src/modules/inventario/pages/visionData.js';
test('visión: tipos reales, tamaño y dimensiones de las imágenes',()=>{
  for(const type of ['image/jpeg','image/png','image/webp'])assert.equal(visionFileError({type,size:100}), '');
  for(const file of [null,{type:'image/svg+xml',size:100},{type:'image/png',size:0},{type:'image/png',size:MAX_IMAGE_BYTES+1}])assert.ok(visionFileError(file));
  assert.equal(visionDimensionsError(960,1280),'');
  for(const [w,h] of [[31,100],[8193,32],[4001,4000]])assert.ok(visionDimensionsError(w,h));
});
