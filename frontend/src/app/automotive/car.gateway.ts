import {Injectable} from '@angular/core';
import {api,extension,optimizePhoto,type Photo} from '../../../../lib/workspace';
import type {CarSchema,CarCard,CarOption,CarPrepared,CarAnalysis,CarPhotoRecognition,CarCandidates} from './car-models';
const path='workspace/categories/cars_used_sale/';
@Injectable({providedIn:'root'})
export class CarGateway {
 editor(){return api<CarSchema>(path+'editor');}
 options(field:string,parent='',query='',offset=0){return api<{items:CarOption[];total:number}>(path+'options?'+new URLSearchParams({field,parent,query,offset:String(offset)}));}
 selection(node:string){return api<{path:CarOption[]}>(path+'selection?'+new URLSearchParams({node}));}
 prepare(card:CarCard){return api<CarPrepared>(path+'prepare',card);}
 analyze(description:string,recognizedText:string,photoAnalysis?:CarCandidates){return api<CarAnalysis>(path+'analyze',{description,recognizedText,photoAnalysis});}
 recognizePhotos(photos:Photo[]){return api<CarPhotoRecognition>(path+'recognize-photos',{images:photos.map(p=>p.dataUrl)});}
 extension(type:string,payload?:unknown){return extension(type,payload,type==='RENTAL_RUN'?30000:6000);}
 async photos(files:File[]){const result:Photo[]=[];for(const file of files)result.push(await optimizePhoto(file));return result;}
}
