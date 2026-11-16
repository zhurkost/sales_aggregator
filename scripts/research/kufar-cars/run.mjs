import {parseArgs} from 'node:util';
import {collect} from './collect.mjs';
import {build} from './normalize.mjs';
import {report} from './report.mjs';

const {values}=parseArgs({options:{directory:{type:'string',default:'work/kufar-cars-used'},output:{type:'string',default:'data/parsing/cars_used_sale'},'max-requests':{type:'string',default:'Infinity'},interval:{type:'string',default:'1100'},'allow-partial':{type:'boolean',default:false},'normalize-only':{type:'boolean',default:false}}});
if(!values['normalize-only']){
  const result=await collect({directory:values.directory,maxRequests:Number(values['max-requests']),interval:Number(values.interval)});
  if(!result.complete&&!values['allow-partial'])throw Error('Crawl paused; checkpoint saved. Resume with the same directory. Final files were not overwritten.');
}
const stats=build({directory:values.directory,output:values.output,allowPartial:values['allow-partial']});
report({output:values.output});
console.log(JSON.stringify({validated:true,...stats}));
