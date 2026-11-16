import {describe,it,expect,vi} from 'vitest';
import {CarEditorComponent} from './car-editor.component';
import {CarGateway} from './car.gateway';

describe('car extension connection',()=>{
 it('rechecks a failed initial connection before launching exactly once',async()=>{
  const extension=vi.fn().mockRejectedValueOnce(new Error('Нет связи с расширением.'))
   .mockResolvedValueOnce({version:'0.9.32',capabilities:['cars-publishing-v1']})
   .mockResolvedValueOnce({jobs:[]});
  const c=new CarEditorComponent({extension} as unknown as CarGateway);
  await c.connect();expect(c.ready).toBe(false);
  await c.publish();expect(c.ready).toBe(true);expect(c.error).toBe('');
  expect(extension.mock.calls.map(call=>call[0])).toEqual(['PING','PING','RENTAL_RUN']);
 });
 it('shows the actual connection failure and does not launch',async()=>{
  const message='Обновите вкладку Автопоста: она потеряла связь с расширением.';
  const extension=vi.fn().mockRejectedValue(new Error(message));
  const c=new CarEditorComponent({extension} as unknown as CarGateway);
  await c.publish();expect(c.ready).toBe(false);expect(c.error).toBe(message);
  expect(extension.mock.calls.map(call=>call[0])).toEqual(['PING']);
 });
 it('rejects a connected helper without car support and ignores foreign ready events',async()=>{
  const extension=vi.fn().mockResolvedValue({version:'0.9.1',capabilities:[]});
  const c=new CarEditorComponent({extension} as unknown as CarGateway);
  c.onExtensionReady(new MessageEvent('message',{origin:'https://foreign.example',data:{source:'autopost-extension',type:'READY'}}));
  expect(extension).not.toHaveBeenCalled();await c.publish();expect(c.error).toContain('не поддерживает автомобили');expect(extension).toHaveBeenCalledTimes(1);
 });
 it('deduplicates simultaneous handshakes and ignores results after destruction',async()=>{
  let resolve!:(v:unknown)=>void;const extension=vi.fn(()=>new Promise(r=>resolve=r));
  const c=new CarEditorComponent({extension} as unknown as CarGateway);
  const a=c.connect(),b=c.connect();expect(extension).toHaveBeenCalledTimes(1);c.ngOnDestroy();
  resolve({capabilities:['cars-publishing-v1']});await Promise.all([a,b]);expect(c.ready).toBe(false);
 });
});
