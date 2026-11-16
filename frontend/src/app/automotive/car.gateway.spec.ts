import {it,expect,vi} from 'vitest';
import {CarGateway} from './car.gateway';

it('sends every photo in order, including photos beyond twelve',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({text:'Результат'}),{status:200}));
 try{
  const photos=Array.from({length:20},(_,i)=>({id:String(i),name:i+'.jpg',type:'image/jpeg',dataUrl:'data:image/jpeg;base64,'+i}));
  await new CarGateway().recognizePhotos(photos);
  const body=JSON.parse(fetch.mock.calls[0][1]!.body as string);
  expect(body.images).toEqual(photos.map(p=>p.dataUrl));
 }finally{fetch.mockRestore();}
});
